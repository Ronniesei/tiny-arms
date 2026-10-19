// Client session: sends inputs, receives snapshots, interpolates other entities ~100 ms behind,
// predicts its own T-Rex locally and gently corrects toward the host. Same interface as HostSession.

import { BALANCE } from '../data/balance.js';
import { decodeSnap, interpolateViews } from './protocol.js';
import { connectToHost } from './transport.js';
import { predictMove, rollDir } from '../sim/systems/movement.js';
import { clampDanger, DEFAULT_DANGER } from '../data/danger.js';

const INTERP_DELAY = 0.1;     // s
const INPUT_HZ = 30;
const SNAP_CORRECT = 0.15;    // fraction of prediction error removed per snapshot
const HARD_SNAP_PX = 40;

/** Dash's Stampede moves the hero on the host: follow the host instead of predicting a walk (abState = casting flag). */
const charging = (me) => me.char === 'dash' && me.casting;

export class ClientSession {
  constructor({ code, name, char, local = false, unlocks = null }) {
    this.isHost = false;
    this.myId = -1;
    this.code = code;
    this.local = local;
    this.name = name || 'Player';
    this.char = char || 'spike';
    this.state = 'connecting';
    this.error = null;
    this.players = [];
    this.danger = DEFAULT_DANGER;   // the host's choice, read-only here
    this.maxDanger = DEFAULT_DANGER; // the highest level anyone in the lobby has unlocked (lobby message)
    this.unlocks = unlocks;          // this browser's {items, weapons, maxDanger}: sent in hello (docs/PROGRESSION.md)
    this.ready = false;
    this.names = {};
    this.snaps = [];          // [{time, view}]
    this.evQueue = [];
    this.outEvents = [];
    this.meData = null;
    this.lastRes = null;
    this.input = { mx: 0, my: 0, ab: 0 };
    this.seq = 0;
    this.sendT = 0;
    this.lastSent = '';
    this.frames = [];         // [{seq, mx, my, dt, spd}]
    this.pred = null;
    this.offset = null;       // serverTime - localTime (s)
    this.renderTime = 0;
    this.rtt = 0;
    this.bytesWindow = [];
    this.inRun = false;
  }

  async open() {
    try {
      this.conn = await connectToHost(this.code, { local: this.local });
      this.conn.onData((m) => this.onMsg(m));
      this.conn.onClose(() => this.onHostLeft());
      this.conn.send({ t: 'hello', name: this.name, char: this.char, unlocks: this.unlocks });
      this.pingTimer = setInterval(() => this.conn.send({ t: 'ping', c: performance.now() }), 2000);
    } catch (e) {
      this.error = e.message;
      this.state = 'error';
    }
  }

  onHostLeft() {
    if (this.state === 'error') return;
    this.error = 'The host left the game.';
    this.state = 'error';
    this.inRun = false;
    clearInterval(this.pingTimer);
  }

  now() { return performance.now() / 1000; }

  onMsg(m) {
    switch (m.t) {
      case 'welcome': this.myId = m.id; this.state = 'lobby'; break;
      case 'full': this.error = m.msg; this.state = 'error'; break;
      case 'lobby':
        this.players = m.players;
        if (m.danger !== undefined) this.danger = clampDanger(m.danger);
        if (m.maxDanger !== undefined) this.maxDanger = clampDanger(m.maxDanger);
        if (!this.inRun) this.state = 'lobby';
        break;
      case 'start':
        if (m.danger !== undefined) this.danger = clampDanger(m.danger);
        this.names = Object.fromEntries(m.players.map((p) => [p.id, p.name]));
        this.inRun = true;
        this.snaps = [];
        this.evQueue = [];
        this.pred = null;
        this.frames = [];
        this.offset = null;
        this.state = 'wave';
        break;
      case 'again':
        this.inRun = false;
        this.state = 'lobby';
        this.meData = null;
        this.ready = false;
        break;
      case 'bye': this.onHostLeft(); break;
      case 'snap': this.onSnap(m); break;
      case 'me': this.meData = m.d; if (m.res) this.lastRes = m.res; break;
      case 'pong': this.rtt = performance.now() - m.c; break;
      default:
    }
  }

