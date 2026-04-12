/**
 * YTM Player Bridge — writes state to window.__VIBEYTM_STATE__
 * AND tries to use Tauri IPC if available.
 */
(function () {
  'use strict';

  window.__VIBEYTM_STATE__ = null;
  window.__VIBEYTM_DEBUG__ = [];

  function log(msg) {
    window.__VIBEYTM_DEBUG__.push(new Date().toISOString() + ': ' + msg);
    if (window.__VIBEYTM_DEBUG__.length > 50) window.__VIBEYTM_DEBUG__.shift();
  }

  function getPlayer() {
    var el = document.querySelector('#movie_player');
    return el && typeof el.getPlayerState === 'function' ? el : null;
  }

  function update() {
    var player = getPlayer();
    if (!player) return;

    var stateMap = { 1: 'playing', 2: 'paused', 3: 'buffering' };
    var rawState = player.getPlayerState();

    var titleEl = document.querySelector('.title.ytmusic-player-bar');
    var artistEl = document.querySelector('.byline.ytmusic-player-bar a:first-of-type');
    var imgEl = document.querySelector('.image.ytmusic-player-bar img');

    // Get video ID — prefer getVideoData() (authoritative) over URL (may lag)
    var videoId = '';
    try {
      var vdata = player.getVideoData ? player.getVideoData() : null;
      if (vdata && vdata.video_id) videoId = vdata.video_id;
    } catch(e) {}
    if (!videoId) {
      videoId = new URLSearchParams(window.location.search).get('v') || '';
    }

    // If Rust requested a specific track but the YTM player is still on the
    // previous track, don't overwrite state with stale data. Once the player
    // matches the target, clear the target.
    var target = window.__VIBEYTM_TARGET_VID__;
    if (target) {
      if (videoId && videoId === target) {
        // Target reached — clear it and report fresh state
        window.__VIBEYTM_TARGET_VID__ = null;
      } else {
        // Still loading target — don't report stale state
        return;
      }
    }

    // Get artwork from multiple possible selectors
    var artworkUrl = '';
    if (imgEl && imgEl.src) {
      artworkUrl = imgEl.src.replace(/w\d+-h\d+/, 'w512-h512');
    }
    if (!artworkUrl) {
      var altImg = document.querySelector('ytmusic-player-bar .middle-controls img, .song-image img, img.ytmusic-player-bar');
      if (altImg && altImg.src) artworkUrl = altImg.src.replace(/w\d+-h\d+/, 'w512-h512');
    }
    if (!artworkUrl && videoId) {
      artworkUrl = 'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg';
    }

    // --- Read shuffle / repeat / like state from the player bar DOM ---
    var bar = document.querySelector('ytmusic-player-bar');
    // Shuffle: YTM stores it as queue.shuffleEnabled, mirrored on the
    // player bar. Some builds expose `shuffle-on` attr; others a class.
    var shuffleOn = false;
    try {
      if (bar) {
        if (bar.hasAttribute('shuffle-on')) shuffleOn = true;
        var sb = bar.querySelector('.shuffle');
        if (sb && (sb.getAttribute('aria-pressed') === 'true' || sb.classList.contains('style-default-active'))) {
          shuffleOn = true;
        }
      }
    } catch(e) {}

    // Repeat mode: derive from the player bar attr first, then fall back
    // to the repeat button's aria-label which is the most stable contract.
    // YTM's aria-label is one of: "Repeat off", "Repeat all", "Repeat one".
    var repeatMode = 'none';
    try {
      if (bar) {
        var attr = (bar.getAttribute('repeat-mode') || '').toUpperCase();
        if (attr === 'ALL_REPEAT' || attr === 'ALL') {
          repeatMode = 'all';
        } else if (attr === 'ONE_REPEAT' || attr === 'ONE') {
          repeatMode = 'one';
        } else {
          var rbtn = bar.querySelector('[aria-label^="Repeat" i]');
          if (rbtn) {
            var rl = (rbtn.getAttribute('aria-label') || '').toLowerCase();
            if (rl.indexOf('all') !== -1) repeatMode = 'all';
            else if (rl.indexOf('one') !== -1) repeatMode = 'one';
            else repeatMode = 'none';
          }
        }
      }
    } catch(e) {}

    // Like status: 'LIKE' | 'DISLIKE' | 'INDIFFERENT'
    var isLiked = false;
    try {
      var likeRenderer = document.querySelector('ytmusic-player-bar ytmusic-like-button-renderer');
      if (likeRenderer) {
        var ls = likeRenderer.getAttribute('like-status') || '';
        isLiked = ls === 'LIKE';
      }
    } catch(e) {}

    window.__VIBEYTM_STATE__ = {
      status: stateMap[rawState] || 'idle',
      title: titleEl ? titleEl.textContent.trim() : '',
      artist: artistEl ? artistEl.textContent.trim() : '',
      album: '',
      artworkUrl: artworkUrl,
      videoId: videoId,
      positionSecs: player.getCurrentTime() || 0,
      durationSecs: player.getDuration() || 0,
      volume: (player.getVolume() || 0) / 100,
      isShuffled: shuffleOn,
      repeatMode: repeatMode,
      isLiked: isLiked,
    };

    // Try Tauri IPC if available
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
      try {
        window.__TAURI__.core.invoke('on_track_changed', {
          track: window.__VIBEYTM_STATE__
        });
      } catch(e) { /* ignore */ }
    }
  }

  window.__VIBEYTM_COMMAND__ = function (cmd, args) {
    var player = getPlayer();
    if (!player) return;
    // Optimistically reflect the new status into __VIBEYTM_STATE__ so the
    // poller picks it up on the next cycle without waiting for YTM's DOM
    // observers to fire. update() will reconcile shortly with authoritative
    // state from getPlayerState().
    function setStatusOptimistic(s) {
      if (window.__VIBEYTM_STATE__) {
        window.__VIBEYTM_STATE__.status = s;
      }
    }
    switch (cmd) {
      case 'play':
        player.playVideo();
        setStatusOptimistic('playing');
        break;
      case 'pause':
        player.pauseVideo();
        setStatusOptimistic('paused');
        break;
      case 'toggle_play':
        if (player.getPlayerState() === 1) {
          player.pauseVideo();
          setStatusOptimistic('paused');
        } else {
          player.playVideo();
          setStatusOptimistic('playing');
        }
        break;
      case 'next': player.nextVideo(); break;
      case 'previous': player.previousVideo(); break;
      case 'seek':
        if (args && typeof args.secs === 'number') player.seekTo(args.secs, true);
        break;
      case 'set_volume':
        if (args && typeof args.level === 'number') player.setVolume(Math.round(args.level * 100));
        break;
      case 'toggle_shuffle': {
        // Find by aria-label inside the player bar — stable across YTM
        // versions. The label varies (e.g. "Shuffle off", "Shuffle on")
        // so use a prefix match. Scope strictly to ytmusic-player-bar so
        // we can never accidentally hit the next/prev buttons.
        var bar = document.querySelector('ytmusic-player-bar');
        var sb = null;
        if (bar) {
          sb = bar.querySelector('[aria-label^="Shuffle" i]')
            || bar.querySelector('.shuffle')
            || bar.querySelector('tp-yt-paper-icon-button.shuffle');
        }
        if (sb) {
          sb.click();
          if (window.__VIBEYTM_STATE__) {
            window.__VIBEYTM_STATE__.isShuffled = !window.__VIBEYTM_STATE__.isShuffled;
          }
        }
        break;
      }
      case 'cycle_repeat': {
        // Single click cycles NONE → ALL → ONE → NONE. NEVER advances the
        // current song — we explicitly target the repeat button by aria
        // label and never fall back to a wider selector that could pick
        // the next/prev button.
        var bar2 = document.querySelector('ytmusic-player-bar');
        var rb = null;
        if (bar2) {
          // Order matters: try the most specific match first.
          rb = bar2.querySelector('[aria-label^="Repeat" i]')
            || bar2.querySelector('button[aria-label*="repeat" i]')
            || bar2.querySelector('tp-yt-paper-icon-button.repeat-button')
            || bar2.querySelector('tp-yt-paper-icon-button.repeat');
          // Defensive: if the matched element accidentally has "next" or
          // "previous" in its aria-label, drop it — we'd rather no-op than
          // skip a song.
          if (rb) {
            var lbl = (rb.getAttribute('aria-label') || '').toLowerCase();
            if (lbl.indexOf('next') !== -1 || lbl.indexOf('previous') !== -1) {
              rb = null;
            }
          }
        }
        if (rb) {
          rb.click();
          if (window.__VIBEYTM_STATE__) {
            var cur = window.__VIBEYTM_STATE__.repeatMode || 'none';
            window.__VIBEYTM_STATE__.repeatMode =
              cur === 'none' ? 'all' : cur === 'all' ? 'one' : 'none';
          }
        } else {
          log('cycle_repeat: repeat button not found');
        }
        break;
      }
      case 'toggle_like': {
        // The like-button-renderer wraps a thumbs-up button. Click toggles
        // between LIKE and INDIFFERENT.
        var lr = document.querySelector('ytmusic-player-bar ytmusic-like-button-renderer');
        var lb = lr && (
          lr.querySelector('#button-shape-like button') ||
          lr.querySelector('button[aria-label*="Like" i]') ||
          lr.querySelector('yt-button-shape:first-of-type button')
        );
        if (lb) {
          lb.click();
          if (window.__VIBEYTM_STATE__) {
            window.__VIBEYTM_STATE__.isLiked = !window.__VIBEYTM_STATE__.isLiked;
          }
        }
        break;
      }
    }
  };

  function waitForPlayer() {
    if (getPlayer()) {
      log('player found');
      setInterval(update, 150);
      update();
    } else {
      log('waiting for player...');
      setTimeout(waitForPlayer, 1000);
    }
  }

  if (window.location.hostname === 'music.youtube.com') {
    log('bridge loaded on ' + window.location.href);
    log('__TAURI__ available: ' + (typeof window.__TAURI__ !== 'undefined'));
    log('__TAURI_INTERNALS__ available: ' + (typeof window.__TAURI_INTERNALS__ !== 'undefined'));
    waitForPlayer();
  }
})();
