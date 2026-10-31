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


# ---------------------------------------------------------------------------
# Studio profile: measure eight reference takes, then resynthesise the pack
# from those measurements. The result contains no audio from the references --
# only numbers (frequencies, decays, tilt) drive our own synthesis.
# ---------------------------------------------------------------------------

def _load_wav(path):
    with wave.open(path) as w:
        sr = w.getframerate()
        raw = w.readframes(w.getnframes())
    data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return data, sr


def _envelope(data, sr, hop_ms=1.0):
    hop = max(1, int(sr * hop_ms / 1000.0))
    frames = max(1, len(data) // hop)
    return np.array([np.sqrt(np.mean(data[i * hop:(i + 1) * hop] ** 2))
                     for i in range(frames)])


def _spectral_peaks(data, sr, count=8):
    n = 1 << 14
    seg = data[:min(len(data), int(sr * 0.06))]
    if len(seg) < 64:
        return []
    window = np.hanning(len(seg))
    spectrum = np.abs(np.fft.rfft(seg * window, n=n))
    freqs = np.fft.rfftfreq(n, 1.0 / sr)
    spectrum /= (spectrum.max() or 1.0)

    peaks = []
    for i in range(2, len(spectrum) - 2):
        if not (spectrum[i] > spectrum[i - 1] and spectrum[i] >= spectrum[i + 1]):
            continue
        if spectrum[i] < 0.04 or freqs[i] < 80 or freqs[i] > 12000:
            continue
        # -6 dB width around the peak
        j = i
        while j > 0 and spectrum[j] > spectrum[i] * 0.5: j -= 1
        k = i
        while k < len(spectrum) - 1 and spectrum[k] > spectrum[i] * 0.5: k += 1
        bw = max(20.0, freqs[k] - freqs[j])
        peaks.append({"f": float(freqs[i]), "a": float(spectrum[i]), "bw": float(bw)})
    peaks.sort(key=lambda p: -p["a"])

    kept = []
    for p in peaks:
        if all(abs(p["f"] - q["f"]) > 25 for q in kept):
            kept.append(p)
        if len(kept) >= count:
            break
    for p in kept:
        # higher partials ring out faster
        p["tau"] = float(np.clip(900.0 / (1.0 + p["f"] / 900.0), 8.0, 120.0))
    return kept


def profile_takes(directory, out_json):
    """Measure every take and store the acoustics as numbers, not audio."""
    profiles = {}
    for name in sorted(os.listdir(directory)):
        if not name.endswith(".wav"):
            continue
        data, sr = _load_wav(os.path.join(directory, name))
        if len(data) == 0:
            continue
        idx = np.argmax(np.abs(data) > np.max(np.abs(data)) * 0.05)
        data = data[max(0, idx - int(sr * 0.002)):]

        env = _envelope(data, sr)
        peak = float(env.max()) or 1.0
        attack_ms = float((np.argmax(env) + 1))
        below = np.where(env < peak * 0.1)[0]
        decay_ms = float(below[0] if len(below) else len(env))

        spectrum = np.abs(np.fft.rfft(data, n=1 << 14))
        freqs = np.fft.rfftfreq(1 << 14, 1.0 / sr)
        band = (freqs > 200) & (freqs < 8000)
        tilt = float(np.polyfit(np.log10(freqs[band]), np.log10(spectrum[band] + 1e-9), 1)[0]) \
            if band.sum() > 8 else -1.0

        total = float(np.sum(spectrum ** 2)) or 1.0
        sub = float(np.sum(spectrum[freqs < 120] ** 2) / total)
        sub_f = float(freqs[np.argmax(spectrum[freqs < 120])]) if (freqs < 120).any() else 60.0

        onset = data[:int(sr * 0.01)]
        noise = float(np.std(onset) / (np.max(np.abs(onset)) or 1.0))

        edges = np.logspace(np.log10(80.0), np.log10(16000.0), 33)
        bands = []
        for lo, hi in zip(edges[:-1], edges[1:]):
            sel = (freqs >= lo) & (freqs < hi)
            bands.append(float(np.mean(spectrum[sel])) if sel.any() else 0.0)
        top = max(bands) or 1.0
        bands = [round(b / top, 4) for b in bands]

        profiles[name[:-4]] = {
            "dur_ms": round(1000.0 * len(data) / sr, 1),
            "attack_ms": round(attack_ms, 1),
            "decay_ms": round(decay_ms, 1),
            "tilt": round(tilt, 3),
            "sub": round(min(1.0, sub * 8.0), 3),
            "sub_hz": round(max(40.0, min(110.0, sub_f)), 1),
            "noise": round(min(0.7, max(0.05, noise * 2.5)), 3),
            "noise_tau_ms": round(max(6.0, decay_ms * 0.35), 1),
            "centroid_hz": round(float(np.sum(freqs * spectrum ** 2) / total), 1),
            "bands": bands,
            "peaks": _spectral_peaks(data, sr),
        }
        print("  profiled %-12s %5.0f ms  peaks %d  centroid %4.0f Hz" % (
            name, profiles[name[:-4]]["dur_ms"], len(profiles[name[:-4]]["peaks"]),
            profiles[name[:-4]]["centroid_hz"]))

    with open(out_json, "w") as f:
        json.dump(profiles, f, indent=2)
    print("wrote %s (%d takes)" % (out_json, len(profiles)))
    return profiles


def synth_take(profile, seed, peak=0.89):
    """Modal + noise resynthesis. Fresh audio, driven only by measured numbers."""
    rng = np.random.default_rng(seed)
    n = max(64, int(SR * profile["dur_ms"] / 1000.0))
    t = np.arange(n) / float(SR)
    out = np.zeros(n)

    for p in profile["peaks"]:
        f = p["f"] * (1.0 + rng.normal(0, 0.004))
        amp = p["a"] * rng.uniform(0.85, 1.15)
        tau = max(0.004, p["tau"] / 1000.0)
        out += amp * np.exp(-t / tau) * np.sin(2 * np.pi * f * t + rng.uniform(0, 2 * np.pi))

    noise = rng.normal(0.0, 1.0, n)
    spectrum = np.fft.rfft(noise)
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    shape = np.zeros_like(freqs)
    band = freqs > 120
    shape[band] = (freqs[band] / 1000.0) ** profile["tilt"]
    shape[freqs > 12000] = 0.0
    noise = np.fft.irfft(spectrum * shape, n)
    noise /= (np.max(np.abs(noise)) or 1.0)
    out += noise * profile["noise"] * np.exp(-t / max(0.004, profile["noise_tau_ms"] / 1000.0))

    out += profile["sub"] * np.exp(-t / 0.035) * np.sin(2 * np.pi * profile["sub_hz"] * t)

    # match the reference's broad spectral envelope (numbers, not samples)
    if profile.get("bands"):
        spectrum = np.fft.rfft(out)
        freqs = np.fft.rfftfreq(n, 1.0 / SR)
        edges = np.logspace(np.log10(80.0), np.log10(16000.0), 33)
        scale = np.zeros_like(freqs)
        for lo, hi, gain in zip(edges[:-1], edges[1:], profile["bands"]):
            sel = (freqs >= lo) & (freqs < hi)
            if not sel.any():
                continue
            have = float(np.sqrt(np.mean(np.abs(spectrum[sel]) ** 2)))
            scale[sel] = gain / (have + 1e-9)
        out = np.fft.irfft(spectrum * scale, n)

    attack = max(1, int(SR * 0.0006))
    out[:attack] *= np.linspace(0, 1, attack)
    fade = max(1, int(SR * 0.003))
    if len(out) > 2 * fade:
        out[-fade:] *= np.linspace(1, 0, fade)
    out *= peak / (np.max(np.abs(out)) or 1.0)
    return out


def synth_pack(profiles_json, out_dir):
    with open(profiles_json) as f:
        profiles = json.load(f)
    os.makedirs(out_dir, exist_ok=True)
    for name in os.listdir(out_dir):
        if name.endswith(".wav"):
            os.remove(os.path.join(out_dir, name))

    written = 0
    for i, (name, profile) in enumerate(sorted(profiles.items())):
        samples = synth_take(profile, seed=1000 + i)
        path = os.path.join(out_dir, name + ".wav")
        with wave.open(path, "w") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())
        written += 1
        print("  %-12s %5.0f ms  peak %.2f" % (name, 1000.0 * len(samples) / SR,
                                               float(np.max(np.abs(samples)))))
    print("%d synthesised takes -> %s" % (written, out_dir))


