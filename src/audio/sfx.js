// Retro sound effects synthesised with WebAudio (no files, no licences).
//
//   sfx.play(name, { vol, pan, rate, delay })   vol 0..1 (distance), pan -1..1, rate = pitch multiplier, delay in s
//   sfx.ensure()      create/resume the AudioContext (needs a user gesture first)
//   sfx.setVolume(v)  master sound-effect volume 0..1
//
// Every sound is a short stack of "layers" (a tone or filtered noise with a pitch sweep and an envelope).
// Each sound has a rate limit (gap), a max number of copies playing at once (max) and a priority; a global
// voice cap drops low-priority sounds first, so 300 enemies never turn into noise. Pitch varies a little
// on every play so repeats don't sound like a machine gun.
//
// sfx.bus is the mix point (-> compressor -> speakers). music.js plays into the same bus.

const VOICE_CAP = 26;

/** Layer: w = sine|tri|saw|sq|sq25|sq12|noise|brown, f0->f1 Hz sweep, dur s, vol 0..1, at = start offset s.
 *  Optional: att (attack s), hold (fraction of dur at full level), lp (low-pass Hz), vib [Hz, depth],
 *  fm [Hz, depthHz] (wobble a noise filter), trem [Hz, depth], ft (noise filter type), q (filter Q). */
const L = (w, f0, f1, dur, vol, o) => ({ w, f0, f1, dur, vol, ...o });
const arp = (w, notes, step, dur, vol, o) => notes.map((f, i) => L(w, f, f, dur, vol, { at: i * step, ...o }));

