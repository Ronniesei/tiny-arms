// The game simulation: createWorld() and step(). Pure JS: no Phaser, no DOM, no Math.random, no Date.
// step() returns this tick's events; renderer, audio and network consume those.

import { BALANCE } from '../data/balance.js';
import { WAVES } from '../data/waves.js';
import { clampDanger } from '../data/danger.js';
import { createRng } from './rng.js';
import { SpatialHash } from './spatial.js';
import { createPlayer, emit } from './entities.js';
import { recomputeStats } from './stats.js';
import { openShop, autoLoadout } from './shop.js';
import { collectLeftovers, openCrates, autoResolveAll } from './crates.js';
import { payHarvest } from './systems/pickups.js';
import { scoreboard } from './score.js';
import * as movement from './systems/movement.js';
import * as abilities from './systems/abilities.js';
import * as waves from './systems/waves.js';
import * as enemies from './systems/enemies.js';
import * as status from './systems/status.js';
import * as weapons from './systems/weapons.js';
import * as summons from './systems/summons.js';
import * as projectiles from './systems/projectiles.js';
import * as shots from './systems/shots.js';
import * as hazards from './systems/hazards.js';
import * as pickups from './systems/pickups.js';
import * as downed from './systems/downed.js';

/**
 * @param {{seed?:number, players:{id:number,name?:string,char:string}[], startWave?:number, danger?:number}} opts
 *   danger: index into DANGER (src/data/danger.js), 0 Chill .. 3 Extinction; default 1 (Normal).
 */
export function createWorld(opts) {
  const seed = (opts.seed ?? 1) >>> 0;
  const w = {
    seed, rng: createRng(seed), tick: 0, time: 0,
    phase: 'wave', wave: 1, waveTime: 0, waveDur: 0, shopTime: 0,
    players: [], enemies: [], projectiles: [], shots: [], pickups: [], hazards: [], summons: [], marks: [],
    nextId: 1, events: [], bag: 0, activeCount: 1, dir: null, bossDead: false, result: null,
    danger: clampDanger(opts.danger),
    grid: new SpatialHash(80),
  };
  for (const p of opts.players) {
    const pl = createPlayer(w, p);
    w.players.push(pl);
    recomputeStats(pl);
    pl.hp = pl.stats.maxHp;
  }
  if ((opts.startWave || 1) > 1) autoLoadout(w, opts.startWave);
  startWave(w, opts.startWave || 1);
  return w;
}

function placePlayers(w) {
  const { w: AW, h: AH } = BALANCE.arena;
  const list = w.players.filter((p) => !p.gone);
  list.forEach((p, i) => {
    const a = (i / Math.max(1, list.length)) * Math.PI * 2 - Math.PI / 2;
    const d = list.length > 1 ? 70 : 0;
    p.x = AW / 2 + Math.cos(a) * d;
    p.y = AH / 2 + Math.sin(a) * d;
  });
}

export function startWave(w, n) {
  w.wave = n;
  w.phase = 'wave';
  w.waveTime = 0;
  w.waveDur = WAVES[n - 1].dur;
  w.activeCount = w.players.filter((p) => !p.gone).length;
  w.enemies = []; w.projectiles = []; w.shots = []; w.hazards = []; w.summons = []; w.marks = [];
  for (const p of w.players) {
    if (p.gone) continue;
    recomputeStats(p);
    p.score.amberMark = p.score.amber; // amber earned this wave = score.amber now minus this
    p.downed = false;
    p.reviveT = 0;
    p.hp = p.stats.maxHp;
    p.mana = Math.max(p.mana, p.stats.maxMana * 0.5);
    p.abState = null;
    p.abCd = 0;
    p.rollT = 0;
    p.rollCd = 0;
    p.iframes = 1;
    p.ready = false;
    for (const wpn of p.weapons) wpn.cd = 0.4;
  }
  placePlayers(w);
  waves.begin(w);
  emit(w, { type: 'waveStart', wave: n });
}

