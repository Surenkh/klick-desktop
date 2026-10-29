'use strict';
// Menu-bar / tray menu, rebuilt from settings whenever they change.

const path = require('node:path');
const { Menu, Tray, nativeImage } = require('electron');

function trayImage(appRoot, platform) {
  const dir = path.join(appRoot, 'assets');
  if (platform !== 'darwin') {
    return nativeImage.createFromPath(path.join(dir, 'tray-win.png'));
  }
  // 1x + 2x representations so the status bar gets a crisp 18 pt icon
  const image = nativeImage.createEmpty();
  for (const [scale, file] of [[1, 'trayTemplate.png'], [2, 'trayTemplate@2x.png']]) {
    try {
      const fs = require('node:fs');
      image.addRepresentation({ scaleFactor: scale, buffer: fs.readFileSync(path.join(dir, file)) });
    } catch {
      // fall through to createFromPath below
    }
  }
  const result = image.isEmpty() ? nativeImage.createFromPath(path.join(dir, 'trayTemplate.png')) : image;
  result.setTemplateImage(true);
  return result;
}

function createTray({ appRoot, platform, getSettings, applySettings, packs, onSettings, onQuit }) {
  const tray = new Tray(trayImage(appRoot, platform));
  tray.setToolTip('Klick');

  const build = () => {
    const cfg = getSettings();
    const template = [
      {
        label: cfg.enabled ? 'Sounds on' : 'Sounds off',
        type: 'checkbox',
        checked: !!cfg.enabled,
        click: () => applySettings({ enabled: !getSettings().enabled })
      },
      { type: 'separator' },
      {
        label: 'Volume',
        submenu: [0.25, 0.5, 0.75, 1].map((value) => ({
          label: `${Math.round(value * 100)}%`,
          type: 'radio',
          checked: Math.abs(getSettings().volume - value) < 0.01,
          click: () => applySettings({ volume: value })
        }))
      },
      {
        label: 'Sound',
        submenu: packs.list().map((pack) => ({
          label: pack[0].toUpperCase() + pack.slice(1),
          type: 'radio',
          checked: getSettings().pack === pack,
          click: () => applySettings({ pack })
        }))
      },
      { type: 'separator' },
      {
        label: 'Show Kiki',
        type: 'checkbox',
        checked: !!cfg.buddy,
        click: () => applySettings({ buddy: !getSettings().buddy })
      },
      { label: 'Settings…', accelerator: 'CommandOrControl+,', click: onSettings },
      { type: 'separator' },
      { label: 'Quit Klick', accelerator: 'CommandOrControl+Q', click: onQuit }
    ];

    if (!cfg.enabled || !cfg.pack) {
      // keep the menu usable even if a pack is missing
      template.splice(2, 0, { label: 'No sound pack found', enabled: false });
    }
    tray.setContextMenu(Menu.buildFromTemplate(template));
  };

  tray.on('click', () => (platform === 'darwin' ? tray.popUpContextMenu() : onSettings()));
  build();

  return { refresh: build, tray };
}

module.exports = { createTray, trayImage };
