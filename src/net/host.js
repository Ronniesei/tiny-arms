// Host session: runs the authoritative world, the lobby, and sends snapshots to clients.
// Solo play is a host with no transport.
//
// Session interface (shared with ClientSession, used by App/UI/GameScene):
//   isHost, myId, code, danger, phase(), lobby(), update(dtMs), view(), takeEvents(), me(),
//   setInput({mx,my,ab}), shopOp(op), pick(char), setReady(v), setName(n), setDanger(d), startRun(), playAgain(),
//   netStats(), error, leave()

import { BALANCE } from '../data/balance.js';
import { createWorld, step, skipWave, removePlayer } from '../sim/world.js';
import { applyShopOp } from '../sim/shop.js';
import { encodeSnap, decodeSnap, privateView, filterEvents } from './protocol.js';
import { createHostTransport } from './transport.js';
import { clampDanger, DEFAULT_DANGER } from '../data/danger.js';

const DT = 1 / BALANCE.tickRate;
const SNAP_EVERY = 3;         // ticks (20 Hz)
const ME_EVERY = 30;          // ticks (2 Hz) for private state
const DROP_AFTER_S = 4;
const SILENT_AFTER_MS = 6000;  // no message (inputs at 30 Hz, pings every 2 s) for this long = gone
const MAX_PLAYERS = 4;

export class HostSession {
  constructor({ code, name, char, solo = false, local = false, speed = 1, seed, startWave = 1, danger = DEFAULT_DANGER }) {
    this.isHost = true;
    this.myId = 0;
    this.code = code;
    this.solo = solo;
    this.local = local;
    this.speed = speed;
    this.seed = seed;
    this.startWave = startWave;
    this.danger = clampDanger(danger);   // chosen by the host in the lobby (src/data/danger.js)
    this.error = null;
    this.state = solo ? 'lobby' : 'connecting';
    this.players = [{ id: 0, name: name || 'Host', char: char || 'spike', ready: true, connected: true }];
    this.conns = new Map();       // pid -> conn
    this.lastHeard = new Map();   // pid -> performance.now() of the last message
    this.inputs = {};             // pid -> latest input
    this.localInput = { mx: 0, my: 0, ab: 0 };
    this.world = null;
    this.acc = 0;
    this.localEvents = [];
    this.netEvents = [];
    this.lastPhase = null;
    this.dropTimers = new Map();
    this.cachedView = null;
    this.cachedTick = -1;
    this.bytesOut = 0;
    this.bytesWindow = [];
    this.stepMs = 0;
  }

  async open() {
    if (this.solo) return;
    try {
      this.transport = await createHostTransport(this.code, { local: this.local });
      this.transport.onJoin((conn) => this.onJoin(conn));
      this.state = 'lobby';
    } catch (e) {
      this.error = e.message;
      this.state = 'error';
    }
  }

  // ---- lobby ----

  phase() { return this.world ? this.world.phase : this.state; }

  lobby() {
    return { code: this.code, isHost: true, myId: this.myId, players: this.players.map((p) => ({ ...p })), local: this.local, danger: this.danger };
  }

  broadcastLobby() { this.broadcast({ t: 'lobby', code: this.code, players: this.players, danger: this.danger }); }

  broadcast(msg) {
    for (const conn of this.conns.values()) this.sendTo(conn, msg);
  }

  sendTo(conn, msg) {
    try {
      conn.send(msg);
      if (msg.t === 'snap') {
        const n = JSON.stringify(msg).length;
        this.bytesOut += n;
        this.bytesWindow.push([performance.now(), n]);
      }
    } catch (e) { console.warn('send failed', e); }
  }

  onJoin(conn) {
    const taken = new Set(this.players.map((p) => p.id));
    let id = -1;
    for (let i = 0; i < MAX_PLAYERS; i++) if (!taken.has(i)) { id = i; break; }
    if (this.world || id < 0) {
      // Reconnect into a running game is not supported in v1.
      conn.send({ t: 'full', msg: this.world ? 'That game has already started.' : 'That game is full (4 players).' });
      setTimeout(() => conn.close(), 500);
      return;
    }
    this.conns.set(id, conn);
    this.lastHeard.set(id, performance.now());
    this.players.push({ id, name: `Player ${id + 1}`, char: 'spike', ready: false, connected: true });
    this.players.sort((a, b) => a.id - b.id);
    conn.onData((m) => this.onMsg(id, m));
    conn.onClose(() => this.onLeave(id));
    conn.send({ t: 'welcome', id, code: this.code });
    this.broadcastLobby();
  }

