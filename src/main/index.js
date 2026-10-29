'use strict';
// Composition root: builds the pieces and wires them together. All behaviour
// lives in the modules beside it; this file only decides order and connections.

const path = require('node:path');
const { app, globalShortcut, nativeImage, ipcMain, shell, powerSaveBlocker } = require('electron');

const store = require('./store');
const { createLogger } = require('./logger');
const { createPacks, createCueFiles } = require('./packs');
const { createWindows } = require('./windows');
const { createTray } = require('./tray');
const { createAudioBus } = require('./audio-bus');
const { createCues } = require('./cues');
const { createKeyboard } = require('./keyboard');
const { createAgentServer } = require('./agent-server');
const agents = require('./agents');
const { registerIpc } = require('./ipc');

const APP_ROOT = path.join(__dirname, '..', '..');
const PRELOAD = path.join(__dirname, '..', 'preload', 'index.js');
const PACK_DIR = path.join(APP_ROOT, 'assets', 'packs');
const CUE_DIR = path.join(APP_ROOT, 'assets', 'cues');

const NO_HOOK = process.argv.includes('--no-hook') || process.env.KLICK_NO_HOOK === '1';
const IS_WIN = process.platform === 'win32';

app.setName('Klick');

let log = console.log;
let windows;
let tray;
let keyboard;
let agentServer;
let audio;
let quitting = false;

const lastDownAt = new Map();
const REPEAT_GUARD_MS = 28;
let statsTimer = null;

// ---------------------------------------------------------------- behaviour

function sendStats() {
  const stats = store.get().stats;
  windows.toSettings('stats:update', { ...stats, level: store.levelFor(stats.xp) });
}

function pushStatsSoon() {
  if (statsTimer) return;
  statsTimer = setTimeout(() => {
    statsTimer = null;
    if (windows) sendStats();
  }, 300);
}

function playKey({ role, pan = 0, gainScale = 1 }) {
  const cfg = store.get();
  audio.key({
    pack: cfg.pack,
    role,
    pan,
    rate: role === 'click' ? 1 : 0.985 + Math.random() * 0.03,
    gain: cfg.volume * gainScale
  });
}

// Runs inside the OS input path: keep it to classification, one IPC message and
// an in-memory counter. Disk and UI work is deferred.
function handleKey(press) {
  const cfg = store.get();

  if (press.type === 'up') {
    if (!cfg.enabled || !cfg.releaseSounds || press.role === 'modifier') return;
    playKey({ role: 'release', pan: press.pan, gainScale: 0.7 });
    return;
  }

  if (!cfg.enabled) return;
  if (press.role === 'click' && !cfg.mouseClicks) return;

  const id = press.usage ?? press.role;
  const now = Date.now();
  if (now - (lastDownAt.get(id) || 0) < REPEAT_GUARD_MS) return; // OS auto-repeat
  lastDownAt.set(id, now);

  playKey({ role: press.role, pan: press.pan });
  windows.toBuddy('buddy:press');

  const { levelledUp } = store.addXp(1);
  if (levelledUp) windows.toBuddy('buddy:mood', 'party');
  pushStatsSoon();
}

function applySettings(patch) {
  const next = store.merge(patch);
  if ('buddy' in patch) windows.showBuddy(!!next.buddy);
  if ('launchAtLogin' in patch) {
    try {
      app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin });
    } catch (err) {
      log(`login item change failed: ${err.message}`);
    }
  }
  if (tray) tray.refresh();
  windows.toSettings('settings:changed', next);
  return next;
}

function simulateKey() {
  if (!store.get().enabled) return false;
  playKey({ role: 'keys', pan: 0 });
  windows.toBuddy('buddy:press');
  store.addXp(1);
  pushStatsSoon();
  return true;
}

function quit() {
  if (quitting) return;
  quitting = true;
  try { keyboard && keyboard.stop(); } catch {}
  try { agentServer && agentServer.stop(); } catch {}
  try { store.flush(); } catch {}
  app.quit();
}

// ---------------------------------------------------------------- startup

