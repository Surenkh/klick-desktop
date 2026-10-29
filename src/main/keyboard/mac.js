'use strict';
// macOS capture inside the app process, via the klick-capture N-API addon.
//
// In-process is the point: macOS grants Input Monitoring to the Klick.app bundle,
// so the tap created here uses exactly that grant. A separate helper process has
// its own identity, which is why it kept reporting "no permission" after the user
// had granted it (and why two entries appeared in System Settings).
//
// The tap is LISTEN-ONLY: it may not modify or block events.
// If permission is missing we retry once a second, so granting it starts capture
// without a restart.

const path = require('node:path');

const RETRY_MS = 1000;

class MacCapture {
  constructor({ addonPath, onDown, onUp, onStatus, log }) {
    this.addonPath = addonPath;
    this.onDown = onDown;
    this.onUp = onUp;
    this.onStatus = onStatus;
    this.log = log || (() => {});
    this.addon = null;
    this.started = false;
    this.stopped = false;
    this.timer = null;
    this.status = { ok: false, platform: 'darwin', reason: 'starting' };
  }

  load() {
    if (this.addon) return this.addon;
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      this.addon = require(this.addonPath);
      this.log(`capture addon loaded (${path.basename(this.addonPath)})`);
    } catch (err) {
      this.log(`capture addon failed to load: ${err.message}`);
      this.addon = null;
    }
    return this.addon;
  }

  start() {
    if (this.stopped) return;
    const addon = this.load();
    if (!addon) {
      this.setStatus({ ok: false, reason: 'addon-missing' });
      return;
    }

    if (!addon.preflight()) {
      this.setStatus({ ok: false, reason: 'permission' });
      try { addon.request(); } catch {}
      this.armRetry();
      return;
    }

    if (this.started) return;
    addon.start((code, down) => {
      if (down) this.onDown(code);
      else this.onUp(code);
    });
    this.started = true;
    // preflight passed, so the grant exists; the tap thread sets its own state a
    // moment later. Report success now, and let watch() correct a real failure.
    this.setStatus({ ok: true, reason: null });
    this.log('capture started (listen-only tap, in-process)');
    setTimeout(() => {
      if (this.stopped || !this.addon) return;
      const state = this.addon.status();
      if (state === 2) this.setStatus({ ok: false, reason: 'permission' });
      else if (state === 3) this.setStatus({ ok: false, reason: 'tap-failed' });
      else this.setStatus({ ok: true, reason: null });
    }, 400);
    this.watch();
  }

  watch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.stopped) return;
      const addon = this.addon;
      if (!addon) return;
      const state = addon.status();
      if (state === 2) this.setStatus({ ok: false, reason: 'permission' });
      else if (state === 3) this.setStatus({ ok: false, reason: 'tap-failed' });
      else if (state === 1) this.setStatus({ ok: true, reason: null });
      this.watch();
    }, 3000);
  }

  armRetry() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.stopped) return;
      if (this.addon && this.addon.preflight()) {
        this.log('input monitoring granted; starting capture');
        this.start();
      } else {
        this.armRetry();
      }
    }, RETRY_MS);
  }

  setStatus(next) {
    const merged = { ...next, platform: 'darwin' };
    if (JSON.stringify(merged) === JSON.stringify(this.status)) return;
    this.status = merged;
    this.log(`keyboard status: ok=${merged.ok} reason=${merged.reason || '-'}`);
    this.onStatus(merged);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.addon && this.started) {
      try { this.addon.stop(); } catch {}
    }
    this.started = false;
  }
}

module.exports = { MacCapture };
