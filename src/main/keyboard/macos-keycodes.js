'use strict';
// macOS virtual keycodes (what a CGEventTap reports) -> role + stereo column.
// Same shape as hid.js, different numbering.

const ROLE = {
  36: 'enter', 76: 'enter',
  49: 'space',
  51: 'delete', 117: 'delete',
  53: 'keys', 48: 'keys'
};

for (const code of [54, 55, 56, 57, 58, 59, 60, 61, 62, 63]) ROLE[code] = 'modifier';

const COLUMNS = {};
const add = (codes, offset) => codes.forEach((c, i) => { COLUMNS[c] = offset + i; });
// q w e r t y u i o p
add([12, 13, 14, 15, 17, 16, 32, 34, 31, 35], 0.25);
// a s d f g h j k l
add([0, 1, 2, 3, 5, 4, 38, 40, 37], 0.4);
// z x c v b n m
add([6, 7, 8, 9, 11, 45, 46], 0.7);
// 1 2 3 4 5 6 7 8 9 0
add([18, 19, 20, 21, 23, 22, 26, 28, 25, 29], 0.5);

const EXTRA = { 50: 0, 27: 10, 24: 11, 33: 11.3, 30: 12.3, 42: 13, 41: 10, 39: 11.3, 43: 8.3, 47: 9.3, 44: 10.3 };

const cache = new Map();

function classifyKeycode(code) {
  if (cache.has(code)) return cache.get(code);
  const role = ROLE[code] || 'keys';
  const column = COLUMNS[code] !== undefined ? COLUMNS[code] : EXTRA[code];
  const pan = column === undefined ? 0 : Math.max(-0.65, Math.min(0.65, (column / 9 - 0.5) * 1.3));
  const result = Object.freeze({ role, pan });
  cache.set(code, result);
  return result;
}

module.exports = { classifyKeycode };
