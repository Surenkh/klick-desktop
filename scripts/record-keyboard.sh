#!/bin/sh
# Record your own keyboard into a Klick pack.
#
#   sh scripts/record-keyboard.sh my-keyboard
#
# Records four guided takes with the built-in microphone (macOS will ask for
# microphone access once), then builds assets/packs/my-keyboard from them:
#   keys.wav    ~20 s of normal typing
#   space.wav   press space slowly ~10 times
#   enter.wav   press return ~10 times
#   delete.wav  press backspace ~10 times
set -eu
cd "$(dirname "$0")/.."

ID="${1:-my-keyboard}"
DIR="recordings/$ID"
mkdir -p "$DIR"

record() {
  OUT="$1"; SECONDS_TO_RECORD="$2"; PROMPT="$3"
  printf '\n  %s\n  recording %s s… (Ctrl-C to stop early)\n' "$PROMPT" "$SECONDS_TO_RECORD"
  /usr/bin/afrecord -f WAVE -d LEI16@48000 -c 1 "$OUT" &
  PID=$!
  sleep "$SECONDS_TO_RECORD"
  kill -INT "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  [ -s "$OUT" ] || { printf '  no audio captured\n' >&2; exit 1; }
  printf '  saved %s\n' "$OUT"
}

record "$DIR/keys.wav"   20 "Type normally for 20 seconds."
record "$DIR/space.wav"  10 "Press the space bar about ten times, pausing between."
record "$DIR/enter.wav"  10 "Press return about ten times."
record "$DIR/delete.wav" 10 "Press backspace about ten times."

PY3="$(command -v python3 || true)"
[ -n "$PY3" ] || { printf '  python3 is required to build the pack\n' >&2; exit 1; }
"$PY3" scripts/import-recordings.py --session "$DIR" --id "$ID" --name "$ID" || {
  printf '\n  the importer needs numpy; install it with: python3 -m pip install numpy\n' >&2
  exit 1
}

printf '\n  Pack built: assets/packs/%s\n  Rebuild the app: sh scripts/build-native.sh --install\n\n' "$ID"
