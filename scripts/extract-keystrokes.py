#!/usr/bin/env python3
"""Cut individual keystrokes out of typing recordings and build a pack.

    python3 scripts/extract-keystrokes.py --pack laptop \
        ~/Downloads/mixkit-laptop-keyboard-typing-sequence-2537.wav ...

Each recording is a performance, not a sample. This finds the transient of every
hit (spectral-flux onsets), cuts each one, and sorts the hits into the roles the
app needs (keys / space / enter / delete / modifier / release / click) by how
heavy, how bright and how long each hit is.

Output: assets/packs/<pack>/ at 48 kHz mono 16-bit, peak -1 dBFS.
"""

import argparse
import json
import os
import shutil
import subprocess
import tempfile
import wave

import numpy as np

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "packs")


# --------------------------------------------------------------------------- io
def to_mono_48k(path, tmpdir):
    dest = os.path.join(tmpdir, os.path.splitext(os.path.basename(path))[0] + ".wav")
    if shutil.which("afconvert"):
        cmd = ["afconvert", "-f", "WAVE", "-d", "LEI16@%d" % SR, "-c", "1", path, dest]
    elif shutil.which("ffmpeg"):
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-ac", "1",
               "-ar", str(SR), "-acodec", "pcm_s16le", dest]
    else:
        raise SystemExit("need afconvert (macOS) or ffmpeg")
    subprocess.run(cmd, check=True, capture_output=True)
    with wave.open(dest) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    return data.astype(np.float32) / 32768.0


# ------------------------------------------------------------------ detection
def find_onsets(x):
    win, hop = 1024, 256
    frames = np.lib.stride_tricks.sliding_window_view(x, win)[::hop]
    spec = np.abs(np.fft.rfft(frames * np.hanning(win).astype(np.float32), axis=1))
    flux = np.diff(spec, axis=0)
    flux[flux < 0] = 0.0
    od = flux.sum(axis=1)
    od = np.concatenate([[0.0], od])
    if od.max() <= 0:
        return []
    od /= od.max()

    # adaptive threshold: local mean + margin, so a loud passage does not
    # swallow the quiet hits around it
    k = 25
    local = np.convolve(od, np.ones(2 * k + 1) / (2 * k + 1), mode="same")
    thresh = np.maximum(local * 1.6 + 0.02, 0.015)

    min_gap = int(0.045 * SR / hop)
    peaks = []
    for i in range(1, len(od) - 1):
        if od[i] < thresh[i]:
            continue
        if od[i] < od[i - 1] or od[i] < od[i + 1]:
            continue
        if peaks and i - peaks[-1] < min_gap:
            if od[i] > od[peaks[-1]]:
                peaks[-1] = i
            continue
        peaks.append(i)
    return [int(p * hop) for p in peaks]


def cut(x, onset):
    start = max(0, onset - int(0.004 * SR))
    # walk forward until the energy has decayed to near nothing, max 150 ms
    limit = min(len(x), onset + int(0.15 * SR))
    win = int(0.004 * SR)
    seg = x[start:limit]
    frames = np.lib.stride_tricks.sliding_window_view(seg, win)[::win] if len(seg) > win else seg[None, :]
    rms = np.sqrt((frames ** 2).mean(axis=1) + 1e-12)
    top = rms.max() + 1e-12
    quiet = np.flatnonzero(rms < top * 0.03)
    quiet_after = quiet[quiet > 3]
    end = start + (quiet_after[0] * win + win) if quiet_after.size else limit
    end = min(len(x), max(end, start + int(0.012 * SR)))
    end = min(end, start + int(0.15 * SR))
    hit = x[start:end].copy()
    if hit.size < int(0.005 * SR):
        return None
    # a cut that still contains a second, comparable hit is two keys, not one
    win = int(0.001 * SR)
    if len(hit) > win * 8:
        fr = np.lib.stride_tricks.sliding_window_view(hit, win)[::win]
        env = np.sqrt((fr ** 2).mean(axis=1) + 1e-12)
        env = env / (env.max() + 1e-12)
        guard = int(0.025 * SR / win)
        later = env[guard:]
        if later.size and later.max() > 0.62:
            return None
    return hit


def features(hit):
    spec = np.abs(np.fft.rfft(hit * np.hanning(len(hit))))
    freqs = np.fft.rfftfreq(len(hit), 1 / SR)
    total = spec.sum() + 1e-9
    centroid = float((spec * freqs).sum() / total)
    low = float(spec[freqs < 500].sum() / total)
    high = float(spec[freqs > 2500].sum() / total)
    peak = float(np.max(np.abs(hit)))
    # decay: time from peak to 10 % of peak
    env = np.abs(hit)
    p = int(np.argmax(env))
    after = env[p:]
    below = np.flatnonzero(after < peak * 0.1)
    decay = float(below[0] / SR) if below.size else len(after) / SR
    return dict(centroid=centroid, low=low, high=high, peak=peak,
                dur=len(hit) / SR, decay=decay,
                weight=(low * 1.4 + peak * 0.9))


# ------------------------------------------------------------------- assembly
MAX_MS = {"space": 170, "enter": 150, "delete": 90, "modifier": 110,
          "release": 120, "click": 70, "keys": 140}


def _lp(x, cutoff):
    """one-pole low-pass in the frequency domain (short signals, cheap)"""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(spec / (1.0 + (f / cutoff) ** 2), len(x))


def _hp(x, cutoff):
    return x - _lp(x, cutoff)


