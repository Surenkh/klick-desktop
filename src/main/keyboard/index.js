'use strict';
// One keyboard facade for both platforms.
//
//   macOS   : native helper (IOHIDManager, Input Monitoring only, no interception)
//   Windows : uiohook low-level hook (no permission needed)
//
// The rest of the app only sees { type: 'down' | 'up', role, pan }.

const fs = require('node:fs');
const path = require('node:path');
const { classifyHID } = require('./hid');
const { MacKeyboard } = require('./mac');
const { WinKeyboard } = require('./win');

function helperPath({ appRoot, resourcesPath }) {
  const packaged = path.join(resourcesPath || '', 'klick-keys');
  const dev = path.join(appRoot, 'native', 'bin', 'klick-keys');
  return fs.existsSync(packaged) ? packaged : dev;
}

function createKeyboard({ platform = process.platform, appRoot, resourcesPath, log, onKey, onStatus }) {
  let impl;

  if (platform === 'darwin') {
    impl = new MacKeyboard({
      binary: helperPath({ appRoot, resourcesPath }),
      log,
      onDown: (usage) => {
        const { role, pan } = classifyHID(usage);
        onKey({ type: 'down', role, pan, usage });
      },
      onUp: (usage) => {
        const { role, pan } = classifyHID(usage);
        onKey({ type: 'up', role, pan, usage });
      },
      onStatus
    });
    // the helper also reports mouse buttons ("b 1"); surface them as clicks
    const original = impl.handleLine.bind(impl);
    impl.handleLine = (line) => {
      if (line.startsWith('b ')) {
        onKey({ type: 'down', role: 'click', pan: 0, mouse: true });
        return;
      }
      original(line);
    };
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
