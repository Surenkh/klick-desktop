'use strict';
// Audio engine: decodes the generated WAV packs once, then plays a take per key
// with per-press pitch variation and stereo placement.

const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
const banks = new Map(); // pack -> { role: [AudioBuffer] }
const loading = new Map(); // pack -> Promise
const cues = {};       // 'done' | 'error' -> AudioBuffer

function b64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function load(pack) {
  if (banks.has(pack)) return banks.get(pack);
  if (loading.has(pack)) return loading.get(pack);
  const promise = (async () => {
    const raw = await window.klick.samples(pack);
    const bank = {};
    for (const [role, takes] of Object.entries(raw || {})) {
      bank[role] = [];
      for (const b64 of takes) {
        try {
          bank[role].push(await ctx.decodeAudioData(b64ToArrayBuffer(b64)));
        } catch (err) {
          console.error('[klick] could not decode', pack, role, err.message);
        }
      }
    }
    banks.set(pack, bank);
    console.log('[audio] pack ready', pack, Object.keys(bank).join(','));
    return bank;
  })();
  loading.set(pack, promise);
  return promise;
}

async function ensureRunning() {
  if (ctx.state === 'running') return;
  try { await ctx.resume(); } catch (err) { console.error('[audio] resume failed', err.message); }
}

async function playCue(msg) {
  await ensureRunning();
  const buffer = cues[msg.name];
  if (!buffer) return;
  const gain = ctx.createGain();
  gain.gain.value = Math.max(0, Math.min(1, typeof msg.gain === 'number' ? msg.gain : 0.8));
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(gain).connect(ctx.destination);
  src.start();
}

async function play(msg) {
  const t0 = performance.now();
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    if (msg.kind === 'cue') return playCue(msg);
    const bank = await load(msg.pack);
    const takes = bank[msg.role] && bank[msg.role].length ? bank[msg.role] : bank.keys;
    if (!takes || !takes.length) return;
    const buffer = takes.length === 1 ? takes[0] : takes[Math.floor(Math.random() * takes.length)];
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = msg.rate || 1;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, msg.pan || 0));
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, typeof msg.gain === 'number' ? msg.gain : 0.7));
    src.connect(panner).connect(gain).connect(ctx.destination);
    src.start();
    reportLatency(performance.now() - t0);
  } catch (err) {
    console.error('[klick] play failed', err.message);
  }
}

async function loadCues() {
  try {
    const raw = await window.klick.cueSamples();
    for (const [name, b64] of Object.entries(raw || {})) {
      if (!b64) continue;
      cues[name] = await ctx.decodeAudioData(b64ToArrayBuffer(b64));
    }
    console.log('[audio] cues ready', Object.keys(cues).join(',') || 'none');
  } catch (err) {
    console.error('[audio] cue load failed', err.message);
  }
}

loadCues();
window.klick.onPlay(play);

// Keep the graph alive with silence instead of a system wake lock: audio keeps
// running, but the Mac can still sleep.
try {
  const silence = ctx.createConstantSource();
  silence.offset.value = 0;
  const mute = ctx.createGain();
  mute.gain.value = 0;
  silence.connect(mute).connect(ctx.destination);
  silence.start();
} catch (err) {
  console.error('[audio] keep-alive failed', err.message);
}

// decode every pack up front so the first press of any pack is already warm
(async () => {
  try {
    const packs = await window.klick.packs();
    for (const name of packs) await load(name);
    console.log('[audio] preloaded packs', packs.join(','));
  } catch (err) {
    console.error('[audio] preload failed', err.message);
  }
})();

let reports = 0;
function reportLatency(handlingMs) {
  if (reports++ % 20 !== 0) return;   // sample, not spam
  try {
    window.klick.reportLatency({
      baseMs: (ctx.baseLatency || 0) * 1000,
      outputMs: (ctx.outputLatency || 0) * 1000,
      handlingMs,
      state: ctx.state
    });
  } catch {}
}

// Chromium can suspend a hidden window's audio graph; keep it awake and log it
setInterval(() => {
  if (ctx.state !== 'running') {
    console.log('[audio] context', ctx.state, '- resuming');
    ctx.resume().catch(() => {});
  }
}, 2000);
ctx.onstatechange = () => console.log('[audio] context state', ctx.state);
window.klick.onSettings((cfg) => {
  if (cfg && cfg.pack) load(cfg.pack); // warm the cache for the next press
});
window.klick.getSettings().then((cfg) => cfg && cfg.pack && load(cfg.pack));
document.addEventListener('DOMContentLoaded', () => {});
