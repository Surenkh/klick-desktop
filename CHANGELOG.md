# Changelog

Dates are release dates. Installers live on the
[releases page](https://github.com/Surenkh/klick-desktop/releases); each entry has a
detailed note under [`docs/releases/`](docs/releases/).

## 0.3.0 — 2026-10-30

- First-run screen: permission-free **Hear a key**, live Input Monitoring detection,
  plain-language privacy line, `Start typing` completes setup.
- Removed the system wake lock (`powerSaveBlocker`) — Klick no longer keeps the Mac awake.
- Measured latency in Settings → About (device `baseLatency`/`outputLatency` + pipeline time).
- All sound packs decoded at startup; audio renderer recreated if it crashes.
- Audio context pinned to 48 kHz interactive.

## 0.2.0 — 2026-10-29

- Kiki 30 % smaller (97 px) with a slow weightless drift.
- Key capture moved **in-process** (`klick-capture.node`, listen-only CGEventTap):
  Input Monitoring only, no Accessibility, cannot block or modify a keystroke.
- Fixed "permission granted but silent" and duplicate entries in System Settings.
- Audio watchdog, cue playback resume, macOS keycode mapping.
- Intel (x86_64) installer alongside Apple silicon; artifacts named by architecture.

## 0.1.0 — 2026-10-29

- First public build: four sound packs cut from real keyboard recordings, Kiki with
  eight states, agent cues for Claude Code / Cursor / Codex, menu-bar app.
