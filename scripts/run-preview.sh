#!/bin/sh
# Launch Klick in preview mode: no key hook, no macOS permission prompts.
# Stops a previous instance (its pid lives in the Electron singleton lock) first.
cd "$(dirname "$0")/.." || exit 1
if [ -L .userdata/SingletonLock ]; then
  pid=$(readlink .userdata/SingletonLock | sed 's/.*-//')
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "stopping previous instance (pid $pid)"
    kill "$pid" 2>/dev/null
    sleep 1
  fi
fi
rm -f .userdata/SingletonLock .userdata/SingletonCookie .userdata/SingletonSocket
exec env -u ELECTRON_RUN_AS_NODE \
  ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . \
  --user-data-dir="$PWD/.userdata" --no-sandbox --enable-logging --no-hook "$@"
