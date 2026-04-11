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
    // Get video ID from URL params or from the player's video data
    var videoId = new URLSearchParams(window.location.search).get('v') || '';
    if (!videoId) {
      try {
        var vdata = player.getVideoData ? player.getVideoData() : null;
        if (vdata && vdata.video_id) videoId = vdata.video_id;
      } catch(e) {}
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
    switch (cmd) {
      case 'play': player.playVideo(); break;
      case 'pause': player.pauseVideo(); break;
      case 'toggle_play':
        player.getPlayerState() === 1 ? player.pauseVideo() : player.playVideo();
        break;
      case 'next': player.nextVideo(); break;
      case 'previous': player.previousVideo(); break;
      case 'seek':
        if (args && typeof args.secs === 'number') player.seekTo(args.secs, true);
        break;
      case 'set_volume':
        if (args && typeof args.level === 'number') player.setVolume(Math.round(args.level * 100));
        break;
    }
  };

  function waitForPlayer() {
    if (getPlayer()) {
      log('player found');
      setInterval(update, 250);
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
