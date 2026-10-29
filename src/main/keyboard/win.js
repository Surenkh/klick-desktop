'use strict';
// Windows key capture: a low-level keyboard hook. No permission prompt exists on
// Windows for this, so it simply starts.

const { classify } = require('./uiohook-map');

class WinKeyboard {
  constructor({ onDown, onUp, onStatus, log }) {
    this.onDown = onDown;
    this.onUp = onUp;
    this.onStatus = onStatus;
    this.log = log || (() => {});
    this.hook = null;
    this.status = { ok: false, platform: 'win32', reason: 'starting' };
  }

  start() {
    try {
      const { uIOhook, UiohookKey } = require('uiohook-napi');
      uIOhook.on('keydown', (e) => {
        const { role, pan } = classify(UiohookKey, e.keycode);
        this.onDown({ role, pan, usage: e.keycode });
      });
      uIOhook.on('keyup', (e) => {
        const { role, pan } = classify(UiohookKey, e.keycode);
        this.onUp({ role, pan, usage: e.keycode });
      });
      uIOhook.on('mousedown', () => this.onDown({ role: 'click', pan: 0, usage: -1, mouse: true }));
      uIOhook.start();
      this.hook = uIOhook;
      this.setStatus({ ok: true, reason: null });
    } catch (err) {
      this.log(`windows hook unavailable: ${err.message}`);
      this.setStatus({ ok: false, reason: 'hook-failed' });
    }
  }

  setStatus(next) {
    const merged = { ...next, platform: 'win32' };
    if (JSON.stringify(merged) === JSON.stringify(this.status)) return;
    this.status = merged;
    this.onStatus(merged);
  }

  stop() {
    try { this.hook && this.hook.stop(); } catch {}
    this.hook = null;
  }
}

module.exports = { WinKeyboard };
