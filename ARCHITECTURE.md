# Architecture

Klick is one Electron app with a small native helper. Everything is local: no
server, no telemetry, no network code at all in this build.

```
┌──────────────────────── main process ────────────────────────┐
│ index.js        composition root: order + wiring only         │
│ windows.js      audio / Kiki / Settings windows, placement    │
│ tray.js         menu bar menu                                 │
│ ipc.js          one table of renderer → main calls            │
│ audio-bus.js    the only path to the audio renderer           │
│ cues.js         agent cue routing (recorded + pack notes)     │
│ agent-server.js local socket that the agent shim writes to    │
│ agents.js       hook install/remove, shim, backups            │
│ packs.js        pack + cue file access                        │
│ store.js        settings/stats, debounced persistence         │
│ logger.js       console + capped log file                      │
│ keyboard/                                                     │
│   index.js      platform facade: one onKey({type,role,pan})   │
│   mac.js        drives the in-process addon                   │
│   win.js        uiohook adapter (Windows)                     │
│   macos-keycodes.js  virtual keycode → role + stereo column    │
│   uiohook-map.js     keycode → role + stereo column (Windows)  │
└───────────────────────────────────────────────────────────────┘
        │                                     │ IPC (small JSON)
        ▼                                     ▼
┌─ native/klick-capture.node (in-process) ─┐  ┌──── renderers ────┐
│ N-API addon, listen-only CGEventTap      │  │ audio  WebAudio   │
│ cannot modify or block events            │  │ buddy  Kiki       │
│ uses Klick.app's own TCC identity        │  │ settings  UI      │
└──────────────────────────────────────────┘  └───────────────────┘
```

## Why capture lives inside the app

| | separate helper binary | in-process addon (current) |
| --- | --- | --- |
| Input Monitoring identity | its own, so the app's grant does not apply — it reported "no permission" forever | the app's, so the grant works |
| Entries in System Settings | duplicates, one per build | one |
| Failure mode | a tap can be created without permission and silently deliver nothing | status comes from the real tap state |
| Crash risk | separate process | shared with the app (guarded by `watch()`) |

The tap is **listen-only** (`kCGEventTapOptionListenOnly`): the OS forbids it from
modifying or blocking events, so Klick cannot delay or swallow a keystroke. That is
also why only Input Monitoring is needed — an active tap would require Accessibility.

## Data flow for one key press

```
HID report → klick-keys → "d 20" (stdout)
  → mac.js parses → hid.js classifies (role, pan)
  → index.js handleKey:
        audio.key({pack, role, pan, rate, gain})   → audio-bus → renderer IPC
        windows.toBuddy('buddy:press')             → renderer IPC
        store.addXp(1)                             → memory only
        pushStatsSoon()                            → coalesced 300 ms
```

Everything after classification is asynchronous. The only work in the input
path is: one table lookup, one Map write, two tiny `webContents.send` calls.

## Threading and performance budget

- The helper is its own process; the main process never blocks on I/O.
- Audio decoding happens once per pack in the renderer; playback is scheduled on
  the WebAudio thread, so a busy main process cannot stutter a key.
- `settings.json` writes are debounced (600 ms) and flushed on quit.
- The stats push to Settings is coalesced (300 ms) — typing at 10 keys/s
  produces one UI update per ~300 ms, not ten.
- Windows are created hidden and shown on `ready-to-show`; the buddy is a
  non-activating panel, so it never steals focus or clicks.
- Startup order: audio window first (so the first keypress has a target), then
  Kiki, then tray, then capture. Settings is lazy.

## Failure behaviour

| Failure | What happens |
| --- | --- |
| Input Monitoring denied | helper prints `access missing`, waits; granting it later starts capture with no restart; Settings shows a banner |
| Helper missing/corrupt | capture stays off, log line, app otherwise fully usable |
| Helper crashes | restarted after 4 s; at most a short gap in sounds |
| Agent config invalid | that connect/remove is refused, file untouched, error shown |
| Another instance running | the second exits; the first raises Settings |
| Any uncaught error | logged to `<userData>/klick.log`, app keeps running |

## Extension points

- New sound pack: drop a folder into `assets/packs/<name>/` with
  `{keys-1..n,space,enter,delete,modifier,release,click}` at 48 kHz mono; it
  appears in the UI and tray.
- New agent: add an entry to `AGENTS` in `agents.js` (config path + events) and
  a cue mood in `cues.js`.
- New cue sound: drop `assets/cues/<name>.wav`; `cues.play(name)` prefers the
  file and falls back to pack notes.
- New platform: implement `start/stop/status` in `keyboard/`, reuse everything
  else.
