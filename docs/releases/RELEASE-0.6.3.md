## Klick 0.6.3 — settings polish

Native macOS, 8.6 MB, ~2–4 ms key-to-ear.

### Install

```sh
curl -fsSL https://raw.githubusercontent.com/Surenkh/klick-desktop/main/scripts/install.sh | sh
```

### Fixes

- **Buddy cue buttons respond** — Done / Needs you / Error were stubbed out in the
  bridge and played nothing; they now use the real cue sounds and change Kiki's mood.
- **The wardrobe shows what you're wearing** — the frame follows your pick instantly,
  the worn hat carries a ✓ badge, and *No hat* is framed when nothing is on. Tapping
  the worn hat takes it off.
- **Kiki stopped scowling** — the press sprite was an angry face flashed on every
  keystroke; presses now only squash, keeping the friendly expression.
- **Celebrations keep Kiki visible** — the sprite is no longer hidden during a
  milestone; the party pose is the same size, with confetti and the toast.
- **Agents tab removed** until Cursor and Codex are genuinely wired; Claude Code's
  hooks still work in the background.

### Checksums

```
3b250db2404d3d97393caf34940645670b63418f37acd253c12f085fcad2ee07  Klick-0.6.3-arm64.dmg
91ca4a76ef9135c9d7887db831d111efbbb4b4f2419fe6edf758259a5b9af87d  Klick-0.6.3-x64.dmg
```