  onLeave(pid) {
    if (!this.conns.has(pid)) return;
    this.conns.delete(pid);
    delete this.inputs[pid];
    if (!this.world) {
      this.players = this.players.filter((p) => p.id !== pid);
      this.broadcastLobby();
      return;
    }
    const lp = this.players.find((p) => p.id === pid);
    if (lp) lp.connected = false;
    const wp = this.world.players[pid];
    if (wp) { wp.connected = false; wp.input = { mx: 0, my: 0, ab: wp.input.ab, dr: wp.input.dr || 0 }; }
    // Tell everyone (the renderer/HUD show a banner); events normally come from step(), so add it by hand.
    this.onEvents([{ type: 'left', pid, name: lp?.name || wp?.name || 'A mate', k: this.world.tick }]);
    this.dropTimers.set(pid, DROP_AFTER_S);
  }

  onMsg(pid, m) {
    this.lastHeard.set(pid, performance.now());
    const lp = this.players.find((p) => p.id === pid);
    switch (m.t) {
      case 'hello':
        if (lp) { lp.name = this.uniqueName(String(m.name || lp.name).slice(0, 16), pid); if (m.char) lp.char = m.char; }
        this.broadcastLobby();
        break;
      case 'pick':
        if (lp && !this.world) { lp.char = m.char; this.broadcastLobby(); }
        break;
      case 'ready':
        if (lp && !this.world) { lp.ready = !!m.value; this.broadcastLobby(); }
        break;
      case 'in':
        if (this.world && this.world.players[pid]) {
          this.inputs[pid] = { mx: +m.mx || 0, my: +m.my || 0, ab: m.ab | 0, dr: m.dr | 0 };
          this.world.players[pid].lastSeq = m.seq | 0;
        }
        break;
      case 'shop':
        if (this.world) {
          const res = applyShopOp(this.world, pid, m.op);
          this.sendMe(pid, res);
          this.meDirty = true;
        }
        break;
      case 'ping':
        this.sendTo(this.conns.get(pid), { t: 'pong', c: m.c });
        break;
      default:
    }
  }

  /** Two mates with the same name get "Rex 2" etc., so the scoreboard stays readable. */
  uniqueName(name, pid) {
    let n = name || 'Rex', k = 2;
    while (this.players.some((p) => p.id !== pid && p.name === n)) n = `${name} ${k++}`;
    return n;
  }

  setName(name) { this.players[0].name = String(name).slice(0, 16); this.broadcastLobby(); }
  pick(char) { if (!this.world) { this.players[0].char = char; this.broadcastLobby(); } }
  setReady() {}
  /** Host picks the danger level (lobby only); mates see it read-only. */
  setDanger(d) { if (!this.world) { this.danger = clampDanger(d); this.broadcastLobby(); } }

  startRun() {
    const seed = this.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.names = Object.fromEntries(this.players.map((p) => [p.id, p.name]));
    // Players are placed by id; the world array must be indexable by id.
    const list = [];
    const maxId = Math.max(...this.players.map((p) => p.id));
    for (let i = 0; i <= maxId; i++) {
      const lp = this.players.find((p) => p.id === i);
      list.push(lp ? { id: i, name: lp.name, char: lp.char } : { id: i, name: '-', char: 'spike', gone: true });
    }
    this.world = createWorld({ seed, players: list, startWave: this.startWave, danger: this.danger });
    for (const p of list) if (p.gone) removePlayer(this.world, p.id);
    this.acc = 0;
    this.localEvents = [];
    this.netEvents = [];
    this.broadcast({ t: 'start', seed, danger: this.danger, players: this.players.map((p) => ({ id: p.id, name: p.name, char: p.char })) });
    for (const pid of this.conns.keys()) this.sendMe(pid);
  }

