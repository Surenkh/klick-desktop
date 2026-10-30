#!/bin/sh
# Build the native Klick.app (Objective-C + C), for this machine's architecture.
#   sh scripts/build-native.sh            build only
#   sh scripts/build-native.sh --install  build, ad-hoc sign, install, relaunch
set -eu
cd "$(dirname "$0")/.."

ARCH="$(uname -m)"
OUT="build/native"
APP="$OUT/Klick.app"
rm -rf "$OUT"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web" "$APP/Contents/Resources/assets"

echo "== compiling ($ARCH)"
clang -fobjc-arc -O2 -arch "$ARCH" -mmacosx-version-min=14.0 \
  -I native/app \
  -o "$APP/Contents/MacOS/Klick" \
  native/app/main.m native/app/audio.c native/app/capture.c \
  -framework Cocoa -framework WebKit -framework ServiceManagement \
  -framework AudioToolbox -framework CoreAudio -framework ApplicationServices

cp native/app/Info.plist "$APP/Contents/Info.plist"

echo "== web UI"
cp src/renderer/settings.html src/renderer/settings.css src/renderer/settings.js "$APP/Contents/Resources/web/"
cp native/app/bridge.js "$APP/Contents/Resources/web/"
# the web root is Resources/web, so assets are one level up
sed -i '' 's|\.\./\.\./assets/|../assets/|g' "$APP/Contents/Resources/web/settings.html"

echo "== assets"
cp -R assets/packs assets/buddy assets/cues "$APP/Contents/Resources/assets/" 2>/dev/null || true
cp assets/icon.png assets/trayTemplate.png "$APP/Contents/Resources/assets/"
cp assets/icon.png "$APP/Contents/Resources/icon.png"
[ -f assets/icon.icns ] && cp assets/icon.icns "$APP/Contents/Resources/icon.icns"

echo "== signing (ad-hoc, stable requirement)"
codesign --force --deep --sign - --entitlements native/app/entitlements.plist "$APP" 2>&1 | tail -1
codesign --verify --deep --strict "$APP" && echo "   signature ok"

echo
echo "app:  $APP  ($(du -sh "$APP" | cut -f1))"

if [ "${1:-}" = "--install" ]; then
  echo "== installing to /Applications"
  rm -rf /Applications/Klick.app
  cp -R "$APP" /Applications/
  LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  "$LSREG" -u "$PWD/$APP" 2>/dev/null || true
  pkill -f "/Applications/Klick.app/Contents/MacOS/Klick" 2>/dev/null || true
  sleep 1
  open -a /Applications/Klick.app
  echo "installed: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Klick.app/Contents/Info.plist)"
fi