export function endWave(w) {
  emit(w, { type: 'waveEnd', wave: w.wave });
  // Per-weapon damage of the wave just played, for the shop (Brotato shows it after every wave).
  for (const p of w.players) {
    for (const rec of Object.values(p.score.byWeapon || {})) { rec.last = rec.wave || 0; rec.wave = 0; }
    p.score.lastWaveDealt = p.score.waveDealt || 0;
    p.score.waveDealt = 0;
  }
  collectLeftovers(w); // loot crates still on the ground go to the nearest player
  // Uncollected amber goes into the bag and is paid out over the next wave.
  for (const pk of w.pickups) if (pk.kind === 'amber' && !pk.dead) w.bag += pk.v;
  w.pickups = [];
  w.enemies = []; w.projectiles = []; w.shots = []; w.hazards = []; w.summons = []; w.marks = [];
  for (const p of w.players) {
    if (p.gone) continue;
    payHarvest(w, p);
    p.score.lastWaveAmber = p.score.amber - (p.score.amberMark ?? p.score.amber); // pickups + Harvesting
  }
  if (w.wave >= BALANCE.waves.count) { endRun(w, true); return; }
  w.phase = 'shop';
  w.shopTime = BALANCE.shop.time;
  openCrates(w); // every crate picked up this wave becomes an offer at the top of that player's shop
  for (const p of w.players) if (!p.gone) openShop(w, p);
}

export function endRun(w, win) {
  w.phase = 'end';
  w.result = { win, wave: w.wave, danger: w.danger ?? 1, ...scoreboard(w) };
  emit(w, { type: 'runEnd', win });
}

function stepWave(w, inputs, dt) {
  w.time += dt;
  w.waveTime += dt;
  for (const p of w.players) {
    const inp = inputs && inputs[p.id];
    if (inp) p.input = inp;
  }
  movement.update(w, dt);

  w.grid.clear();
  for (const e of w.enemies) if (!e.dead) w.grid.insert(e);

  abilities.update(w, dt);
  waves.update(w, dt);
  enemies.update(w, dt);

  // Re-grid after movement so hits use current positions.
  w.grid.clear();
  for (const e of w.enemies) if (!e.dead) w.grid.insert(e);

  status.update(w, dt);
  weapons.update(w, dt);
  summons.update(w, dt);
  projectiles.update(w, dt);
  shots.update(w, dt);
  hazards.update(w, dt);
  pickups.update(w, dt);
  downed.update(w, dt);

  compact(w);

  const present = w.players.filter((p) => !p.gone);
  if (present.length > 0 && present.every((p) => p.downed)) { endRun(w, false); return; }
  const W = WAVES[w.wave - 1];
  if (W.dur > 0 && w.waveTime >= w.waveDur) endWave(w);
  else if (W.dur === 0 && w.bossDead) endWave(w);
}

function compact(w) {
  for (const key of ['enemies', 'projectiles', 'shots', 'pickups', 'hazards', 'summons']) {
    const a = w[key];
    let j = 0;
    for (let i = 0; i < a.length; i++) if (!a[i].dead) a[j++] = a[i];
    a.length = j;
  }
}

function stepShop(w, dt) {
  // Solo shops have no timer (as in Brotato); co-op shops count down so nobody waits forever.
  if (w.players.filter((p) => !p.gone).length > 1) w.shopTime -= dt;
  const present = w.players.filter((p) => !p.gone && p.connected);
  // Everyone else is ready: don't keep them waiting for the full timer.
  if (present.length > 1 && present.filter((p) => !p.ready).length === 1) w.shopTime = Math.min(w.shopTime, BALANCE.coop.lastReadyShopTime);
  if (w.shopTime <= 0 || (present.length > 0 && present.every((p) => p.ready))) {
    autoResolveAll(w); // crates nobody opened are taken, so the timer never costs a free item
    startWave(w, w.wave + 1);
  }
}

/**
 * Advance the world by dt seconds (the host calls this at a fixed 1/60 s).
 * @param {object} w
 * @param {Object<number, {mx:number, my:number, ab:number}>} inputs latest input per player id
 * @param {number} dt
 * @returns {object[]} events emitted this tick
 */
export function step(w, inputs, dt) {
  w.events = [];
  w.tick++;
  if (w.phase === 'wave') stepWave(w, inputs, dt);
  else if (w.phase === 'shop') stepShop(w, dt);
  return w.events;
}

// ---- Test / debug helpers ----

/** End the current wave now (debug). */
export function skipWave(w) {
  if (w.phase === 'wave') { w.waveTime = w.waveDur; w.events = []; endWave(w); return w.events; }
  return [];
}

/** Mark a player as having left; they are removed from play. */
export function removePlayer(w, pid) {
  const p = w.players[pid];
  if (!p) return;
  p.gone = true;
  p.connected = false;
  p.downed = false;
}
