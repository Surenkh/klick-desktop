## Klick 0.4.3

Native macOS, 7 MB, no Electron. This release is the polish pass on top of 0.4.0.

### Install

| Mac | File |
| --- | --- |
| Apple silicon (M1–M6) | `Klick-0.4.3-arm64.dmg` |
| Intel | `Klick-0.4.3-x64.dmg` |

Drag **Klick** to Applications, launch, allow it once via **System Settings → Privacy &
Security → Open Anyway**, then flip **Input Monitoring** on.

### New in 0.4.3

- **Kiki's live tap counter** — a mint pill beside the character that counts every key,
  with a celebration (burst art, confetti, toast, party mood and a brighter cue) every
  100 / 500 / 1,000 taps. Configurable on both the Sound and Buddy tabs.
- **Live stats** — taps, XP, level and hats update in Settings and on Kiki as you type;
  Kiki slaps award +10 XP.
- **Reset taps** in the Today tab, behind a two-step confirmation.
- **Mint theme** across Settings; the amber warning banner stays amber on purpose.
- **Two-line permission CTA** that no longer collapses at narrow widths.
- **One Kiki at a time** — the standard sprite hides for the celebration window.
- Fixed: the app crashing on any boolean bridge reply, Settings never loading, and the
  Sound menu being empty before packs loaded.

### Still true from 0.4.0

- ~2–4 ms key-to-ear latency: CGEventTap → lock-free ring → CoreAudio, 64-frame buffer.
- Sample-rate matching and output-device switching; sleep/wake recovery.
- Agents: unix socket, `Klick --hook`, recorded cues, Claude Code hooks.
- Input Monitoring only, listen-only tap, no network.

### Checksums

```
65ec893cfb180846aa28464bdb818dcf700e7ef06363ec325358b87c47c7dfa4  Klick-0.4.3-arm64.dmg
b0b0f3e8b4d235c5de35f37693b223cad92d7b848a82f0d9a3083d7dcf8c3cd7  Klick-0.4.3-x64.dmg
```
