'use strict';
// The only path from main to the audio renderer.
//
// Everything is fire-and-forget IPC with tiny payloads; the renderer owns
// decoding and playback. Keeping this in one place means the key handler stays
// a few instructions long (it runs inside the OS input path).

function createAudioBus(getWindow) {
  const send = (message) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return false;
    win.webContents.send('audio:play', message);
    return true;
  };

  return {
    // one key press: pack + role + stereo + slight pitch variation
    key({ pack, role, pan = 0, rate = 1, gain = 0.7 }) {
      return send({ kind: 'key', pack, role, pan, rate, gain });
    },
    // a recorded cue (done / error), played at full length
    cue({ name, gain = 0.8 }) {
      return send({ kind: 'cue', name, gain });
    },
    // a note played from the current pack (needs-you chime)
    note({ pack, role, rate = 1, pan = 0, gain = 0.7 }) {
      return send({ kind: 'key', pack, role, pan, rate, gain });
    }
  };
}

module.exports = { createAudioBus };
