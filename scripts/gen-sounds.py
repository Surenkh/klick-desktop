#!/usr/bin/env python3
"""Klick sound packs - physical-ish keyboard synthesis.

Each hit is modelled as four layers:

  1. click     broadband noise burst, band-passed, 1-5 ms decay (plastic/metal snap)
  2. body      3-6 damped resonances (switch housing / keycap)
  3. thump     low case resonance, 40-70 ms
  4. ping      long metallic partials (only for buckling-spring / clicky switches)

Everything is synthesised from scratch with numpy, so the packs carry no
third-party samples. Output: 48 kHz mono 16-bit WAV in assets/packs/<pack>/.

Usage: python3 scripts/gen-sounds.py
"""

import argparse
import json
import os
import wave

import numpy as np

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "packs")

# pack: body modes (Hz, decay s), click band (Hz), click level/decay,
#       thump (Hz / level), ping modes, drive (saturation)
PACKS = {
    # IBM Model M: loud sharp click, spring ping, big hollow case
    "buckling": dict(
        modes=[(210, 0.030), (430, 0.026), (760, 0.020), (1180, 0.014)],
        click=(2600, 9000), click_level=0.85, click_decay=0.0018,
        thump=105, thump_level=0.55,
        ping=[(3100, 0.090), (4650, 0.120), (6100, 0.060)], ping_level=0.30,
        drive=2.4,
    ),
    # MX Blue style clicky: jacket click plus bottom-out on plastic
    "blue": dict(
        modes=[(300, 0.026), (620, 0.020), (980, 0.014)],
        click=(2200, 8000), click_level=0.75, click_decay=0.0030,
        thump=120, thump_level=0.35,
        ping=[(4200, 0.035)], ping_level=0.14,
        drive=2.0,
    ),
    # tactile brown: soft bump, rounded body, almost no ping
    "brown": dict(
        modes=[(240, 0.034), (470, 0.026), (820, 0.017)],
        click=(1400, 4200), click_level=0.42, click_decay=0.0040,
        thump=95, thump_level=0.45,
        ping=[], ping_level=0.0,
        drive=1.7,
    ),
    # linear red: smooth, deep, quick - gaming board without the clack
    "red": dict(
        modes=[(190, 0.030), (390, 0.022), (700, 0.013)],
        click=(1100, 3000), click_level=0.28, click_decay=0.0035,
        thump=85, thump_level=0.62,
        ping=[], ping_level=0.0,
        drive=1.9,
    ),
    # Topre / rubber dome: deep thock, no click, long soft tail
    "topre": dict(
        modes=[(150, 0.048), (290, 0.036), (520, 0.024), (860, 0.014)],
        click=(700, 2200), click_level=0.22, click_decay=0.0050,
        thump=72, thump_level=0.70,
        ping=[], ping_level=0.0,
        drive=1.6,
    ),
    # optical gaming: tight high tick, very short, snappy
    "optical": dict(
        modes=[(420, 0.016), (880, 0.012), (1450, 0.008)],
        click=(3200, 10000), click_level=0.62, click_decay=0.0012,
        thump=135, thump_level=0.22,
        ping=[(5200, 0.020)], ping_level=0.10,
        drive=2.2,
    ),
}

# role: pitch, decay, gain, click scale, thump scale
ROLES = {
    "keys":     (1.00, 1.00, 0.90, 1.00, 1.00),
    "space":    (0.55, 1.90, 1.00, 0.70, 1.70),
    "enter":    (0.70, 1.55, 0.98, 0.85, 1.45),
    "delete":   (0.76, 1.35, 0.94, 0.90, 1.30),
    "modifier": (0.84, 1.15, 0.82, 0.80, 1.10),
    "release":  (1.00, 0.55, 0.38, 0.15, 0.30),
    "click":    (1.30, 0.45, 0.60, 1.25, 0.25),
}

TAKES = {"keys": 3}


def bandpass_noise(rng, n, low, high):
    """White noise shaped with a smooth band-pass in the frequency domain."""
    spec = np.fft.rfft(rng.standard_normal(n))
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    lo = np.clip((freqs - low * 0.6) / (low * 0.6), 0, 1)
    hi = np.clip((high * 1.4 - freqs) / (high * 0.4), 0, 1)
    shape = (lo ** 0.6) * (hi ** 0.9)
    # presence lift around 3 kHz, where plastic clicks live
    shape *= 1.0 + 0.8 * np.exp(-((freqs - 3200) ** 2) / (2 * 1500 ** 2))
    return np.fft.irfft(spec * shape, n)


