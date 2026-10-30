// bridge.js — the same `window.klick` surface the Electron build exposed,
// implemented over WKWebView's message handler. Injected at document start.
(function () {
  if (window.klick) return;

  let seq = 0;
  const pending = new Map();
  const listeners = {};

  window.__klickResolve = (id, value) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    entry.resolve(value);
  };

  window.__klickEvent = (name, payload) => {
    for (const fn of listeners[name] || []) {
      try { fn(payload); } catch (err) { console.warn('[klick] listener', name, err); }
    }
  };

  const call = (method, args) => new Promise((resolve) => {
    if (!window.webkit || !window.webkit.messageHandlers.klick) return resolve(null);
    const id = String(++seq);
    pending.set(id, { resolve });
    try {
      window.webkit.messageHandlers.klick.postMessage({ id, method, args: args || {} });
    } catch (err) {
      pending.delete(id);
      console.warn('[klick] bridge', method, err);
      resolve(null);
    }
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); resolve(null); }
    }, 4000);
  });

  const on = (name) => (cb) => {
    (listeners[name] = listeners[name] || []).push(cb);
    return () => {
      listeners[name] = (listeners[name] || []).filter((fn) => fn !== cb);
    };
  };

  window.klick = {
    getSettings: () => call('getSettings'),
    setSettings: (patch) => call('setSettings', { patch }),
    packs: () => call('packs'),
    samples: (pack) => call('samples', { pack }),
    cueSamples: () => call('cueSamples'),
    agents: () => call('agents'),
    connectAgent: () => Promise.reject(new Error('Agent hooks land in the next native build')),
    removeAgent: () => Promise.reject(new Error('Agent hooks land in the next native build')),
    stats: () => call('stats'),
    hat: () => null,
    appInfo: () => call('appInfo'),
    captureInfo: () => call('captureInfo'),
    latency: () => call('latency'),
    hookStatus: () => call('hookStatus'),
    openPrivacy: () => call('openPrivacy'),
    revealLog: () => call('revealLog'),
    onboarded: () => call('onboarded'),
    demoTap: () => call('demoTap'),
    demoCue: () => Promise.resolve(false),
    quit: () => call('quit'),
    openSettings: () => call('openSettings'),
    openLink: (url) => call('openLink', { url }),
    onSettings: on('settings'),
    onHookStatus: on('hookStatus'),
    onStats: on('stats'),
    onOnboarding: on('onboarding'),
    slap: () => call('slap'),
    buddyMove: (dx, dy) => call('buddyMove', { dx, dy }),
    buddyEnd: () => call('buddyEnd'),
    onPlay: on('play'),
    onPress: on('press'),
    onMood: on('mood')
  };
})();
