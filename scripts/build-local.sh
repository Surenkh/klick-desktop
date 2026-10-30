#!/bin/sh
# Build ONLY for this machine's architecture, then remove the staging .app so
# Spotlight/LaunchServices never register it as a second installed Klick.
set -eu
cd "$(dirname "$0")/.."

ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  FLAG="--arm64" ;;
  x86_64) FLAG="--x64"   ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;;
esac
echo "== building for $ARCH ($FLAG)"

[ -f native/klick-capture.node ] || npm run build:native

npx electron-builder --mac dmg "$FLAG" --publish never

# staging bundles must never be indexable, and must not stay registered
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
for staging in dist/mac dist/mac-arm64 dist/mac-universal; do
  if [ -d "$staging/Klick.app" ]; then
    "$LSREG" -u "$PWD/$staging/Klick.app" 2>/dev/null || true
  fi
done
rm -rf dist/mac dist/mac-arm64 dist/mac-universal dist/linux* 2>/dev/null || true
: > dist/.metadata_never_index

echo
ls -lh dist/*.dmg
echo
du -sh dist/*.dmg | awk '{print "  dmg size:", $1, $2}'
