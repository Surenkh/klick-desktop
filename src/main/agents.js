'use strict';
// Agent Sounds: the same contract TapNoise uses, reimplemented.
//
//   <shim> claude|codex|cursor done|needs-you|error
//
// The shim is a one-line launcher that runs hook.js, which posts one JSON line
// to Klick's local socket. Every edit is backed up first, and removal only
// takes out entries whose command is our own shim.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const IS_WIN = process.platform === 'win32';
const SHIM = 'klick-hook' + (IS_WIN ? '.cmd' : '');

const AGENTS = {
  claude: { label: 'Claude Code', config: path.join(os.homedir(), '.claude', 'settings.json'), events: ['done', 'needs-you', 'error'] },
  cursor: { label: 'Cursor', config: path.join(os.homedir(), '.cursor', 'hooks.json'), events: ['done', 'error'] },
  codex: { label: 'Codex CLI', config: path.join(os.homedir(), '.codex', 'config.toml'), events: ['done'] }
};

function socketPath() {
  if (IS_WIN) return '\\\\.\\pipe\\klick-agents';
  return path.join(app.getPath('userData'), 'agents.sock');
}

function shimPath() {
  return path.join(app.getPath('userData'), 'bin', SHIM);
}

function hookScript() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'hook.js')
    : path.join(__dirname, 'hook.js');
}

function writeShim() {
  const shim = shimPath();
  fs.mkdirSync(path.dirname(shim), { recursive: true });
  const exec = process.execPath;
  const script = hookScript();
  const sock = socketPath();
  const body = IS_WIN
    ? `@echo off\r\nset KLICK_AGENT_SOCK=${sock}\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exec}" "${script}" %*\r\n`
    : `#!/bin/sh\n# Klick's hook for Claude Code, Codex and Cursor. Written by the copy of\n# Klick that connected it; remove it from Settings > Agents.\nKLICK_AGENT_SOCK="${sock}" ELECTRON_RUN_AS_NODE=1 exec "${exec}" "${script}" "$@"\n`;
  fs.writeFileSync(shim, body, { mode: 0o755 });
  return shim;
}

function command(agent, event) {
  const shim = shimPath();
  return IS_WIN ? `"${shim}" ${agent} ${event}` : `"${shim}" ${agent} ${event}`;
}

