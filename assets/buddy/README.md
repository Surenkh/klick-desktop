# Kiki — the desktop character

Kiki is installed and driven by the app. These files are the runtime assets;
replace them (keeping the names) to reskin the character.

| File | Shown when |
| --- | --- |
| `anim/idle.webp` | resting loop — animated WebP, 512², 30 fps, 3.2 s, transparent |
| `anim/happy.webp` | happy loop — same format |
| `idle.png` | static idle (fallback when animation is off / reduced motion) |
| `press.png` | ~110 ms on every keypress ("working" face) |
| `happy.png` | short positive reaction |
| `party.png` | level up / agent finished (confetti) |
| `sweat.png` | agent needs you |
| `error.png` | agent error / failure cue |
| `sleep.png` | after 90 s without typing |
| `blink.png` | static idle blink frame (only used when the loop is not) |

PNGs: 512 × 512, RGBA, transparent, consistent canvas. Import from a new pack with:

```sh
python3 scripts/import-visuals.py incoming/visuals/Klick_App_Assets
```

That script maps Kiki's names to the app's, trims transparent padding, writes
the contact sheet `_preview.png`, and rebuilds `assets/icon.png` from the idle pose.

## Behaviour (src/renderer/buddy.html)

- bottom-right corner, 196 px window, draggable, click the ⚙ to open settings
- idle: animated loop, gentle float; soft "enter" pop when it appears
- press: squash (`translateY(5px) scale(.93)`) + working face for 110 ms
- moods expire on their own: party 1.8 s, happy 1.4 s, sweat 2.6 s, error 2.0 s
- sleep after 90 s idle, any key wakes it
- static fallback (drawn keycap) if the art files are missing
- honours `prefers-reduced-motion`: no float, no pop, static PNGs

## Style constraints if you regenerate

Displayed at 172 px on light and dark windows, so keep a rim light / dark edge;
the character is lavender on a charcoal face, so it reads on both. Keep padding
of ~6 % and the same camera across states, or the state swaps will jump.
