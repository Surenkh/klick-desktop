# Architecture

Klick is one Electron app with a small native helper. Everything is local: no
server, no telemetry, no network code at all in this build.

```
┌──────────────────────── main process ────────────────────────┐
│ index.js        composition root: order + wiring only        │
│ windows.js      audio / Kiki / Settings windows, placement   │
│ tray.js         menu bar menu                                │
│ ipc.js          one table of renderer → main calls           │
│ audio-bus.js    the only path to the audio renderer          │
│ cues.js         agent cue routing (recorded + pack notes)    │
│ agent-server.js local socket that the agent shim writes to   │
│ agents.js       hook install/remove, shim, backups           │
│ packs.js        pack + cue file access                      │
│ store.js        settings/stats, debounced persistence        │
│ logger.js       console + capped log file                    │
│ keyboard/                                                    │
│   index.js      platform facade: one onKey({type,role,pan}) │
│   mac.js        spawns ../../native/bin/klick-keys           │
│   win.js        uiohook adapter (Windows)                    │
│   hid.js        HID usage → role + stereo column (pure)      │
│   uiohook-map.js keycode → role + stereo column (pure)       │
└──────────────────────────────────────────────────────────────┘
        │ spawn + stdout lines              │ IPC (small JSON)
        ▼                                   ▼
┌─ native/bin/klick-keys (C, universal) ─┐  ┌──────── renderers ────────┐
│ IOHIDManager, observe-only            │  │ audio.html  WebAudio      │
│ prints: access/ready/d <usage>/u <usage>│ │ buddy.html  Kiki          │
│ never intercepts, never blocks input  │  │ settings.html  UI         │
└───────────────────────────────────────┘  └───────────────────────────┘
```

## Why a native helper instead of an event tap

| | event tap (uiohook) | IOHIDManager helper (used on macOS) |
| --- | --- | --- |
| Permission | Accessibility **and** Input Monitoring | **Input Monitoring only** |
| Can it block input? | yes, while the callback runs | never — it only observes reports |
| Worst case | system-wide input stall | key sounds stop |
| Crash risk | inside the UI process | separate process, restarts on its own |

That is the entire trust argument: Klick cannot intercept, delay or drop a
keystroke, and it asks for one permission that macOS explains as "can see what
you type". Windows keeps uiohook because a low-level hook needs no permission
there.

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
