// Minimal Web Audio one-shot SFX with sample-accurate segment playback.
// Browsers block audio until a user gesture, so we resume the context on the
// first pointer/key event. A single "current" source is tracked so a new play
// cuts off whatever was still ringing (see playSegment).

let ctx = null;
let buffer = null;
let loadPromise = null;
let current = null; // { source, gain }
let movement = null;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

// Shared so the music engine uses the same context + unlock-on-gesture handling.
export function getAudioContext() { return getCtx(); }

function unlock() {
  const c = getCtx();
  if (c.state === 'suspended') c.resume();
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
}
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

// Fetch + decode once; safe to call eagerly at startup.
export function loadSfx(url) {
  if (!loadPromise) {
    loadPromise = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((data) => getCtx().decodeAudioData(data))
      .then((buf) => { buffer = buf; return buf; })
      .catch((e) => { console.warn('sfx load failed', url, e); return null; });
  }
  return loadPromise;
}

// Play the loaded buffer from `start` to `end` seconds (end = null -> natural
// end of the clip). `fadeOut` applies a short linear ramp to silence over the
// last fadeOut seconds so a mid-clip cut doesn't click. Stops any prior play.
export function playSegment(start, end, { fadeOut = 0, volume = 1 } = {}) {
  if (!buffer) return; // not loaded yet; silently skip
  const c = getCtx();
  if (c.state === 'suspended') c.resume();

  if (current) { try { current.source.stop(); } catch (_) {} current = null; }

  const stop = end == null ? buffer.duration : Math.min(end, buffer.duration);
  const dur = Math.max(0, stop - start);
  if (dur <= 0) return;

  const src = c.createBufferSource();
  src.buffer = buffer;
  const gain = c.createGain();
  src.connect(gain).connect(c.destination);

  const now = c.currentTime;
  gain.gain.setValueAtTime(volume, now);
  if (fadeOut > 0 && dur > fadeOut) {
    gain.gain.setValueAtTime(volume, now + dur - fadeOut);
    gain.gain.linearRampToValueAtTime(0, now + dur);
  }

  src.start(now, start, dur);
  const handle = { source: src, gain };
  src.onended = () => { if (current === handle) current = null; };
  current = handle;
}

function envelope(gain, now, duration, volume) {
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
}

function addTone(c, out, now, { type = 'sawtooth', from = 220, to = 80, duration = 0.14, volume = 0.25 } = {}) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + duration);
  envelope(gain, now, duration, volume);
  osc.connect(gain).connect(out);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function addNoise(c, out, now, { duration = 0.08, volume = 0.2 } = {}) {
  const sampleCount = Math.max(1, Math.floor(c.sampleRate * duration));
  const noise = c.createBuffer(1, sampleCount, c.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < sampleCount; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
  }

  const src = c.createBufferSource();
  const filter = c.createBiquadFilter();
  const gain = c.createGain();
  src.buffer = noise;
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1200, now);
  filter.Q.setValueAtTime(0.75, now);
  envelope(gain, now, duration, volume);
  src.connect(filter).connect(gain).connect(out);
  src.start(now);
  src.stop(now + duration + 0.02);
}

function makeLoopNoise(c) {
  const sampleCount = c.sampleRate;
  const noise = c.createBuffer(1, sampleCount, c.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < sampleCount; i += 1) data[i] = Math.random() * 2 - 1;
  return noise;
}

function ensureMovementSfx() {
  if (movement) return movement;
  const c = getCtx();

  const engineOsc = c.createOscillator();
  const engineGrowl = c.createOscillator();
  const engineFilter = c.createBiquadFilter();
  const engineTremolo = c.createGain();
  const engineChug = c.createOscillator();
  const engineChugDepth = c.createGain();
  const engineGain = c.createGain();
  engineOsc.type = 'sawtooth';
  engineGrowl.type = 'sawtooth';
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 260;
  engineFilter.Q.value = 0.9;
  engineTremolo.gain.value = 0.82;
  engineChug.type = 'sine';
  engineChug.frequency.value = 8;
  engineChugDepth.gain.value = 0.24;
  engineGain.gain.value = 0;
  engineOsc.connect(engineFilter);
  engineGrowl.connect(engineFilter);
  engineFilter.connect(engineTremolo).connect(engineGain).connect(c.destination);
  engineChug.connect(engineChugDepth).connect(engineTremolo.gain);
  engineOsc.start();
  engineGrowl.start();
  engineChug.start();

  const engineNoise = c.createBufferSource();
  engineNoise.buffer = makeLoopNoise(c);
  engineNoise.loop = true;
  const engineNoiseFilter = c.createBiquadFilter();
  const engineNoiseGain = c.createGain();
  engineNoiseFilter.type = 'lowpass';
  engineNoiseFilter.frequency.value = 180;
  engineNoiseFilter.Q.value = 0.6;
  engineNoiseGain.gain.value = 0;
  engineNoise.connect(engineNoiseFilter).connect(engineNoiseGain).connect(c.destination);
  engineNoise.start();

  const boostNoise = c.createBufferSource();
  boostNoise.buffer = makeLoopNoise(c);
  boostNoise.loop = true;
  const boostFilter = c.createBiquadFilter();
  const boostGain = c.createGain();
  boostFilter.type = 'bandpass';
  boostFilter.frequency.value = 900;
  boostFilter.Q.value = 0.7;
  boostGain.gain.value = 0;
  boostNoise.connect(boostFilter).connect(boostGain).connect(c.destination);
  boostNoise.start();

  const boostWhine = c.createOscillator();
  const whineGain = c.createGain();
  boostWhine.type = 'sawtooth';
  boostWhine.frequency.value = 95;
  whineGain.gain.value = 0;
  boostWhine.connect(whineGain).connect(c.destination);
  boostWhine.start();

  movement = {
    engineOsc,
    engineGrowl,
    engineFilter,
    engineChug,
    engineGain,
    engineNoiseFilter,
    engineNoiseGain,
    boostFilter,
    boostGain,
    boostWhine,
    whineGain,
  };
  return movement;
}