def voice(x, tone):
    """Give a pack its own character without changing the source hit."""
    if tone == "hard":
        # low-shelf weight + saturation: a heavier, chunkier press
        x = x + 0.45 * _lp(x, 220)
        x = np.tanh(x * 1.6) / np.tanh(1.6)
    elif tone == "soft":
        # take the edge off: low-pass twice, quieter, shorter tail
        x = _lp(_lp(x, 6500), 9000) * 0.82
        x = _hp(x, 55)
    elif tone == "fast":
        # tight and bright: drop the rumble, shorten the decay
        x = _hp(x, 110)
        env = np.abs(x)
        gate = env < (env.max() * 0.02)
        x = x * (~gate)
    return x


def finish(hit, gain=1.0, role="keys", tone="neutral"):
    limit = int(MAX_MS.get(role, 140) * SR / 1000)
    if len(hit) > limit:
        hit = hit[:limit].copy()
    hit = voice(hit.astype(np.float32), tone)
    peak = float(np.max(np.abs(hit))) or 1.0
    y = hit / peak * 0.89 * gain
    ramp = max(1, int(0.0005 * SR))
    y[:ramp] *= np.linspace(0.0, 1.0, ramp)
    fade = min(len(y), int(0.003 * SR))
    y[-fade:] *= np.linspace(1.0, 0.0, fade)
    return (np.clip(y, -1, 1) * 32767).astype("<i2")


def write(path, samples):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(samples.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True)
    ap.add_argument("--keys-takes", type=int, default=4)
    ap.add_argument("--tone", default="neutral",
                    choices=["neutral", "hard", "soft", "fast"])
    ap.add_argument("sources", nargs="+")
    args = ap.parse_args()

    hits = []
    with tempfile.TemporaryDirectory() as tmp:
        for src in args.sources:
            x = to_mono_48k(src, tmp)
            onsets = find_onsets(x)
            kept = 0
            for o in onsets:
                hit = cut(x, o)
                if hit is None:
                    continue
                f = features(hit)
                if f["peak"] < 0.01 or f["dur"] < 0.012:
                    continue
                f["hit"] = hit
                f["source"] = os.path.basename(src)
                hits.append(f)
                kept += 1
            print("%-52s %3d onsets, %3d usable" % (os.path.basename(src), len(onsets), kept))

    if len(hits) < 8:
        raise SystemExit("not enough usable hits (%d)" % len(hits))

    # drop near-duplicates by centroid+duration+weight distance
    hits.sort(key=lambda h: h["weight"], reverse=True)
    uniq = []
    for h in hits:
        if all(abs(h["weight"] - u["weight"]) > 0.02 or abs(h["centroid"] - u["centroid"]) > 150
               for u in uniq):
            uniq.append(h)
    hits = uniq

    def take(pred, n, sort_key, reverse=True):
        pool = [h for h in hits if pred(h)]
        pool.sort(key=sort_key, reverse=reverse)
        chosen = pool[:n]
        for c in chosen:
            hits.remove(c)
        return chosen

    d = os.path.join(OUT, args.pack)
    if os.path.isdir(d):
        shutil.rmtree(d)
    os.makedirs(d)

    counts = {}
    # space / enter: the heaviest, most low-frequency hits
    heavy = take(lambda h: h["dur"] > 0.030, 1, lambda h: h["weight"])
    enter = take(lambda h: h["dur"] > 0.030, 1, lambda h: h["weight"])
    # delete: short and bright (a small key, snapped fast)
    delete = take(lambda h: h["dur"] < 0.085, 1, lambda h: h["high"] * h["peak"])
    # modifier / release: the quietest hits, kept short
    modifier = take(lambda h: h["dur"] < 0.110, 1, lambda h: h["peak"], reverse=False)
    release = take(lambda h: h["dur"] < 0.120, 1, lambda h: h["peak"], reverse=False)
    # click: tightest, brightest hit left
    click = take(lambda h: h["dur"] < 0.075, 1, lambda h: h["centroid"])
    # keys: spread across brightness so takes do not sound identical
    keys = take(lambda h: True, args.keys_takes, lambda h: h["centroid"])

    for role, items, gain in (
        ("space", heavy, 1.0), ("enter", enter, 1.0), ("delete", delete, 1.0),
        ("modifier", modifier, 0.9), ("release", release, 0.45),
        ("click", click, 0.8),
    ):
        for i, h in enumerate(items, 1):
            write(os.path.join(d, "%s-%d.wav" % (role, i)), finish(h["hit"], gain, role, args.tone))
        counts[role] = len(items)

    for i, h in enumerate(keys, 1):
        write(os.path.join(d, "keys-%d.wav" % i), finish(h["hit"], 0.95, "keys", args.tone))
    counts["keys"] = len(keys)

    print("\npack %r  (%d source hits)" % (args.pack, len(hits) + sum(counts.values())))
    for role, n in counts.items():
        files = sorted(f for f in os.listdir(d) if f.startswith(role + "-"))
        durs = []
        for f in files:
            with wave.open(os.path.join(d, f)) as w:
                durs.append(1000 * w.getnframes() / w.getframerate())
        print("  %-9s %d  %s" % (role, n, " ".join("%.0fms" % x for x in durs)))

    manifest_path = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    manifest[args.pack] = {
        role: sorted(f for f in os.listdir(d) if f.startswith(role + "-"))
        for role in counts
    }
    json.dump(manifest, open(manifest_path, "w"), indent=2)
    print("manifest updated")


if __name__ == "__main__":
    main()