function backup(file) {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // a suffix keeps two edits in the same millisecond from overwriting a backup
  const uniq = Math.random().toString(36).slice(2, 7);
  const dest = path.join(dir, `${path.basename(file)}.${stamp}.${uniq}.bak`);
  fs.copyFileSync(file, dest);
  return dest;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

const ours = (entry) => typeof entry === 'string' && entry.includes('klick-hook');

function claudeEntries(agent) {
  // Claude Code: hooks.<Event> is a list of groups; each group may carry a
  // matcher and a list of {type:"command", command:"..."} hooks.
  const mk = (event) => ({ hooks: [{ type: 'command', command: command(agent, event) }] });
  const withMatcher = (event) => ({
    matcher: 'permission_prompt',
    hooks: [{ type: 'command', command: command(agent, event) }]
  });
  return {
    Stop: [mk('done')],
    Notification: [withMatcher('needs-you')],
    StopFailure: [mk('error')]
  };
}

function connectClaude() {
  const file = AGENTS.claude.config;
  const existed = fs.existsSync(file);
  const cfg = (existed && readJson(file)) || {};
  if (existed && !readJson(file)) throw new Error(`${file} is not valid JSON; left it alone`);
  if (existed) backup(file);
  if (!cfg.hooks || typeof cfg.hooks !== 'object' || Array.isArray(cfg.hooks)) cfg.hooks = {};
  const want = claudeEntries('claude');
  for (const [event, groups] of Object.entries(want)) {
    const current = Array.isArray(cfg.hooks[event]) ? cfg.hooks[event] : [];
    const cleaned = current.filter((g) => {
      const hooks = Array.isArray(g && g.hooks) ? g.hooks : [];
      return !hooks.some((h) => ours(h && h.command));
    });
    cfg.hooks[event] = cleaned.concat(groups); // appended after the user's own hooks
  }
  writeJson(file, cfg);
  return file;
}

function connectCursor() {
  const file = AGENTS.cursor.config;
  const existed = fs.existsSync(file);
  const cfg = (existed && readJson(file)) || {};
  if (existed && !readJson(file)) throw new Error(`${file} is not valid JSON; left it alone`);
  if (existed) backup(file);
  cfg.version = cfg.version || 1;
  if (!cfg.hooks || typeof cfg.hooks !== 'object' || Array.isArray(cfg.hooks)) cfg.hooks = {};
  const stops = Array.isArray(cfg.hooks.stop) ? cfg.hooks.stop : [];
  cfg.hooks.stop = stops
    .filter((e) => !ours(e && (e.command || e)))
    .concat([{ command: command('cursor', 'done') }]);
  writeJson(file, cfg);
  return file;
}

function tomlArray(items) {
  return '[' + items.map((i) => JSON.stringify(i)).join(', ') + ']';
}

function connectCodex() {
  const file = AGENTS.codex.config;
  const existed = fs.existsSync(file);
  const text = existed ? fs.readFileSync(file, 'utf8') : '';
  if (existed) backup(file);
  const notifyLine = /^[ \t]*notify[ \t]*=[ \t]*(.+)$/m;
  const match = text.match(notifyLine);
  let next;
  if (match) {
    let previous;
    try {
      previous = JSON.parse(match[1]);
    } catch {
      throw new Error(`the existing notify setting in ${file} could not be read; left it alone`);
    }
    if (!Array.isArray(previous)) throw new Error(`the existing notify setting in ${file} is not a list; left it alone`);
    // our command first, the user's previous notify command preserved after --then
    let kept = previous.slice();
    if (kept.length >= 3 && ours(kept[0]) && kept[1] === 'codex' && kept[2] === 'done') kept = kept.slice(3);
    if (kept[0] === '--then') kept = kept.slice(1);
    kept = kept.filter((part) => !ours(part));
    const next = [shimPath(), 'codex', 'done', ...(kept.length ? ['--then', ...kept] : [])];
    const replacement = `notify = ${tomlArray(next)}`;
    const updated = text.replace(notifyLine, replacement);
    fs.writeFileSync(file, updated);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const addition = `notify = ${tomlArray([shimPath(), 'codex', 'done'])}\n`;
    fs.writeFileSync(file, text.endsWith('\n') || text === '' ? text + addition : text + '\n' + addition);
  }
  return file;
}

function isEmptyDir(dir) {
  try {
    return fs.readdirSync(dir).length === 0;
  } catch {
    return true;
  }
}

function connect(agent) {
  if (!AGENTS[agent]) throw new Error(`unknown agent: ${agent}`);
  writeShim();
  let file;
  if (agent === 'claude') file = connectClaude();
  else if (agent === 'cursor') file = connectCursor();
  else file = connectCodex();
  return { agent, file, shim: shimPath() };
}

function remove(agent) {
  const spec = AGENTS[agent];
  if (!spec) throw new Error(`unknown agent: ${agent}`);
  const file = spec.config;
  if (!fs.existsSync(file)) return { agent, removed: false, reason: 'not configured' };
  if (agent === 'codex') {
    const text = fs.readFileSync(file, 'utf8');
    const match = text.match(/^[ \t]*notify[ \t]*=[ \t]*(.+)$/m);
    if (!match) return { agent, removed: false, reason: 'no notify line' };
    let previous;
    try {
      previous = JSON.parse(match[1]);
    } catch {
      return { agent, removed: false, reason: 'notify is not readable JSON; left it alone' };
    }
    let kept = previous.filter((part) => !ours(part));
    if (kept[0] === 'codex' && kept[1] === 'done') kept = kept.slice(2);
    if (kept[0] === '--then') kept = kept.slice(1);
    const thenAt = kept.indexOf('--then');
    const rest = thenAt >= 0 ? kept.slice(thenAt + 1) : kept;
    backup(file);
    fs.writeFileSync(file, text.replace(match[0], rest.length ? `notify = ${tomlArray(rest)}` : 'notify = []'));
    return { agent, removed: true, file };
  }
  const cfg = readJson(file);
  if (!cfg) return { agent, removed: false, reason: 'config is not valid JSON; left it alone' };
  backup(file);
  if (agent === 'claude') {
    for (const event of Object.keys(cfg.hooks || {})) {
      if (!Array.isArray(cfg.hooks[event])) continue;
      cfg.hooks[event] = cfg.hooks[event].filter(
        (g) => !(Array.isArray(g && g.hooks) && g.hooks.some((h) => ours(h && h.command)))
      );
      if (cfg.hooks[event].length === 0) delete cfg.hooks[event];
    }
  } else {
    const stops = Array.isArray(cfg.hooks && cfg.hooks.stop) ? cfg.hooks.stop : [];
    cfg.hooks.stop = stops.filter((e) => !ours(e && (e.command || e)));
    if (cfg.hooks.stop.length === 0) delete cfg.hooks.stop;
  }
  writeJson(file, cfg);
  return { agent, removed: true, file };
}

function status() {
  const out = {};
  for (const [id, spec] of Object.entries(AGENTS)) {
    let installed = false;
    try {
      const raw = fs.readFileSync(spec.config, 'utf8');
      installed = raw.includes('klick-hook');
    } catch {
      installed = false;
    }
    out[id] = { label: spec.label, config: spec.config, events: spec.events, installed };
  }
  return out;
}

module.exports = { connect, remove, status, socketPath, shimPath, AGENTS, IS_WIN, writeShim };
