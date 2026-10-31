'use strict';

const PACK_INFO = {
  laptop: 'Real laptop keys, crisp and light',
  hard: 'Heavy press with more body',
  fast: 'Tight and bright, built for speed',
  soft: 'Muffled, quiet, office-safe'
};

const $ = (id) => document.getElementById(id);
let cfg = null;

// --- navigation -------------------------------------------------------------
document.querySelectorAll('#nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view').forEach((v) =>
      v.classList.toggle('active', v.id === 'view-' + btn.dataset.view)
    );
  });
});

// --- local preview (independent of the main process audio window) -----------
const ctx = new AudioContext({ latencyHint: 'interactive' });
const banks = new Map();

async function bank(pack) {
  if (banks.has(pack)) return banks.get(pack);
  const raw = await window.klick.samples(pack);
  const decoded = {};
  for (const [role, takes] of Object.entries(raw || {})) {
    decoded[role] = [];
    for (const b64 of takes) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      decoded[role].push(await ctx.decodeAudioData(bytes.buffer));
    }
  }
  banks.set(pack, decoded);
  return decoded;
}

function hit(bankObj, role, when, pan, rate, gainValue) {
  const takes = (bankObj[role] && bankObj[role].length) ? bankObj[role] : bankObj.keys;
  if (!takes || !takes.length) return;
  const src = ctx.createBufferSource();
  src.buffer = takes[Math.floor(Math.random() * takes.length)];
  src.playbackRate.value = rate;
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  const gain = ctx.createGain();
  gain.gain.value = gainValue;
  src.connect(panner).connect(gain).connect(ctx.destination);
  src.start(when);
}

// a short typing phrase: normal keys with position, then space/enter/delete,
// so a pack can be judged the way it is actually heard
async function preview(pack) {
  if (ctx.state === 'suspended') await ctx.resume();
  const b = await bank(pack);
  const vol = cfg ? cfg.volume : 0.7;
  const t0 = ctx.currentTime + 0.02;
  const seq = [
    ['keys', 0.00, -0.45], ['keys', 0.11, -0.10], ['keys', 0.20, 0.25],
    ['keys', 0.33, 0.40], ['space', 0.48, 0.00], ['keys', 0.66, -0.25],
    ['keys', 0.75, 0.05], ['enter', 0.92, 0.00], ['delete', 1.10, 0.15]
  ];
  for (const [role, dt, pan] of seq) {
    hit(b, role, t0 + dt, pan, 0.985 + Math.random() * 0.03, vol);
  }
}

// --- rendering --------------------------------------------------------------
function renderPacks(packs) {
  const host = $('packs');
  host.innerHTML = '';
  for (const pack of packs) {
    const btn = document.createElement('button');
    btn.className = 'pack' + (cfg.pack === pack ? ' active' : '');
    btn.innerHTML = `<b>${pack}</b><span>${PACK_INFO[pack] || 'Keyboard sounds'}</span>`;
    btn.addEventListener('click', async () => {
      await window.klick.setSettings({ pack });
      host.querySelectorAll('.pack').forEach((p) => p.classList.toggle('active', p === btn));
      preview(pack);
    });
    host.appendChild(btn);
  }
}

function applyToControls() {
  $('enabled').checked = !!cfg.enabled;
  $('enabledLabel').textContent = cfg.enabled ? 'Sounds on' : 'Sounds off';
  $('volume').value = Math.round(cfg.volume * 100);
  $('volumeOut').textContent = Math.round(cfg.volume * 100) + '%';
  $('releaseSounds').checked = !!cfg.releaseSounds;
  $('mouseClicks').checked = !!cfg.mouseClicks;
  $('launchAtLogin').checked = !!cfg.launchAtLogin;
  $('buddy').checked = !!cfg.buddy;
  $('quickSounds').checked = !!cfg.enabled;
  $('quickKiki').checked = !!cfg.buddy;
}

