'use strict';
// Small structured logger: everything goes to the console (dev) and to a
// size-capped file, so a user can send one file when something goes wrong.

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 256 * 1024;

function createLogger(userDataDir) {
  let file = null;
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    file = path.join(userDataDir, 'klick.log');
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, file + '.1');
    }
  } catch {
    file = null;
  }

  const write = (level, message) => {
    const line = `${new Date().toISOString()} ${level} ${message}`;
    if (level === 'error') console.error(line);
    else console.log(line);
    if (!file) return;
    try {
      fs.appendFileSync(file, line + '\n');
    } catch {
      // logging must never take the app down
    }
  };

  return {
    info: (m) => write('info ', m),
    warn: (m) => write('warn ', m),
    error: (m) => write('error', m),
    file
  };
}

module.exports = { createLogger };
