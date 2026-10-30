# Architecture

**Current release: Klick 0.4.0** — native macOS (arm64 + x86_64), no Electron, no Chromium, no Node.

## Shape of the app

```
Klick.app  (~7 MB)
├── Contents/MacOS/Klick            Objective-C + C, ~2 MB
├── Contents/Resources/web/         settings.html, settings.js, buddy.html (WKWebView)
├── Contents/Resources/assets/      sound packs, Kiki art, cues
└── Contents/Resources/icon.icns
```

One process. Three threads that matter:

| Thread | Job |
| --- | --- |
| main | AppKit, menu bar, windows, bridge replies |
| capture | `CGEventTap` listens for keys (listen-only) |
| CoreAudio | render callback mixes voices into the output buffer |

## The critical path (no JS, no IPC)

```
key down
  → CGEventTap callback (capture thread)
      · CGKeyCode → role + stereo pan          (native/app/keymap.c)
      · audio_trigger(...)                     (native/app/audio.c)
          → lock-free SPSC ring, stdatomic, no malloc
  → next render callback (CoreAudio thread)
      · pops triggers, picks a take, starts a voice
      · mixes with linear interpolation and constant-power pan
      · hardware buffer: 64 frames (1.33 ms @ 48 kHz)
```

Everything above is C. The JavaScript UI is never involved in playing a key sound —
which is why the measured tap→render time is 0.4–1.0 ms instead of the 45 ms the
Electron build inherited from Chromium's audio backend.

## Modules

| File | Responsibility |
| --- | --- |
| `native/app/main.m` | AppDelegate, status item, menu, windows, JS bridge, agents, launch at login, wake handling |
| `native/app/audio.c` | AudioUnit (DefaultOutput), pack loading, mixer, cues, device-change handling |
| `native/app/capture.c` | listen-only `CGEventTap` on its own thread, self-healing on timeout |
| `native/app/keymap.c` | CGKeyCode → role (keys/space/enter/delete/modifier/release) + pan |
| `native/app/bridge.js` | re-creates the `window.klick` API over `webkit.messageHandlers` |
| `tests/test_native.c` | keymap, pack loading, offline mixing and cue checks (23 assertions) |

## Sample-rate matching

Every WAV is decoded and resampled to the **current hardware rate** with
`ExtAudioFile` when a pack loads (44.1 / 48 / 96 kHz all work), so nothing ever
plays at the wrong pitch. When the default output device changes — speakers →
AirPods → USB DAC — an `AudioObjectAddPropertyListener` on
`kAudioHardwarePropertyDefaultOutputDevice` sets a flag; the main thread tears the
unit down, rebuilds it at the new rate, re-converts every pack and restores the
active pack. No crash, no silence, no pitch shift.

## Windows and the UI

- **Settings** — a `WKWebView` created the first time you open it and released when
  you close it, so idle RAM stays flat. The same HTML/CSS/JS from the Electron era
  runs unchanged; `bridge.js` maps `window.klick.*` onto script messages and
  promise callbacks.
- **Kiki** — a borderless, non-activating `NSPanel` (`opaque = NO`, clear
  background, floating level, joins all spaces) hosting a transparent `WKWebView`.
  Key presses are forwarded as `__klickEvent('press')`; dragging moves the panel
  and saves `buddyX/buddyY`; a click plays a hit and awards +10 XP.
- **Menu bar** — `NSStatusItem` with sounds on/off, volume, pack choice, Kiki
  toggle, launch at login, Settings, Quit.

## Agents

A unix socket at `~/Library/Application Support/Klick/agents.sock`, a shim at
`…/Klick/bin/klick-hook`, and `Klick --hook <agent> <event>` as the CLI. Events map
to recorded cues (`done`, `error`) or two rising notes (`needs-you`) and drive
Kiki's mood. Claude Code hooks are installed from the Agents tab; Cursor and Codex
are on the roadmap.

## Permissions and trust

- **Input Monitoring only.** The tap is created with `kCGEventTapOptionListenOnly`,
  so the OS forbids modifying or blocking events. No Accessibility, no Screen
  Recording, no microphone, no network.
- Ad-hoc signatures break TCC on every build, so the app is signed with a **stable
  local identity** (`Klick Local Signing`): the designated requirement is
  `identifier "app.klick.Klick" and certificate root = H"…"`, which survives
  recompilation. One grant, then rebuilds keep working.
- One copy only: builds compile for the current architecture, staging `.app`
  bundles are unregistered and deleted after packaging, and every build directory
  carries `.metadata_never_index`.

## Build and test

```sh
sh scripts/test-native.sh     # 23 checks, no device needed
sh scripts/build-native.sh    # build + sign for this Mac
sh scripts/package-native.sh  # both DMGs into dist/
```

## Older sources

`src/main`, `src/preload`, `src/renderer/audio.js` and `native/capture.c` are from the
previous 0.3.x codebase. They are not part of the app that ships; `native/app` is.