const PRESETS = {
  // ---- hits and deaths ----
  hit:       { gap: 0.03, max: 5, pri: 1, vol: 0.6, pv: 0.16, layers: [L('noise', 1800, 600, 0.05, 0.6, { q: 1.2 }), L('tri', 320, 110, 0.06, 0.7)] },
  crit:      { gap: 0.05, max: 3, pri: 2, vol: 0.55, pv: 0.05, layers: [L('sq25', 1100, 2200, 0.07, 0.28, { lp: 5000 }), L('noise', 3500, 1200, 0.07, 0.45, { q: 0.8 }), L('tri', 280, 90, 0.1, 0.8), L('sine', 2600, 2600, 0.12, 0.1, { at: 0.02 })] },
  death:     { gap: 0.035, max: 4, pri: 1, vol: 1.0, pv: 0.18, layers: [L('noise', 1300, 280, 0.12, 0.5, { q: 0.9 }), L('sq25', 420, 90, 0.12, 0.22, { lp: 2500 })] },
  bigdeath:  { gap: 0.1, max: 2, pri: 3, vol: 0.8, pv: 0.06, layers: [L('brown', 900, 80, 0.5, 1), L('sine', 150, 40, 0.45, 0.8), L('noise', 1000, 200, 0.3, 0.4)] },
  bossdeath: { gap: 1, max: 1, pri: 3, vol: 0.9, pv: 0.02, layers: [L('brown', 1000, 60, 1.6, 1), L('saw', 220, 35, 1.2, 0.35, { lp: 600 }), L('sine', 120, 30, 1.4, 0.8), ...arp('sq25', [523, 392, 330, 262, 196], 0.14, 0.3, 0.12, { lp: 3000, at: 0.2 })] },
  leaf:      { gap: 0.06, max: 2, pri: 1, vol: 0.5, pv: 0.12, layers: [L('noise', 900, 3200, 0.12, 0.5, { ft: 'highpass', q: 0.7 }), L('tri', 420, 210, 0.09, 0.4)] },

  // ---- weapons ----
  roll:      { gap: 0.15, max: 2, pri: 2, vol: 0.9, pv: 0.08, layers: [L('noise', 350, 1600, 0.28, 0.6, { q: 1.4, att: 0.03 })] },
  swing:     { gap: 0.05, max: 3, pri: 1, vol: 0.9, pv: 0.1, layers: [L('noise', 500, 2200, 0.1, 0.7, { q: 2, att: 0.035 })] },
  thrust:    { gap: 0.05, max: 3, pri: 1, vol: 0.9, pv: 0.1, layers: [L('noise', 1400, 4200, 0.07, 0.6, { q: 1.5, att: 0.01 }), L('sq12', 700, 1500, 0.05, 0.15, { lp: 4000 })] },
  shoot:     { gap: 0.04, max: 4, pri: 1, vol: 0.8, pv: 0.12, layers: [L('sq12', 950, 420, 0.06, 0.32, { lp: 4500 })] },
  shoot_sling:  { gap: 0.04, max: 3, pri: 1, vol: 0.85, pv: 0.12, layers: [L('tri', 380, 980, 0.07, 0.5), L('noise', 2600, 1000, 0.04, 0.25)] },
  shoot_spear:  { gap: 0.05, max: 3, pri: 1, vol: 0.9, pv: 0.1, layers: [L('noise', 800, 3400, 0.11, 0.5, { q: 1.6, att: 0.02 }), L('sq25', 520, 260, 0.08, 0.2, { lp: 3000 })] },
  shoot_bow:    { gap: 0.04, max: 3, pri: 1, vol: 0.8, pv: 0.12, layers: [L('saw', 1200, 320, 0.07, 0.3, { lp: 3500 }), L('noise', 3000, 1500, 0.03, 0.25)] },
  shoot_ember:  { gap: 0.05, max: 3, pri: 1, vol: 0.85, pv: 0.1, layers: [L('noise', 500, 1800, 0.14, 0.5, { q: 0.8, att: 0.03 }), L('sine', 300, 700, 0.12, 0.3)] },
  shoot_lob:    { gap: 0.08, max: 2, pri: 1, vol: 0.55, pv: 0.08, layers: [L('sine', 190, 60, 0.18, 0.9), L('noise', 600, 200, 0.12, 0.35)] },
  shoot_egg:    { gap: 0.05, max: 3, pri: 1, vol: 0.7, pv: 0.14, layers: [L('sine', 700, 1500, 0.04, 0.5), L('sq25', 1500, 900, 0.03, 0.15)] },
  shoot_ptero:  { gap: 0.1, max: 2, pri: 1, vol: 0.75, pv: 0.1, layers: [L('saw', 900, 1500, 0.09, 0.22, { lp: 2800, vib: [30, 0.08] }), L('saw', 1500, 700, 0.12, 0.2, { at: 0.08, lp: 2800 })] },
  shoot_coconut:{ gap: 0.08, max: 2, pri: 1, vol: 0.5, pv: 0.1, layers: [L('tri', 260, 100, 0.1, 0.8), L('noise', 900, 300, 0.05, 0.3)] },
  laser:     { gap: 0.06, max: 2, pri: 1, vol: 0.75, pv: 0.06, layers: [L('saw', 2200, 280, 0.15, 0.28, { lp: 4000 }), L('sq25', 1300, 200, 0.12, 0.2, { lp: 3000 }), L('noise', 5000, 1500, 0.06, 0.15)] },
  boom:      { gap: 0.06, max: 3, pri: 2, vol: 0.85, pv: 0.08, layers: [L('brown', 1300, 90, 0.5, 1), L('sine', 130, 36, 0.4, 0.8), L('noise', 2200, 400, 0.15, 0.5)] },
  spit:      { gap: 0.06, max: 3, pri: 2, vol: 0.7, pv: 0.12, layers: [L('sine', 260, 620, 0.1, 0.55, { vib: [28, 0.12] }), L('noise', 900, 500, 0.06, 0.25, { q: 2 })] },

  // ---- enemy attacks (telegraphs and strikes) ----
  windup_flare:  { gap: 0.12, max: 2, pri: 2, vol: 0.65, pv: 0.08, layers: [L('sq25', 480, 1000, 0.2, 0.25, { lp: 3500, att: 0.03 }), L('noise', 2500, 4500, 0.15, 0.12, { ft: 'highpass' })] },
  windup_charge: { gap: 0.15, max: 2, pri: 2, vol: 0.6, pv: 0.06, layers: [L('saw', 110, 290, 0.55, 0.3, { lp: 700, att: 0.1 }), L('noise', 250, 900, 0.5, 0.3, { q: 1.2, att: 0.1 })] },
  windup_slam:   { gap: 0.15, max: 2, pri: 2, vol: 0.6, pv: 0.06, layers: [L('sine', 70, 190, 0.6, 0.6, { att: 0.15 }), L('tri', 140, 320, 0.55, 0.2, { att: 0.2, lp: 900 })] },
  charge:    { gap: 0.1, max: 2, pri: 2, vol: 0.7, pv: 0.06, layers: [L('noise', 200, 1400, 0.4, 0.7, { q: 1.4, att: 0.06 }), L('saw', 95, 55, 0.35, 0.3, { lp: 500 })] },
  stomp:     { gap: 0.3, max: 1, pri: 3, vol: 1, pv: 0.03, layers: [L('sine', 110, 28, 0.6, 1), L('brown', 800, 60, 0.7, 0.9), L('noise', 1800, 200, 0.14, 0.5)] },
  tail:      { gap: 0.1, max: 2, pri: 2, vol: 0.7, pv: 0.06, layers: [L('noise', 300, 1700, 0.24, 0.6, { q: 1.3, att: 0.06 }), L('sine', 110, 50, 0.2, 0.6, { at: 0.12 })] },
  bossCall:  { gap: 0.5, max: 1, pri: 3, vol: 0.9, pv: 0.02, layers: [
    L('saw', 98, 92, 1.1, 0.35, { lp: 650, hold: 0.7, att: 0.12, vib: [5, 0.03] }), L('saw', 147, 138, 1.1, 0.25, { lp: 650, hold: 0.7, att: 0.12, vib: [5, 0.03] }),
    L('saw', 196, 184, 1.1, 0.18, { lp: 650, hold: 0.7, att: 0.12, vib: [5, 0.03] }), L('noise', 300, 120, 0.9, 0.35, { att: 0.1 })] },
  bossEnrage:{ gap: 1, max: 1, pri: 3, vol: 1, pv: 0.02, layers: [
    L('saw', 82, 55, 1.6, 0.4, { lp: 700, hold: 0.6, att: 0.1, vib: [9, 0.05] }), L('saw', 123, 82, 1.6, 0.28, { lp: 700, hold: 0.6, att: 0.1, vib: [9, 0.05] }),
    L('brown', 700, 90, 1.5, 0.8), L('noise', 500, 2500, 0.5, 0.3, { att: 0.2 })] },

  // ---- player feedback ----
  hurt:      { gap: 0.08, max: 2, pri: 3, vol: 0.8, pv: 0.05, layers: [L('saw', 270, 80, 0.2, 0.38, { lp: 1800 }), L('noise', 1000, 300, 0.14, 0.45), L('sq', 190, 90, 0.15, 0.2, { lp: 1200 })] },
  dodge:     { gap: 0.1, max: 2, pri: 2, vol: 0.5, pv: 0.06, layers: [L('noise', 2200, 5500, 0.12, 0.35, { ft: 'highpass', q: 0.8, att: 0.03 }), L('sine', 800, 1700, 0.1, 0.15)] },
  amber:     { gap: 0.04, max: 4, pri: 1, vol: 0.6, pv: 0.01, layers: [L('tri', 1000, 1000, 0.09, 0.55), L('sine', 2000, 2000, 0.06, 0.22), L('sq25', 1500, 1500, 0.04, 0.08, { lp: 4000 })] },
  heal:      { gap: 0.1, max: 2, pri: 2, vol: 0.5, pv: 0.03, layers: [L('sine', 523, 523, 0.16, 0.45), L('sine', 784, 784, 0.18, 0.35, { at: 0.07 })] },
  berry:     { gap: 0.1, max: 2, pri: 2, vol: 0.55, pv: 0.05, layers: [L('sine', 440, 880, 0.12, 0.5), L('sine', 660, 1320, 0.14, 0.35, { at: 0.06 }), L('noise', 3000, 6000, 0.06, 0.08, { ft: 'highpass' })] },
  levelup:   { gap: 0.3, max: 1, pri: 3, vol: 0.8, pv: 0, layers: [...arp('sq25', [523, 659, 784, 1047, 1319], 0.06, 0.12, 0.3, { lp: 4000 }), ...arp('tri', [262, 330, 392, 523, 659], 0.06, 0.16, 0.4), L('noise', 4000, 8000, 0.25, 0.08, { ft: 'highpass', at: 0.25 })] },
  revive:    { gap: 0.2, max: 1, pri: 3, vol: 0.8, pv: 0, layers: [L('sine', 300, 900, 0.4, 0.5), ...arp('sq25', [392, 523, 659, 784, 1047], 0.07, 0.15, 0.25, { lp: 4000, at: 0.1 }), L('noise', 4000, 8000, 0.3, 0.08, { ft: 'highpass', at: 0.25 })] },
  downed:    { gap: 0.2, max: 1, pri: 3, vol: 0.9, pv: 0.02, layers: [L('saw', 360, 50, 0.75, 0.38, { lp: 1200 }), L('sine', 200, 30, 0.85, 0.8), L('noise', 800, 120, 0.4, 0.3)] },
  waveStart: { gap: 0.5, max: 1, pri: 3, vol: 0.8, pv: 0, layers: [...arp('saw', [262, 330, 392, 523], 0.1, 0.35, 0.22, { lp: 1600, hold: 0.4 }), L('sine', 90, 45, 0.5, 0.7), L('noise', 400, 150, 0.25, 0.3)] },
  waveEnd:   { gap: 0.5, max: 1, pri: 3, vol: 0.8, pv: 0, layers: [...arp('sq25', [392, 523, 659, 784, 1047], 0.08, 0.22, 0.25, { lp: 4000 }), ...arp('tri', [196, 262, 330, 392, 523], 0.08, 0.26, 0.35), L('noise', 4000, 9000, 0.4, 0.08, { ft: 'highpass', at: 0.3 })] },
  win:       { gap: 1, max: 1, pri: 3, vol: 0.85, pv: 0, layers: [...arp('sq25', [523, 523, 523, 659, 784, 659, 784, 1047], 0.11, 0.3, 0.26, { lp: 4000, hold: 0.5 }), ...arp('tri', [262, 262, 262, 330, 392, 330, 392, 523], 0.11, 0.34, 0.4)] },
  lose:      { gap: 1, max: 1, pri: 3, vol: 0.85, pv: 0, layers: [...arp('sq', [392, 349, 311, 262], 0.22, 0.5, 0.2, { lp: 1500, hold: 0.5 }), L('sine', 110, 40, 1.1, 0.7, { at: 0.5 })] },

  // ---- abilities ----
  roar:          { gap: 0.2, max: 1, pri: 3, vol: 0.9, pv: 0.03, layers: [L('saw', 160, 55, 0.65, 0.5, { lp: 900, vib: [14, 0.06], hold: 0.3 }), L('noise', 500, 180, 0.6, 0.5, { q: 0.8 }), L('sine', 60, 38, 0.55, 0.8)] },
  healing_pulse: { gap: 0.2, max: 1, pri: 3, vol: 0.8, pv: 0, layers: [...arp('tri', [523, 659, 784, 1047, 1319, 1568], 0.05, 0.24, 0.4), ...arp('sine', [1047, 1319, 1568, 2093], 0.05, 0.3, 0.14, { at: 0.12 }), L('noise', 5000, 9000, 0.4, 0.06, { ft: 'highpass', at: 0.1 })] },
  tail_whirl:    { gap: 0.2, max: 1, pri: 3, vol: 0.8, pv: 0.03, layers: [L('noise', 1100, 1100, 1.25, 0.6, { q: 3, fm: [9, 750], att: 0.12, hold: 0.7 }), L('saw', 220, 280, 1.2, 0.1, { lp: 900, trem: [9, 0.7], hold: 0.7, att: 0.1 })] },
  meteor_call:   { gap: 0.2, max: 1, pri: 3, vol: 0.8, pv: 0.02, layers: [L('sine', 300, 1300, 0.4, 0.4), L('sq25', 600, 2600, 0.35, 0.12, { lp: 4000 }), L('noise', 2000, 6000, 0.3, 0.12, { ft: 'highpass' })] },
  meteor_fall:   { gap: 0.2, max: 1, pri: 2, vol: 0.8, pv: 0.02, layers: [L('sine', 2200, 220, 0.7, 0.28, { att: 0.15 }), L('noise', 3500, 500, 0.7, 0.25, { q: 2, att: 0.2 })] },
  meteor_hit:    { gap: 0.2, max: 1, pri: 3, vol: 1, pv: 0.03, layers: [L('brown', 1600, 60, 1, 1), L('sine', 100, 28, 0.8, 1), L('noise', 3000, 300, 0.25, 0.6), L('sq25', 220, 60, 0.4, 0.2, { lp: 1200 })] },

  // ---- shop and menus ----
  click:     { gap: 0.02, max: 2, pri: 2, vol: 0.8, pv: 0.03, layers: [L('sq', 1200, 850, 0.025, 0.4, { lp: 5000 })] },
  buy:       { gap: 0.05, max: 2, pri: 3, vol: 0.7, pv: 0.01, layers: [L('sq25', 988, 988, 0.06, 0.3, { lp: 5000 }), L('sq25', 1319, 1319, 0.14, 0.3, { at: 0.06, lp: 5000 }), L('sine', 2637, 2637, 0.2, 0.1, { at: 0.06 })] },
  sell:      { gap: 0.05, max: 2, pri: 3, vol: 0.7, pv: 0.01, layers: [L('sq25', 1319, 1319, 0.06, 0.28, { lp: 5000 }), L('sq25', 880, 880, 0.12, 0.28, { at: 0.06, lp: 5000 })] },
  merge:     { gap: 0.1, max: 1, pri: 3, vol: 0.8, pv: 0, layers: arp('sq25', [659, 784, 988, 1319, 1568], 0.045, 0.12, 0.28, { lp: 5000 }) },
  reroll:    { gap: 0.08, max: 1, pri: 2, vol: 0.6, pv: 0.04, layers: [L('noise', 3000, 1500, 0.04, 0.5, { q: 1 }), L('noise', 3500, 1800, 0.04, 0.5, { q: 1, at: 0.06 }), L('noise', 4000, 2100, 0.04, 0.5, { q: 1, at: 0.12 }), L('sq25', 700, 700, 0.05, 0.14, { at: 0.12, lp: 3000 })] },
  lock:      { gap: 0.08, max: 1, pri: 2, vol: 0.6, pv: 0.02, layers: [L('sq', 500, 500, 0.04, 0.3, { lp: 2500 }), L('sq', 750, 750, 0.06, 0.3, { at: 0.04, lp: 2500 })] },
  ready:     { gap: 0.1, max: 1, pri: 2, vol: 0.6, pv: 0.01, layers: [L('tri', 660, 660, 0.08, 0.5), L('tri', 990, 990, 0.14, 0.5, { at: 0.07 })] },
  nope:      { gap: 0.15, max: 1, pri: 3, vol: 0.9, pv: 0.02, layers: [L('sq', 180, 140, 0.11, 0.35, { lp: 1500 }), L('saw', 90, 70, 0.13, 0.3, { lp: 700 })] },
};

