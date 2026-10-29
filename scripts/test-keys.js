#!/usr/bin/env node
'use strict';
// Unit checks for the two key-mapping tables and the cue routing.
//   node scripts/test-keys.js

const path = require('node:path');
const { classifyHID } = require(path.join(__dirname, '..', 'src', 'main', 'keyboard', 'hid.js'));
const { classify } = require(path.join(__dirname, '..', 'src', 'main', 'keyboard', 'uiohook-map.js'));

let failures = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '   <- ' + (detail ?? '')}`);
  if (!cond) failures += 1;
};

// --- macOS HID usages -------------------------------------------------------
const cas = (usage, role) => check(`HID ${usage} -> ${role}`, classifyHID(usage).role === role, classifyHID(usage).role);
cas(0x2c, 'space');
cas(0x28, 'enter');
cas(0x58, 'enter');       // keypad enter
cas(0x2a, 'delete');
cas(0x4c, 'delete');      // forward delete
cas(0xe0, 'modifier');    // left ctrl
cas(0xe7, 'modifier');    // right gui
cas(0x04, 'keys');        // a
cas(0x1d, 'keys');        // z
cas(0x29, 'keys');        // escape

check('HID left-half key pans left', classifyHID(0x14).pan < -0.15, classifyHID(0x14).pan);   // q
check('HID right-half key pans right', classifyHID(0x13).pan > 0.15, classifyHID(0x13).pan);  // p
check('HID centre key is centred', Math.abs(classifyHID(0x2c).pan) < 0.001);                  // space
check('HID pan stays inside -0.65..0.65',
  Object.values({}).length === 0 && [0x04, 0x13, 0x1d, 0x38].every((u) => Math.abs(classifyHID(u).pan) <= 0.65));
check('HID unknown usage defaults to keys', classifyHID(0x7f).role === 'keys');

// a letter row should be monotonic left to right
const q = classifyHID(0x14).pan; // q
const p = classifyHID(0x13).pan; // p
check('HID column order q < p', q < p, `${q} / ${p}`);

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
