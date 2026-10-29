#!/usr/bin/env node
'use strict';
// Exercises src/main/agents.js against fixture config files in a throwaway HOME,
// with a stubbed electron `app` so nothing in the real home is touched.
//
//   node scripts/test-agents.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'klick-agents-'));
const home = path.join(root, 'home');
const userData = path.join(root, 'userData');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(userData, { recursive: true });

process.env.HOME = home;
process.env.USERPROFILE = home;

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => userData, isPackaged: false } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const agents = require(path.join(__dirname, '..', 'src', 'main', 'agents.js'));

// Claude uses {matcher, hooks:[{command}]} groups; Cursor uses flat {command} entries
const commands = (groups) => (groups || []).flatMap((g) =>
  Array.isArray(g && g.hooks)
    ? g.hooks.map((h) => String(h.command || ''))
    : [String((g && g.command) || g || '')]);

let failures = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '   <- ' + (detail || '')}`);
  if (!cond) failures += 1;
};
const write = (p, body) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// ---------------------------------------------------------------- fixtures
const claude = path.join(home, '.claude', 'settings.json');
write(claude, JSON.stringify({
  model: 'opus',
  theme: 'dark',
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'echo user-stop' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }]
  }
}, null, 2));

const cursor = path.join(home, '.cursor', 'hooks.json');
write(cursor, JSON.stringify({
  version: 1,
  hooks: { stop: [{ command: 'echo cursor-stop' }], afterFileEdit: [{ command: 'echo edit' }] }
}, null, 2));

const codex = path.join(home, '.codex', 'config.toml');
write(codex, 'model = "gpt-5"\nnotify = ["terminal-notifier", "-message", "done"]\n\n[profiles.fast]\nmodel = "gpt-5-mini"\n');

// ---------------------------------------------------------------- claude
agents.connect('claude');
let c = readJson(claude);
const stopGroups = c.hooks.Stop || [];
check('claude: keeps the user Stop hook', stopGroups.some((g) => JSON.stringify(g).includes('echo user-stop')));
check('claude: appends our Stop hook', commands(stopGroups).some((c) => c.includes('klick-hook') && c.endsWith('claude done')));
check('claude: adds Notification with permission_prompt matcher',
  (c.hooks.Notification || []).some((g) => g.matcher === 'permission_prompt' && JSON.stringify(g).includes('needs-you')));
check('claude: adds StopFailure', (c.hooks.StopFailure || []).length === 1);
check('claude: preserves unrelated keys', c.model === 'opus' && c.theme === 'dark' && (c.hooks.PreToolUse || []).length === 1);
const st = agents.status();
check('claude: status reports installed', st.claude.installed === true);

agents.connect('claude'); // idempotent?
c = readJson(claude);
check('claude: re-connect does not duplicate', (c.hooks.Stop || []).length === 2);

agents.remove('claude');
c = readJson(claude);
check('claude: remove leaves the user hook', (c.hooks.Stop || []).length === 1 && JSON.stringify(c.hooks.Stop).includes('echo user-stop'));
check('claude: remove drops our events', !c.hooks.Notification && !c.hooks.StopFailure);
check('claude: remove keeps top-level config', c.model === 'opus' && c.theme === 'dark');

// ---------------------------------------------------------------- cursor
agents.connect('cursor');
let cu = readJson(cursor);
check('cursor: keeps user stop hook', JSON.stringify(cu.hooks.stop).includes('echo cursor-stop'));
check('cursor: adds our stop hook', commands(cu.hooks.stop).some((c) => c.includes('klick-hook') && c.endsWith('cursor done')));
check('cursor: preserves other hooks', (cu.hooks.afterFileEdit || []).length === 1);
agents.remove('cursor');
cu = readJson(cursor);
check('cursor: remove restores one stop hook', (cu.hooks.stop || []).length === 1);

// ---------------------------------------------------------------- codex
agents.connect('codex');
let cx = fs.readFileSync(codex, 'utf8');
check('codex: our notify comes first', /notify = \["[^"]*klick-hook", "codex", "done"/.test(cx), cx.split('\n')[1]);
check('codex: previous notify preserved after --then', cx.includes('"--then", "terminal-notifier", "-message", "done"'), cx.split('\n')[1]);
check('codex: rest of file untouched', cx.includes('[profiles.fast]') && cx.startsWith('model = "gpt-5"'));
agents.connect('codex');
cx = fs.readFileSync(codex, 'utf8');
check('codex: re-connect is idempotent', (cx.match(/klick-hook/g) || []).length === 1);
agents.remove('codex');
cx = fs.readFileSync(codex, 'utf8');
check('codex: remove restores the original notify',
  cx.includes('notify = ["terminal-notifier", "-message", "done"]') && !cx.includes('klick-hook'), cx.split('\n')[1]);

// ---------------------------------------------------------------- safety
const broken = path.join(home, '.claude', 'broken.json');
write(broken, '{ this is not json');
const savedConfig = agents.AGENTS.claude.config;
agents.AGENTS.claude.config = broken;
let threw = false;
try {
  agents.connect('claude');
} catch {
  threw = true;
}
check('claude: refuses to edit invalid JSON', threw && fs.readFileSync(broken, 'utf8') === '{ this is not json');
agents.AGENTS.claude.config = savedConfig;

const backups = path.join(userData, 'backups');
check('backups written before every edit', fs.existsSync(backups) && fs.readdirSync(backups).length >= 8,
  fs.existsSync(backups) ? fs.readdirSync(backups).length + ' files' : 'no dir');

const shim = agents.shimPath();
check('shim exists and is executable', fs.existsSync(shim) && (fs.statSync(shim).mode & 0o111) !== 0);
check('shim points at the local socket', fs.readFileSync(shim, 'utf8').includes(agents.socketPath()));

console.log(`\n${failures === 0 ? 'all checks passed' : failures + ' check(s) failed'}  (fixtures in ${root})`);
process.exit(failures === 0 ? 0 : 1);
