// Item effect hooks: the one place where "build-maker" items (src/data/items.js) act when something happens.
//
//   onHit(w, e, p, dmg, o)    after the player p's hit landed on enemy e (damage.js hitEnemy). o = the hit's options.
//                               crit hits: Bloodthirst heals, Chain Spark zaps. melee hits (o.melee): Serrated Tooth bleeds,
//                               Shockwave Club shoves the enemies behind.
//   onKill(w, e, p, hit)      the player p killed e with `hit` = {dmg, wuid}: Mana Leech, Dino Dynamite.
//   onRoll(w, p)              the player started a dodge roll: Boom Boots drops a bomb.
//   update(w, dt)             every wave tick (weapons.update calls it): fuses (bombs, echoes, whirl pulses) and bleeds.
//   endWaveCleanup(w)         the wave ended: drop fuses that never fired.
//
// Rules for effects that hurt enemies: they go through hitEnemy with `pid` (and `wuid` when it is a weapon's damage), so
// scores and the per-weapon damage list stay right. A hit made by an effect carries `secondary: true`, which stops it from
// triggering the on-hit effects again (no loops). Explosions can chain (a blast kills, the kill explodes) but only
// SPECIAL_RULES.dynamite.maxDepth deep. Everything is deterministic: the seeded world RNG only, nothing allocated per tick
// unless an effect actually fires.
//
// Hero trait: Ash's Kindling (onHit) lives here too.
//
// Events used (all already drawn by render/fx.js): explode, hit, heal, beam (the Chain Spark line), cast (Spell Echo).

import { ENEMIES } from '../data/enemies.js';
import { SPECIAL_RULES } from '../data/items.js';
import { emit, spawnHazard } from './entities.js';
import { chance } from './rng.js';
import { hitEnemy, healPlayer } from './systems/damage.js';
import { applyBurn } from './systems/status.js';
import { explode } from './systems/projectiles.js';
import { castEcho } from './systems/abilities.js';

let depth = 0; // re-entrancy guard for chains of item explosions

const alive = (q) => q && !q.dead && !ENEMIES[q.type]?.neutral;

/** Damage of an item explosion: grows with the wave (like abilities) and with the player's Damage %. */
function blastDamage(w, p, base, perWave) {
  return base * (1 + perWave * Math.max(0, w.wave - 1)) * Math.max(0.2, 1 + (p.stats.damage || 0) / 100);
}

// ---- fuses: things that happen a moment later ----

/** Schedule a delayed effect: {kind:'bomb'|'echo'|'whirl', t, pid, ...}. Cleared at wave end. */
export function addFuse(w, f) {
  (w.fuses || (w.fuses = [])).push(f);
}

function fireFuse(w, f) {
  const p = w.players[f.pid];
  if (!p || p.gone) return true;
  if (f.kind === 'bomb') {
    explode(w, f.x, f.y, f.r, f.dmg, { pid: f.pid, source: 'p' });
    return true;
  }
  if (f.kind === 'echo') {
    if (!p.downed) castEcho(w, p);
    return true;
  }
  if (f.kind === 'whirl') { // Spell Echo copy of Tail Whirl: a few weaker pulses around the player
    if (!p.downed) {
      for (const e of w.grid.query(p.x, p.y, f.r)) {
        if (e.dead) continue;
        hitEnemy(w, e, f.dmg, { pid: f.pid, kb: f.kb, kbAngle: Math.atan2(e.y - p.y, e.x - p.x), source: 'a', secondary: true });
      }
    }
    if (--f.left <= 0) return true;
    f.t += f.every;
    return false;
  }
  return true;
}

function updateFuses(w, dt) {
  const list = w.fuses;
  if (!list || !list.length) return;
  let j = 0;
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    f.t -= dt;
    // A pulse train can fire more than once in a long step; the loop keeps it exact.
    let done = false;
    while (f.t <= 0 && !done) done = fireFuse(w, f);
    if (!done) list[j++] = f;
  }
  list.length = j;
}

// ---- bleed (Serrated Tooth) ----

function addBleed(e, dps, pid, wuid) {
  const R = SPECIAL_RULES.bleed;
  const b = e.bleeds || (e.bleeds = []);
  if (b.length >= R.maxStacks) b.shift();
  b.push({ dps, t: R.time, pid, wuid });
}

const BLEED_TICK = 0.5;

function updateBleeds(w, dt) {
  for (const e of w.enemies) {
    const b = e.bleeds;
    if (!b || e.dead) continue;
    let dps = 0, last = null, j = 0;
    for (let i = 0; i < b.length; i++) {
      const s = b[i];
      dps += s.dps; // every stack alive at the start of the tick pays for this tick
      last = s;
      s.t -= dt;
      if (s.t > 0) b[j++] = s;
    }
    b.length = j;
    e.bleedAcc = (e.bleedAcc || 0) + dps * dt;
    e.bleedTick = (e.bleedTick || 0) + dt;
    const over = j === 0;
    if ((e.bleedTick >= BLEED_TICK || over) && last) {
      e.bleedTick = 0;
      const d = Math.floor(e.bleedAcc);
      if (d >= 1) {
        e.bleedAcc -= d;
        hitEnemy(w, e, d, { pid: last.pid, source: 'burn', noLifeSteal: true, wuid: last.wuid, secondary: true });
      }
    }
    if (over) { e.bleeds = null; e.bleedAcc = 0; e.bleedTick = 0; }
  }
}

