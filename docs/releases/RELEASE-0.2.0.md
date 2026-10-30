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
- **Key capture rebuilt.** It now runs inside the app as a native addon
  (`klick-capture.node`) using a **listen-only** event tap: it may not modify or block
  input, and it needs **Input Monitoring only** (no Accessibility). This fixes the case
  where macOS had granted permission but the old separate helper process saw a different
  identity and stayed silent.
- **Audio stays awake**: a power-save blocker plus a watchdog that resumes the audio
  context, so sounds no longer stop after a while.
- Release artifacts are named `Klick-<version>-<arch>.dmg`.

### Checksums

```
d14072365bae466b594bdde15016f4cb2bc7021f8637f38c89a0eee10ebc1b4a  Klick-0.2.0-arm64.dmg
75a66f23cb9011a2cfbb3e49b9ce719afee8768ea1b8bb3f19a5bcab8737af05  Klick-0.2.0-x64.dmg
```

MIT licensed code; artwork and sound carry their own terms (see `LICENSE`, `CREDITS.md`).
