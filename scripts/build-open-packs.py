#!/usr/bin/env python3
"""Build Klick packs from verified MIT / CC0 recordings.

Sources (all verified in their repositories):
  * tplai/kbsim            MIT, Copyright (c) Thomas Lai        -> 12 switch packs
  * lavenderdotpet/CC0-Public-Domain-Sounds, "bb - Keyboard Sounds (Mar 2021)"
                           CC0 1.0, Ben Burnes / Abstraction     -> 2 packs
  * opengameart "Keyboard Soundpack 1" by unicaegames
                           CC0 1.0, Cherry KC 1000 + SM7B        -> 2 packs

    python3 scripts/build-open-packs.py --kbsim /tmp/kbsim --bb /tmp/cc0sounds --unicae /tmp/unicae/x
"""
import argparse
import json
import os
import subprocess
import tempfile
import wave

import numpy as np

SR = 48000
PEAK = 0.89           # -1 dBFS
FADE_MS = 3.0

SWITCHES = [
    ("alpaca",     "Alpaca",          "Smooth linear, soft landing",       "Linear"),
    ("blackink",   "Gateron Ink Black","Creamy linear with a deep bottom", "Linear"),
    ("bluealps",   "Blue Alps",        "Vintage clicky, bright and hollow","Clicky"),
    ("boxnavy",    "Box Navy",         "Heavy click bar, loud and sharp",  "Clicky"),
    ("buckling",   "Buckling Spring",  "IBM Model M, metallic ping",       "Retro"),
    ("cream",      "NovelKeys Cream",  "Poppy full-POM thock",             "Thock"),
    ("holypanda",  "Holy Panda",       "Sharp tactile bump, deep thock",   "Tactile"),
    ("mxblack",    "Cherry MX Black",  "Heavy linear, firm press",         "Linear"),
    ("mxbrown",    "Cherry MX Brown",  "Light tactile, everyday switch",   "Tactile"),
    ("redink",     "Gateron Red Ink",  "Light linear, smooth and quiet",   "Linear"),
    ("topre",      "Topre",            "Electro-capacitive thock",         "Thock"),
    ("turquoise",  "Kailh Pro Turquoise","Crisp clicky with a short throw","Clicky"),
]


def decode(path, work):
    out = os.path.join(work, os.path.basename(path) + ".wav")
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@48000", "-c", "1", path, out],
                   check=True, capture_output=True)
    with wave.open(out) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    return data


def trim_onset(data, threshold=0.004):
    """Zero pre-roll: start on the first sample that is unambiguously audible."""
    idx = np.where(np.abs(data) > threshold)[0]
    return data[idx[0]:] if len(idx) else data


def save(path, data):
    data = data.copy()
    data *= PEAK / (np.max(np.abs(data)) or 1.0)
    n = max(1, int(SR * FADE_MS / 1000.0))
    if len(data) > 2 * n:
        data[-n:] *= np.linspace(1, 0, n)
    with wave.open(path, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(data, -1, 1) * 32767).astype(np.int16).tobytes())


def write_pack(root, pack_id, roles, meta):
    out = os.path.join(root, pack_id)
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out):
        if old.endswith(".wav"):
            os.remove(os.path.join(out, old))
    for name, samples in roles.items():
        save(os.path.join(out, name + ".wav"), samples)
    meta["id"] = pack_id
    return meta


def build_kbsim(root, repo, work, manifest):
    for switch, name, vibe, category in SWITCHES:
        press = os.path.join(repo, "src/assets/audio", switch, "press")
        if not os.path.isdir(press):
            print("  ! missing", press); continue
        roles = {}
        for i in range(5):
            roles["keys-%d" % (i + 1)] = trim_onset(decode(os.path.join(press, "GENERIC_R%d.mp3" % i), work))
        roles["keys-6"] = trim_onset(decode(os.path.join(press, "GENERIC_R0.mp3"), work))
        roles["space-1"] = trim_onset(decode(os.path.join(press, "SPACE.mp3"), work))
        roles["enter-1"] = trim_onset(decode(os.path.join(press, "ENTER.mp3"), work))
        roles["delete-1"] = trim_onset(decode(os.path.join(press, "BACKSPACE.mp3"), work))
        manifest.append(write_pack(root, switch, roles, {
            "name": name, "vibe": vibe, "category": category,
            "license": "MIT", "author": "Thomas Lai", "source": "github.com/tplai/kbsim"}))


