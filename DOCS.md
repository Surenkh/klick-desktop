# Klick — functionality and internals

**Current release: 0.4.3** — native macOS 14+ (arm64 and x86_64), 7 MB.
Key-to-ear latency is ~2–4 ms: see [ARCHITECTURE.md](ARCHITECTURE.md) for the
CGEventTap → lock-free ring → CoreAudio path.

**App:** Klick · **Character:** Kiki — your little keycap companion.
Keyboard sounds for macOS and Windows, plus a desktop character that reacts to what you do.

Klick listens to *key positions*, not text. It never receives characters, words or
passwords — only "the third key in the second row went down" — and it turns that into
sound, animation and a daily counter.

---

## 1. What you actually get

### Keyboard sounds
- Every key in every app, including the built-in keyboard and USB/Bluetooth keyboards.
- **Key roles** are separated, because a space bar does not sound like a letter key:
  `keys` (three to five takes), `space`, `enter`, `delete`, `modifier` (⇧⌃⌥⌘), `release`
  (key-up, optional) and `click` (mouse/trackpad, optional).
- **Variation**: each press picks a random take and applies ±1.5 % pitch, so fast typing
  never sounds like one sample on repeat.
- **Stereo**: keys carry their physical column — left-side keys lean left, right-side keys
  lean right (±0.65 pan). Space/Return/Delete sit centre.
- **Latency**: sound starts within a few milliseconds; buffers are decoded once at startup
  and cached per pack.

### Sound packs
Four packs, cut from real typing recordings:

| Pack | Character | Felt as |
| --- | --- | --- |
| `laptop` | crisp, light laptop keys | bright, quiet-ish, quick |
| `hard` | low-shelf + saturation | heavier, more body, punchier |
| `fast` | rumble removed, short tails | tight, bright, made for speed |
| `soft` | low-passed, quieter | muffled, office-safe |

Spec: 48 kHz, mono, 16-bit PCM, peak −1 dBFS, 24–170 ms per sample.
Each pack has 5 `keys` takes + one each of space/enter/delete/modifier/release/click.

How they are made (`scripts/extract-keystrokes.py`): spectral-flux onset detection with an
adaptive threshold → one cut per hit → cuts containing a second comparable transient are
rejected (a laptop press often has a bottom-out bump) → loudness normalisation → per-pack
voicing (shelf/EQ/saturation) → manifest.

### Kiki, the character
- Sits bottom-right, always-on-top, transparent, **draggable**; click the ⚙ (on hover) to
  open Settings.
- **States**: `idle` (animated WebP loop, gentle float), `press` (110 ms on every keypress,
  with a squash), `happy`, `party` (confetti), `sweat` (agent needs you), `error`,
  `sleep` (after 90 s without typing; any key wakes it).
- **Crossfaded** state changes (220 ms), so it never snaps between expressions.
- **Reduced motion** is honoured: no float, no pop, static frames only.
- **Levels**: 1 XP per key, 10 per slap-equivalent event; the level curve feeds
  `store.levelFor()` (hats exist in the data model but are not drawn in this build).

### Agent sounds
Klick can chime when a coding agent finishes, needs you, or fails.

- Supported: **Claude Code** (done / needs you / error), **Cursor** (done / error),
  **Codex CLI** (done only).
- Wiring: a tiny POSIX shim (`<userData>/bin/klick-hook`) is written and referenced from
  each agent's own config:
  - Claude: `hooks.Stop`, `hooks.Notification` (matcher `permission_prompt`), `hooks.StopFailure`
  - Cursor: `hooks.stop`
  - Codex: one `notify` command, with your previous notify preserved after `--then`
- Contract: `klick-hook claude|cursor|codex done|needs-you|error` → one JSON line to a local
  socket (unix socket on macOS, named pipe on Windows). Nothing leaves the machine.
- Cues are **made from the pack you selected**: three notes for done, two for needs-you,
  a falling pair for error — so they sound like part of the keyboard, not a system alert.
- Safety: every file is backed up first (`<userData>/backups`, unique name per edit), editing
  refuses invalid JSON/TOML rather than rewriting it, re-connecting is idempotent, and
  Remove deletes only entries whose command is our shim.

### Menu bar / tray
- Template silhouette icon on macOS (tinted by the system), coloured icon on Windows.
- Menu: sounds on/off, volume (25/50/75/100 %), pack switcher with preview, Show Kiki,
  Settings (⌘,), Quit (⌘Q).

### Settings window
Six sections: **Sound** (packs + the two master toggles), **Keys** (release sounds, mouse
clicks, start at login), **Kiki** (show/hide, Tap Kiki, agent cue demos), **Agents**
(per-agent Connect/Remove with status), **Today** (taps, XP, level, hat), **About**
(version, sound/licence notes, quit).