async function renderAgents() {
  if (!window.klick.agents) return;
  const status = await window.klick.agents();
  if (!status || typeof status !== 'object') return;
  const host = $('agents');
  host.innerHTML = '';
  for (const [id, a] of Object.entries(status)) {
    const row = document.createElement('div');
    row.className = 'agent';
    row.innerHTML = `
      <div class="meta">
        <b>${a.label}</b>
        <span>${(a.events || []).join(' · ')} — ${a.config}</span>
      </div>
      <span class="pill ${a.installed ? 'on' : ''}">${a.installed ? 'connected' : 'not connected'}</span>`;
    const btn = document.createElement('button');
    btn.className = 'action' + (a.installed ? ' ghost' : '');
    btn.textContent = a.installed ? 'Remove' : 'Connect';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        if (a.installed) await window.klick.removeAgent(id);
        else await window.klick.connectAgent(id);
        $('agentNote').textContent = `${a.label} updated. Restart it to pick up the change.`;
      } catch (err) {
        $('agentNote').textContent = `${a.label}: ${err.message || err}`;
      }
      await renderAgents();
  if (window.klick.debug) window.klick.debug('boot: agents done');
    });
    row.appendChild(btn);
    host.appendChild(row);
  }
}

  // ---- gamification: XP curve, progress and wardrobe ------------------------
  const HATS = [
    { level: 2,  id: 'beanie',     name: 'Mint beanie',    file: 'klicky-hat-01-mint-beanie.png' },
    { level: 4,  id: 'baseball',   name: 'Baseball cap',   file: 'klicky-hat-02-baseball-cap.png' },
    { level: 6,  id: 'explorer',   name: 'Explorer hat',   file: 'klicky-hat-03-explorer-hat.png' },
    { level: 8,  id: 'wizard',     name: 'Wizard hat',     file: 'klicky-hat-04-wizard-hat.png' },
    { level: 10, id: 'graduation', name: 'Graduation cap', file: 'klicky-hat-05-graduation-cap.png' },
    { level: 15, id: 'crown',      name: 'Golden crown',   file: 'klicky-hat-06-golden-crown.png' }
  ];
  const hatArt = (file) => `../assets/buddy/hats/${file}`;
  const HAT_BY_LEVEL = (lvl) => HATS.find((h) => h.level === lvl) || null;
  const HAT_BY_ID = (id) => HATS.find((h) => h.id === id) || null;
  // start XP of level L is 60 * L * (L - 1); mirrors klick_level_for in C
  const levelStart = (lvl) => 60 * lvl * (lvl - 1);

  let latestStats = { taps: 0, xp: 0, level: 1, hat: null, equipped: null };

  const paintStats = (stats) => {
    latestStats = { ...latestStats, ...stats };
    const { taps, xp, level } = latestStats;
    $('stTaps').textContent = taps ?? 0;
    $('stXp').textContent = xp ?? 0;
    $('stLevel').textContent = level ?? 1;

    const autoHat = HAT_BY_ID(latestStats.hat) || HAT_BY_LEVEL(level);
    const worn = HAT_BY_ID(latestStats.equipped) || autoHat;
    if ($('stHat')) {
      $('stHat').innerHTML = worn
        ? `<img class="hat-mini" src="${hatArt(worn.file)}" alt="" /><span>${worn.name}</span>`
        : '<span>No hat</span>';
      $('stHat').classList.toggle('with-hat', !!worn);
    }

    const start = levelStart(level);
    const next = levelStart(level + 1);
    const span = Math.max(1, next - start);
    const into = Math.max(0, Math.min(span, xp - start));
    $('levelBadge').textContent = `LEVEL ${level}`;
    $('xpCount').textContent = `${xp.toLocaleString('en-US')} / ${next.toLocaleString('en-US')} XP`;
    $('xpFill').style.width = `${Math.round((into / span) * 1000) / 10}%`;

    const nextHat = HATS.find((h) => h.level > level);
    const remaining = Math.max(0, next - xp);
    $('xpNext').textContent = nextHat
      ? `${remaining.toLocaleString('en-US')} XP to Level ${level + 1} — ${nextHat.name} hat`
      : 'Every hat unlocked. Enjoy the crown.';

    paintWardrobe();
  };

  const paintWardrobe = () => {
    const host = $('wardrobe');
    if (!host) return;
    const level = latestStats.level || 1;
    const wornId = (HAT_BY_ID(latestStats.equipped) || HAT_BY_ID(latestStats.hat) || HAT_BY_LEVEL(level) || {}).id;
    host.innerHTML = '';
    for (const hat of HATS) {
      const unlocked = level >= hat.level;
      const equipped = unlocked && hat.id === wornId;
      const el = document.createElement('button');
      el.className = `hat ${unlocked ? 'unlocked' : 'locked'}${equipped ? ' equipped' : ''}`;
      el.disabled = !unlocked;
      el.innerHTML =
        `<span class="art">${unlocked
            ? `<img src="${hatArt(hat.file)}" alt="" />`
            : '<span class="lock">🔒</span>'}</span>` +
        `<span class="name">${hat.name}</span>` +
        `<span class="need">${unlocked ? (equipped ? 'wearing · click to remove' : `Lv ${hat.level}`) : `🔒 Lv ${hat.level}`}</span>`;
      if (unlocked) {
        el.addEventListener('click', async () => {
          const next = equipped ? 'none' : hat.id;
          cfg = await window.klick.setSettings({ equippedHat: next });
          paintStats({ equipped: next });
        });
      }
      host.appendChild(el);
    }

    // explicit "no hat" option so anyone can take it off
    const none = document.createElement('button');
    const wearingNone = !wornId || wornId === 'none';
    none.className = `hat unlocked${wearingNone ? ' equipped' : ''}`;
    none.innerHTML =
      '<span class="art nohat">🚫</span>' +
      '<span class="name">No hat</span>' +
      `<span class="need">${wearingNone ? 'wearing nothing' : 'click to remove'}</span>`;
    none.addEventListener('click', async () => {
      cfg = await window.klick.setSettings({ equippedHat: 'none' });
      paintStats({ equipped: 'none' });
    });
    host.appendChild(none);
  };

  window.klick.onStats((s) => {
    paintStats(s);
    if (window.klick.debug && window.__lastStatsTap !== s.taps) {
      window.__lastStatsTap = s.taps;
      window.klick.debug(`stats-dom taps=${$('stTaps').textContent} xp=${$('stXp').textContent} level=${$('stLevel').textContent}`);
    }
  });

