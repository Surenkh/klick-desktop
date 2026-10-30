![Klick — your little keycap companion](docs/cover.jpg)

# Klick

Keyboard sounds for **macOS and Windows**, with **Kiki**, a little keycap companion.

**Latest release: 0.3.0.**

**Download:** grab `Klick-<version>-arm64.zip` from Releases, then follow
[`INSTALL.md`](INSTALL.md) (one "Open Anyway" click on first launch, because the
build is unsigned).

Version history: [`CHANGELOG.md`](CHANGELOG.md). New here? [`DOCS.md`](DOCS.md) explains every feature, the internals, the permissions and
what is verified versus still missing.
Built from the behaviour map produced by reverse-engineering TapNoise 0.2.6
(see [`../targets/tapnoise/RE-FINDINGS.md`](../targets/tapnoise/RE-FINDINGS.md)).

Different name, same core idea, none of their code or audio.

## Run it

```sh
cd klick
npm install          # electron + uiohook-napi
npm test             # key mapping + agent hook suites
npm run sounds       # regenerate synthetic packs (not used by default)
npm start
```

The app lives in the menu bar / system tray. The buddy appears bottom-right; drag it anywhere.

**macOS permission:** *Input Monitoring* only. Klick reads HID reports through a native
helper, so it never intercepts input and never asks for Accessibility. In development the
helper runs under Electron, so grant `Electron.app` once; a packaged build asks for Klick
itself. Granting it needs no restart. Without it the app runs fine, silently.

**Windows:** no permission prompt; the low-level hook works as soon as the app starts, and the
buddy/tray behave the same.

## What it does

| Behaviour | Status | Notes |
| --- | --- | --- |
| Per-key sounds across all apps | done | global hook, OS auto-repeat filtered per key |
| Key roles: normal keys, Space, Return, Delete, modifiers | done | separate samples per role, like the original |
| Three takes per key + per-press pitch jitter | done | no two presses identical |
| Stereo placement by keyboard column | done | left keys lean left |
| Release ("key-up") sound | done | toggle in Keys |
| Mouse-click sound | done | left button |
| Volume, master on/off, pack switching | done | tray + settings window |
| Menu-bar / tray control | done | pack, volume, buddy, quit |
| Desktop buddy that presses along, moods, hats | done | CSS keycap, reacts to cues and levels |
| Agent cues: done / needs you / error | done | Claude Code, Cursor, Codex CLI |
| Hook installer with backups and safe removal | done | appends after your own hooks, shim + socket |
| XP, level, hats, daily counter | done | +1 tap, +10 slap |
| Motion features (harder-press, slaps, knocks, lift alarm) | roadmap | needs AppleSPU/`Windows.Devices.Sensors` parity work |
| Lid creak, charger/USB sounds | roadmap | macOS-only sensors in the original |
| Clean Mode, Guard Mode, shortcut cheat sheet, Song Mode | roadmap | Accessibility/UIA work |
| Licence server | not included | Klick is MIT and free; no seats, no Keychain |

## Architecture

```
src/main/index.js     app lifecycle, tray, windows, key events, cue router, IPC
src/main/keys.js      keycode -> role + stereo column
src/main/store.js     settings/stats JSON in userData
src/main/agents.js    hook install/remove for Claude Code, Cursor, Codex (+ shim, backups)
src/main/hook.js      the shim's payload: one JSON line to a unix socket / named pipe
src/preload/index.js  contextBridge API
src/renderer/audio.*  WebAudio engine: decode packs, per-press rate/pan/gain
src/renderer/buddy.*  the keycap buddy window (transparent, always on top)
src/renderer/settings.* settings UI
scripts/gen-sounds.py all shipped audio, synthesised (no sample library)
```

Agent contract — byte-compatible in spirit with the original:

```
klick-hook claude|cursor|codex done|needs-you|error [--then cmd …]
```

Claude Code gets `hooks.Stop`, `hooks.Notification` (`permission_prompt`) and
`hooks.StopFailure`; Cursor gets `hooks.stop`; Codex gets one `notify` command with the
previous value preserved after `--then`. Every file is backed up under
`<userData>/backups` first, and Remove deletes only entries whose command is our shim.

## Sound packs

Four packs, each cut from real typing recordings you supplied:

| Pack | Character | Keys takes |
| --- | --- | --- |
| `laptop` | crisp, light laptop keys (default) | 5 |
| `hard` | heavier press, low-shelf + saturation | 5 |
| `fast` | tight, bright, rumble removed | 5 |
| `soft` | low-passed, quieter, office-safe | 5 |

Each pack also has `space`, `enter`, `delete`, `modifier`, `release` and `click`,
all 48 kHz mono 16-bit, peak -1 dBFS. The full role/spectrum table is in
[`CREDITS.md`](CREDITS.md); the extraction pipeline is
`scripts/extract-keystrokes.py` (spectral-flux onsets, merged-hit rejection,
loudness normalisation, per-pack voicing).

Re-cutting a pack from new recordings:

```sh
python3 scripts/extract-keystrokes.py --pack mypack --tone neutral --keys-takes 5 ~/Downloads/recording.wav
```

Or drop a folder of already-cut samples on the importer:

```sh
python3 scripts/import-pack.py incoming/sounds/mypack --pack mypack
```

`scripts/gen-sounds.py` can still synthesise packs from scratch if you ever need
audio with no licensing questions at all.

## Kiki — the desktop character

The character is Kiki: a lavender keycap with a charcoal glass face. It sits in the
bottom-right corner, presses along with every key, and changes expression for
agents and levels.

| State | Trigger |
| --- | --- |
| idle (`anim/idle.webp`) | resting, animated float + blink |
| press (`press.png`) | 110 ms on every keypress, with a squash |
| happy / party | positive reactions, level up, agent done |
| sweat | agent needs you |
| error | agent error |
| sleep | 90 s without typing, any key wakes it |

Both are switchable from Settings — the two toggle cards at the top of **Sound**
cover "Keyboard sounds" and "Kiki on the desktop", and the tray menu has the
same two. Art lives in `assets/buddy/`; replace it with
`python3 scripts/import-visuals.py <asset-pack>` (details in
[`assets/buddy/README.md`](assets/buddy/README.md)).

## Ship it

```sh
npm i -D electron-builder
npm run dist:mac     # dmg + zip (arm64/x64 per host)
npm run dist:win     # nsis + portable (needs a Windows host or CI)
```

`.github/workflows/build.yml` builds both on push. `uiohook-napi` is unpacked from the asar
because it ships native prebuilds for macOS arm64/x64 and Windows x64/arm64.

## Legal

Klick is an independent reimplementation. It contains no TapNoise code, no TapNoise audio,
no licence-server client, and no attempt to bypass the original's licensing. TapNoise's
recordings (some generated with ElevenLabs) are their author's property; Klick ships only
sounds synthesised by `scripts/gen-sounds.py`.

## Names considered

`Klick` was chosen for the pun (clack + chuckle) and a clean bundle id
(`app.klick.Klick`). Alternatives if you want something else: **Thumply**, **Keybop**,
**Tockbox**, **Clackwell**, **Keysparrow** — the buddy is named *Pip* internally if you want
a mascot name to hang the brand on.

## Licence

Code: **MIT** — see [LICENSE](LICENSE).

Not MIT, on purpose: Kiki's artwork is © Suren Khachatryan (all rights reserved),
and the sound packs/cues carry the Mixkit Free License and may not be redistributed
as standalone audio. Details in [ASSET-LICENSES.md](ASSET-LICENSES.md) and
[CREDITS.md](CREDITS.md).