def synth(pack_name, role, take, rng):
    p = PACKS[pack_name]
    pitch, decay, gain, click_scale, thump_scale = ROLES[role]
    scale = 1.0 + (take - 1) * 0.012  # tiny per-take detune

    body_longest = max(d for _, d in p["modes"]) * decay
    ping_longest = max([t for _, t in p["ping"]] or [0.0]) * min(decay, 1.0)
    # long enough for the body to die and the spring ping to ring out, but no
    # longer: a key press is a click, not a drum hit
    n = int(SR * min(0.4, 3.0 * body_longest + 1.6 * ping_longest + 0.012))
    t = np.arange(n) / SR
    out = np.zeros(n)

    # --- body resonances ---------------------------------------------------
    for freq, tau in p["modes"]:
        f = freq * pitch * scale * rng.uniform(0.97, 1.03)
        a = (0.55 / len(p["modes"])) * rng.uniform(0.8, 1.15)
        phase = rng.uniform(0, 2 * np.pi)
        # slight downward glide: the plastic "settle" of a real press
        glide = 1.0 - 0.06 * (t / max(t[-1], 1e-6))
        out += a * np.sin(2 * np.pi * f * glide * t + phase) * np.exp(-t / (tau * decay))

    # --- case thump --------------------------------------------------------
    if p["thump_level"] > 0:
        tf = p["thump"] * pitch * rng.uniform(0.95, 1.05)
        out += (0.5 * p["thump_level"] * thump_scale) * np.sin(2 * np.pi * tf * t) * np.exp(-t / (0.045 * decay))

    # --- click transient ---------------------------------------------------
    if p["click_level"] * click_scale > 0.01:
        low, high = p["click"]
        click = bandpass_noise(rng, n, low * pitch, high * pitch)
        out += (0.9 * p["click_level"] * click_scale) * click * np.exp(-t / (p["click_decay"] * decay))
        if role in ("space", "enter", "delete"):
            # second, softer impact a few ms later, like a stabiliser seating
            delay = int(SR * 0.004)
            tail = np.zeros(n)
            tail[delay:] = click[: n - delay] * np.exp(-t[: n - delay] / (p["click_decay"] * 2))
            out += 0.25 * p["click_level"] * tail

    # --- metallic ping (spring / click jacket) -----------------------------
    if p["ping"] and p["ping_level"] > 0:
        for freq, tau in p["ping"]:
            f = freq * rng.uniform(0.98, 1.02)
            amp = p["ping_level"] * rng.uniform(0.7, 1.1) / len(p["ping"])
            out += amp * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / tau)

    # --- saturation + normalise -------------------------------------------
    drive = p["drive"]
    out = np.tanh(out * drive) / np.tanh(drive)

    # 0.6 ms attack ramp removes the DC step without softening the click
    ramp = max(1, int(SR * 0.0006))
    out[:ramp] *= np.linspace(0.0, 1.0, ramp)

    peak = np.max(np.abs(out)) or 1.0
    out = out / peak * 0.82 * gain
    fade = min(n, int(SR * 0.002))
    out[-fade:] *= np.linspace(1.0, 0.0, fade)
    return (np.clip(out, -1, 1) * 32767).astype("<i2")


def write_wav(path, samples):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(samples.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", help="print one generated sample path and exit")
    args = ap.parse_args()
    if args.path:
        print(os.path.join(OUT, args.path))
        return

    rng = np.random.default_rng(20261029)
    manifest = {}
    total = 0
    for pack in PACKS:
        d = os.path.join(OUT, pack)
        os.makedirs(d, exist_ok=True)
        manifest[pack] = {}
        for role in ROLES:
            manifest[pack][role] = []
            for take in range(1, TAKES.get(role, 1) + 1):
                samples = synth(pack, role, take, rng)
                path = os.path.join(d, "%s-%d.wav" % (role, take))
                write_wav(path, samples)
                manifest[pack][role].append("%s-%d.wav" % (role, take))
                total += 1
                print("%-26s %5.1f ms  peak %4.0f" % (
                    os.path.relpath(path, OUT), 1000.0 * len(samples) / SR,
                    float(np.max(np.abs(samples)))))
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("\n%d samples written across %d packs (all synthesised)" % (total, len(PACKS)))


if __name__ == "__main__":
    main()
