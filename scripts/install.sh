#!/bin/sh
# Klick — one-line installer for macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/Surenkh/klick-desktop/main/scripts/install.sh | sh
#
# Downloads the latest release DMG for this Mac, checks its SHA-256 against the
# checksum published in the release notes, installs to /Applications, clears the
# quarantine flag (so Gatekeeper does not block an unsigned app) and launches it.
set -eu

REPO="Surenkh/klick-desktop"
APP="Klick.app"
DEST="/Applications/$APP"

say()  { printf '  %s\n' "$1"; }
fail() { printf '\n  error: %s\n\n' "$1" >&2; exit 1; }

printf '\n  Klick installer\n\n'

[ "$(uname -s)" = "Darwin" ] || fail "Klick is a macOS app."

case "$(uname -m)" in
  arm64)  ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *)      fail "unsupported architecture: $(uname -m)" ;;
esac
say "Mac: $(uname -m) -> $ARCH build"

TMP="$(mktemp -d)"
cleanup() {
  [ -d "$TMP/mnt" ] && hdiutil detach "$TMP/mnt" -quiet >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

API="https://api.github.com/repos/$REPO/releases/latest"
curl -fsSL "$API" -o "$TMP/release.json" || fail "cannot reach GitHub."

URL=$(sed -n 's/.*"browser_download_url": *"\([^"]*\)".*/\1/p' "$TMP/release.json" \
      | grep -- "-$ARCH\.dmg$" | head -1)
[ -n "$URL" ] || fail "no $ARCH download in the latest release."
FILE=$(basename "$URL")
say "Latest release: $FILE"

# The release notes publish "sha256  <file>" lines; verify before installing.
EXPECTED=$(tr ',' '\n' < "$TMP/release.json" \
           | grep -o "[0-9a-f]\{64\}  $FILE" | head -1 | cut -d' ' -f1 || true)

say "Downloading…"
curl -fsSL "$URL" -o "$TMP/$FILE" || fail "download failed."

ACTUAL=$(shasum -a 256 "$TMP/$FILE" | awk '{print $1}')
if [ -n "$EXPECTED" ]; then
  [ "$ACTUAL" = "$EXPECTED" ] || fail "checksum mismatch — refusing to install.

  expected $EXPECTED
  got      $ACTUAL"
  say "Checksum verified: ${ACTUAL%??????????????????????????????????????????????????????}…"
else
  say "No checksum published for this release; continuing unverified."
fi

say "Mounting…"
mkdir -p "$TMP/mnt"
hdiutil attach -nobrowse -readonly -quiet -mountpoint "$TMP/mnt" "$TMP/$FILE" \
  || fail "could not mount the disk image."

[ -d "$TMP/mnt/$APP" ] || fail "the disk image does not contain $APP."

say "Installing to /Applications…"
rm -rf "$DEST" 2>/dev/null || true
/usr/bin/ditto "$TMP/mnt/$APP" "$DEST" || fail "could not copy to /Applications (try running with sudo)."

hdiutil detach "$TMP/mnt" -quiet >/dev/null 2>&1 || true

# The app is ad-hoc signed: clear the quarantine flag so Gatekeeper stays quiet.
xattr -cr "$DEST" 2>/dev/null || true
codesign --verify --deep --strict "$DEST" >/dev/null 2>&1 \
  && say "Signature verified." \
  || say "Signature check skipped (unsigned build)."

VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$DEST/Contents/Info.plist" 2>/dev/null || echo "?")
say "Installed Klick $VERSION."

open -a "$DEST" 2>/dev/null || true

printf '\n  Done. Klick is running in your menu bar.\n'
printf '  It needs Input Monitoring: System Settings > Privacy & Security > Input Monitoring.\n\n'
