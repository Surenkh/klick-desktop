## Klick 0.6.2 — sound length control

Native macOS, 8.6 MB, ~2–4 ms key-to-ear.

### Install

```sh
curl -fsSL https://raw.githubusercontent.com/Surenkh/klick-desktop/main/scripts/install.sh | sh
```

### New: Sound length

Settings → Keys → **Sound length**:

- **Natural** (default) — each sample plays as recorded, 44–114 ms for keys.
- **Tight** — the mixer caps keys at 60 ms, delete 150 ms, enter 180 ms and space
  200 ms with an 8 ms fade. Snappier, still a keyboard rather than a UI tick.

It changes how long a press rings, not how soon it starts: the ~2–4 ms latency is
untouched.

### Checksums

```
9ac46339284af0ac2a8151e7711ce3196dea090cb8c28cef67676a5f0ed7c759  Klick-0.6.2-arm64.dmg
5a112fab524270e6e40fa4b035c42c49cec8f323c1cfab43089aac686fb0a323  Klick-0.6.2-x64.dmg
```
