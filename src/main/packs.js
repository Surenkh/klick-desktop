'use strict';
// Sound packs: the only place that knows how a pack is laid out on disk.

const fs = require('node:fs');
const path = require('node:path');

function createPacks(packDir) {
  const list = () => {
    try {
      return fs
        .readdirSync(packDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  };

  // role -> [base64 wav, ...]  (the audio renderer decodes and caches these)
  const read = (pack) => {
    const dir = path.join(packDir, String(pack));
    const out = {};
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((f) => f.endsWith('.wav')).sort();
    } catch {
      return out;
    }
    for (const name of names) {
      const role = name.replace(/-\d+\.wav$/, '');
      (out[role] = out[role] || []).push(fs.readFileSync(path.join(dir, name)).toString('base64'));
    }
    return out;
  };

  const has = (pack) => list().includes(pack);

  return { list, read, has, dir: packDir };
}

function createCueFiles(cueDir) {
  const file = (name) => path.join(cueDir, `${name}.wav`);
  const exists = (name) => fs.existsSync(file(name));
  const read = (name) => (exists(name) ? fs.readFileSync(file(name)).toString('base64') : null);
  return { file, exists, read, dir: cueDir };
}

module.exports = { createPacks, createCueFiles };
