'use strict';
// Window lifecycle in one place: the hidden audio renderer, Kiki, and Settings.
// Nothing here decides *policy* (when to show Kiki, what a key does) - it only
// creates, positions and hides windows.

const path = require('node:path');
const { BrowserWindow, screen } = require('electron');

const BUDDY_SIZE = 118;   // 97 px character + room for the drift and confetti

function createWindows({ appRoot, preloadPath, getSettings, onBuddyMoved, log }) {
  let audio = null;
  let buddy = null;
  let settings = null;

  const audioWindow = () => {
    if (audio && !audio.isDestroyed()) return audio;
    audio = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    });
    audio.loadFile(path.join(appRoot, 'src', 'renderer', 'audio.html'));
    return audio;
  };

  const clampToScreen = (x, y) => {
    const display = screen.getDisplayNearestPoint({ x, y });
    const area = display.workArea;
    return {
      x: Math.min(Math.max(x, area.x + 8), area.x + area.width - BUDDY_SIZE - 8),
      y: Math.min(Math.max(y, area.y + 8), area.y + area.height - BUDDY_SIZE - 8)
    };
  };

  const buddyWindow = () => {
    if (buddy && !buddy.isDestroyed()) return buddy;
    const cfg = getSettings();
    const area = screen.getPrimaryDisplay().workArea;
    const wanted = {
      x: Number.isFinite(cfg.buddyX) ? cfg.buddyX : area.x + area.width - BUDDY_SIZE - 20,
      y: Number.isFinite(cfg.buddyY) ? cfg.buddyY : area.y + area.height - BUDDY_SIZE - 16
    };
    const spot = clampToScreen(wanted.x, wanted.y);

    buddy = new BrowserWindow({
      x: spot.x,
      y: spot.y,
      width: BUDDY_SIZE,
      height: BUDDY_SIZE,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      hasShadow: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
      acceptFirstMouse: true,
      type: process.platform === 'darwin' ? 'panel' : undefined,
      webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false }
    });
    buddy.setAlwaysOnTop(true, 'floating');
    buddy.loadFile(path.join(appRoot, 'src', 'renderer', 'buddy.html'));
    buddy.on('moved', () => {
      const [x, y] = buddy.getPosition();
      onBuddyMoved(x, y);
    });
    buddy.on('closed', () => { buddy = null; });
    return buddy;
  };

  const showBuddy = (visible) => {
    const win = buddyWindow();
    if (!win) return;
    if (visible) {
      const [x, y] = win.getPosition();
      const spot = clampToScreen(x, y);
      win.setPosition(spot.x, spot.y);
      win.showInactive();
    } else {
      win.hide();
    }
  };

  const openSettings = () => {
    if (settings && !settings.isDestroyed()) {
      settings.show();
      settings.focus();
      return settings;
    }
    settings = new BrowserWindow({
      width: 880,
      height: 640,
      minWidth: 760,
      minHeight: 540,
      show: false,
      title: 'Klick',
      backgroundColor: '#14151a',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      trafficLightPosition: { x: 14, y: 14 },
      webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false }
    });
    settings.loadFile(path.join(appRoot, 'src', 'renderer', 'settings.html'));
    settings.once('ready-to-show', () => settings.show());
    settings.on('closed', () => { settings = null; });
    return settings;
  };

  const send = (win, channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  return {
    audioWindow,
    buddyWindow,
    openSettings,
    showBuddy,
    toBuddy: (channel, payload) => send(buddy, channel, payload),
    toSettings: (channel, payload) => send(settings, channel, payload),
    settingsWindow: () => settings,
    buddySize: BUDDY_SIZE,
    clampToScreen,
    log
  };
}

module.exports = { createWindows, BUDDY_SIZE };
