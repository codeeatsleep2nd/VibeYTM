#!/usr/bin/env bash
# Build a release VibeYTM.app bundle from the SPM project.
#
# Output:  app/build/VibeYTM.app
# Usage:   bash app/build.sh
#          bash app/build.sh --debug         # debug build (faster, larger)
#          bash app/build.sh --install       # also copy to ~/Applications
#
# This script exists because we don't yet have an Xcode project — SwiftPM
# emits a bare binary, which macOS launchd can't keep alive without a
# proper bundle structure. Drag the produced VibeYTM.app to /Applications
# (or use --install) and double-click to launch.
#
# Code signing: ad-hoc (`codesign --sign -`). That's enough to satisfy
# Hardened Runtime + JIT entitlement for WKWebView's content process.
# Distribution outside this machine still needs a Developer ID signature
# from a real Xcode install — that lands once Xcode 26 is on disk.

set -euo pipefail

CONFIG="release"
INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --debug)   CONFIG="debug" ;;
    --install) INSTALL=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SPM_ROOT="$SCRIPT_DIR/VibeYTMApp"
BUILD_DIR="$SCRIPT_DIR/build"
APP="$BUILD_DIR/VibeYTM.app"

echo "[1/5] swift build -c $CONFIG …"
( cd "$SPM_ROOT" && swift build -c "$CONFIG" )

BIN_DIR="$SPM_ROOT/.build/arm64-apple-macosx/$CONFIG"
EXEC="$BIN_DIR/VibeYTMApp"
RES_BUNDLE="$BIN_DIR/YTMBridge_YTMBridge.bundle"

[ -x "$EXEC" ]    || { echo "missing executable: $EXEC" >&2; exit 1; }
[ -d "$RES_BUNDLE" ] || { echo "missing resource bundle: $RES_BUNDLE" >&2; exit 1; }

echo "[2/5] assembling .app bundle at $APP …"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$EXEC" "$APP/Contents/MacOS/VibeYTM"
cp -R "$RES_BUNDLE" "$APP/Contents/MacOS/"

# SPM's resource bundle ships without an Info.plist, which makes
# `codesign --deep` reject it ("bundle format unrecognized"). Inject a
# minimal one so codesign treats it as a legit resource bundle. The
# CFBundleIdentifier matches the SPM module so Bundle.module's lookup
# at runtime stays consistent.
RES_BUNDLE_DEST="$APP/Contents/MacOS/$(basename "$RES_BUNDLE")"
cat > "$RES_BUNDLE_DEST/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleIdentifier</key><string>YTMBridge.YTMBridge.resources</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>YTMBridge_YTMBridge</string>
  <key>CFBundlePackageType</key><string>BNDL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
</dict>
</plist>
PLIST

echo "[3/5] writing Info.plist …"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>VibeYTM</string>
  <!--
    Bundle ID = com.vibeytm.dev (Sprint 0 eng-review D4): preserves the
    Tauri-era WKWebsiteDataStore cookie storage so existing users don't
    re-sign-in to YouTube Music. Logger subsystem matches.
  -->
  <key>CFBundleIdentifier</key><string>com.vibeytm.dev</string>
  <key>CFBundleName</key><string>VibeYTM</string>
  <key>CFBundleDisplayName</key><string>VibeYTM</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>2.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>26.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.music</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsArbitraryLoads</key><true/></dict>
  <key>NSMicrophoneUsageDescription</key><string>Used by YTM for video conferencing pages — never recorded.</string>
  <!--
    Sprint 3 — URL scheme registration for vibeytm:// deep links.
    AppRouter.handle(deepLink:) parses these into AppRoute values.
  -->
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>com.vibeytm.dev.deeplink</string>
      <key>CFBundleURLSchemes</key>
      <array><string>vibeytm</string></array>
    </dict>
  </array>
</dict>
</plist>
PLIST

echo "[4/5] writing entitlements + signing (ad-hoc) …"
# NOTE: Apple's AMFIUnserializeXML parser rejects XML comments inside
# <dict>. Keep this entitlements XML comment-free.
#
# App Group entitlement (com.apple.security.application-groups) is
# INTENTIONALLY OMITTED from ad-hoc-signed builds.
#
# Declaring it without a Developer ID provisioning profile causes
# macOS Tahoe to:
#   1. Prompt the user on EVERY launch ("VibeYTM wants to access data
#      beyond its own folder") — incredibly annoying, can't be silenced.
#   2. Intercept the launch in a way that prevents the SwiftUI WindowGroup
#      from coming forward properly (windows materialize but stay
#      onScreen=false). Verified empirically.
#
# `SharedPlaybackSnapshotWriter` handles the missing container gracefully
# (logs once, skips writes). Re-add this block AT THE SAME TIME you
# switch to Developer ID signing (Apple Developer Program / Sprint 6
# cutover):
#
#   <key>com.apple.security.application-groups</key>
#   <array>
#     <string>group.com.vibeytm.dev</string>
#   </array>
ENT_FILE="$BUILD_DIR/VibeYTM.entitlements"
cat > "$ENT_FILE" <<'ENT'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.network.client</key><true/>
</dict>
</plist>
ENT

codesign --force --deep --sign - \
  --entitlements "$ENT_FILE" \
  --options runtime \
  "$APP"

echo "[5/5] verifying signature …"
codesign --verify --deep --verbose=2 "$APP" || {
  echo "signature verification failed" >&2
  exit 1
}

echo ""
echo "✓ VibeYTM.app built at: $APP"

