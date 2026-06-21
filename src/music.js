// Procedural Transformers-flavored background music, synthesized live with the
// Web Audio API (no audio assets). Three mid-tempo styles to compare:
//   0 = Heroic 80s synth (G1)   1 = Dark industrial / Cybertron   2 = Militaristic tension
// startMusicPlaylist() auto-cycles them in the order 3 -> 1 -> 2, repeating
// (~42s each); toggleMusicMute() mutes. Uses a lookahead scheduler (the classic
// "two clocks" pattern) for tight timing independent of rAF.

import { getAudioContext } from './sfx.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// pad voicings + bass roots (MIDI). Quarter-note chord per bar.
const STYLES = [
  {
    name: 'Heroic 80s (G1)',
    kind: 'heroic',
    bpm: 112,
    volume: 0.5,
    prog: [ // Em - C - G - D
      { bass: 40, pad: [52, 55, 59] },
      { bass: 36, pad: [48, 52, 55] },
      { bass: 43, pad: [55, 59, 62] },
      { bass: 38, pad: [54, 57, 62] },
    ],
    drums: {
      kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
      hat:   [1,0,1,0, 1,0,1,1, 1,0,1,0, 1,0,1,1],
    },
    bass:    [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,1,0,0],
  },
  {
    name: 'Dark industrial (Cybertron)',
    kind: 'industrial',
    bpm: 100,
    volume: 0.55,
    prog: [ // Em drone -> C (bVI) darkness
      { bass: 28, pad: [40, 47, 52] },
      { bass: 24, pad: [36, 43, 48] },
    ],
    drums: {
      kick:  [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,0,0],
      snare: [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0],
      hat:   [0,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
      clang: [1,0,0,0, 0,0,0,0, 0,0,0,1, 0,0,0,0],
    },
    bass:    [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0],
  },
  {
    name: 'Militaristic tension',
    kind: 'military',
    bpm: 108,
    volume: 0.5,
    prog: [ // E Phrygian: Em -> F (bII) menace
      { bass: 40, pad: [52, 55, 59] },
      { bass: 41, pad: [53, 57, 60] },
    ],
    drums: {
      kick:  [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0],
      snare: [0,0,1,0, 1,0,1,0, 0,0,1,0, 1,0,1,1],
      hat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      tom:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,1],
    },
    bass:    [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    stab:    [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], // short brass-ish chord stabs
  },
];

class MusicEngine {
  constructor() {
    this.ctx = getAudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0001;
    this.master.connect(this.ctx.destination);

    // 1s of white noise reused for all percussion
    const sr = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, sr, sr);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.style = null;
    this.styleIndex = -1;
    this.playing = false;
    this.muted = false;
    this.paused = false;
    this.step = 0;
    this.nextNoteTime = 0;
    this.timer = null;
    this.scheduleAhead = 0.12; // seconds scheduled in advance

    // Auto-cycling playlist: track 3, then 1, then 2 (STYLES indices), repeating.
    // Each track plays for ~trackDuration seconds, then advances on the next
    // bar downbeat for a clean musical transition.
    this.playlist = [2, 0, 1];
    this.playlistPos = 0;
    this.autoAdvance = false;
    this.trackStartTime = 0;
    this.trackDuration = 42; // seconds per track before advancing
  }

  // ---- voices --------------------------------------------------------------
  _noise() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; return s; }

  note(time, freq, dur, o = {}) {
    const ctx = this.ctx;
    const { type = 'sawtooth', cutoff = 3000, q = 1, gain = 0.2,
            a = 0.01, d = 0.08, s = 0.6, rel = 0.12, voices = 1, spread = 0,
            filterType = 'lowpass', dest } = o;
    const filt = ctx.createBiquadFilter();
    filt.type = filterType; filt.frequency.value = cutoff; filt.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    filt.connect(g).connect(dest || this.master);
    for (let i = 0; i < voices; i++) {
      const osc = ctx.createOscillator();
      osc.type = type; osc.frequency.value = freq;
      if (voices > 1) osc.detune.value = (i - (voices - 1) / 2) * spread;
      osc.connect(filt); osc.start(time); osc.stop(time + dur + rel + 0.05);
    }
    const end = time + Math.max(dur, a + d);
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + a);
    g.gain.linearRampToValueAtTime(Math.max(0.0001, gain * s), time + a + d);
    g.gain.setValueAtTime(Math.max(0.0001, gain * s), end);
    g.gain.exponentialRampToValueAtTime(0.0001, end + rel);
  }

  kick(time, gain = 0.9) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    const g = ctx.createGain(); osc.connect(g).connect(this.master);
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.32);
    osc.start(time); osc.stop(time + 0.34);
  }

  snare(time, gain = 0.45) {
    const ctx = this.ctx;
    const n = this._noise();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const g = ctx.createGain(); n.connect(hp).connect(g).connect(this.master);
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    n.start(time); n.stop(time + 0.2);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 180;
    const g2 = ctx.createGain(); o.connect(g2).connect(this.master);
    g2.gain.setValueAtTime(gain * 0.5, time);
    g2.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    o.start(time); o.stop(time + 0.14);
  }

  hat(time, gain = 0.18, decay = 0.04) {
    const n = this._noise();
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = this.ctx.createGain(); n.connect(hp).connect(g).connect(this.master);
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + decay);
    n.start(time); n.stop(time + decay + 0.02);
  }

  tom(time, freq = 110, gain = 0.5) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    const g = ctx.createGain(); osc.connect(g).connect(this.master);
    osc.frequency.setValueAtTime(freq * 1.4, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.18);
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
    osc.start(time); osc.stop(time + 0.27);
  }

  clang(time, gain = 0.3) {
    const ctx = this.ctx;
    const n = this._noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 6;
    const g = ctx.createGain(); n.connect(bp).connect(g).connect(this.master);
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
    n.start(time); n.stop(time + 0.52);
    // metallic ring: two detuned squares
    [0, 7].forEach((semi, i) => {
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.value = mtof(72 + semi) * (i ? 1.005 : 1);
      const og = ctx.createGain(); o.connect(og).connect(this.master);
      og.gain.setValueAtTime(gain * 0.18, time);
      og.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
      o.start(time); o.stop(time + 0.42);
    });
  }

  // ---- sequencing ----------------------------------------------------------
  _hit(arr, i) { return arr && arr[i]; }

  _scheduleStep(step, time) {
    const st = this.style;
    const bars = st.prog.length;
    const bar = Math.floor(step / 16) % bars;
    const i = step % 16;
    const chord = st.prog[bar];
    const secPerStep = (60 / st.bpm) / 4;

    // drums (shared across styles, pattern-driven)
    if (this._hit(st.drums.kick, i)) this.kick(time);
    if (this._hit(st.drums.snare, i)) this.snare(time);
    if (this._hit(st.drums.hat, i)) this.hat(time);
    if (this._hit(st.drums.tom, i)) this.tom(time, 100 + (i % 4) * 18);
    if (this._hit(st.drums.clang, i)) this.clang(time);

    // bass
    if (this._hit(st.bass, i)) {
      if (st.kind === 'industrial') {
        this.note(time, mtof(chord.bass), secPerStep * 2.4,
          { type: 'square', cutoff: 420, q: 8, gain: 0.32, a: 0.01, d: 0.2, s: 0.7, rel: 0.2 });
      } else if (st.kind === 'military') {
        this.note(time, mtof(chord.bass), secPerStep * 0.7,
          { type: 'sawtooth', cutoff: 900, q: 3, gain: 0.3, a: 0.005, d: 0.08, s: 0.2, rel: 0.06 });
      } else {
        this.note(time, mtof(chord.bass), secPerStep * 1.6,
          { type: 'sawtooth', cutoff: 700, q: 2, gain: 0.3, a: 0.005, d: 0.12, s: 0.4, rel: 0.1 });
      }
    }

    // pad: sustained chord on the bar downbeat
    if (i === 0) {
      const barDur = secPerStep * 16;
      chord.pad.forEach((m) => {
        this.note(time, mtof(m), barDur * 0.95, st.kind === 'industrial'
          ? { type: 'sawtooth', cutoff: 700, q: 1, gain: 0.07, a: 0.4, d: 0.5, s: 0.8, rel: 0.6, voices: 2, spread: 14 }
          : { type: 'sawtooth', cutoff: 1600, q: 1, gain: 0.06, a: 0.08, d: 0.3, s: 0.7, rel: 0.4, voices: 2, spread: 8 });
      });
    }

    // melodic layer per style
    if (st.kind === 'heroic') {
      // bright arpeggio of the chord, up an octave, every 16th
      const notes = chord.pad;
      const m = notes[step % notes.length] + 12;
      this.note(time, mtof(m), secPerStep * 0.9,
        { type: 'sawtooth', cutoff: 3600, q: 2, gain: 0.12, a: 0.005, d: 0.06, s: 0.3, rel: 0.08, voices: 2, spread: 10 });
      // anthemic lead: top chord tone held on beats 1 and 3
      if (i === 0 || i === 8) {
        this.note(time, mtof(notes[notes.length - 1] + 12), secPerStep * 6,
          { type: 'sawtooth', cutoff: 2600, q: 1.5, gain: 0.13, a: 0.03, d: 0.2, s: 0.8, rel: 0.3, voices: 3, spread: 12 });
      }
    } else if (st.kind === 'industrial') {
      // slow ominous two-note motif + sparse dissonant high tone
      if (i === 0) this.note(time, mtof(chord.pad[0] + 12), secPerStep * 7,
        { type: 'square', cutoff: 1100, q: 4, gain: 0.08, a: 0.06, d: 0.4, s: 0.6, rel: 0.5 });
      if (i === 8) this.note(time, mtof(chord.pad[0] + 13), secPerStep * 5, // b2 above for menace
        { type: 'sawtooth', cutoff: 1400, q: 3, gain: 0.05, a: 0.05, d: 0.3, s: 0.5, rel: 0.4 });
    } else if (st.kind === 'military') {
      // short brass-ish minor stabs
      if (this._hit(st.stab, i)) {
        chord.pad.forEach((m) => this.note(time, mtof(m), secPerStep * 1.2,
          { type: 'sawtooth', cutoff: 1500, q: 1.5, gain: 0.1, a: 0.01, d: 0.1, s: 0.3, rel: 0.12, voices: 2, spread: 6 }));
      }
    }
  }

  _tick = () => {
    while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAhead) {
      // at a bar downbeat, advance to the next playlist track once the current
      // one has had its time
      if (this.autoAdvance && this.step === 0 &&
          this.nextNoteTime - this.trackStartTime >= this.trackDuration) {
        this._advance();
      }
      this._scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += (60 / this.style.bpm) / 4;
      this.step = (this.step + 1) % (this.style.prog.length * 16);
    }
  };

  _advance() {
    this.playlistPos = (this.playlistPos + 1) % this.playlist.length;
    this.styleIndex = this.playlist[this.playlistPos];
    this.style = STYLES[this.styleIndex];
    this.step = 0;
    this.trackStartTime = this.nextNoteTime;
    if (!this.muted && !this.paused) this._ramp(this.style.volume);
  }

  // ---- control -------------------------------------------------------------
  startPlaylist() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.playing) return; // already running the playlist
    this.playlistPos = 0;
    this.styleIndex = this.playlist[0];
    this.style = STYLES[this.styleIndex];
    this.autoAdvance = true;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.08;
    this.trackStartTime = this.nextNoteTime;
    this.playing = true;
    this.timer = setInterval(this._tick, 25);
    if (!this.muted && !this.paused) this._ramp(this.style.volume);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.playing = false;
    this._ramp(0.0001);
  }

  toggleMute() {
    this.muted = !this.muted;
    this._ramp(this.muted || this.paused ? 0.0001 : (this.style ? this.style.volume : 0.5));
    return this.muted;
  }

  setPaused(paused) {
    this.paused = paused;
    this._ramp(this.muted || this.paused ? 0.0001 : (this.style ? this.style.volume : 0.5));
  }

  _ramp(v) {
    const g = this.master.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.exponentialRampToValueAtTime(Math.max(0.0001, v), now + 0.25);
  }
}

let engine = null;
function get() { if (!engine) engine = new MusicEngine(); return engine; }

export function startMusicPlaylist() { get().startPlaylist(); }
export function stopMusic() { get().stop(); }
export function toggleMusicMute() { return get().toggleMute(); }
export function setMusicPaused(paused) { get().setPaused(paused); }
export function musicStyleName(index) { return STYLES[index] ? STYLES[index].name : ''; }
export function currentMusicIndex() { return engine ? engine.styleIndex : -1; }
export function isMusicMuted() { return engine ? engine.muted : false; }
export const MUSIC_STYLE_COUNT = STYLES.length;
