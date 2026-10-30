# Klick — plain-English description

Raw material for a landing page. Written to be true of the 0.2.0 build, not of a
roadmap.

---

## One line

**Klick makes your Mac sound like the keyboard you wish you had — and puts a small
keycap character in the corner that types along with you.**

## Two lines

A menu-bar app that plays a real keyboard sound under every key you press, in every
app, with a different sound for Space, Return, Delete and the mouse. It also watches
your coding agents, so you hear when they finish or need you — even when you have
looked away.

## Short paragraph (≈60 words)

Klick is a small macOS app that gives your typing a voice. Every key press plays a
short, real recorded keyboard sound — crisp laptop keys, a heavy thock, a quiet
office sound — with separate samples for the big keys and a little variation so fast
typing never sounds like a loop. A keycap character called Kiki sits in the corner and
presses along with you, reacting to what you do.

## The problem it solves

Two small, daily annoyances:

1. **Typing is where most of the day goes, and it feels like nothing.** People spend
   hundreds of dollars chasing keyboard feel — switches, keycaps, lubing — because
   the sound and touch of a good keyboard makes work pleasant. Laptop keyboards have
   none of that. Klick gives the sound back without buying anything.
2. **When you work with AI agents, you stop watching the screen — and then you miss
   the moment they finish.** You alt-tab away, start something else, and come back to
   find the agent has been waiting for you. Klick plays a cue when an agent is done,
   needs permission, or fails.

## What it actually does

**Keyboard sounds**
- Plays a short keyboard sound on every key press, in every app — the built-in
  keyboard or anything plugged in.
- Different samples for normal keys, Space, Return and Delete, so big keys sound big.
- Several recordings per key, plus a tiny random pitch change on every press, so fast
  typing doesn't turn into a machine gun.
- Keys carry their position into stereo: left-hand keys lean slightly left, right-hand
  keys lean right.
- Optional softer sound when a key comes back up, and an optional click for the mouse
  or trackpad.
- Four sound packs, each cut key by key from real keyboard recordings:
  **Laptop** (crisp and light), **Heavy** (more body), **Fast** (tight and bright),
  **Quiet** (muffled, office-safe).

**Kiki, the character**
- A small lavender keycap with a screen for a face, sitting in the bottom-right corner.
- It presses along with every key, drifts slowly as if weightless, and changes
  expression: happy, sleeping, sweating, celebrating, annoyed, or an error face.
- It sleeps after a minute and a half without typing, and wakes on the next key.
- You can drag it anywhere; a small gear opens settings.

**Agent cues**
- Works with Claude Code, Cursor and the Codex CLI.
- Plays a rising chime when an agent finishes, a different cue when it needs you, and a
  falling cue when it errors.
- Connects by writing one entry into each agent's own config — after backing it up —
  and removes exactly its own entry again. It never reads your prompts or your code;
  it only hears "done", "needs you" or "error".

**Controls**
- Menu-bar icon: sounds on/off, volume, sound pack, show/hide Kiki, settings, quit.
- Settings window: pack audition (a short typing phrase per pack), key options, Kiki
  options, per-agent connect/remove, a daily counter, and About.

## Why it is built this way

- **It reads key positions, never text.** Klick is told "the third key in the second
  row went down", never "a" — no characters, words or passwords.
- **Input Monitoring is the only permission.** The key reader is a listen-only tap:
  macOS does not let it modify or block a keystroke, so Klick cannot delay, swallow or
  remap anything you type. It does not ask for Accessibility, Screen Recording, the
  microphone, the camera, Full Disk Access or notifications.
- **No network code at all.** No account, no telemetry, no update pings, no licence
  server. Everything stays in one settings file on the Mac.
- **Sounds are real recordings, and they are local.** Nothing is streamed.
- **Open source.** The code is MIT; the sound packs and Kiki artwork are the project's
  own assets with their own terms.

## Who it is for

- People who like how a good keyboard sounds and miss it on a laptop.
- Developers who run AI agents in another window and want to hear the moment they
  finish.
- Anyone who works in calls or open offices and wants a sound that can be made quiet
  rather than a beep that cannot.

## What it deliberately is not

- Not a keyboard remapper, macro tool or hotkey manager.
- Not typing analytics: it counts taps for a personal counter, nothing more, and never
  stores what you type.
- Not a cloud product: no sync, no account, no subscription.
- Not a full mechanical-keyboard simulation — there are four crafted packs, not a
  library of hundreds.

## Honest current state (worth knowing before writing claims)

- **macOS only for now.** Windows is planned, not shipped.
- **Unsigned and not notarised**, so the first launch needs one "Open Anyway" click in
  System Settings; with an Apple Developer ID that step disappears.
- **Every new build resets the Input Monitoring grant** while the app is unsigned.
- **Not implemented yet:** pressure-sensitive volume, slaps, knocks, lid creak, Guard
  Mode, Clean Mode, the shortcut cheat sheet, and Song Mode.
- The character has levels and a daily counter; hats exist in the data but are not
  drawn in the current build.

## Copy blocks

**Headline options**
- Every key, a little joy.
- Give your Mac a keyboard it deserved.
- The sound of a good keyboard, on the keyboard you actually have.
- Type. Hear. Smile.

**Sub-headline options**
- Real keyboard sounds under every key, with a small keycap friend who types along.
- Laptop keys that sound like a keyboard worth owning.
- Hear your agents finish while you look somewhere else.

**Call to action**
- Download for Mac (Apple silicon · Intel) — one file, no account.
- Free and open source. One permission. No network.

## Tone notes

Warm, plain, specific. Avoid "AI-powered", "revolutionary", "seamless". Prefer concrete
phrases ("Space sounds like Space", "no account, no network") over adjectives. The
privacy story is a feature, not small print.
