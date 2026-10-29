'use strict';
// Every renderer -> main call in one table, so the API surface is auditable.

function registerIpc(ctx) {
  const { ipcMain, shell } = require('electron');
  const {
    store, packs, cueFiles, agents, cues, audio, windows,
    keyboardStatus, applySettings, simulateKey, quit, openSettings
  } = ctx;

  ipcMain.handle('settings:get', () => store.get());
  ipcMain.handle('settings:set', (_event, patch) => applySettings(patch || {}));

  ipcMain.handle('packs:list', () => packs.list());
  ipcMain.handle('audio:samples', (_event, pack) => packs.read(pack));
  ipcMain.handle('audio:cues', () => ({
    done: cueFiles.read('done'),
    error: cueFiles.read('error')
  }));

  ipcMain.handle('agents:status', () => agents.status());
  ipcMain.handle('agents:connect', (_event, id) => {
    const result = agents.connect(id);
    store.merge({ agents: { ...store.get().agents, [id]: true } });
    windows.toSettings('settings:changed', store.get());
    return result;
  });
  ipcMain.handle('agents:remove', (_event, id) => {
    const result = agents.remove(id);
    store.merge({ agents: { ...store.get().agents, [id]: false } });
    windows.toSettings('settings:changed', store.get());
    return result;
  });

  ipcMain.handle('stats:get', () => {
    const stats = store.get().stats;
    const level = store.levelFor(stats.xp);
    return { ...stats, level, hat: store.hatFor(level) };
  });

  ipcMain.handle('hook:status', () => keyboardStatus());
  ipcMain.handle('hook:openPrivacy', () => {
    if (process.platform !== 'darwin') return false;
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent');
    return true;
  });

  ipcMain.handle('demo:tap', () => simulateKey());
  ipcMain.handle('demo:cue', (_event, kind) => cues.play(kind));

  ipcMain.handle('app:openSettings', () => { openSettings(); return true; });
  ipcMain.handle('app:quit', () => { quit(); return true; });
  ipcMain.handle('app:openLink', (_event, url) => shell.openExternal(String(url)));
  ipcMain.handle('app:revealLog', () => {
    shell.showItemInFolder(ctx.logFile());
    return true;
  });
}

module.exports = { registerIpc };
