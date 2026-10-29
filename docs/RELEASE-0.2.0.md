## Klick 0.2.0 — smaller Kiki, weightless drift, Intel builds

### Install

| Mac | File |
| --- | --- |
| Apple silicon (M1–M4) | `Klick-0.2.0-arm64.dmg` |
| Intel | `Klick-0.2.0-x64.dmg` |

Open the DMG, drag **Klick** to Applications. First launch: macOS cannot verify the
app (unsigned) → **System Settings → Privacy & Security → Open Anyway**. Then Settings →
**Open Input Monitoring** and enable Klick.

### What changed

- **Kiki is 30 % smaller** — 97 px instead of 138 px, in a 118 px window, so the corner
  feels lighter on screen.
- **Kiki now drifts instead of sitting still.** A 13-second, slightly irregular hover
  (translate + a touch of rotation, no easing repeats at the seams) runs on a wrapper
  element, so it never fights the press squash. Static PNG states float the same way.
  `prefers-reduced-motion` turns it off.
- **Intel support.** Separate arm64 and x86_64 DMGs, each with the correct Electron
  runtime and the universal (arm64 + x86_64) key reader inside.
- Release artifacts are now named `Klick-<version>-<arch>.dmg`.

### Checksums

```
3cd0ba7b4eb61b603792226c4c0c059c232abe8ed620a1521f324853a4655f46  Klick-0.2.0-arm64.dmg
96135be43cbcfb2ad84dda4904c0bd1121f561bdeeb1547b573b40c7821dbf28  Klick-0.2.0-x64.dmg
```

MIT licensed code; artwork and sound carry their own terms (see `LICENSE`, `CREDITS.md`).
