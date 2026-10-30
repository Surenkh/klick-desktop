# Changelog

Dates are release dates. Installers live on the
[releases page](https://github.com/Surenkh/klick-desktop/releases); each entry has a
detailed note under [`docs/releases/`](docs/releases/).

## 0.4.1 — 2026-10-30

- **Live stats.** Every captured key adds +1 tap and +1 XP, Kiki slaps give +10 XP;
  level and hat are recomputed in C (`stats.c`) and pushed to Settings and Kiki as
  they change, so Today and the buddy update while you type.
- **Tap pill on Kiki** — a compact counter under the character, on by default,
  toggleable in Buddy settings.
- **Milestones** — celebrate every 100 / 500 / 1,000 taps (or off): confetti burst,
  "🎉 N taps!" toast, party mood and a brighter cue. Detected once per threshold.
- **Welcome screen accessible** — menu bar → *Show welcome screen* re-runs the
  onboarding flow, and the permission banner follows capture state live.
- Native test suite grew to 43 checks, including the XP curve, hat unlocks and
  milestone crossing.

## 0.4.0 — 2026-10-30

**Klick is now a native macOS app. No Electron, no Chromium, no Node.**

- **7 MB** instead of 265 MB; the DMG is 7 MB instead of 127 MB.
- **~2–4 ms key-to-ear latency**: the CGEventTap thread pushes into a lock-free
  ring buffer that the CoreAudio render callback consumes, with a 64-frame device
  buffer. Measured tap→render: 0.4–1.0 ms.
- Objective-C shell: `NSStatusItem` menu bar, `NSPanel` + `WKWebView` for Kiki,
  lazy `WKWebView` Settings that is torn down when closed.
- Kiki returns: floats above other apps, bounces on every key, drag to move
  (position saved), click to slap (+10 XP).
- Agents are back: unix-socket listener, `Klick --hook` CLI, recorded done/error
  cues, Claude Code hooks wired from the Agents tab. Cursor/Codex are next.
- Sample-rate matching via ExtAudioFile; output-device changes rebuild the
  AudioUnit and re-convert every pack (AirPods/USB DAC safe).
- Sleep/wake recovery, tap re-enable on timeout, `SMAppService` launch at login.
- Signed with a stable local identity, so Input Monitoring survives rebuilds.
- Single-arch builds, staging bundles deleted and unregistered, `.metadata_never_index`
  in every build directory — macOS can only ever see one Klick.

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
