## Klick 0.1.0 — first public build

Keyboard sounds for macOS, with **Kiki**, your little keycap companion.

### Install

1. Download `Klick-0.1.0-arm64.dmg` below and open it.
2. Drag **Klick** into **Applications**.
3. First launch: macOS cannot verify the app (it is unsigned) → open **System Settings → Privacy & Security → Open Anyway**.
4. Settings → **Open Input Monitoring** → enable Klick. It starts within a second, no restart.

There is no Dock icon once Settings is closed — Klick lives in the menu bar, and Kiki sits in the bottom-right corner of the screen.

### What's in it

- **Four sound packs**, cut key-by-key from real keyboard recordings: `laptop`, `hard`, `fast`, `soft`
- Separate samples for normal keys (5 takes), Space, Return, Delete, modifiers, key-up and mouse clicks
- Random take + slight pitch variation per press, so fast typing does not sound mechanical
- Stereo placement: left-side keys lean left, right-side keys lean right
- **Kiki**: eight states with crossfaded transitions, squash on every key, sleep after 90 s idle, draggable
- **Agent cues** for Claude Code, Cursor and the Codex CLI — recorded chime for done, recorded cue for errors, pack-based notes for "needs you"
- Menu bar control: sounds on/off, volume, pack, show Kiki, Settings, Quit
- Settings with pack audition, per-key options, agent connect/remove, daily stats

### Privacy and permissions

- **Input Monitoring only.** A native helper observes HID reports; it never installs an event tap, so it cannot intercept or delay typing, and it never asks for Accessibility.
- No Accessibility, Screen Recording, microphone, camera, Full Disk Access or notifications.
- **No network code at all** — no account, no telemetry, no update pings, no licence server.
- Everything stays on this Mac: settings and counters in `~/Library/Application Support/Klick`.

### Known limitations

- **Unsigned and not notarised** — one "Open Anyway" click on first launch.
- **arm64 only** in this build (no Intel slice).
- Windows build is not published yet.
- Not implemented: sensor features (slaps, knocks, lid creak), Guard Mode, Clean Mode, shortcut cheat sheet, Song Mode.

### Verify the download

```
shasum -a 256 Klick-0.1.0-arm64.dmg
1c9b0739a66575169ebf64ee36bd271cee3b0dc547dee035fcda18245f302c2d
```

MIT licensed (code). Artwork and sound recordings carry their own terms — see `LICENSE` and `CREDITS.md`.
