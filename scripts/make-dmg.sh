#!/bin/sh
# Build Klick.app and a distributable DMG. Run this on a normal macOS account -
# inside a restricted sandbox hdiutil/diskutil refuse to create disk images.
set -e
cd "$(dirname "$0")/.."
echo "== native helper"
if command -v clang >/dev/null 2>&1; then
  npm run build:native
else
  echo "clang not found - keeping the committed universal binary"
fi
echo "== app + dmg"
npx electron-builder --mac dmg --arm64 --publish never
echo
ls -lh dist/*.dmg
shasum -a 256 dist/*.dmg
