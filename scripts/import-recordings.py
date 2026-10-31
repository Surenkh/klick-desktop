#!/usr/bin/env python3
"""Build Klick packs from real keyboard recordings.

Unlike gen-sounds.py this script stores the actual recorded audio (trimmed to
single hits and peak-normalised); nothing is synthesised.

    python3 scripts/import-recordings.py --src ~/recordings --root assets/packs

Reference files are matched by brand and role in the filename:
    "<Brand>, Space Bar, Hits 02"   -> space
    "<Brand>, Enter, Hits 02"       -> enter
    "<Brand>, Backspace, Hits 03"   -> delete
    "<Brand>, Typing"               -> keys (cut into several takes)
    "<Brand>, Various, Characters, Single" / "<Brand>, Period" -> extra key takes
"""
import argparse
import glob
import json
import os
import subprocess
import tempfile
import wave

import numpy as np

SR = 48000
PACKS = []


def decode(path, workdir):
    wav = os.path.join(workdir, os.path.basename(path) + ".wav")
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@48000", "-c", "1", path, wav],
                   check=True, capture_output=True)
    with wave.open(wav) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    return data, w.getframerate()


def onsets(data, sr, min_gap_ms=45, ratio=0.2):
    env = np.abs(data)
    win = max(1, int(sr * 0.004))
    env = np.convolve(env, np.ones(win) / win, mode="same")
    above = env > env.max() * ratio
    edges = np.where(np.diff(above.astype(int)) == 1)[0]
    found, last = [], -10 ** 9
    for i in edges:
        if i - last > int(sr * min_gap_ms / 1000):
            found.append(i)
            last = i
    return found


def save(path, seg, peak=0.89):
    seg = seg.copy()
    seg *= peak / (np.max(np.abs(seg)) or 1.0)
    n = max(1, int(SR * 0.003))
    if len(seg) > 2 * n:
        seg[:n] *= np.linspace(0, 1, n)
        seg[-n:] *= np.linspace(1, 0, n)
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(seg, -1, 1) * 32767).astype(np.int16).tobytes())


def hit(data, sr, at, ms):
    return data[at:min(len(data), at + int(sr * ms / 1000))]


def build_session(args):
    """Build one pack from a record-keyboard.sh session folder."""
    work = tempfile.mkdtemp()
    out = os.path.join(args.root, args.id)
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out):
        if old.endswith(".wav"):
            os.remove(os.path.join(out, old))

    keys = decode(os.path.join(args.session, "keys.wav"), work)
    sr = SR
    cuts = []
    for at in onsets(keys, sr)[:6]:
        cuts.append(hit(keys, sr, max(0, at - int(sr * 0.001)), 180))
    if not cuts:
        raise SystemExit("no keystrokes found in keys.wav")
    for i in range(6):
        save(os.path.join(out, "keys-%d.wav" % (i + 1)), cuts[i % len(cuts)])

    for role, ms in (("space", 320), ("enter", 300), ("delete", 260)):
        data = decode(os.path.join(args.session, role + ".wav"), work)
        found = onsets(data, sr)
        at = found[0] if found else 0
        save(os.path.join(out, role + "-1.wav"), hit(data, sr, max(0, at - int(sr * 0.001)), ms))

    manifest_path = os.path.join(args.root, "manifest.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {"packs": []}
    manifest["packs"] = [p for p in manifest["packs"] if p["id"] != args.id]
    manifest["packs"].append({
        "id": args.id, "name": args.name or args.id,
        "vibe": "Recorded on this Mac", "category": "Mechanical",
        "license": "CC0-1.0", "author": "you", "source": "local recording"})
    json.dump(manifest, open(manifest_path, "w"), indent=2)
    print("  built %s with %d key takes" % (args.id, len(cuts)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", help="folder of reference recordings")
    parser.add_argument("--session", help="folder recorded by record-keyboard.sh")
    parser.add_argument("--id", help="pack id for --session")
    parser.add_argument("--name", help="display name for --session")
    parser.add_argument("--root", default="assets/packs")
    args = parser.parse_args()

    if args.session:
        build_session(args)
        return

    files = sorted(glob.glob(os.path.join(args.src, "*.mp3")))
    if not files:
        raise SystemExit("no recordings in %s" % args.src)

    work = tempfile.mkdtemp()
    by_role = {"keys": [], "space": [], "enter": [], "delete": []}
    for path in files:
        name = os.path.basename(path)
        data, sr = decode(path, work)
        entry = (name, data, sr)
        if "Space Bar" in name:
            by_role["space"].append(entry)
        elif "Enter" in name:
            by_role["enter"].append(entry)
        elif "Backspace" in name:
            by_role["delete"].append(entry)
        elif "Typing" in name or "Characters" in name or "Period" in name:
            by_role["keys"].append(entry)

    BRANDS = ["Apple", "Cooler Master", "Corsair", "Dell", "Logitech", "Razer"]

    def brand_of(name):
        for brand in BRANDS:
            if ", %s," % brand in name or name.startswith(brand + ","):
                return brand
        return "?"

    script = json.load(open(os.path.join(os.path.dirname(__file__), "..", "scripts", "raw-packs.json")))
    manifest = {"packs": []}

    for spec in script["packs"]:
        out = os.path.join(args.root, spec["id"])
        os.makedirs(out, exist_ok=True)
        for old in os.listdir(out):
            if old.endswith(".wav"):
                os.remove(os.path.join(out, old))

        # key takes: prefer this brand's own recordings, then any typing take
        key_sources = [e for e in by_role["keys"] if brand_of(e[0]) == spec["brand"]] or by_role["keys"]
        takes = []
        for name, data, sr in key_sources:
            for at in onsets(data, sr)[:4]:
                takes.append(hit(data, sr, max(0, at - int(sr * 0.002)), 180))
            if len(takes) >= 6:
                break
        if not takes:
            raise SystemExit("no key material for %s" % spec["id"])

        for i in range(6):
            save(os.path.join(out, "keys-%d.wav" % (i + 1)), takes[i % len(takes)])

        for role, ms in (("space", 320), ("enter", 300), ("delete", 260)):
            pool = [e for e in by_role[role] if brand_of(e[0]) == spec["brand"]] or by_role[role]
            space_name, data, sr = pool[0]
            start = onsets(data, sr)
            at = start[0] if start else 0
            save(os.path.join(out, role + "-1.wav"), hit(data, sr, max(0, at - int(sr * 0.002)), ms))

        manifest["packs"].append({k: spec[k] for k in ("id", "name", "vibe", "category")})
        print("  %-16s keys=%d space=%s" % (spec["id"], len(takes), brand_of(space_name)))

    # keep the original four packs in the manifest
    existing = json.load(open(os.path.join(args.root, "manifest.json"))) if os.path.exists(
        os.path.join(args.root, "manifest.json")) else {"packs": []}
    keep = [p for p in existing["packs"] if p["id"] in ("laptop", "hard", "fast", "soft")]
    manifest["packs"] = keep + manifest["packs"]
    with open(os.path.join(args.root, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("%d packs written" % len(manifest["packs"]))


if __name__ == "__main__":
    main()
