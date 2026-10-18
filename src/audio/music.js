// Procedural chiptune music (WebAudio, no files). A look-ahead step sequencer plays small loops:
//   menu  calm, slow, soft arpeggio and pad
//   shop  relaxed and a bit jaunty (between waves)
//   wave  driving: bass, 4-on-the-floor, hook; gets busier as the wave number grows
//   boss  tense variant for wave 20 (phrygian riff, galloping bass, double kick, siren pad)
//   off   silence (fades out)
//
//   music.setMode('menu'|'wave'|'shop'|'boss'|'off', wave)   cheap to call every frame
//   music.setVolume(v)   0..1 (the settings value; default 0.4 sits well under the sound effects)
//
// It plays into sfx.bus, so the same compressor protects the mix. It stays silent until the browser
// lets the AudioContext run (first click or key press, see sfx.ensure()).

import { sfx as defaultSfx } from './sfx.js';

const LOOKAHEAD = 0.28;       // s of audio scheduled ahead
const MUSIC_GAIN = 0.55;      // settings volume 1.0 -> this much of the bus (voices are mixed quietly on top)

const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
/** 'c#5' -> MIDI number, '.' -> 0 (rest). */
function m(name) {
  if (name === '.' || name === '-') return 0;
  const mt = /^([a-g])(#|b)?(\d)$/.exec(name);
  if (!mt) return 0;
  return 12 * (+mt[3] + 1) + SEMI[mt[1]] + (mt[2] === '#' ? 1 : mt[2] === 'b' ? -1 : 0);
}
const bar = (s) => s.trim().split(/\s+/).map(m);
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Chord tones (MIDI) used by the arpeggios; the bass plays the root two octaves down.
const CH = {
  Am: [57, 60, 64, 69], F: [53, 57, 60, 65], C: [60, 64, 67, 72], G: [55, 59, 62, 67], Dm: [50, 53, 57, 62],
  Em: [52, 55, 59, 64], Bb: [58, 62, 65, 70], E: [52, 56, 59, 64],
};
const ROOT = { Am: 45, F: 41, C: 48, G: 43, Dm: 38, Em: 40, Bb: 46, E: 40 };

const N = null; // rest in a bass pattern (a number is a semitone offset from the chord root)

const MODES = {
  wave: {
    bpm: 132,
    prog: ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'E'],
    lead: [
      bar('e5 . e5 . a5 . g5 . e5 . d5 . c5 . . .'),
      bar('c5 . c5 . f5 . e5 . c5 . a4 . c5 . . .'),
      bar('g4 . c5 . e5 . d5 . c5 . g4 . e5 . . .'),
      bar('d5 . d5 . g5 . f5 . d5 . b4 . d5 . . .'),
      bar('a5 . g5 . e5 . g5 . a5 . . . e5 . . .'),
      bar('f5 . e5 . c5 . e5 . f5 . . . a5 . . .'),
      bar('g5 . f5 . d5 . f5 . g5 . . . b5 . . .'),
      bar('e5 . g#5 . b5 . g#5 . e5 . . . b4 . . .'),
    ],
    bass: [0, N, 0, N, 12, N, 0, N, 0, N, 0, N, 12, N, 7, N],
    kick: [0, 4, 8, 12], snare: [4, 12],
  },
  boss: {
    bpm: 148,
    prog: ['Em', 'Em', 'Bb', 'Bb', 'Em', 'Em', 'Bb', 'E'],
    lead: [
      bar('e5 e5 . b4 . f5 . e5 . b4 . bb4 . e5 . .'),
      bar('e5 . g5 . e5 . b4 . e5 f5 e5 . b4 . . .'),
      bar('bb4 bb4 . f5 . bb5 . a5 . f5 . d5 . bb4 . .'),
      bar('d5 . f5 . bb5 . a5 . f5 . d5 . f5 . . .'),
      bar('b5 . b5 . e6 . b5 . bb5 . f5 . e5 . . .'),
      bar('e5 f5 e5 . b4 . f5 . e5 . . . g5 . f5 .'),
      bar('f5 . bb5 . a5 . f5 . d5 . f5 . bb4 . . .'),
      bar('g#5 . g#5 . b5 . g#5 . e5 . . . b4 . . .'),
    ],
    bass: [0, 0, N, 12, 0, 0, 12, N, 0, 0, N, 12, 0, 0, 12, 13],
    kick: [0, 3, 4, 8, 10, 12], snare: [4, 12],
  },
  shop: {
    bpm: 96,
    prog: ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm', 'G'],
    lead: [
      bar('e5 . . . g5 . . . e5 . d5 . c5 . . .'),
      bar('c5 . . . e5 . . . a4 . c5 . . . . .'),
      bar('a4 . . . c5 . . . f5 . e5 . c5 . . .'),
      bar('b4 . . . d5 . . . g5 . . . . . . .'),
      bar('g5 . . . e5 . . . g5 . a5 . g5 . . .'),
      bar('e5 . . . c5 . . . e5 . . . a4 . . .'),
      bar('f5 . . . d5 . . . a4 . d5 . f5 . . .'),
      bar('d5 . . . b4 . . . g4 . . . . . . .'),
    ],
    bass: [0, N, N, N, N, N, 7, N, 0, N, N, N, N, N, 12, N],
    kick: [], snare: [],
  },
};
MODES.menu = { ...MODES.shop, bpm: 80 };