// Friendly aliases so the UI (or later code) can use natural names.
PRESETS.levelUp = PRESETS.levelup;
PRESETS.coin = PRESETS.buy;
PRESETS.select = PRESETS.click;
PRESETS.unlock = PRESETS.lock;
PRESETS.toast = PRESETS.click;
PRESETS.pickup = PRESETS.amber;

class Sfx {
  constructor(autoUnlock = true) {
    this.ctx = null;
    this.volume = 0.7;
    this.last = {};      // name -> last start time
    this.alive = {};     // name -> [end times]
    this.ends = [];      // [endTime, priority] of every playing voice
    this.waves = {};
    this.streak = 0;
    this.streakT = -9;
    if (autoUnlock && typeof addEventListener === 'function') {
      const unlock = () => { this.ensure(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
      addEventListener('pointerdown', unlock);
      addEventListener('keydown', unlock);
    }
  }

  /** Use a given context (tests render to an OfflineAudioContext). */
  attach(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.bus = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 14; this.comp.ratio.value = 5;
    this.comp.attack.value = 0.004; this.comp.release.value = 0.18;
    this.master.connect(this.bus);
    this.bus.connect(this.comp);
    this.comp.connect(ctx.destination);
    const sr = ctx.sampleRate;
    this.white = ctx.createBuffer(1, sr * 2, sr);
    this.brown = ctx.createBuffer(1, sr * 2, sr);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < w.length; i++) {
      const x = Math.random() * 2 - 1;
      w[i] = x;
      last = (last + 0.02 * x) / 1.02;
      b[i] = last * 3.5;
    }
  }

  ensure() {
    if (!this.ctx) {
      try { this.attach(new (window.AudioContext || window.webkitAudioContext)()); } catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended' && this.ctx.resume) { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); }
    return this.ctx;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, +v || 0));
    if (this.master) this.master.gain.value = this.volume;
  }