if [ "$INSTALL" -eq 1 ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
  rm -rf "$DEST/VibeYTM.app"
  cp -R "$APP" "$DEST/VibeYTM.app"
  echo "✓ installed to $DEST/VibeYTM.app"

  # ── Visible-window smoke test ────────────────────────────────────────
  # Catches three classes of regression that previously shipped silently:
  #   1. NSWindow creation during App @State init (BridgeHost.start() in
  #      AppBootstrap.init blocked the WindowGroup from rendering on
  #      macOS 26 Tahoe — main window stayed onScreen=false, no dock icon)
  #   2. Entitlement-vs-signing TCC prompts (App Group entitlement on
  #      an ad-hoc-signed bundle triggered a per-launch user-trust prompt
  #      that intercepted window display)
  #   3. Auth-sync regressions (AuthWebView signed in but bridge didn't
  #      reload → app stuck on visible WebView; main window IS up but
  #      shows web UI instead of native SwiftUI)
  # (1) and (2) are caught directly. (3) requires sign-in state; it's
  # checked indirectly — if AuthWebView is the detail pane, the main
  # window will still be onScreen, so this test passes. (3) needs the
  # auth-sync XCUITest from SWIFTUI_CHECKLIST.md to fully cover.
  #
  # Disable with VERIFY_LAUNCH=0 (useful in CI without a windowserver
  # session).
  if [ "${VERIFY_LAUNCH:-1}" = "1" ]; then
    echo ""
    echo "[smoke test] verifying app launches with a visible window …"
    # Kill any running instance so we test a fresh launch.
    pkill -9 -f "$DEST/VibeYTM.app/Contents/MacOS/VibeYTM" 2>/dev/null || true
    sleep 1
    open "$DEST/VibeYTM.app"
    # Give SwiftUI a fair shake — WindowGroup mounts at first scene
    # appearance, which lands after AppBootstrap.init + the .task block
    # fires. 5 s covers a worst-case cold start on a busy machine.
    sleep 5

    # Use a Swift one-liner to query CGWindowList. The audio-engine
    # window has a fixed signature: alpha=0, x<-1000 (BridgeHost parks
    # it at x=-10000). Any OTHER VibeYTM-owned window with onScreen=true
    # counts as a visible main window.
    VISIBLE=$(swift -e '
import AppKit
import CoreGraphics
let opts = CGWindowListOption(arrayLiteral: .optionAll)
guard let wins = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { exit(1) }
var found = false
for w in wins {
    guard let owner = w[kCGWindowOwnerName as String] as? String, owner == "VibeYTM" else { continue }
    let onScreen = (w[kCGWindowIsOnscreen as String] as? Bool) ?? false
    let alpha = (w[kCGWindowAlpha as String] as? Double) ?? 1.0
    let bounds = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let x = (bounds["X"] as? Double) ?? 0
    let width = (bounds["Width"] as? Double) ?? 0
    // Filter out the audio-engine window (off-screen alpha-0) and the
    // menu bar windows (1512x33 at y=0 — too thin to be the main UI).
    if onScreen && alpha > 0.5 && x > -1000 && width > 200 {
        print("VISIBLE")
        found = true
        break
    }
}
if !found { print("NO_VISIBLE_WINDOW") }
' 2>/dev/null)

    if [ "$VISIBLE" = "VISIBLE" ]; then
      echo "✓ smoke test passed — visible main window detected"
      echo ""
      echo "  Open via Spotlight or:  open \"$DEST/VibeYTM.app\""
    else
      echo "✗ smoke test FAILED — app launched but no visible main window after 5s" >&2
      echo "" >&2
      echo "  Likely causes:" >&2
      echo "  - NSWindow created during @State init (move to .task block)" >&2
      echo "  - Entitlement requiring Developer ID (App Group, etc.) declared" >&2
      echo "    on an ad-hoc-signed bundle (triggers TCC prompt that blocks launch)" >&2
      echo "  - SwiftUI scene body throws / hangs before window orders front" >&2
      echo "" >&2
      echo "  Diagnostic windows:" >&2
      swift -e '
import AppKit
import CoreGraphics
let opts = CGWindowListOption(arrayLiteral: .optionAll)
if let wins = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] {
    for w in wins {
        guard let owner = w[kCGWindowOwnerName as String] as? String, owner == "VibeYTM" else { continue }
        let onScreen = (w[kCGWindowIsOnscreen as String] as? Bool) ?? false
        let alpha = (w[kCGWindowAlpha as String] as? Double) ?? 1.0
        let bounds = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let x = (bounds["X"] as? Double) ?? 0
        let y = (bounds["Y"] as? Double) ?? 0
        let width = (bounds["Width"] as? Double) ?? 0
        let height = (bounds["Height"] as? Double) ?? 0
        let title = (w[kCGWindowName as String] as? String) ?? ""
        print("    onScreen=\(onScreen) alpha=\(alpha) pos=(\(Int(x)),\(Int(y))) size=\(Int(width))x\(Int(height)) title=\"\(title)\"")
    }
}
' 2>/dev/null >&2
      echo "" >&2
      echo "  Re-run without smoke test:  VERIFY_LAUNCH=0 bash app/build.sh --install" >&2
      pkill -9 -f "$DEST/VibeYTM.app/Contents/MacOS/VibeYTM" 2>/dev/null || true
      exit 1
    fi
  else
    echo "  (smoke test skipped — VERIFY_LAUNCH=0)"
    echo "  Open via Spotlight or:  open \"$DEST/VibeYTM.app\""
  fi
else
  echo "  Drag to /Applications, or rerun with --install to copy to ~/Applications."
  echo "  Open via:  open \"$APP\""
fi
