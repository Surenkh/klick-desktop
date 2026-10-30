#!/bin/sh
# Package Klick as two native DMGs (arm64 + x86_64), no Electron.
# Staging .app bundles are removed and unregistered so LaunchServices never
# sees a second copy.
set -eu
cd "$(dirname "$0")/.."

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' native/app/Info.plist)"
STAGE="build/release"
DIST="dist"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

rm -rf "$STAGE"
mkdir -p "$STAGE" "$DIST"
: > "$DIST/.metadata_never_index"
: > "$STAGE/.metadata_never_index"

sign_app() {
  APP="$1"
  IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | grep "Klick Local Signing" | awk '{print $2}' | head -1)"
  if [ -n "$IDENTITY" ]; then
    codesign --force --deep --sign "$IDENTITY" --entitlements native/app/entitlements.plist "$APP" 2>&1 | tail -1
  else
    codesign --force --deep --sign - --entitlements native/app/entitlements.plist "$APP" 2>&1 | tail -1
  fi
  codesign --verify --deep --strict "$APP"
}

build_arch() {
  ARCH="$1"; NAME="$2"
  APP="$STAGE/$NAME/Klick.app"
  echo "== $ARCH"
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web" "$APP/Contents/Resources/assets"

  clang -fobjc-arc -O2 -arch "$ARCH" -mmacosx-version-min=14.0 -I native/app \
    -o "$APP/Contents/MacOS/Klick" \
    native/app/main.m native/app/audio.c native/app/capture.c native/app/keymap.c \
    -framework Cocoa -framework WebKit -framework ServiceManagement \
    -framework AudioToolbox -framework CoreAudio -framework ApplicationServices

  cp native/app/Info.plist "$APP/Contents/Info.plist"
  cp src/renderer/settings.html src/renderer/settings.css src/renderer/settings.js \
     src/renderer/buddy.html "$APP/Contents/Resources/web/"
  cp native/app/bridge.js "$APP/Contents/Resources/web/"
  sed -i '' 's|\.\./\.\./assets/|../assets/|g' \
    "$APP/Contents/Resources/web/settings.html" "$APP/Contents/Resources/web/buddy.html"

  cp -R assets/packs assets/buddy assets/cues "$APP/Contents/Resources/assets/"
  cp assets/icon.png assets/trayTemplate.png "$APP/Contents/Resources/assets/"
  [ -f assets/icon.icns ] && cp assets/icon.icns "$APP/Contents/Resources/icon.icns"

  sign_app "$APP"

  DMG="$DIST/Klick-$VERSION-$NAME.dmg"
  rm -f "$DMG"
  hdiutil create -quiet -volname "Klick" -srcfolder "$APP" -ov -format UDZO "$DMG"

  # never leave a registrable staging bundle behind
  "$LSREG" -u "$PWD/$APP" 2>/dev/null || true
}

build_arch arm64 arm64
build_arch x86_64 x64

rm -rf "$STAGE"
: > "$DIST/.metadata_never_index"

echo
ls -lh "$DIST"/Klick-"$VERSION"-*.dmg | awk '{print "  " $5, $9}'
echo
shasum -a 256 "$DIST"/Klick-"$VERSION"-*.dmg