// ---- on hit ----

function critHeal(w, p, sp) {
  if (p.downed || p.hp >= p.stats.maxHp) return;
  if ((p.critHealAcc || 0) >= SPECIAL_RULES.critHeal.perSec) return; // movement.js drains this by perSec each second
  p.critHealAcc = (p.critHealAcc || 0) + sp.critHeal;
  healPlayer(w, p, sp.critHeal, p.id);
}

/** Chain Spark: each copy zaps one more of the nearest other enemies near e. */
function chainZap(w, e, p, dmg, o, copies) {
  const R = SPECIAL_RULES.chainZap;
  const near = [];
  for (const q of w.grid.query(e.x, e.y, R.radius)) {
    if (q === e || !alive(q)) continue;
    near.push([(q.x - e.x) ** 2 + (q.y - e.y) ** 2, q]);
  }
  near.sort((a, b) => a[0] - b[0]);
  const n = Math.min(near.length, Math.max(1, Math.round(copies)));
  for (let i = 0; i < n; i++) {
    const q = near[i][1];
    emit(w, {
      type: 'beam', pid: p.id, slot: 15, a: +Math.atan2(q.y - e.y, q.x - e.x).toFixed(2),
      x: Math.round(e.x), y: Math.round(e.y - e.r * 0.5), x2: Math.round(q.x), y2: Math.round(q.y - q.r * 0.5), wid: 'chain_spark',
    });
    hitEnemy(w, q, dmg * R.dmgFrac, { pid: p.id, source: 'p', wuid: o.wuid, secondary: true });
  }
}

/** Shockwave Club: the knocked enemy shoves up to 4 enemies behind it (not ones the same swing already hit). */
function shockwave(w, e, p, dmg, o, frac) {
  const R = SPECIAL_RULES.shockwave;
  const a = o.kbAngle ?? Math.atan2(e.y - p.y, e.x - p.x);
  const cx = Math.cos(a), cy = Math.sin(a);
  let n = 0;
  for (const q of w.grid.query(e.x, e.y, R.radius)) {
    if (q === e || !alive(q)) continue;
    if (o.swing && q.swing === o.swing) continue;
    if ((q.x - e.x) * cx + (q.y - e.y) * cy <= 0) continue;
    hitEnemy(w, q, dmg * frac, { pid: p.id, kb: 140, kbAngle: a, source: 'w', wuid: o.wuid, secondary: true });
    if (++n >= 4) break;
  }
}

export function onHit(w, e, p, dmg, o) {
  const sp = p.specials;
  if (!sp) return;
  // Ash's Kindling: a hit (not a burn tick) may set the enemy alight for a share of the hit per second.
  if (p.stats.kindle > 0 && o.source !== 'burn' && e.hp > 0 && chance(w.rng, p.stats.kindle)) {
    applyBurn(e, dmg * p.stats.kindleDps, p.stats.kindleTime, p.id, o.wuid);
  }
  if (o.crit) {
    if (sp.critHeal > 0) critHeal(w, p, sp);
    if (sp.chainZap > 0 && depth < 2) { depth++; chainZap(w, e, p, dmg, o, sp.chainZap); depth--; }
  }
  if (o.melee) {
    if (sp.bleed > 0 && e.hp > 0) addBleed(e, (dmg * sp.bleed) / SPECIAL_RULES.bleed.time, p.id, o.wuid);
    if (sp.shockwave > 0) shockwave(w, e, p, dmg, o, sp.shockwave);
  }
}

// ---- on kill ----

export function onKill(w, e, p, hit) {
  const sp = p.specials;
  if (!sp) return;
  if (sp.killMana > 0) p.mana = Math.min(p.stats.maxMana, p.mana + sp.killMana);
  const R = SPECIAL_RULES.dynamite;
  if (sp.killBoom > 0 && hit && depth < R.maxDepth && chance(w.rng, Math.min(1, sp.killBoom))) {
    depth++;
    explode(w, e.x, e.y, R.radius, hit.dmg * R.dmgFrac, { pid: p.id, source: 'p', wuid: hit.wuid });
    depth--;
  }
}

// ---- on roll ----

export function onRoll(w, p) {
  const sp = p.specials;
  if (!(sp?.rollBomb > 0)) return;
  const R = SPECIAL_RULES.rollBomb;
  const r = R.radius * (1 + (sp.blastSize || 0));
  addFuse(w, { kind: 'bomb', t: R.fuse, x: p.x, y: p.y, pid: p.id, r: R.radius, dmg: blastDamage(w, p, R.dmg, R.perWave) });
  // A visual-only hazard: the renderer draws an amber ring for the fuse (the explosion itself is the fuse above).
  spawnHazard(w, { kind: 'bomb', owner: 'player', pid: p.id, x: p.x, y: p.y, r, delay: R.fuse, dur: 0.05 });
}

// ---- per tick and wave end ----

export function update(w, dt) {
  updateFuses(w, dt);
  updateBleeds(w, dt);
}

/** The wave is over: bombs and echoes that never fired are dropped (enemies and hazards are cleared too). */
export function endWaveCleanup(w) {
  if (w.fuses) w.fuses.length = 0;
  for (const p of w.players) p.critHealAcc = 0;
}
