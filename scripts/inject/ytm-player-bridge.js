/**
 * YTM Player Bridge — writes state to window.__VIBEYTM_STATE__
 * AND tries to use Tauri IPC if available.
 */
(function () {
  'use strict';

  window.__VIBEYTM_STATE__ = null;
  window.__VIBEYTM_DEBUG__ = [];
  // Tri-state: true = signed in, false = signed out, null = undetermined.
  // Tracked independently of __VIBEYTM_STATE__ because we need it before the
  // music player DOM exists (on the sign-in page there is no player yet).
  window.__VIBEYTM_LOGGED_IN__ = null;
  // { name: string, avatarUrl: string } once the nav-bar avatar is rendered.
  window.__VIBEYTM_ACCOUNT__ = null;

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
    // Prefer the expanded song-image (right-hand now-playing panel) because
    // it shows the *album* artwork even for songs that also have a music
    // video — issue #39. The small bar thumbnail is our second choice and
    // the bar's ytmusic-player-bar image is the last resort.
    var imgEl =
      document.querySelector('ytmusic-player-page .song-image img') ||
      document.querySelector('ytmusic-player-page img.thumbnail-image') ||
      document.querySelector('.image.ytmusic-player-bar img');

    // Get video ID — prefer getVideoData() (authoritative) over URL (may lag)
    var videoId = '';
    var vdata = null;
    try {
      vdata = player.getVideoData ? player.getVideoData() : null;
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

    // YTM's getDuration() returns 0 for a few cycles while the <video>
    // element buffers, and on some tracks it reports a fractional/buffered
    // length (4:12 shown as 0:29). getVideoData().lengthSeconds is the
    // authoritative track length published by the player metadata. Prefer
    // it when present and only fall back to getDuration() otherwise.
    var lengthFromData = 0;
    try {
      if (vdata && typeof vdata.lengthSeconds !== 'undefined') {
        lengthFromData = Number(vdata.lengthSeconds) || 0;
      }
    } catch(e) {}
    var rawDuration = player.getDuration() || 0;
    var durationSecs = lengthFromData > 0 ? lengthFromData : rawDuration;

    window.__VIBEYTM_STATE__ = {
      status: stateMap[rawState] || 'idle',
      title: titleEl ? titleEl.textContent.trim() : '',
      artist: artistEl ? artistEl.textContent.trim() : '',
      album: '',
      artworkUrl: artworkUrl,
      videoId: videoId,
      positionSecs: player.getCurrentTime() || 0,
      durationSecs: durationSecs,
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

  /**
   * Watchdog for issue #40: songs occasionally start, then stall at 0:00
   * with status "playing" or "buffering" — the <video> element is ready
   * but playback never actually begins. If we stay at position 0 for
   * STUCK_THRESHOLD_MS without any progress, nudge YTM with a play() call
   * (and, on a second offense, re-seek to 0) to kick the pipeline awake.
   */
  var STUCK_THRESHOLD_MS = 4000;
  var lastPositionSample = -1;
  var stuckSinceMs = 0;
  var stuckRetries = 0;
  function checkStuck() {
    var s = window.__VIBEYTM_STATE__;
    if (!s || !s.videoId) {
      stuckSinceMs = 0;
      stuckRetries = 0;
      return;
    }
    // Only watch when YTM claims to be playing or buffering — a deliberately
    // paused track at 0s isn't stuck.
    if (s.status !== 'playing' && s.status !== 'buffering') {
      stuckSinceMs = 0;
      stuckRetries = 0;
      lastPositionSample = s.positionSecs;
      return;
    }
    var pos = s.positionSecs || 0;
    if (pos > 0.25 || pos !== lastPositionSample) {
      // Progress is happening (or at least the position moved) — reset.
      if (pos > lastPositionSample) {
        stuckSinceMs = 0;
        stuckRetries = 0;
      }
      lastPositionSample = pos;
      if (pos > 0.25) return;
    }
    if (stuckSinceMs === 0) {
      stuckSinceMs = Date.now();
      return;
    }
    if (Date.now() - stuckSinceMs < STUCK_THRESHOLD_MS) return;

    var player = getPlayer();
    if (!player) return;
    log('stuck at 0s for ' + (Date.now() - stuckSinceMs) + 'ms — retry ' + stuckRetries);
    try {
      if (stuckRetries === 0) {
        player.playVideo();
      } else if (stuckRetries === 1) {
        player.seekTo(0, true);
        player.playVideo();
      } else {
        // Last resort: reload the same track via a fresh navigation. Using
        // the anchor-click SPA path avoids a full page reload.
        var a = document.createElement('a');
        a.href = '/watch?v=' + s.videoId;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function(){ try { document.body.removeChild(a); } catch(e){} }, 100);
      }
    } catch(e) {}
    stuckRetries += 1;
    stuckSinceMs = Date.now();
  }

  function waitForPlayer() {
    if (getPlayer()) {
      log('player found');
      setInterval(update, 150);
      setInterval(checkStuck, 1000);
      update();
    } else {
      log('waiting for player...');
      setTimeout(waitForPlayer, 1000);
    }
  }

  /**
   * Detect YouTube Music sign-in state from the nav bar. Runs on a 1.5s
   * interval regardless of player presence because on the sign-in flow the
   * music player DOM hasn't been constructed yet.
   */
  function checkLoginStatus() {
    try {
      var avatar = document.querySelector(
        'ytmusic-nav-bar #avatar-btn, ytmusic-nav-bar ytmusic-settings-button img'
      );
      var signIn = document.querySelector(
        'ytmusic-nav-bar a[href*="accounts.google.com"], ytmusic-nav-bar a[aria-label*="Sign in" i]'
      );
      if (avatar) {
        window.__VIBEYTM_LOGGED_IN__ = true;
      } else if (signIn) {
        window.__VIBEYTM_LOGGED_IN__ = false;
      }
    } catch (e) {
      // Leave last-known value in place on transient DOM errors.
    }
  }

  /**
   * Read avatar URL from the nav-bar avatar button. The button's aria-label
   * is usually the generic "Account menu" string, so for the real display
   * name we query YTM's internal accounts_list endpoint (see fetchAccountFromApi).
   */
  function readAvatarFromDom() {
    try {
      var btn = document.querySelector('ytmusic-nav-bar #avatar-btn')
        || document.querySelector('ytmusic-nav-bar tp-yt-paper-icon-button[aria-label*="Account" i]')
        || document.querySelector('ytmusic-nav-bar ytmusic-settings-button');
      if (!btn) return '';
      var img = btn.querySelector('img')
        || document.querySelector('ytmusic-nav-bar yt-img-shadow img, ytmusic-nav-bar img.yt-img-shadow');
      if (!img) return '';
      var src = img.src || img.getAttribute('src') || img.getAttribute('data-src') || '';
      return src.replace(/=s\d+(-.+)?$/, '=s96-c');
    } catch (e) {
      return '';
    }
  }

  /**
   * Call /youtubei/v1/account/account_menu with a SAPISIDHASH Authorization
   * header so YouTube returns the full response containing
   * `activeAccountHeaderRenderer` (which has the account name and photo).
   *
   * Authorization format — reverse-engineered and documented by the
   * ytmusicapi python library:
   *   SAPISIDHASH <ts>_<sha1(ts + " " + SAPISID + " " + origin)>
   * The SAPISID value lives in the __Secure-3PAPISID cookie (same-origin,
   * not HttpOnly for YouTube properties).
   */
  var fetchInflight = false;
  var fetchAttempts = 0;

  function readSapisidCookie() {
    var parts = document.cookie.split('; ');
    for (var i = 0; i < parts.length; i += 1) {
      var eq = parts[i].indexOf('=');
      if (eq < 0) continue;
      var k = parts[i].substring(0, eq);
      if (k === '__Secure-3PAPISID' || k === 'SAPISID') {
        return parts[i].substring(eq + 1);
      }
    }
    return null;
  }

  async function sapisidHash(sapisid, origin) {
    var ts = Math.floor(Date.now() / 1000);
    var payload = ts + ' ' + sapisid + ' ' + origin;
    var bytes = new TextEncoder().encode(payload);
    var buf = await crypto.subtle.digest('SHA-1', bytes);
    var hex = '';
    var arr = new Uint8Array(buf);
    for (var i = 0; i < arr.length; i += 1) {
      var h = arr[i].toString(16);
      hex += h.length === 1 ? '0' + h : h;
    }
    return 'SAPISIDHASH ' + ts + '_' + hex;
  }

  function fetchAccountFromApi() {
    if (fetchInflight) return;
    if (window.__VIBEYTM_ACCOUNT__ && window.__VIBEYTM_ACCOUNT__.name) return;
    if (fetchAttempts > 8) return;
    var cfg = window.ytcfg;
    var apiKey = cfg && (cfg.get ? cfg.get('INNERTUBE_API_KEY') : cfg.data_ && cfg.data_.INNERTUBE_API_KEY);
    var context = cfg && (cfg.get ? cfg.get('INNERTUBE_CONTEXT') : cfg.data_ && cfg.data_.INNERTUBE_CONTEXT);
    if (!apiKey || !context) {
      log('fetchAccount: ytcfg not ready');
      return;
    }
    var sapisid = readSapisidCookie();
    if (!sapisid) {
      log('fetchAccount: no SAPISID cookie (not signed in?)');
      return;
    }
    fetchInflight = true;
    fetchAttempts += 1;

    var origin = 'https://music.youtube.com';
    sapisidHash(sapisid, origin).then(function (auth) {
      var url = '/youtubei/v1/account/account_menu?prettyPrint=false&key=' + encodeURIComponent(apiKey);
      return fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': auth,
          'X-Origin': origin,
          'X-Goog-AuthUser': '0',
        },
        body: JSON.stringify({ context: context }),
      });
    })
      .then(function (r) {
        log('fetchAccount: status=' + r.status);
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        fetchInflight = false;
        if (!data) return;
        var header = findActiveAccountHeader(data);
        if (!header) {
          log('fetchAccount: no activeAccountHeaderRenderer');
          return;
        }
        var name = runsText(header.accountName) || simpleTextOf(header.accountName);
        var thumbs = header.accountPhoto && header.accountPhoto.thumbnails;
        var avatar = (thumbs && thumbs.length) ? thumbs[thumbs.length - 1].url : '';
        if (!name) { log('fetchAccount: empty name'); return; }
        applyAccountInfo({ name: name, avatarUrl: avatar });
        log('fetchAccount: resolved');
      })
      .catch(function (e) {
        fetchInflight = false;
        log('fetchAccount error: ' + (e && e.message));
      });
  }

  function findActiveAccountHeader(data) {
    var found = null;
    (function visit(node) {
      if (found || !node || typeof node !== 'object') return;
      if (node.activeAccountHeaderRenderer) { found = node.activeAccountHeaderRenderer; return; }
      for (var k in node) {
        if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
        var v = node[k];
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === 'object') visit(v);
      }
    })(data);
    return found;
  }

  function runsText(node) {
    if (!node || !node.runs) return '';
    return node.runs.map(function (r) { return r.text || ''; }).join('');
  }

  function simpleTextOf(node) {
    return (node && node.simpleText) || '';
  }

  function applyAccountInfo(info) {
    var prevAvatar = (window.__VIBEYTM_ACCOUNT__ && window.__VIBEYTM_ACCOUNT__.avatarUrl) || '';
    window.__VIBEYTM_ACCOUNT__ = {
      name: info.name,
      avatarUrl: info.avatarUrl || prevAvatar || readAvatarFromDom(),
    };
  }

  function checkAccountInfo() {
    // Populate the avatar from the nav bar immediately so the sidebar has
    // something to show. The display name requires opening the account menu
    // (scrapeAccountViaMenu), which we defer until the avatar is present.
    var avatar = readAvatarFromDom();
    if (!avatar) return;
    var prev = window.__VIBEYTM_ACCOUNT__;
    if (!prev) {
      window.__VIBEYTM_ACCOUNT__ = { name: '', avatarUrl: avatar };
    } else if (!prev.avatarUrl) {
      window.__VIBEYTM_ACCOUNT__ = { name: prev.name || '', avatarUrl: avatar };
    }
    if (!window.__VIBEYTM_ACCOUNT__.name) {
      fetchAccountFromApi();
    }
  }

  if (window.location.hostname === 'music.youtube.com') {
    log('bridge loaded on ' + window.location.href);
    log('__TAURI__ available: ' + (typeof window.__TAURI__ !== 'undefined'));
    log('__TAURI_INTERNALS__ available: ' + (typeof window.__TAURI_INTERNALS__ !== 'undefined'));
    waitForPlayer();
    setInterval(checkLoginStatus, 1500);
    checkLoginStatus();
    setInterval(checkAccountInfo, 2000);
    checkAccountInfo();
  }
})();