export function playMovementSfx(kind = 'footstep') {
  const c = getCtx();
  if (c.state === 'suspended') return;
  const now = c.currentTime;
  const out = c.createGain();
  out.gain.value = 0.8;
  out.connect(c.destination);

  if (kind === 'footstep') {
    addTone(c, out, now, { type: 'sine', from: 58, to: 24, duration: 0.18, volume: 0.46 });
    addTone(c, out, now + 0.018, { type: 'square', from: 92, to: 36, duration: 0.11, volume: 0.16 });
    addNoise(c, out, now, { duration: 0.075, volume: 0.2 });
  }

  setTimeout(() => out.disconnect(), 280);
}

export function updateMovementSfx({ mode = 'robot', speed = 0, boosting = false, active = true } = {}) {
  const c = getCtx();
  if (c.state === 'suspended') return;
  const s = ensureMovementSfx();
  const now = c.currentTime;
  const speed01 = Math.max(0, Math.min(1, speed / 60));
  const engineOn = active && mode === 'vehicle' && speed > 0.8;
  const boostOn = engineOn && boosting;

  s.engineGain.gain.linearRampToValueAtTime(engineOn ? 0.09 + speed01 * 0.09 : 0.0001, now + 0.08);
  s.engineOsc.frequency.linearRampToValueAtTime(28 + speed01 * 38, now + 0.08);
  s.engineGrowl.frequency.linearRampToValueAtTime(14 + speed01 * 24, now + 0.08);
  s.engineFilter.frequency.linearRampToValueAtTime(160 + speed01 * 360, now + 0.08);
  s.engineChug.frequency.linearRampToValueAtTime(6 + speed01 * 11, now + 0.08);
  s.engineNoiseGain.gain.linearRampToValueAtTime(engineOn ? 0.035 + speed01 * 0.055 : 0.0001, now + 0.08);
  s.engineNoiseFilter.frequency.linearRampToValueAtTime(120 + speed01 * 260, now + 0.08);

  s.boostGain.gain.linearRampToValueAtTime(boostOn ? 0.18 + speed01 * 0.12 : 0.0001, now + 0.06);
  s.boostFilter.frequency.linearRampToValueAtTime(boostOn ? 430 + speed01 * 420 : 300, now + 0.06);
  s.whineGain.gain.linearRampToValueAtTime(boostOn ? 0.085 : 0.0001, now + 0.06);
  s.boostWhine.frequency.linearRampToValueAtTime(boostOn ? 62 + speed01 * 80 : 50, now + 0.06);
}

// Small synthesized combat cues so melee/ram feedback does not depend on new
// audio assets. These layer over music and do not interrupt transform SFX.
export function playCombatSfx(kind = 'hit') {
  const c = getCtx();
  if (c.state === 'suspended') c.resume();

  const now = c.currentTime;
  const out = c.createGain();
  out.gain.setValueAtTime(0.85, now);
  out.connect(c.destination);

  if (kind === 'whiff') {
    addTone(c, out, now, { type: 'triangle', from: 360, to: 190, duration: 0.08, volume: 0.12 });
  } else if (kind === 'upgrade') {
    addTone(c, out, now, { type: 'triangle', from: 420, to: 840, duration: 0.12, volume: 0.18 });
    addTone(c, out, now + 0.08, { type: 'sine', from: 640, to: 1280, duration: 0.16, volume: 0.16 });
    addTone(c, out, now + 0.18, { type: 'triangle', from: 980, to: 1560, duration: 0.18, volume: 0.12 });
  } else if (kind === 'enemyDeath') {
    addTone(c, out, now, { type: 'sawtooth', from: 150, to: 34, duration: 0.28, volume: 0.38 });
    addTone(c, out, now + 0.015, { type: 'square', from: 520, to: 110, duration: 0.16, volume: 0.16 });
    addTone(c, out, now + 0.045, { type: 'triangle', from: 980, to: 360, duration: 0.12, volume: 0.11 });
    addNoise(c, out, now, { duration: 0.2, volume: 0.34 });
    addNoise(c, out, now + 0.08, { duration: 0.11, volume: 0.18 });
  } else if (kind === 'smash') {
    addTone(c, out, now, { type: 'sawtooth', from: 120, to: 38, duration: 0.22, volume: 0.34 });
    addNoise(c, out, now, { duration: 0.16, volume: 0.28 });
  } else if (kind === 'ram') {
    addTone(c, out, now, { type: 'square', from: 95, to: 45, duration: 0.16, volume: 0.3 });
    addNoise(c, out, now, { duration: 0.12, volume: 0.24 });
  } else if (kind === 'damage') {
    addTone(c, out, now, { type: 'sawtooth', from: 180, to: 90, duration: 0.18, volume: 0.28 });
    addTone(c, out, now + 0.04, { type: 'square', from: 260, to: 180, duration: 0.1, volume: 0.12 });
  } else {
    addTone(c, out, now, { type: 'sawtooth', from: 260, to: 75, duration: 0.1, volume: 0.22 });
    addNoise(c, out, now, { duration: 0.075, volume: 0.18 });
  }

  setTimeout(() => out.disconnect(), 450);
}
