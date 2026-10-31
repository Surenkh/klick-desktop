## Klick 0.5.0 — hats, XP and a Studio pack

Native macOS, 8 MB, no Electron. Latency stays at ~2–4 ms.

### Install in one line

```sh
curl -fsSL https://raw.githubusercontent.com/Surenkh/klick-desktop/main/scripts/install.sh | sh
```

Picks your architecture, verifies the SHA-256, installs to `/Applications`, clears the
quarantine flag and launches Klick — no Gatekeeper dialog.

### Or download the DMG

| Mac | File |
| --- | --- |
| Apple silicon (M1–M6) | `Klick-0.5.0-arm64.dmg` |
| Intel | `Klick-0.5.0-x64.dmg` |

Drag **Klick** to Applications, launch, allow it once via **System Settings → Privacy &
Security → Open Anyway**, then flip **Input Monitoring** on. (Klick is not notarized
yet, so browser downloads always need that one-time confirmation; the installer above
skips it.)

### What's new

- **Six hats that sit on Kiki's head** — mint beanie (Lv 2), baseball cap (4),
  explorer hat (6), wizard hat (8), graduation cap (10), golden crown (15). They
  follow his bounce, tilt with the perspective, and can be swapped or taken off in
  **Today → Wardrobe**.
- **Real XP progression** — level badge, animated mint progress bar, XP to the next
  level, and the next hat named. The curve lives in the C core so the UI and the
  engine never disagree.
- **Three volume channels** — key taps, celebrations, and agent/system cues are
  independent sliders wired straight into the CoreAudio mixer.
- **Studio pack** — a fifth sound pack, synthesised from scratch. `gen-sounds.py`
  profiles reference takes (modal peaks, bandwidths, spectral tilt, sub-bass,
  32-band envelope) and rebuilds new audio from those numbers. All five packs are
  original and MIT.
- **Kiki and the tap counter are separate windows**, each draggable and remembered;
  the counter keeps a fixed 10 px shape and updates on every key press.
- **Celebrations fixed** — milestone burst, confetti and toast fire reliably, with
  only one Kiki on screen during the burst.
- Mint theme throughout Settings; the amber warning banner stays amber on purpose.

### Checksums

```
8aeaf81d82f3502a7ad2978e29785fb4332c711e0b333b8d4f943b62095834e6  Klick-0.5.0-arm64.dmg
863d8b2fcfe9c13eb9353563cf70d5ea793b59d637461dc10075c0938e4b0f58  Klick-0.5.0-x64.dmg
```
