'use strict';
// Agent cues.
//
//   done      recorded chime (assets/cues/done.wav)
//   error     recorded cue  (assets/cues/error.wav)
//   needs-you two notes from the current keyboard pack, so it still sounds like
//             the keyboard rather than another system alert

const MOODS = { done: 'party', error: 'error', 'needs-you': 'sweat' };
const FALLBACK_NOTES = { done: [0, 7, 12], 'needs-you': [0, 5], error: [0, -5] };

// `schedule` is injectable so the note sequence can be tested synchronously
function createCues({ audio, cueFiles, getSettings, setMood, log, schedule = (fn, ms) => setTimeout(fn, ms) }) {
  const playNotes = (semitones, gap, gain) => {
    const cfg = getSettings();
    semitones.forEach((semi, index) => {
      schedule(() => {
        audio.note({
          pack: cfg.pack,
          role: 'keys',
          rate: Math.pow(2, semi / 12),
          gain: cfg.volume * gain
        });
      }, index * gap);
    });
  };

  const play = (kind) => {
    if (!MOODS[kind]) return false;
    const cfg = getSettings();
    if (!cfg.enabled) return false;

    const recorded = cueFiles.exists(kind) ? kind : null;
    if (recorded) {
      audio.cue({ name: recorded, gain: cfg.volume });
    } else {
      const notes = FALLBACK_NOTES[kind];
      playNotes(notes, kind === 'done' ? 90 : 120, 0.9);
    }

    setMood(MOODS[kind]);
    log(`cue ${kind}${recorded ? ' (recorded)' : ' (notes)'}`);
    return true;
  };

  return { play, MOODS };
}

module.exports = { createCues };