  playAgain() {
    this.world = null;
    this.state = 'lobby';
    for (const p of this.players) p.ready = p.id === 0;
    this.players = this.players.filter((p) => p.connected);
    this.broadcast({ t: 'again' });
    this.broadcastLobby();
  }

  leave() {
    this.broadcast({ t: 'bye' });
    this.transport?.close();
  }

  // ---- run ----

  setInput(inp) { this.localInput = inp; }

  shopOp(op) {
    if (!this.world) return { ok: false };
    const res = applyShopOp(this.world, 0, op);
    this.meDirty = true;
    return res;
  }

  me() { return this.world ? privateView(this.world, this.myId) : null; }

  sendMe(pid, res) {
    const conn = this.conns.get(pid);
    if (conn && this.world) this.sendTo(conn, { t: 'me', d: privateView(this.world, pid), res: res || null });
  }

  /** A closed tab doesn't always send a goodbye (and WebRTC can take long to notice), so drop silent peers. */
  checkSilent() {
    const now = performance.now();
    for (const pid of [...this.conns.keys()]) {
      if (now - (this.lastHeard.get(pid) || now) > SILENT_AFTER_MS) {
        try { this.conns.get(pid).close(); } catch (e) { /* already gone */ }
        this.onLeave(pid);
      }
    }
  }

  update(dtMs) {
    this.silentT = (this.silentT || 0) + dtMs;
    if (this.silentT > 1000) { this.silentT = 0; this.checkSilent(); }
    const w = this.world;
    if (!w) return;
    for (const [pid, t] of this.dropTimers) {
      const left = t - dtMs / 1000;
      if (left <= 0) { this.dropTimers.delete(pid); removePlayer(w, pid); this.players = this.players.filter((p) => p.id !== pid); }
      else this.dropTimers.set(pid, left);
    }
    this.acc += (Math.min(dtMs, 250) / 1000) * this.speed;
    let steps = 0;
    const maxSteps = 6 * Math.max(1, this.speed);
    while (this.acc >= DT && steps < maxSteps) {
      this.acc -= DT;
      steps++;
      const inputs = { ...this.inputs, [this.myId]: this.localInput };
      const t0 = performance.now();
      const evs = step(w, inputs, DT);
      this.stepMs = this.stepMs * 0.95 + (performance.now() - t0) * 0.05;
      this.onEvents(evs);
      if (w.tick % SNAP_EVERY === 0) this.sendSnap();
      if (w.tick % ME_EVERY === 0 || this.meDirty) { this.meDirty = false; for (const pid of this.conns.keys()) this.sendMe(pid); }
    }
    if (steps >= maxSteps) this.acc = 0;
  }

  onEvents(evs) {
    if (!evs.length) return;
    for (const e of evs) this.localEvents.push(e);
    if (this.conns.size) for (const e of evs) this.netEvents.push(e);
    if (this.localEvents.length > 600) this.localEvents.splice(0, this.localEvents.length - 600);
    const w = this.world;
    if (w.phase !== this.lastPhase) {
      this.lastPhase = w.phase;
      this.sendSnap();
      for (const pid of this.conns.keys()) this.sendMe(pid);
    }
  }

  sendSnap() {
    if (!this.conns.size) return;
    const snap = encodeSnap(this.world);
    snap.ev = filterEvents(this.netEvents);
    this.netEvents = [];
    this.broadcast(snap);
  }

  view() {
    const w = this.world;
    if (!w) return null;
    if (this.cachedTick !== w.tick || !this.cachedView) {
      this.cachedView = decodeSnap(encodeSnap(w), this.names);
      this.cachedTick = w.tick;
    }
    return this.cachedView;
  }

  takeEvents() {
    const e = this.localEvents;
    this.localEvents = [];
    return e;
  }

  netStats() {
    const now = performance.now();
    while (this.bytesWindow.length && now - this.bytesWindow[0][0] > 1000) this.bytesWindow.shift();
    const perSec = this.bytesWindow.reduce((s, x) => s + x[1], 0);
    return { role: 'host', clients: this.conns.size, kbps: +(perSec / 1024).toFixed(1), stepMs: +this.stepMs.toFixed(2) };
  }

  // ---- debug ----
  skipWave() { if (this.world) this.onEvents(skipWave(this.world)); }
  skipToShop() { this.skipWave(); }
}