### Privacy
No account, no analytics, no network calls at all in this build — no licence server, no
update pings. Typing data never leaves the process: only counters (`taps`, `xp`) are stored,
in `settings.json`.

---

## 2. Runtime architecture

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full map. In short:

```
main/  index.js (wiring only) · windows · tray · ipc · audio-bus · cues
       agent-server · agents · packs · store · logger
       keyboard/  index (facade) · mac (spawns native helper) · win (uiohook)
                  hid (usage→role+pan) · uiohook-map (keycode→role+pan)
native/bin/klick-keys   C, universal, IOHIDManager, observe-only
renderers  audio (WebAudio) · buddy (Kiki) · settings (UI)
```

**One key press** costs: a helper stdout line → one table lookup → two tiny IPC
messages → an in-memory counter. Disk writes are debounced (600 ms), UI stats
are coalesced (300 ms), and playback runs on the WebAudio thread, so the input
path can never stall.

## 3. Files Klick writes

| Path | What |
| --- | --- |
| `<userData>/settings.json` | settings + counters (debounced, flushed on quit) |
| `<userData>/agents.sock` | local agent event socket (macOS/Linux) |
| `\\.\pipe\klick-agents` | same, on Windows |
| `<userData>/bin/klick-hook` | shim referenced by agent configs |
| `<userData>/backups/` | timestamped copies of every agent config edited |
| `<userData>/klick.log` | timestamped log, capped at 256 KB (About → Reveal log) |

`<userData>` is `~/Library/Application Support/Klick` on macOS, `%APPDATA%\Klick` on Windows.

---

## 4. Permissions

| Platform | Needed for | Notes |
| --- | --- | --- |
| macOS | **Input Monitoring only** | an in-process listen-only event tap: the OS forbids it from modifying or blocking events, so Klick cannot intercept or delay input, and it never asks for Accessibility |
| Windows | nothing | a low-level keyboard hook needs no prompt |

Klick does **not** ask for Accessibility, Screen Recording, microphone, camera,
Full Disk Access, notifications or network access. Granting Input Monitoring
takes effect without a restart: the helper notices within a second and starts
reporting keys. Settings shows a single banner with an "Open Input Monitoring"
button, and does nothing at launch that could trigger a prompt unless sounds are
actually enabled.

Preview mode (`--no-hook`, or `scripts/run-preview.sh`) starts everything except
capture, so the app can be evaluated without any permission at all.

## 5. Verified vs not

**Verified here**
- pack decode + playback through the real audio renderer (all roles logged per pack)
- Kiki's states rendered from the real window at the shipping size (headless Chrome)
- agent hooks: 24 checks over Claude/Cursor/Codex fixtures — preservation, idempotency,
  removal, invalid-file refusal, unique backups, executable shim (`scripts/test-agents.js`)
- preview mode start/stop, single-instance lock behaviour, tray icon generation
- key mapping unit tests (`scripts/test-keys.js`): HID usages → roles, stereo
  ordering, Windows keycode table, and cue routing (recorded vs pack notes)
- the capture addon builds as a universal binary and gates its tap on
  `CGPreflightListenEventAccess()`: without permission it reports `permission` and
  retries once a second, so granting it starts capture without a restart

**Not verified**
- global key capture on macOS (needs the user's Accessibility grant) and on Windows
  (no Windows host here) — the code path is the same, the permission story differs
- packaged installers (`electron-builder` is configured, CI builds both OSes, nothing has
  been signed or notarised yet)
- the sensor features of the original app are **not** implemented: no slaps/knocks, no lid
  creak, no Guard/Clean mode, no shortcut cheat sheet, no Song Mode

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| No sound on keys | Input Monitoring not granted | Settings → *Open Input Monitoring* → add Klick; it starts within a second, no restart |
| No sound, capture granted | pack missing/stale | Settings → Sound → pick a pack (stale names are auto-corrected at startup) |
| Kiki missing | toggled off | Settings → Sound → *Kiki on the desktop*, or tray → *Show Kiki* |
| App exits instantly, no window | another instance holds the single-instance lock | quit the old instance, or `pkill -f "Klick.app/Contents/MacOS/Klick"` |
| Input feels sticky | something slow in the tap callback | Klick never writes to disk there; if it persists, `⌘⌥⇧Q` quits immediately |

---

## 7. Build & package

```sh
sh scripts/test-native.sh      # 43 checks, no audio device needed
sh scripts/build-native.sh     # build + sign for this Mac
sh scripts/build-native.sh --install   # build, install to /Applications, launch
sh scripts/package-native.sh   # both DMGs into dist/
```

There is no `npm install`: the app has no runtime dependencies.

Icons: `assets/icon.icns` (macOS, generated by `scripts/make-app-icon.py`),
`assets/icon.png` (Windows), `assets/trayTemplate.png` + `@2x` (macOS menu bar),
`assets/tray-win.png` (Windows tray).
