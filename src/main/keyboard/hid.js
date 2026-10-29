'use strict';
// HID keyboard usage (page 0x07) -> role + stereo column.
//
// Pure functions, no I/O: the native helper only says "usage N went down", and
// this maps that to what the audio layer needs. Unit-tested by scripts/test-keys.js.

const ROLE = {
  0x28: 'enter',      // Return
  0x58: 'enter',      // Keypad Enter
  0x2c: 'space',      // Space
  0x2a: 'delete',     // Backspace
  0x4c: 'delete',     // Forward Delete
  0x29: 'keys',       // Escape
  0x2b: 'keys'        // Tab
};

for (let u = 0xe0; u <= 0xe7; u += 1) ROLE[u] = 'modifier'; // Ctrl/Shift/Alt/GUI, L+R

// QWERTY columns, so a key on the left of the board sounds slightly left
const LETTER_ROW = { r1: 'qwertyuiop', r2: 'asdfghjkl', r3: 'zxcvbnm' };
const LETTER_COLUMN = {};
['r1', 'r2', 'r3'].forEach((row, i) => {
  const offset = [0.25, 0.4, 0.7][i];
  for (const ch of LETTER_ROW[row]) LETTER_COLUMN[ch] = offset + LETTER_ROW[row].indexOf(ch);
});

// usage 0x04..0x1d is a..z
function columnFor(usage) {
  if (usage >= 0x04 && usage <= 0x1d) {
    const ch = String.fromCharCode(0x61 + (usage - 0x04));
    return LETTER_COLUMN[ch];
  }
  if (usage >= 0x1e && usage <= 0x27) return 0.5 + (usage - 0x1e); // 1..0
  if (usage === 0x35) return 0;                                    // `
  switch (usage) {
    case 0x2d: return 10;    // -
    case 0x2e: return 11;    // =
    case 0x2f: return 11.3;  // [
    case 0x30: return 12.3;  // ]
    case 0x31: return 13;    // backslash
    case 0x33: return 10;    // ;
    case 0x34: return 11.3;  // '
    case 0x36: return 8.3;   // ,
    case 0x37: return 9.3;   // .
    case 0x38: return 10.3;  // /
    default: return undefined;
  }
}

const cache = new Map();

function classifyHID(usage) {
  if (cache.has(usage)) return cache.get(usage);
  const role = ROLE[usage] || 'keys';
  const column = columnFor(usage);
  const pan = column === undefined ? 0 : Math.max(-0.65, Math.min(0.65, (column / 9 - 0.5) * 1.3));
  const result = Object.freeze({ role, pan, column: column === undefined ? null : column });
  cache.set(usage, result);
  return result;
}

module.exports = { classifyHID, columnFor, ROLE };