# ---------------------------------------------------------------------------
# Pack library: one acoustic character per pack, all synthesised from the
# reference profiles. Each entry only changes numbers (pitch, decay, tilt,
# thock, noise, ring), so every pack is original audio.
# ---------------------------------------------------------------------------

LIBRARY = [
    # id, display name, vibe, category, sources, transform
    dict(id="blue-clicky", name="Blue Clicky", vibe="Sharp buckling click with a plastic snap",
         category="Clicky", keys="Apple_Typing", space="Cooler_Master_Space_Bar_Hits_02",
         enter="Corsair_Enter_Hits_02", delete="Corsair_Backspace_Hits_02",
         pitch=1.12, tilt=0.15, decay=0.75, sub=0.6, noise=1.25, ring=0.0),
    dict(id="creamy-thock", name="Creamy Thock", vibe="Deep PBT thock, rounded and warm",
         category="Thock", keys="Apple_Typing", space="Cooler_Master_Space_Bar_Hits_02",
         enter="Corsair_Enter_Hits_02", delete="Dell_Backspace_Hits_02",
         pitch=0.90, tilt=-0.25, decay=1.45, sub=1.6, noise=0.8, ring=0.0),
    dict(id="heavy-tactile", name="Heavy Tactile", vibe="Heavy bump, long housing ring",
         category="Mechanical", keys="Apple_Typing", space="Corsair_Space_Bar_Hits_02",
         enter="Corsair_Enter_Hits_02", delete="Corsair_Backspace_Hits_03",
         pitch=0.95, tilt=-0.05, decay=1.6, sub=1.2, noise=0.95, ring=0.25),
    dict(id="vintage-typewriter", name="Vintage Typewriter", vibe="Metal clack with a long mechanical ring",
         category="Retro", keys="Razer_Period_Hits_02", space="Corsair_Space_Bar_Hits_02",
         enter="Corsair_Enter_Hits_02", delete="Dell_Backspace_Hits_04",
         pitch=0.86, tilt=0.1, decay=1.9, sub=0.8, noise=1.1, ring=0.6),
    dict(id="low-chiclet", name="Low Chiclet", vibe="Short, soft low-profile keys",
         category="Quiet", keys="Dell_Various_Characters_Single", space="Cooler_Master_Space_Bar_Hits_02",
         enter="Logitech_Enter_Hits_02", delete="Dell_Backspace_Hits_02",
         pitch=1.25, tilt=0.05, decay=0.6, sub=0.5, noise=1.0, ring=0.0),
    dict(id="silent-linear", name="Silent Linear", vibe="Muted bottom-out, almost no click",
         category="Quiet", keys="Dell_Various_Characters_Single", space="Cooler_Master_Space_Bar_Hits_02",
         enter="Logitech_Enter_Hits_02", delete="Dell_Backspace_Hits_02",
         pitch=1.05, tilt=-0.2, decay=0.8, sub=0.4, noise=0.45, ring=0.0),
    dict(id="topre-thock", name="Topre Thock", vibe="Capacitive dome, soft and rounded",
         category="Thock", keys="Apple_Typing", space="Cooler_Master_Space_Bar_Hits_02",
         enter="Corsair_Enter_Hits_02", delete="Dell_Backspace_Hits_02",
         pitch=0.93, tilt=-0.15, decay=1.3, sub=1.5, noise=0.7, ring=0.0),
    dict(id="broadcast-desk", name="Broadcast Desk", vibe="Tight broadcast studio desk, dry and close",
         category="Mechanical", keys="Apple_Typing", space="Corsair_Space_Bar_Hits_02",
         enter="Corsair_Enter_Hits_02", delete="Corsair_Backspace_Hits_02",
         pitch=1.10, tilt=0.12, decay=0.7, sub=0.9, noise=1.15, ring=0.1),
    dict(id="arcade-micro", name="Arcade Micro", vibe="Microswitch snap, bright and fast",
         category="Clicky", keys="Razer_Period_Hits_02", space="Cooler_Master_Space_Bar_Hits_02",
         enter="Corsair_Enter_Hits_02", delete="Razer_Backspace_Hits_03",
         pitch=1.38, tilt=0.3, decay=0.5, sub=0.35, noise=1.4, ring=0.3),
    dict(id="alu-tkl", name="Aluminium TKL", vibe="Hollow aluminium ping with a tight case",
         category="Mechanical", keys="Apple_Typing", space="Corsair_Space_Bar_Hits_02",
         enter="Logitech_Enter_Hits_02", delete="Dell_Backspace_Hits_04",
         pitch=1.0, tilt=0.05, decay=1.2, sub=0.8, noise=1.0, ring=0.75),
    dict(id="gasket-soft", name="Gasket Soft", vibe="Cushioned gasket mount, soft and low",
         category="Thock", keys="Apple_Typing", space="Cooler_Master_Space_Bar_Hits_02",
         enter="Logitech_Enter_Hits_02", delete="Dell_Backspace_Hits_02",
         pitch=0.88, tilt=-0.3, decay=1.15, sub=1.3, noise=0.55, ring=0.0),
]