  onSnap(m) {
    const now = this.now();
    this.bytesWindow.push([performance.now(), JSON.stringify(m).length]);
    const view = decodeSnap(m, this.names);
    const st = m.k / BALANCE.tickRate;
    const sample = st - now;
    if (this.offset === null || sample > this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.02;
    this.snaps.push({ time: st, view });
    if (this.snaps.length > 30) this.snaps.shift();
    if (m.ev) for (const e of m.ev) this.evQueue.push(e);
    this.state = view.phase;
    this.reconcile(view);
  }

  reconcile(view) {
    const me = view.players.find((p) => p.id === this.myId);
    if (!me) return;
    if (me.downed || view.phase !== 'wave' || !this.pred) {
      this.pred = { x: me.x, y: me.y, r: me.r };
      this.frames = [];
      return;
    }
    // Replay inputs the host has not processed yet on top of the host position.
    this.frames = this.frames.filter((f) => f.seq > me.lastSeq);
    const target = { x: me.x, y: me.y, r: me.r };
    if (charging(me)) { this.pred.x = me.x; this.pred.y = me.y; this.frames = []; this.mySpeed = me.spd; return; }
    for (const f of this.frames) predictMove(target, f.mx, f.my, f.spd, f.dt);
    const ex = target.x - this.pred.x, ey = target.y - this.pred.y;
    if (Math.hypot(ex, ey) > HARD_SNAP_PX) { this.pred.x = target.x; this.pred.y = target.y; }
    else { this.pred.x += ex * SNAP_CORRECT; this.pred.y += ey * SNAP_CORRECT; }
    this.mySpeed = me.spd;
  }

  phase() { return this.state; }

  lobby() {
    return { code: this.code, isHost: false, myId: this.myId, players: this.players.map((p) => ({ ...p })), local: this.local, danger: this.danger, maxDanger: this.maxDanger };
  }

  setName(name) { this.name = name; this.conn?.send({ t: 'hello', name, char: this.char, unlocks: this.unlocks }); }
  /** New unlocks after a run: tell the host (for the next run's pool and danger list). */
  setUnlocks(u) { this.unlocks = u; this.conn?.send({ t: 'hello', name: this.name, char: this.char, unlocks: u }); }
  pick(char) { this.char = char; this.conn?.send({ t: 'pick', char }); }
  setReady(v) { this.ready = v; this.conn?.send({ t: 'ready', value: v }); }
  setDanger() {}   // only the host chooses
  startRun() {}
  playAgain() {}
  leave() { clearInterval(this.pingTimer); this.conn?.close(); }

  setInput(inp) { this.input = inp; }

  shopOp(op) {
    this.conn?.send({ t: 'shop', op });
    return { ok: true, pending: true };
  }

  me() { return this.meData; }

  update(dtMs) {
    if (!this.inRun) return;
    const dt = Math.min(dtMs, 100) / 1000;
    // Send input at INPUT_HZ, or right away when it changes.
    this.sendT -= dt;
    const key = `${this.input.mx.toFixed(2)},${this.input.my.toFixed(2)},${this.input.ab},${this.input.dr}`;
    if (this.sendT <= 0 || key !== this.lastSent) {
      this.sendT = 1 / INPUT_HZ;
      this.lastSent = key;
      this.seq++;
      this.conn?.send({ t: 'in', seq: this.seq, mx: +this.input.mx.toFixed(3), my: +this.input.my.toFixed(3), ab: this.input.ab, dr: this.input.dr || 0 });
    }
    // Predict own movement.
    const latest = this.snaps[this.snaps.length - 1]?.view;
    const me = latest?.players.find((p) => p.id === this.myId);
    // Dodge roll prediction (same rules as movement.js on the host).
    const R = BALANCE.roll;
    this.rollCd = Math.max(0, (this.rollCd || 0) - dt);
    if (me && me.rollCd > this.rollCd + 0.5) this.rollCd = me.rollCd;
    const dr = this.input.dr || 0;
    if (this.drSeen === undefined) this.drSeen = dr;
    if (dr > this.drSeen && this.rollCd <= 0 && this.pred && me && !me.downed && latest.phase === 'wave') {
      [this.rollDx, this.rollDy] = rollDir(this.input.mx, this.input.my, this.facing || me.facing);
      this.rollT = R.duration;
      this.rollCd = R.cooldown;
    }
    this.drSeen = dr;
    if (this.pred && me && !me.downed && latest.phase === 'wave' && !charging(me)) {
      const base = this.mySpeed || me.spd;
      const rolling = this.rollT > 0;
      if (rolling) this.rollT -= dt;
      const mx = rolling ? this.rollDx : this.input.mx, my = rolling ? this.rollDy : this.input.my;
      const spd = rolling ? base * R.speedMult : base;
      predictMove(this.pred, mx, my, spd, dt);
      this.frames.push({ seq: this.seq, mx, my, dt, spd });
      if (this.frames.length > 240) this.frames.shift();
      if (this.input.mx > 0.05) this.facing = 1; else if (this.input.mx < -0.05) this.facing = -1;
    }
  }

  view() {
    if (!this.snaps.length) return null;
    const rt = this.now() + (this.offset ?? 0) - INTERP_DELAY;
    this.renderTime = rt;
    let A = null, B = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].time <= rt) { A = this.snaps[i]; B = this.snaps[i + 1] || null; break; }
    }
    let v;
    if (!A) v = this.snaps[0].view;
    else if (!B) v = A.view;
    else v = interpolateViews(A.view, B.view, Math.min(1, (rt - A.time) / Math.max(0.001, B.time - A.time)));
    // Own T-Rex: predicted position, newest state otherwise.
    const latest = this.snaps[this.snaps.length - 1].view;
    const meNew = latest.players.find((p) => p.id === this.myId);
    if (meNew && this.pred) {
      const mine = { ...meNew, x: this.pred.x, y: this.pred.y, facing: this.facing || meNew.facing, moving: Math.abs(this.input.mx) + Math.abs(this.input.my) > 0.05, rolling: this.rollT > 0 || meNew.rolling, rollCd: Math.max(this.rollCd || 0, meNew.rollCd || 0) };
      v = { ...v, players: v.players.map((p) => (p.id === this.myId ? mine : p)) };
    }
    // Phase and timers from the newest snapshot so the HUD/UI react immediately.
    return { ...v, phase: latest.phase, wave: latest.wave, timeLeft: latest.timeLeft, shopTime: latest.shopTime, waveDur: latest.waveDur };
  }

  takeEvents() {
    const rt = this.renderTime || Infinity;
    const out = [];
    const keep = [];
    for (const e of this.evQueue) {
      if (e.k / BALANCE.tickRate <= rt + 0.02 || e.type === 'waveEnd' || e.type === 'runEnd' || e.type === 'waveStart') out.push(e);
      else keep.push(e);
    }
    this.evQueue = keep.length > 800 ? keep.slice(-800) : keep;
    return out;
  }

  netStats() {
    const now = performance.now();
    while (this.bytesWindow.length && now - this.bytesWindow[0][0] > 1000) this.bytesWindow.shift();
    const perSec = this.bytesWindow.reduce((s, x) => s + x[1], 0);
    const err = this.pred && this.snaps.length ? (() => {
      const me = this.snaps[this.snaps.length - 1].view.players.find((p) => p.id === this.myId);
      return me ? Math.round(Math.hypot(me.x - this.pred.x, me.y - this.pred.y)) : 0;
    })() : 0;
    return { role: 'client', rtt: Math.round(this.rtt), kbps: +(perSec / 1024).toFixed(1), snaps: this.snaps.length, predErr: err };
  }

  skipWave() {}
  skipToShop() {}
}
