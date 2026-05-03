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
  <key>CFBundleIdentifier</key><string>com.vibeytm.app</string>
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
</dict>
</plist>
PLIST

echo "[4/5] writing entitlements + signing (ad-hoc) …"
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
  echo "✓ installed to $DEST/VibeYTM.app — open via Spotlight or:"
  echo "  open \"$DEST/VibeYTM.app\""
else
  echo "  Drag to /Applications, or rerun with --install to copy to ~/Applications."
  echo "  Open via:  open \"$APP\""
fi
