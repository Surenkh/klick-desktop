'use strict';
// Local socket that the agent shim talks to: one JSON line per event.
// Unix domain socket on macOS, named pipe on Windows. Nothing leaves the machine.

const fs = require('node:fs');
const net = require('node:net');

function createAgentServer({ socketPath, isWindows, onEvent, log }) {
  let server = null;

  const start = () => {
    if (server) return server;
    if (!isWindows) {
      try {
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
      } catch {
        // a stale socket is not fatal; listen() will report a real problem
      }
    }

    server = net.createServer((conn) => {
      let buffer = '';
      conn.setEncoding('utf8');
      conn.on('data', (chunk) => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const message = JSON.parse(line);
            if (message && message.agent && message.event) onEvent(message.agent, message.event);
          } catch {
            log('agent event rejected: not JSON');
          }
        }
      });
      conn.on('error', () => {});
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') log('another Klick is already listening for agents');
      else log(`agent socket error: ${err.message}`);
    });

    server.listen(socketPath);
    if (!isWindows) {
      try { fs.chmodSync(socketPath, 0o600); } catch {}
    }
    log(`agent socket listening (${socketPath})`);
    return server;
  };

  const stop = () => {
    if (server) {
      try { server.close(); } catch {}
      server = null;
    }
    if (!isWindows) {
      try {
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
      } catch {}
    }
  };

  return { start, stop };
}

module.exports = { createAgentServer };
