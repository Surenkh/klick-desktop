#!/usr/bin/env python3
"""Import a folder of keyboard samples into a Klick sound pack.

    python3 scripts/import-pack.py incoming/sounds/blue --pack blue

Accepts wav/aif/mp3/m4a/flac/ogg, converts to 48 kHz mono 16-bit via afconvert
(macOS) or ffmpeg, trims leading silence, normalises, and writes
assets/packs/<pack>/<role>-<take>.wav. Existing files for that pack are replaced.

No network, no third-party samples: whatever you point it at is what ships.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import wave

import numpy as np

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "packs")

ROLE_ALIASES = {
    "keys": "keys", "key": "keys", "normal": "keys", "press": "keys",
    "space": "space", "spacebar": "space",
    "enter": "enter", "return": "enter", "enter2": "enter",
    "delete": "delete", "backspace": "delete", "del": "delete",
    "modifier": "modifier", "mod": "modifier", "shift": "modifier", "ctrl": "modifier",
    "release": "release", "up": "release", "keyup": "release",
    "click": "click", "mouse": "click", "mousedown": "click",
}

SUPPORTED = {".wav", ".aif", ".aiff", ".mp3", ".m4a", ".flac", ".ogg", ".caf"}


def decode(path, tmpdir):
    """Return a 48 kHz mono 16-bit wav path, converting if needed."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".wav":
        try:
            with wave.open(path) as w:
                if w.getframerate() == SR and w.getnchannels() == 1 and w.getsampwidth() == 2:
                    return path
        except Exception:
            pass
    dest = os.path.join(tmpdir, os.path.splitext(os.path.basename(path))[0] + ".wav")
    if shutil.which("afconvert"):
        cmd = ["afconvert", "-f", "WAVE", "-d", "LEI16@%d" % SR, "-c", "1", path, dest]
    elif shutil.which("ffmpeg"):
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-ac", "1",
               "-ar", str(SR), "-acodec", "pcm_s16le", dest]
    else:
        raise SystemExit("need afconvert (macOS) or ffmpeg to convert %s" % path)
    subprocess.run(cmd, check=True, capture_output=True)
    return dest


def tidy(samples):
    """Trim silence, normalise, fade out. Keeps the attack intact."""
    x = samples.astype(np.float32) / 32768.0
    if x.size == 0:
        return samples
    peak = float(np.max(np.abs(x))) or 1.0
    # onset: first sample above 1% of peak, with 2 ms of pre-roll
    above = np.flatnonzero(np.abs(x) > 0.01 * peak)
    start = max(0, int(above[0]) - int(0.002 * SR)) if above.size else 0
    # tail: last sample above -60 dBFS, with 20 ms of release
    tail = np.flatnonzero(np.abs(x) > 0.001)
    end = min(x.size, (int(tail[-1]) + int(0.02 * SR)) if tail.size else x.size)
    x = x[start:end]
    peak = float(np.max(np.abs(x))) or 1.0
    x = x / peak * 0.90
    fade = min(x.size, int(0.002 * SR))
    if fade > 0:
        x[-fade:] *= np.linspace(1.0, 0.0, fade)
    return (np.clip(x, -1, 1) * 32767).astype("<i2")


def parse_name(path):
    stem = os.path.splitext(os.path.basename(path))[0].lower()
    stem = re.sub(r"[^a-z0-9]+", "-", stem).strip("-")
    m = re.match(r"^(\d+)$", stem)
    if m:
        return "keys", int(m.group(1))
    role = None
    for token in stem.split("-"):
        if token in ROLE_ALIASES:
            role = ROLE_ALIASES[token]
            break
    take = 1
    m = re.search(r"(?:^|-)(\d+)$", stem)
    if m:
        take = int(m.group(1))
    if role is None:
        role = "keys"
    if role == "enter" and "enter2" in stem:
        role = "enter2"
    return role, take


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="folder of samples")
    ap.add_argument("--pack", required=True, help="target pack name, e.g. blue")
    ap.add_argument("--keep", action="store_true", help="keep existing files not replaced")
    args = ap.parse_args()

    files = sorted(
        os.path.join(args.source, f)
        for f in os.listdir(args.source)
        if os.path.splitext(f)[1].lower() in SUPPORTED
    )
    if not files:
        raise SystemExit("no supported audio files in %s" % args.source)

    dest = os.path.join(OUT, args.pack)
    if os.path.isdir(dest) and not args.keep:
        shutil.rmtree(dest)
    os.makedirs(dest, exist_ok=True)

    seen = {}
    with tempfile.TemporaryDirectory() as tmp:
        for path in files:
            role, take = parse_name(path)
            key = (role, take)
            seen[key] = seen.get(key, 0) + 1
            if seen[key] > 1:  # duplicate take names: bump the index
                take = seen[key]
            wav = decode(path, tmp)
            with wave.open(wav) as w:
                data = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
            data = tidy(data)
            out = os.path.join(dest, "%s-%d.wav" % (role, take))
            with wave.open(out, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(SR)
                w.writeframes(data.tobytes())
            print("%-28s -> %-24s %5.1f ms" % (
                os.path.basename(path), os.path.basename(out), 1000 * data.size / SR))

    roles = sorted({r for r, _ in seen})
    missing = [r for r in ("keys", "space", "enter", "delete") if r not in roles]
    print("\npack %r: %d files, roles: %s" % (args.pack, len(files), ", ".join(roles)))
    if missing:
        print("note: missing %s - the app falls back to the keys sample for those"
              % ", ".join(missing))

    manifest_path = os.path.join(OUT, "manifest.json")
    manifest = {}
    if os.path.exists(manifest_path):
        try:
            manifest = json.load(open(manifest_path))
        except Exception:
            manifest = {}
    manifest[args.pack] = {}
    for (role, take) in sorted(seen):
        manifest[args.pack].setdefault(role, []).append("%s-%d.wav" % (role, take))
    json.dump(manifest, open(manifest_path, "w"), indent=2)
    print("manifest updated")


if __name__ == "__main__":
    main()
