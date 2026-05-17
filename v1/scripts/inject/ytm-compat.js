/**
 * YTM Compatibility Script
 *
 * Runs on every page load via Tauri initialization_script.
 * 1. Spoofs Chrome user agent at JS level so YTM doesn't show "unsupported browser"
 * 2. Removes any warning overlays
 * 3. Detects login completion and auto-hides the YTM window
 */
(function () {
  'use strict';

  // DEBUG: Create a visible indicator that this script ran
  document.addEventListener('DOMContentLoaded', function() {
    var d = document.createElement('div');
    d.id = 'vibeytm-debug';
    d.style.cssText = 'position:fixed;top:0;left:0;right:0;background:lime;color:black;padding:4px 8px;z-index:999999;font-size:12px;text-align:center;';
    d.textContent = 'VibeYTM Bridge Active — ' + new Date().toLocaleTimeString();
    document.body.appendChild(d);
    setTimeout(function() { d.remove(); }, 5000);
  });

  // --- 1. Spoof Chrome user agent at JS level ---
  Object.defineProperty(navigator, 'userAgent', {
    get: function () {
      return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    },
  });

  if (!navigator.userAgentData) {
    Object.defineProperty(navigator, 'userAgentData', {
      get: function () {
        return {
          brands: [
            { brand: 'Google Chrome', version: '131' },
            { brand: 'Chromium', version: '131' },
            { brand: 'Not_A Brand', version: '24' },
          ],
          mobile: false,
          platform: 'macOS',
        };
      },
    });
  }

  // --- 2. Remove unsupported browser warnings ---
  function removeBrowserWarnings() {
    var selectors = [
      'ytmusic-you-there-renderer',
      '.ytmusic-unsupported-browser',
      '[class*="unsupported"]',
      '.yt-upsell-dialog-renderer',
    ];
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        el.remove();
      });
    });
    document.querySelectorAll('paper-button, tp-yt-paper-button').forEach(function (btn) {
      var text = (btn.textContent || '').toLowerCase().trim();
      if (text === 'dismiss' || text === 'continue' || text === 'got it') {
        btn.click();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removeBrowserWarnings);
  } else {
    removeBrowserWarnings();
  }

  var warningAttempts = 0;
  var warningInterval = setInterval(function () {
    removeBrowserWarnings();
    warningAttempts++;
    if (warningAttempts > 10) clearInterval(warningInterval);
  }, 1000);

  // --- 3. Auto-hide YTM window after login ---
  // Detect when we're on music.youtube.com and logged in (avatar visible)
  var loginCheckAttempts = 0;
  var loginCheckInterval = setInterval(function () {
    loginCheckAttempts++;

    // Only check on music.youtube.com, not on auth pages
    if (!window.location.hostname.endsWith('music.youtube.com')) {
      return;
    }

    // Check for signs of a logged-in user:
    // - The avatar button in the top-right
    // - The guide/navigation being loaded
    var avatar = document.querySelector(
      'tp-yt-paper-icon-button.ytmusic-nav-bar img, ' +
      'img.yt-spec-avatar-shape__button, ' +
      '#avatar-btn img, ' +
      'button[aria-label="Account"] img'
    );
    var playerBar = document.querySelector('ytmusic-player-bar');

    if (avatar || playerBar) {
      // User is logged in — notify Rust to hide this window
      if (window.__TAURI__) {
        window.__TAURI__.core.invoke('hide_ytm').catch(function () {});
      }
      clearInterval(loginCheckInterval);
    }

    // Stop checking after 2 minutes
    if (loginCheckAttempts > 120) {
      clearInterval(loginCheckInterval);
    }
  }, 1000);
})();