const ARP_ORDER = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 1, 3, 2];

class Music {
  constructor(s = defaultSfx) {
    this.s = s;
    this.vol = 0.4;
    this.want = 'off';
    this.wave = 1;
    this.mode = 'off';
    this.seg = null;       // gain node for the segment (mode) that is currently playing
    this.step = 0;
    this.next = 0;
    this.timer = null;
    this.hidden = false;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { this.hidden = document.hidden; this.applyGain(); });
    }
  }

  setVolume(v) {
    this.vol = Math.max(0, Math.min(1, +v || 0));
    this.applyGain();
  }

  setMode(mode, wave = 1) {
    this.wave = wave;
    if (mode === this.want) return;
    this.want = mode;
    this.start();
  }

  applyGain() {
    if (!this.out) return;
    const ctx = this.s.ctx;
    const g = this.hidden ? 0 : this.vol * MUSIC_GAIN;
    this.out.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.pump(), 50);
  }

  /** Called by the timer. Schedules notes a little ahead of the audio clock. */
  pump() {
    const s = this.s, ctx = s.ctx;
    if (!ctx || ctx.state !== 'running' || !s.bus) return;
    if (!this.out) {
      this.out = ctx.createGain();
      this.out.gain.value = 0;
      this.out.connect(s.bus);
      this.applyGain();
    }
    const now = ctx.currentTime;
    if (this.mode !== this.want) this.switchTo(this.want, now);
    if (this.mode === 'off' || this.hidden || this.vol <= 0) { this.next = 0; return; }
    if (this.next < now - 0.3 || this.next === 0) this.next = now + 0.06; // first start, or we stalled
    const md = MODES[this.mode];
    const stepDur = 60 / md.bpm / 4;
    while (this.next < now + LOOKAHEAD) {
      this.playStep(md, this.step, this.next, stepDur);
      this.next += stepDur;
      this.step++;
    }
  }

  switchTo(mode, now) {
    const ctx = this.s.ctx;
    if (this.seg) {
      const old = this.seg;
      old.gain.cancelScheduledValues(now);
      old.gain.setTargetAtTime(0, now, 0.07);
      setTimeout(() => { try { old.disconnect(); } catch (e) { /* already gone */ } }, 700);
    }
    this.mode = mode;
    this.step = 0;
    this.next = 0;
    if (mode === 'off') { this.seg = null; return; }
    this.seg = ctx.createGain();
    this.seg.gain.setValueAtTime(0.0001, now);
    this.seg.gain.linearRampToValueAtTime(1, now + 0.5);
    this.seg.connect(this.out);
  }

  // ---- voices ----

  tone(type, f, t, dur, vol, o) {
    const ctx = this.s.ctx;
    const osc = ctx.createOscillator();
    if (type === 'p25') osc.setPeriodicWave(this.s.pulse(0.25));
    else if (type === 'p12') osc.setPeriodicWave(this.s.pulse(0.125));
    else osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + (o?.att ?? 0.006));
    if (o?.hold) g.gain.setValueAtTime(vol, t + dur * o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let last = osc;
    if (o?.lp) {
      const f2 = ctx.createBiquadFilter();
      f2.type = 'lowpass'; f2.frequency.value = o.lp;
      osc.connect(f2); last = f2;
    }
    if (o?.vib) {
      const l = ctx.createOscillator(), d = ctx.createGain();
      l.frequency.value = o.vib[0]; d.gain.value = o.vib[1] * f;
      l.connect(d); d.connect(osc.frequency);
      l.start(t + 0.08); l.stop(t + dur + 0.05);
    }
    last.connect(g);
    g.connect(this.seg);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  noise(t, dur, vol, ft, f0, f1, q = 1) {
    const ctx = this.s.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.s.white;
    const f = ctx.createBiquadFilter();
    f.type = ft; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.seg);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.03);
  }

  kick(t, vol) {
    const ctx = this.s.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(this.seg);
    o.start(t); o.stop(t + 0.22);
  }

  playStep(md, step, t, stepDur) {
    const s16 = step % 16;
    const barIx = Math.floor(step / 16) % md.prog.length;
    const chord = md.prog[barIx];
    const tones = CH[chord];
    const root = ROOT[chord];
    const mode = this.mode;
    const w = this.wave || 1;
    const beat = stepDur * 4;

    if (mode === 'wave' || mode === 'boss') {
      const boss = mode === 'boss';
      // Bass: triangle, one octave bounce.
      const bi = md.bass[s16];
      if (bi !== N) this.tone(boss ? 'sawtooth' : 'triangle', hz(root + bi), t, stepDur * (boss ? 0.9 : 1.7), boss ? 0.2 : 0.32, boss ? { lp: 500 } : null);
      // Drums.
      if (md.kick.includes(s16)) this.kick(t, boss ? 0.5 : 0.42);
      if (md.snare.includes(s16)) this.noise(t, 0.13, boss ? 0.2 : 0.16, 'bandpass', 1900, 1000, 0.8);
      if (boss) {
        this.noise(t, 0.035, s16 % 4 === 2 ? 0.1 : 0.06, 'highpass', 7000, 7000);
        if (s16 === 0 && barIx % 2 === 0) this.tone('sawtooth', hz(root + 12), t, beat * 8 * 0.98, 0.07, { lp: 700, att: 0.4, vib: [6, 0.01] }); // siren pad
      } else if (w >= 3 && s16 % 2 === 0) {
        this.noise(t, 0.03, s16 % 4 === 2 ? 0.09 : 0.05, 'highpass', 7500, 7500);
      }
      // Hook.
      const note = md.lead[barIx][s16];
      if (note) this.tone('p25', hz(note), t, stepDur * 1.9, boss ? 0.13 : 0.12, { lp: 3800, vib: [5.5, 0.006] });
      // Arpeggio shimmer when the waves get hard.
      if ((boss || w >= 6) && s16 % 2 === 1) this.tone('p12', hz(tones[ARP_ORDER[s16]] + 12), t, stepDur * 1.1, 0.045);
      // Second voice harmonising the hook late in the run.
      if ((boss || w >= 12) && note && s16 % 4 === 0) this.tone('p12', hz(note - 5), t, stepDur * 1.9, 0.045, { lp: 3000 });
      return;
    }

    // shop / menu: soft and slow.
    const menu = mode === 'menu';
    if (md.bass[s16] !== N) this.tone('triangle', hz(root + md.bass[s16]), t, stepDur * 3.6, 0.3);
    if (s16 % 2 === 0) this.tone('p12', hz(tones[ARP_ORDER[s16]]), t, stepDur * 1.7, menu ? 0.05 : 0.07, { lp: 3000 });
    if (!menu) {
      const note = md.lead[barIx][s16];
      if (note) this.tone('triangle', hz(note), t, stepDur * 3.2, 0.2, { vib: [5, 0.008], att: 0.02 });
      if (s16 % 4 === 2) this.noise(t, 0.03, 0.04, 'highpass', 8000, 8000);
    } else if (s16 === 0) {
      this.tone('triangle', hz(tones[0] + 12), t, beat * 4 * 0.95, 0.1, { att: 0.3 }); // pad
      this.tone('triangle', hz(tones[2] + 12), t, beat * 4 * 0.95, 0.08, { att: 0.3 });
    }
  }
}

export const music = new Music();
export { Music, MODES };
