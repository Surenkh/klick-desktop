# Changelog

Dates are release dates. Installers live on the
[releases page](https://github.com/Surenkh/klick-desktop/releases); each entry has a
detailed note under [`docs/releases/`](docs/releases/).

## 0.3.1 — 2026-10-30

- **Onboarding actually dismisses.** `Start typing`, `Not now` and Escape close the screen
  immediately and persist `onboarded`; grants while it is open flip the card to "Listening
  for keys" and promote *Start typing* to the primary action.
- **Version is real.** About reads `app.getVersion()` instead of a hardcoded string, and
  shows the Electron/Chromium/Node triplet it is running on.
- **Diagnostics panel.** About now reports key capture state, last key age, keys today,
  packs loaded, and the measured audio latency (device + pipeline). Latency is published at
  startup and on the first keys instead of waiting for the 20th.
- Fixed three leftover `window.clackle` references that broke the permission painter and
  the onboarding handler after the 0.2 rename.

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