async function renderStats() {
  const stats = await window.klick.stats();
  if (stats) paintStats(stats);
}

// --- wiring -----------------------------------------------------------------
async function boot() {
  try {
  cfg = await window.klick.getSettings();
  if (window.klick.debug) window.klick.debug('boot: settings ' + JSON.stringify(cfg).slice(0, 60));
  const packs = await window.klick.packs();
  if (window.klick.debug) window.klick.debug('boot: packs ' + JSON.stringify(packs));
  renderPacks(packs);
  applyToControls();
  await renderAgents();
  if (window.klick.debug) window.klick.debug('boot: agents done');
  await renderStats();
  if (window.klick.debug) window.klick.debug('boot: stats done');
  preview(cfg.pack);

  $('enabled').addEventListener('change', async (e) => {
    cfg = await window.klick.setSettings({ enabled: e.target.checked });
    applyToControls();
  });
  $('volume').addEventListener('input', (e) => {
    $('volumeOut').textContent = e.target.value + '%';
  });
  $('volume').addEventListener('change', async (e) => {
    cfg = await window.klick.setSettings({ volume: Number(e.target.value) / 100 });
    preview(cfg.pack);
  });
  $('quickSounds').addEventListener('change', async (e) => {
    cfg = await window.klick.setSettings({ enabled: e.target.checked });
    applyToControls();
  });
  $('quickKiki').addEventListener('change', async (e) => {
    cfg = await window.klick.setSettings({ buddy: e.target.checked });
    applyToControls();
  });
  for (const key of ['releaseSounds', 'mouseClicks', 'launchAtLogin', 'buddy']) {
    $(key).addEventListener('change', async (e) => {
      cfg = await window.klick.setSettings({ [key]: e.target.checked });
    });
  }
  const bindBuddyPrefs = (toggleId, selectId) => {
    $(toggleId).addEventListener('change', async (e) => {
      cfg = await window.klick.setSettings({ showTapCounter: e.target.checked });
      applyToControls();
    });
    $(selectId).addEventListener('change', async (e) => {
      cfg = await window.klick.setSettings({ celebrateEvery: Number(e.target.value) });
      applyToControls();
    });
  };
  bindBuddyPrefs('showTapCounter', 'celebrateEvery');
  bindBuddyPrefs('soundTapCounter', 'soundCelebrateEvery');
  // ---- reset taps: two-step confirmation, auto-cancels after 6s -------------
  const resetBtn = $('resetTaps');
  const resetCancel = $('resetCancel');
  const resetHint = $('resetHint');
  let resetStep = 0;
  let resetTimer = null;

  const paintReset = () => {
    if (resetStep === 0) {
      resetBtn.textContent = 'Reset taps to 0';
      resetBtn.className = 'action danger';
      resetCancel.hidden = true;
      resetHint.hidden = true;
    } else if (resetStep === 1) {
      resetBtn.textContent = 'Are you sure? Click to confirm';
      resetBtn.className = 'action danger confirming';
      resetCancel.hidden = false;
      resetHint.hidden = false;
      resetHint.textContent = 'Your taps and Kiki\'s counter will go back to 0. XP and level stay.';
    } else {
      resetBtn.textContent = 'Final check: reset to 0?';
      resetBtn.className = 'action danger final';
      resetCancel.hidden = false;
      resetHint.hidden = false;
      resetHint.textContent = 'Click once more to reset. Auto-cancels in 6 seconds.';
    }
  };

  const armReset = () => {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { resetStep = 0; paintReset(); }, 6000);
  };

  resetBtn.addEventListener('click', async () => {
    if (resetStep < 2) {
      resetStep += 1;
      paintReset();
      armReset();
      return;
    }
    clearTimeout(resetTimer);
    resetStep = 0;
    const result = await window.klick.resetTaps();
    paintReset();
    if (result && typeof result.taps === 'number') {
      $('stTaps').textContent = result.taps;
      if (window.klick.debug) window.klick.debug(`reset taps -> ${result.taps}`);
    }
  });

  resetCancel.addEventListener('click', () => {
    clearTimeout(resetTimer);
    resetStep = 0;
    paintReset();
  });

  $('tapKiki').addEventListener('click', () => window.klick.demoTap());
  $('cueDone').addEventListener('click', () => window.klick.demoCue('done'));
  $('cueNeeds').addEventListener('click', () => window.klick.demoCue('needs-you'));
  $('cueError').addEventListener('click', () => window.klick.demoCue('error'));
  $('revealLog').addEventListener('click', () => window.klick.revealLog());
  $('quit').addEventListener('click', () => window.klick.quit());


  // ---- first run -----------------------------------------------------------
  const overlay = $('onboarding');
  // never trap the user: hide first, persist second
  const dismissOnboarding = () => {
    overlay.hidden = true;
    window.klick.onboarded().catch((err) => console.warn('[klick] onboarded failed', err));
  };
  const showOnboarding = () => { overlay.hidden = false; };
  if (new URLSearchParams(location.search).get('onboarding') === '1') showOnboarding();
  window.klick.onOnboarding(showOnboarding);
  $('onboardTest').addEventListener('click', () => window.klick.demoTap());
  $('onboardOpenPerm').addEventListener('click', () => window.klick.openPrivacy());
  $('onboardDone').addEventListener('click', dismissOnboarding);
  $('onboardSkip').addEventListener('click', dismissOnboarding);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) dismissOnboarding();
  });

  const paintPerm = (st) => {
    if (!st) return;
    const step = $('onboardPerm');
    const ok = st.ok || st.reason === 'preview';
    step.classList.toggle('ok', ok);
    $('onboardPermTitle').textContent = ok ? 'Listening for keys' : 'Turn on Input Monitoring';
    $('onboardPermText').textContent = ok
      ? 'All set. Type anything to hear it.'
      : 'macOS asks once so Klick can hear that a key went down. It never sees what you type, and it can never block a keystroke.';
    $('onboardOpenPerm').hidden = ok;
    // while permission is missing, granting is the primary action
    $('onboardDone').className = ok ? 'ob-primary' : 'ob-secondary';
    $('onboardTest').className = ok ? 'ob-secondary' : 'ob-secondary';
  };
  paintPerm(await window.klick.hookStatus());
  window.klick.onHookStatus(paintPerm);

  // ---- About + diagnostics --------------------------------------------------
  try {
    const info = await window.klick.appInfo();
    $('version').textContent = `Klick ${info.version}`;
    $('runtime').textContent = info.runtime
      || `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`;
  } catch (err) {
    console.warn('[klick] app info failed', err);
  }

  const paintCapture = async () => {
    try {
      const c = await window.klick.captureInfo();
      const listening = c.ok;
      $('diagCapture').textContent = listening
        ? 'Listening (Input Monitoring granted)'
        : c.reason === 'preview' ? 'Preview mode (capture off)'
        : c.reason === 'permission' ? 'Blocked — grant Input Monitoring'
        : `Not running (${c.reason})`;
      $('diagLastKey').textContent = c.lastKeyAt
        ? `${Math.max(0, Math.round((Date.now() - c.lastKeyAt) / 1000))} s ago`
        : 'none yet';
      $('diagKeys').textContent = `${c.keysToday} keys`;
      $('diagPacks').textContent = `${c.packs} loaded`;
    } catch (err) {
      console.warn('[klick] capture info failed', err);
    }
  };

  const paintLatency = async () => {
    try {
      const sample = await window.klick.latency();
      if (!sample) return;                       // keep the friendly hint
      const device = (sample.baseMs || 0) + (sample.outputMs || 0);
      const total = device + (sample.handlingMs || 0);
      $('latency').textContent =
        `${total.toFixed(1)} ms (device ${device.toFixed(1)} + pipeline ${(sample.handlingMs || 0).toFixed(1)})`;
    } catch (err) {
      console.warn('[klick] latency failed', err);
    }
  };

  paintCapture();
  paintLatency();
  setInterval(paintCapture, 1000);
  setInterval(paintLatency, 2000);

  const banner = $('permBanner');
  let staticBannerState = '';
  const applyHook = (st) => {
    if (!st) return;
    const mac = st.platform === 'darwin';
    banner.hidden = !(mac && !st.ok && st.reason !== 'preview');
    staticBannerState = `${st.ok}:${banner.hidden}`;
    if (window.klick.debug && window.__lastBannerState !== staticBannerState) {
      window.__lastBannerState = staticBannerState;
      window.klick.debug(`banner ok=${st.ok} hidden=${banner.hidden} display=${getComputedStyle(banner).display}`);
    }
  };
  applyHook(await window.klick.hookStatus());
  window.klick.onHookStatus(applyHook);
  $('openPrivacy').addEventListener('click', () => window.klick.openPrivacy());

  window.klick.onSettings((next) => {
    cfg = next;
    applyToControls();
  });

  if (window.klick.debug) window.klick.debug('settings booted');
  } catch (err) {
    if (window.klick.debug) window.klick.debug('boot error: ' + (err && err.message));
    console.error('[klick] boot failed', err);
  }
}

boot();
