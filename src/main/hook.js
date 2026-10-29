#!/usr/bin/env node
'use strict';
// Runs under `ELECTRON_RUN_AS_NODE=1 <Klick> hook.js <agent> <event> [--then cmd…]`.
// Posts one JSON line to Klick's local socket. Exits 0 on every failure so a
// broken Klick can never block a coding agent.

const net = require('node:net');
const { spawnSync } = require('node:child_process');

const AGENTS = new Set(['claude', 'codex', 'cursor']);
const EVENTS = new Set(['done', 'needs-you', 'error']);
const IS_WIN = process.platform === 'win32';

const argv = process.argv.slice(2);
const agent = argv[0];
const event = argv[1];
const rest = argv.slice(2);
const thenAt = rest.indexOf('--then');
const tail = thenAt >= 0 ? rest.slice(thenAt + 1) : [];

const sock =
  process.env.KLICK_AGENT_SOCK ||
  (IS_WIN ? '\\\\.\\pipe\\klick-agents' : require('node:path').join(require('node:os').homedir(), 'Library', 'Application Support', 'Klick', 'agents.sock'));

function send(payload) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    let conn;
    try {
      conn = net.connect(sock);
    } catch {
      return done();
    }
    conn.on('connect', () => conn.end(JSON.stringify(payload) + '\n', done));
    conn.on('error', done);
    setTimeout(() => {
      try { conn.destroy(); } catch {}
      done();
    }, 700);
  });
}

(async () => {
  if (AGENTS.has(agent) && EVENTS.has(event)) {
    await send({ agent, event, apps: process.env.KLICK_AGENT_APPS || undefined });
  }
  if (tail.length) {
    const child = spawnSync(tail[0], tail.slice(1), { stdio: 'inherit', shell: IS_WIN });
    process.exit(child.status || 0);
  }
  // agents pipe a JSON payload on stdin; drain it so we never block them
  if (!process.stdin.isTTY) {
    try {
      process.stdin.resume();
      process.stdin.on('data', () => {});
      setTimeout(() => process.exit(0), 150);
    } catch {
      process.exit(0);
    }
  } else {
    process.exit(0);
  }
})();