if (!app.requestSingleInstanceLock()) {
  // Another copy already owns the tray icon; it will show Settings (see below).
  app.quit();
} else {
  app.on('second-instance', () => windows && windows.openSettings());

  app.whenReady().then(() => {
    store.load();
    const logger = createLogger(app.getPath('userData'));
    log = logger.info;
    log(`boot pid ${process.pid} preview=${NO_HOOK ? 'yes' : 'no'}`);

    const packs = createPacks(PACK_DIR);
    const cueFiles = createCueFiles(CUE_DIR);

    if (!packs.has(store.get().pack) && packs.list().length) {
      const fallback = packs.has('laptop') ? 'laptop' : packs.list()[0];
      log(`pack ${store.get().pack} is gone; using ${fallback}`);
      store.merge({ pack: fallback });
    }

    // a hidden window's audio graph can be suspended by the OS; this keeps it alive
    try {
      powerSaveBlocker.start('prevent-app-suspension');
      log('power save blocker on (audio stays awake)');
    } catch (err) {
      log(`power save blocker failed: ${err.message}`);
    }

    windows = createWindows({
      appRoot: APP_ROOT,
      preloadPath: PRELOAD,
      getSettings: () => store.get(),
      onBuddyMoved: (x, y) => store.merge({ buddyX: x, buddyY: y }),
      log
    });

    audio = createAudioBus(() => windows.audioWindow());

    const cues = createCues({
      audio,
      cueFiles,
      getSettings: () => store.get(),
      setMood: (mood) => windows.toBuddy('buddy:mood', mood),
      log
    });

    windows.audioWindow();   // audio first, so the first key never waits
    windows.buddyWindow();
    windows.showBuddy(!!store.get().buddy);

    tray = createTray({
      appRoot: APP_ROOT,
      platform: process.platform,
      getSettings: () => store.get(),
      applySettings,
      packs,
      onSettings: () => windows.openSettings(),
      onQuit: quit
    });

    let keyboardStatus = {
      ok: false,
      platform: process.platform,
      reason: NO_HOOK ? 'preview' : 'starting'
    };

    keyboard = createKeyboard({
      appRoot: APP_ROOT,
      resourcesPath: process.resourcesPath,
      log,
      onKey: handleKey,
      onStatus: (status) => {
        keyboardStatus = status;
        windows.toSettings('hook:status', status);
      }
    });

    if (NO_HOOK) log('preview mode: key capture off, no permission prompts');
    else keyboard.start();

    agentServer = createAgentServer({
      socketPath: agents.socketPath(),
      isWindows: IS_WIN,
      onEvent: (agent, event) => cues.play(event),
      log
    });
    agentServer.start();
    agents.writeShim();

    registerIpc({
      ipcMain,
      shell,
      store,
      packs,
      cueFiles,
      agents,
      cues,
      audio,
      windows,
      keyboardStatus: () => keyboardStatus,
      applySettings,
      simulateKey,
      quit,
      openSettings: () => windows.openSettings(),
      logFile: () => path.join(app.getPath('userData'), 'klick.log')
    });

    try {
      if (process.platform === 'darwin' && app.dock) {
        app.dock.setIcon(nativeImage.createFromPath(path.join(APP_ROOT, 'assets', 'icon.png')));
      }
      app.setAboutPanelOptions({ applicationName: 'Klick', applicationVersion: app.getVersion() });
    } catch (err) {
      log(`dock icon failed: ${err.message}`);
    }

    // panic switch: quits immediately if anything ever misbehaves
    try {
      globalShortcut.register('CommandOrControl+Alt+Shift+Q', quit);
    } catch {}

    if (process.argv.includes('--settings')) windows.openSettings();
    log('ready');
  });
}

app.on('window-all-closed', (event) => event.preventDefault());
app.on('before-quit', () => {
  try { keyboard && keyboard.stop(); } catch {}
  try { agentServer && agentServer.stop(); } catch {}
  try { store.flush(); } catch {}
});
process.on('uncaughtException', (err) => log(`uncaught: ${err.stack || err.message}`));
process.on('unhandledRejection', (err) => log(`unhandled rejection: ${err && (err.stack || err.message)}`));
