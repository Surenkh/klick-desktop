## Klick 0.4.0 — native, 7 MB, ~2 ms

Klick is a native macOS app: AppKit, CoreAudio and a listen-only `CGEventTap`, with
the settings UI in `WKWebView`.

### Install

| Mac | File |
| --- | --- |
| Apple silicon (M1–M6) | `Klick-0.4.0-arm64.dmg` |
| Intel | `Klick-0.4.0-x64.dmg` |

Drag **Klick** to Applications, launch, allow it once via **System Settings →
Privacy & Security → Open Anyway**, then flip **Input Monitoring** on.

### Numbers

| Metric | Klick 0.4.0 (native) |
| --- | --- |
| App size | **7 MB** |
| DMG | **7 MB** |
| Tap → render | **0.4–1.0 ms** |
| Key → ear | **~2–4 ms** |

### What's new

- **Native shell** — menu bar item and settings window, built on AppKit and WebKit.
- **Kiki is back** — floating panel above other apps, bounces on every key, draggable
  (position remembered), click to slap (+10 XP).
- **Agents** — unix socket + `Klick --hook` CLI + recorded done/error cues; Claude Code
  hooks installed from the Agents tab.
- **Device switching** — output changes rebuild the AudioUnit and re-convert every
  pack to the new sample rate, so AirPods and USB DACs stay in tune.
- **Sleep/wake** — capture and audio recover automatically.
- **Launch at login** via `SMAppService`.
- **Stable signing identity** — Input Monitoring survives rebuilds, unlike the ad-hoc
  builds of 0.3.x.

### Known limits

- Cursor and Codex hooks are not wired yet (Claude Code is).
- No notarization: the app is signed locally, so the first launch needs "Open Anyway".
- Intel builds are cross-compiled and tested by the CI smoke suite, not on Intel hardware.

### Checksums

```
326c6a49583a029059ec327ac43549ebcc5c268c79a9874595e5a123a9430240  Klick-0.4.0-arm64.dmg
35617835fac8f3790915e7abf28c0439f7a7ba1e2fd4d7c880ede28ec6d4b5ff  Klick-0.4.0-x64.dmg
```
