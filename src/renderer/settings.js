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
  const status = await window.klick.agents();
  const host = $('agents');
  host.innerHTML = '';
  for (const [id, a] of Object.entries(status)) {
    const row = document.createElement('div');
    row.className = 'agent';
    row.innerHTML = `
      <div class="meta">
        <b>${a.label}</b>
        <span>${a.events.join(' · ')} — ${a.config}</span>
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
    });
    row.appendChild(btn);
    host.appendChild(row);
  }
}

async function renderStats() {
  const s = await window.klick.stats();
  $('stTaps').textContent = s.taps || 0;
  $('stXp').textContent = s.xp || 0;
  $('stLevel').textContent = s.level || 1;
  $('stHat').textContent = s.hat || '—';
}

// --- wiring -----------------------------------------------------------------
async function boot() {
  cfg = await window.klick.getSettings();
  const packs = await window.klick.packs();
  renderPacks(packs);
  applyToControls();
  await renderAgents();
  await renderStats();
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
  $('tapKiki').addEventListener('click', () => window.klick.demoTap());
  $('cueDone').addEventListener('click', () => window.klick.demoCue('done'));
  $('cueNeeds').addEventListener('click', () => window.klick.demoCue('needs-you'));
  $('cueError').addEventListener('click', () => window.klick.demoCue('error'));
  $('revealLog').addEventListener('click', () => window.klick.revealLog());
  $('quit').addEventListener('click', () => window.klick.quit());

  window.klick.onStats((s) => {
    $('stTaps').textContent = s.taps || 0;
    $('stXp').textContent = s.xp || 0;
    $('stLevel').textContent = s.level || 1;
  });
  const banner = $('permBanner');
  const applyHook = (st) => {
    if (!st) return;
    const mac = st.platform === 'darwin';
    banner.hidden = !(mac && !st.ok && st.reason !== 'preview');
  };
  applyHook(await window.klick.hookStatus());
  window.klick.onHookStatus(applyHook);
  $('openPrivacy').addEventListener('click', () => window.klick.openPrivacy());

  window.klick.onSettings((next) => {
    cfg = next;
    applyToControls();
  });
}

boot();
