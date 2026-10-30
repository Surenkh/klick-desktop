#!/bin/sh
# Build and run the native smoke tests (no audio device, no network).
set -eu
cd "$(dirname "$0")/.."
mkdir -p build/tests
clang -O1 -g -I native/app -o build/tests/test_native \
  tests/test_native.c native/app/audio.c native/app/keymap.c native/app/stats.c \
  -framework AudioToolbox -framework CoreAudio -framework CoreFoundation -lm
exec build/tests/test_native
