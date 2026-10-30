'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  enabled: true,
  onboarded: false,
  pack: 'laptop',
  volume: 0.7,
  buddy: true,
  buddyX: null,
  buddyY: null,
  releaseSounds: true,
  mouseClicks: true,
  quietInCalls: true,
  launchAtLogin: false,
  agents: { claude: false, cursor: false, codex: false },
  stats: { taps: 0, slaps: 0, xp: 0, day: '' }
};

let file;
let state;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function load() {
  file = path.join(app.getPath('userData'), 'settings.json');
  try {
    state = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    state.stats = { ...DEFAULTS.stats, ...(state.stats || {}) };
    state.agents = { ...DEFAULTS.agents, ...(state.agents || {}) };
  } catch {
    state = JSON.parse(JSON.stringify(DEFAULTS));
  }
  if (state.stats.day !== today()) {
    state.stats.day = today();
    state.stats.taps = 0;
    state.stats.slaps = 0;
  }
  if (!fs.existsSync(file)) save();
  return state;
}

// Writes are debounced: the key hook runs inside an active macOS event tap, so
// anything slow in that callback stalls the whole system's input. Never touch
// the disk from the hot path.
let saveTimer = null;

function saveNow() {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[klick] could not save settings:', err.message);
  }
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 600);
}

function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveNow();
}

function get() {
  return state;
}

function merge(patch) {
  Object.assign(state, patch);
  save();
  return state;
}

// 1 XP per tap, 10 per slap; hats every two levels from 2 to 10, then 15
function addXp(amount) {
  state.stats.xp += amount;
  if (amount === 10) state.stats.slaps += 1;
  else state.stats.taps += 1;
  const level = levelFor(state.stats.xp);
  if (level !== state.stats.level) {
    state.stats.level = level;
    save();
    return { level, levelledUp: true };
  }
  save();
  return { level, levelledUp: false };
}

function levelFor(xp) {
  // gentle curve: level n needs 120 * n * (n + 1) / 2 taps of XP
  return Math.floor((-1 + Math.sqrt(1 + (8 * xp) / 120)) / 2) + 1;
}

function hatFor(level) {
  if (level >= 15) return 'crown';
  if (level >= 10) return 'chef';
  if (level >= 8) return 'beanie';
  if (level >= 6) return 'headphones';
  if (level >= 4) return 'sunglasses';
  if (level >= 2) return 'party';
  return null;
}

module.exports = { load, get, merge, save, saveNow, flush, addXp, levelFor, hatFor, DEFAULTS };
