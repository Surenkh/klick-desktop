'use strict';
// Windows/uiohook keycode -> role + stereo column.
// Kept separate from the macOS HID mapping so each platform has one obvious table.

const MODIFIERS = new Set([
  'Shift', 'ShiftRight', 'Ctrl', 'CtrlRight', 'Alt', 'AltRight',
  'Meta', 'MetaRight', 'CapsLock', 'Fn'
]);

const COLUMNS = {};
const addRow = (names, offset) => names.forEach((n, i) => { COLUMNS[n] = offset + i; });
addRow(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], 0.5);
addRow(['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'], 0.25);
addRow(['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'], 0.4);
addRow(['Z', 'X', 'C', 'V', 'B', 'N', 'M'], 0.7);

function nameMap(UiohookKey) {
  const map = nameMap.cache || (nameMap.cache = new Map());
  if (!map.size) {
    for (const [name, code] of Object.entries(UiohookKey || {})) {
      if (typeof code === 'number' && !map.has(code)) map.set(code, name);
    }
  }
  return map;
}

const cache = new Map();

function classify(UiohookKey, keycode) {
  if (cache.has(keycode)) return cache.get(keycode);
  const name = nameMap(UiohookKey).get(keycode) || '';
  let role = 'keys';
  if (name === 'Space') role = 'space';
  else if (name === 'Enter' || name === 'NumpadEnter') role = 'enter';
  else if (name === 'Backspace' || name === 'Delete') role = 'delete';
  else if (MODIFIERS.has(name)) role = 'modifier';

  const column = COLUMNS[name];
  const pan = column === undefined ? 0 : Math.max(-0.65, Math.min(0.65, (column / 9 - 0.5) * 1.3));
  const result = Object.freeze({ role, pan });
  cache.set(keycode, result);
  return result;
}

module.exports = { classify };