EXISTING = [
    dict(id="laptop", name="Laptop", vibe="Crisp, light laptop keys", category="Mechanical"),
    dict(id="hard",   name="Hard",   vibe="Heavy press with more body", category="Thock"),
    dict(id="fast",   name="Fast",   vibe="Tight and bright, built for speed", category="Clicky"),
    dict(id="soft",   name="Soft",   vibe="Muffled, quiet, office-safe", category="Quiet"),
    dict(id="studio", name="Studio", vibe="Neutral studio keys, full take", category="Mechanical"),
]


def _derive(profile, pitch=1.0, tilt=0.0, decay=1.0, sub=1.0, noise=1.0, ring=0.0):
    import copy
    p = copy.deepcopy(profile)
    for peak in p["peaks"]:
        peak["f"] = max(60.0, peak["f"] * pitch)
        peak["tau"] = max(4.0, peak["tau"] * decay)
    p["tilt"] = p["tilt"] + tilt
    p["sub"] = min(1.5, p["sub"] * sub)
    p["noise"] = min(0.9, p["noise"] * noise)
    if ring > 0:
        # metallic partials: a few long, high resonances
        base = p["peaks"][0]["f"] if p["peaks"] else 400.0
        for ratio in (2.4, 3.7, 5.1):
            p["peaks"].append({"f": base * ratio * pitch, "a": 0.35 * ring,
                               "bw": 30.0, "tau": 120.0 * ring})
    return p