def build_bb(root, repo, work, manifest):
    folder = os.path.join(repo, "bb - Keyboard Sounds (Mar 2021)")
    def load(name):
        return trim_onset(decode(os.path.join(folder, name), work))

    keys = ["Keyboard - Key %d.wav" % i for i in range(1, 5)]
    combos = ["Keyboard - Key Combo %d.wav" % i for i in range(1, 4)]
    roles = {}
    for i, f in enumerate(keys + combos[:2]):
        roles["keys-%d" % (i + 1)] = load(f)
    roles["space-1"] = load(combos[2])
    roles["enter-1"] = load("Keyboard - Typing Slower.wav")[: int(SR * 0.3)]
    roles["delete-1"] = load("Keyboard - Key Combo 2.wav")
    manifest.append(write_pack(root, "abstraction", roles, {
        "name": "Abstraction", "vibe": "Warm studio keyboard, Ben Burnes",
        "category": "Thock", "license": "CC0-1.0", "author": "Ben Burnes / Abstraction",
        "source": "github.com/lavenderdotpet/CC0-Public-Domain-Sounds"}))

    roles = {}
    for i in range(6):
        roles["keys-%d" % (i + 1)] = load("Model D - Switch %d.wav" % (i + 1))
    roles["space-1"] = load("Button - Push 1.wav")
    roles["enter-1"] = load("Button - Push 2.wav")
    roles["delete-1"] = load("Button - Push 3.wav")
    manifest.append(write_pack(root, "model-d", roles, {
        "name": "Abstraction Model D", "vibe": "Vintage synth keys as a switch",
        "category": "Retro", "license": "CC0-1.0", "author": "Ben Burnes / Abstraction",
        "source": "github.com/lavenderdotpet/CC0-Public-Domain-Sounds"}))


def build_unicae(root, repo, work, manifest):
    singles = os.path.join(repo, "Single Keys")
    files = sorted(os.listdir(singles))[:9]
    roles = {}
    for i in range(6):
        roles["keys-%d" % (i + 1)] = trim_onset(decode(os.path.join(singles, files[i]), work))
    roles["space-1"] = trim_onset(decode(os.path.join(singles, files[6]), work))
    roles["enter-1"] = trim_onset(decode(os.path.join(singles, files[7]), work))
    roles["delete-1"] = trim_onset(decode(os.path.join(singles, files[8]), work))
    manifest.append(write_pack(root, "cherry-kc1000", roles, {
        "name": "Cherry KC 1000", "vibe": "Office keyboard through a Shure SM7B",
        "category": "Laptop", "license": "CC0-1.0", "author": "unicaegames",
        "source": "opengameart.org/content/keyboard-soundpack-1-typing-and-single-keystrokes"}))

    human = os.path.join(repo, "Human Typing")
    data = trim_onset(decode(os.path.join(human, sorted(os.listdir(human))[0]), work))
    step = len(data) // 7
    roles = {}
    for i in range(6):
        roles["keys-%d" % (i + 1)] = data[i * step:(i + 1) * step][: int(SR * 0.16)]
    roles["space-1"] = data[6 * step:][: int(SR * 0.30)]
    roles["enter-1"] = data[2 * step:2 * step + int(SR * 0.26)]
    roles["delete-1"] = data[3 * step:3 * step + int(SR * 0.24)]
    manifest.append(write_pack(root, "cherry-typing", roles, {
        "name": "Cherry Typing", "vibe": "Continuous human typing, cut to hits",
        "category": "Laptop", "license": "CC0-1.0", "author": "unicaegames",
        "source": "opengameart.org/content/keyboard-soundpack-1-typing-and-single-keystrokes"}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kbsim", required=True)
    ap.add_argument("--bb", required=True)
    ap.add_argument("--unicae", required=True)
    ap.add_argument("--root", default="assets/packs")
    args = ap.parse_args()

    work = tempfile.mkdtemp()
    manifest = []
    build_kbsim(args.root, args.kbsim, work, manifest)
    build_bb(args.root, args.bb, work, manifest)
    build_unicae(args.root, args.unicae, work, manifest)

    with open(os.path.join(args.root, "manifest.json"), "w") as f:
        json.dump({"packs": manifest}, f, indent=2)
    print("%d packs, all MIT/CC0" % len(manifest))


if __name__ == "__main__":
    main()