  /** Pulse-wave PeriodicWave for a duty cycle (0.5 = square). Cached. */
  pulse(duty) {
    let w = this.waves[duty];
    if (!w) {
      const n = 48, re = new Float32Array(n), im = new Float32Array(n);
      for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      w = this.waves[duty] = this.ctx.createPeriodicWave(re, im);
    }
    return w;
  }

  /** Amber pickups walk up a pentatonic scale while they keep coming; returns the pitch multiplier. */
  amberRate() {
    const now = this.ctx ? this.ctx.currentTime : 0;
    this.streak = now - this.streakT < 0.45 ? Math.min(this.streak + 1, 14) : 0;
    this.streakT = now;
    const penta = [0, 2, 4, 7, 9];
    const semis = penta[this.streak % 5] + 12 * Math.floor(this.streak / 5);
    return Math.pow(2, semis / 12);
  }

  play(name, o) {
    const p = PRESETS[name];
    const ctx = this.ctx;
    if (!p || !ctx || this.volume <= 0) return false;
    const now = ctx.currentTime;
    if (now - (this.last[name] ?? -9) < p.gap) return false;
    // Voice bookkeeping: drop finished voices, then apply the per-sound and global caps.
    const ends = this.ends;
    let n = 0;
    for (let i = 0; i < ends.length; i++) if (ends[i][0] > now) ends[n++] = ends[i];
    ends.length = n;
    const al = this.alive[name] || (this.alive[name] = []);
    let m = 0;
    for (let i = 0; i < al.length; i++) if (al[i] > now) al[m++] = al[i];
    al.length = m;
    const pri = p.pri || 1;
    if (al.length >= (p.max || 3)) return false;
    if (n >= VOICE_CAP && pri < 3) return false;
    if (n >= VOICE_CAP + 8) return false;
    const vol = (o && o.vol !== undefined ? o.vol : 1) * (p.vol ?? 1);
    if (vol < 0.02) return false;
    this.last[name] = now;
    const rate = (1 + (Math.random() * 2 - 1) * (p.pv ?? 0.06)) * ((o && o.rate) || 1);
    const t0 = now + ((o && o.delay) || 0) + 0.005;
    let out = this.master;
    if (o && o.pan) {
      if (ctx.createStereoPanner) {
        const sp = ctx.createStereoPanner();
        sp.pan.value = Math.max(-1, Math.min(1, o.pan));
        sp.connect(this.master);
        out = sp;
      }
    }
    let end = t0;
    for (const l of p.layers) {
      const e = this.layer(l, t0, vol, rate, out);
      if (e > end) end = e;
    }
    ends.push([end, pri]);
    al.push(end);
    return true;
  }

