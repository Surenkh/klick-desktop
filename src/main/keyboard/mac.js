'use strict';
// macOS key capture through the klick-keys helper (IOHIDManager).
//
// No event tap, no Accessibility, no input interception: the helper observes HID
// reports, and macOS asks only for Input Monitoring. If the user grants it while
// Klick is running, the helper notices by itself and starts sending keys.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RESTART_MS = 4000;

class MacKeyboard {
  constructor({ binary, onDown, onUp, onStatus, log }) {
    this.binary = binary;
    this.onDown = onDown;
    this.onUp = onUp;
    this.onStatus = onStatus;
    this.log = log || (() => {});
    this.child = null;
    this.status = { ok: false, platform: 'darwin', reason: 'starting' };
    this.stopped = false;
    this.restartTimer = null;
  }

  start() {
    if (this.stopped) return;
    if (!fs.existsSync(this.binary)) {
      this.setStatus({ ok: false, reason: 'helper-missing' });
      this.log(`key helper missing: ${this.binary}`);
      return;
    }
    let child;
    try {
      child = spawn(this.binary, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this.setStatus({ ok: false, reason: 'spawn-failed' });
      this.log(`key helper spawn failed: ${err.message}`);
      this.scheduleRestart();
      return;
    }
    this.child = child;
    this.setStatus({ ok: false, reason: 'starting' });

    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) this.handleLine(line);
      }
    });
    child.stderr.on('data', (d) => this.log(`key helper stderr: ${String(d).trim()}`));
    child.on('exit', (code) => {
      this.child = null;
      if (this.stopped) return;
      this.setStatus({ ok: false, reason: `exited-${code}` });
      this.scheduleRestart();
    });
  }

  handleLine(line) {
    if (line === 'ready') {
      this.setStatus({ ok: true, reason: null });
      return;
    }
    if (line === 'waiting') {
      this.setStatus({ ok: false, reason: 'permission' });
      return;
    }
    if (line === 'access missing') {
      this.setStatus({ ok: false, reason: 'permission' });
      return;
    }
    if (line === 'access granted') {
      this.log('input monitoring granted');
      return;
    }
    if (line.startsWith('error')) {
      this.setStatus({ ok: false, reason: line });
      this.log(`key helper: ${line}`);
      return;
    }
    if (line.startsWith('device')) return;
    const [kind, usageText] = line.split(' ');
    const usage = Number(usageText);
    if (!Number.isFinite(usage)) return;
    if (kind === 'd') this.onDown(usage);
    else if (kind === 'u') this.onUp(usage);
  }

  setStatus(next) {
    const merged = { ...next, platform: 'darwin' };
    if (JSON.stringify(merged) === JSON.stringify(this.status)) return;
    this.status = merged;
    this.onStatus(merged);
  }

  scheduleRestart() {
    if (this.stopped || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, RESTART_MS);
  }

  stop() {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.child) {
      try { this.child.kill('SIGTERM'); } catch {}
      this.child = null;
    }
  }
}

module.exports = { MacKeyboard };
