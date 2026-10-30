## Klick 0.3.0 — reliable first run, measured latency, better battery

### Install

| Mac | File |
| --- | --- |
| Apple silicon (M1–M4) | `Klick-0.3.0-arm64.dmg` |
| Intel | `Klick-0.3.0-x64.dmg` |

Open the DMG, drag **Klick** to Applications. First launch: macOS cannot verify the app
(unsigned) → **System Settings → Privacy & Security → Open Anyway**. Then grant **Input
Monitoring** when Klick asks.

### What changed

- **A first run that cannot fail.** Klick opens a single screen: what it does, a *Hear a
  key* button that works before any permission, live Input Monitoring detection (the card
  turns green the moment you flip the switch, no restart), and a plain-language privacy line.
- **No more battery drain.** The old build held the whole Mac awake with a power-save
  blocker to keep a hidden audio window alive. That is gone; the audio graph is kept alive
  with a silent source instead, so the Mac can sleep normally.
- **Measured latency.** Settings → About now shows the real number:
  `Audio latency 7.9 ms (device 7.4 + pipeline 0.5)`, from the audio context's
  `baseLatency`/`outputLatency` plus our own handling time.
- **Faster first press.** All packs are decoded at startup instead of on demand, so
  switching a pack and immediately typing is already warm.
- **Crash recovery.** If the audio renderer ever dies, Klick recreates it instead of
  going permanently silent.
- Mouse clicks and key sounds come from the same listen-only tap (Input Monitoring only,
  no Accessibility, no network).

### Latency, in numbers

| Stage | Cost |
| --- | --- |
| Kernel → listen-only tap | 0.5–2 ms |
| Tap → app (in-process, N-API) | 0.2–2 ms |
| Main → audio renderer (IPC) | 0.3–1.5 ms |
| Node graph + `start()` | 0.1–0.5 ms |
| **Audio output buffer** | **2.7–10.7 ms** (128–512 frames @ 48 kHz) |
| Bluetooth output | +120–200 ms |

Typical end-to-end on built-in speakers: **7–15 ms**; the floor with WebAudio is ~5–6 ms,
and a native CoreAudio path could reach ~3–5 ms. Anything above ~20 ms starts to feel
disconnected; Bluetooth alone puts you at 130–200 ms, which is why Klick's next step is
warning about it.

### Checksums

```
ab4b1be0d267364cdf6ba8cd7b3a2ad230528da11b31b4e3491c94882ccabc9c  Klick-0.3.0-arm64.dmg
4d41f9636c49a6674577511c7e0ff6b48d847cd3a339a1c0d758580c852158a5  Klick-0.3.0-x64.dmg
```