  layer(l, t0, vol, rate, out) {
    const ctx = this.ctx;
    const t = t0 + (l.at || 0);
    const dur = l.dur;
    const peak = Math.max(0.0003, (l.vol ?? 1) * vol);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + (l.att ?? 0.004));
    if (l.hold) g.gain.setValueAtTime(peak, t + dur * l.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let src, last;
    if (l.w === 'noise' || l.w === 'brown') {
      src = ctx.createBufferSource();
      src.buffer = l.w === 'brown' ? this.brown : this.white;
      const f = ctx.createBiquadFilter();
      f.type = l.ft || (l.w === 'brown' ? 'lowpass' : 'bandpass');
      f.Q.value = l.q ?? 1;
      f.frequency.setValueAtTime(l.f0 * rate, t);
      if (l.f1 !== l.f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, l.f1 * rate), t + dur);
      if (l.fm) this.lfo(l.fm[0], l.fm[1], f.frequency, t, dur);
      src.connect(f);
      last = f;
      src.start(t, Math.random() * Math.max(0, this.white.duration - dur - 0.1));
      src.stop(t + dur + 0.03);
    } else {
      src = ctx.createOscillator();
      if (l.w === 'sq25') src.setPeriodicWave(this.pulse(0.25));
      else if (l.w === 'sq12') src.setPeriodicWave(this.pulse(0.125));
      else src.type = { sine: 'sine', tri: 'triangle', saw: 'sawtooth', sq: 'square' }[l.w] || 'sine';
      src.frequency.setValueAtTime(l.f0 * rate, t);
      if (l.f1 !== l.f0) src.frequency.exponentialRampToValueAtTime(Math.max(25, l.f1 * rate), t + dur);
      if (l.vib) this.lfo(l.vib[0], l.vib[1] * l.f0 * rate, src.frequency, t, dur);
      last = src;
      if (l.lp) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = l.lp;
        src.connect(f);
        last = f;
      }
      src.start(t);
      src.stop(t + dur + 0.03);
    }
    if (l.trem) {
      // Tremolo on its own gain node so the envelope never goes negative.
      const tg = ctx.createGain();
      tg.gain.value = 1 - l.trem[1] / 2;
      this.lfo(l.trem[0], l.trem[1] / 2, tg.gain, t, dur);
      last.connect(tg);
      last = tg;
    }
    last.connect(g);
    g.connect(out);
    return t + dur + 0.03;
  }

  lfo(rate, depth, param, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = rate;
    const d = ctx.createGain();
    d.gain.value = depth;
    o.connect(d);
    d.connect(param);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
}

export const sfx = new Sfx();
export { Sfx, PRESETS };
