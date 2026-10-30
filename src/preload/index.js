'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('klick', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  packs: () => ipcRenderer.invoke('packs:list'),
  samples: (pack) => ipcRenderer.invoke('audio:samples', pack),
  cueSamples: () => ipcRenderer.invoke('audio:cues'),
  reportLatency: (sample) => ipcRenderer.invoke('audio:latency', sample),
  latency: () => ipcRenderer.invoke('audio:latency:get'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  captureInfo: () => ipcRenderer.invoke('capture:info'),
  onboarded: () => ipcRenderer.invoke('app:onboarded'),
  onOnboarding: (cb) => on('onboarding:show', cb),
  onPlay: (cb) => on('audio:play', cb),
  onSettings: (cb) => on('settings:changed', cb),
  onPress: (cb) => on('buddy:press', cb),
  onMood: (cb) => on('buddy:mood', cb),
  onStats: (cb) => on('stats:update', cb),
  stats: () => ipcRenderer.invoke('stats:get'),
  hat: () => ipcRenderer.invoke('buddy:hat'),
  agents: () => ipcRenderer.invoke('agents:status'),
  connectAgent: (id) => ipcRenderer.invoke('agents:connect', id),
  removeAgent: (id) => ipcRenderer.invoke('agents:remove', id),
  openSettings: () => ipcRenderer.invoke('app:openSettings'),
  openLink: (url) => ipcRenderer.invoke('app:openLink', url),
  revealLog: () => ipcRenderer.invoke('app:revealLog'),
  demoTap: () => ipcRenderer.invoke('demo:tap'),
  demoCue: (kind) => ipcRenderer.invoke('demo:cue', kind),
  hookStatus: () => ipcRenderer.invoke('hook:status'),
  onHookStatus: (cb) => on('hook:status', cb),
  openPrivacy: () => ipcRenderer.invoke('hook:openPrivacy'),
  quit: () => ipcRenderer.invoke('app:quit')
});
