'use strict';
// One keyboard facade for both platforms.
//
//   macOS   : native helper (IOHIDManager, Input Monitoring only, no interception)
//   Windows : uiohook low-level hook (no permission needed)
//
// The rest of the app only sees { type: 'down' | 'up', role, pan }.

const fs = require('node:fs');
const path = require('node:path');
const { classifyKeycode } = require('./macos-keycodes');
const { MacCapture } = require('./mac');
const { WinKeyboard } = require('./win');

function helperPath({ appRoot, resourcesPath }) {
  const packaged = path.join(resourcesPath || '', 'klick-keys');
  const dev = path.join(appRoot, 'native', 'bin', 'klick-keys');
  return fs.existsSync(packaged) ? packaged : dev;
}

function createKeyboard({ platform = process.platform, appRoot, resourcesPath, log, onKey, onStatus }) {
  let impl;

  if (platform === 'darwin') {
    impl = new MacCapture({
      addonPath: path.join(appRoot, 'native', 'klick-capture.node'),
      log,
      onDown: (id) => {
        if (id === -1) {                       // left mouse button
          onKey({ type: 'down', role: 'click', pan: 0, mouse: true });
          return;
        }
        const { role, pan } = classifyKeycode(id);
        onKey({ type: 'down', role, pan, usage: id });
      },
      onUp: (id) => {
        const { role, pan } = classifyKeycode(id);
        onKey({ type: 'up', role, pan, usage: id });
      },
      onStatus
    });
  } else {
    impl = new WinKeyboard({
      log,
      onDown: (press) => onKey({ type: 'down', ...press }),
      onUp: (press) => onKey({ type: 'up', ...press }),
      onStatus
    });
  }

  return {
    start: () => impl.start(),
    stop: () => impl.stop(),
    status: () => impl.status
  };
}

module.exports = { createKeyboard, helperPath };
