#!/usr/bin/env node
'use strict';
// Unit checks for the two key-mapping tables and the cue routing.
//   node scripts/test-keys.js

const path = require('node:path');
const { classifyKeycode } = require(path.join(__dirname, '..', 'src', 'main', 'keyboard', 'macos-keycodes.js'));
const { classify } = require(path.join(__dirname, '..', 'src', 'main', 'keyboard', 'uiohook-map.js'));

let failures = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '   <- ' + (detail ?? '')}`);
  if (!cond) failures += 1;
};

// --- macOS virtual keycodes (what the listen-only tap reports) ---------------
const cas = (code, role) => check(`keycode ${code} -> ${role}`, classifyKeycode(code).role === role, classifyKeycode(code).role);
cas(49, 'space');
cas(36, 'enter');
cas(76, 'enter');        // keypad enter
cas(51, 'delete');
cas(117, 'delete');      // forward delete
cas(55, 'modifier');     // left command
cas(62, 'modifier');     // right control
cas(0, 'keys');          // a
cas(6, 'keys');          // z
cas(53, 'keys');         // escape

check('left-side key pans left', classifyKeycode(12).pan < -0.15, classifyKeycode(12).pan);   // q
check('right-side key pans right', classifyKeycode(35).pan > 0.15, classifyKeycode(35).pan);  // p
check('space is centred', Math.abs(classifyKeycode(49).pan) < 0.001);
check('pan stays inside -0.65..0.65',
  [0, 35, 50, 44].every((c) => Math.abs(classifyKeycode(c).pan) <= 0.65));
check('unknown keycode defaults to keys', classifyKeycode(999).role === 'keys');
check('column order q < p', classifyKeycode(12).pan < classifyKeycode(35).pan);

// --- Windows keycodes -------------------------------------------------------
const UiohookKey = { Space: 57, Enter: 3612, Backspace: 14, Delete: 3667, Shift: 42, A: 30, Z: 44, P: 25 };
cas2(57, 'space');
cas2(3612, 'enter');
cas2(14, 'delete');
cas2(42, 'modifier');
cas2(30, 'keys');
function cas2(code, role) {
  const got = classify(UiohookKey, code).role;
  check(`uiohook ${code} -> ${role}`, got === role, got);
}
check('uiohook A pans left of P',
  classify(UiohookKey, 30).pan < classify(UiohookKey, 25).pan,
  `${classify(UiohookKey, 30).pan} / ${classify(UiohookKey, 25).pan}`);

// --- cue routing ------------------------------------------------------------
const cues = require(path.join(__dirname, '..', 'src', 'main', 'cues.js'));
const sent = [];
const played = cues.createCues({
  audio: { cue: (m) => sent.push(['cue', m.name]), note: (m) => sent.push(['note', m.role, m.pack]) },
  cueFiles: { exists: (n) => n === 'done' || n === 'error' },
  getSettings: () => ({ enabled: true, pack: 'laptop', volume: 0.5 }),
  setMood: () => {},
  log: () => {},
  schedule: (fn) => fn()
});
played.play('done');
check('done uses the recorded cue', sent[0] && sent[0][0] === 'cue' && sent[0][1] === 'done', JSON.stringify(sent[0]));
sent.length = 0;
played.play('error');
check('error uses the recorded cue', sent[0] && sent[0][0] === 'cue' && sent[0][1] === 'error', JSON.stringify(sent[0]));
sent.length = 0;
played.play('needs-you');
check('needs-you plays pack notes', sent.length >= 2 && sent[0][0] === 'note' && sent[0][2] === 'laptop', JSON.stringify(sent));
check('unknown cue is ignored', played.play('bogus') === false);

console.log(`\n${failures === 0 ? 'all checks passed' : failures + ' check(s) failed'}`);
process.exit(failures === 0 ? 0 : 1);