def build_library(profile_json, out_root):
    with open(profile_json) as f:
        raw = json.load(f)
    # names come from the profiler as "<file>_cut"; strip that suffix
    profiles = {k.replace("_cut", ""): v for k, v in raw.items()}

    keep = {c["id"] for c in LIBRARY}
    written = 0
    for char in LIBRARY:
        out = os.path.join(out_root, char["id"])
        os.makedirs(out, exist_ok=True)
        for name in os.listdir(out):
            if name.endswith(".wav"):
                os.remove(os.path.join(out, name))

        keys_src = profiles.get(char["keys"])
        if not keys_src:
            print("  ! missing keys source for", char["id"], char["keys"]); continue

        # six takes, each a little different
        for take in range(1, 7):
            p = _derive(keys_src, char["pitch"], char["tilt"], char["decay"],
                        char["sub"], char["noise"], char["ring"])
            p["dur_ms"] = min(220.0, max(140.0, p["dur_ms"] * 0.8))
            samples = synth_take(p, seed=hash((char["id"], take)) & 0xffff, peak=0.89)
            _write(os.path.join(out, "keys-%d.wav" % take), samples)
            written += 1

        for role, src_key in (("space", "space"), ("enter", "enter"), ("delete", "delete")):
            src = profiles.get(char[src_key])
            if not src:
                continue
            p = _derive(src, char["pitch"], char["tilt"], char["decay"],
                        char["sub"], char["noise"], char["ring"])
            p["dur_ms"] = {"space": 320, "enter": 300, "delete": 260}[role]
            samples = synth_take(p, seed=hash((char["id"], role)) & 0xffff, peak=0.89)
            _write(os.path.join(out, role + "-1.wav"), samples)
            written += 1
        print("  %-20s %s" % (char["id"], char["name"]))

    manifest = {"packs": EXISTING + [{k: c[k] for k in ("id", "name", "vibe", "category")} for c in LIBRARY]}
    with open(os.path.join(out_root, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("%d samples across %d synthesised packs" % (written, len(keep)))


def _write(path, samples):
    with wave.open(path, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Klick sound synthesis")
    parser.add_argument("--profile", metavar="DIR", help="measure reference takes in DIR")
    parser.add_argument("--write", metavar="JSON", help="where to store the profile")
    parser.add_argument("--synth", metavar="JSON", help="resynthesise a pack from a profile")
    parser.add_argument("--out", metavar="DIR", help="output pack directory for --synth")
    parser.add_argument("--library", metavar="JSON", help="build every character pack from a profile")
    parser.add_argument("--root", metavar="DIR", help="packs root for --library (default assets/packs)")
    args = parser.parse_args()

    if args.profile:
        profile_takes(args.profile, args.write or "scripts/studio-profile.json")
    elif args.synth:
        synth_pack(args.synth, args.out or "assets/packs/studio")
    elif args.library:
        build_library(args.library, args.root or "assets/packs")
    else:
        main()
