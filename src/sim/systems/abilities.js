// Mana abilities (one per character, on Space). Numbers live in src/data/characters.js.
// input.ab is a press counter: each increase is one press. A press that can't cast is dropped.
// Spell Echo (specials.spellEcho): a cast schedules a second copy SPECIAL_RULES.spellEcho.delay s later at `strength` of the
// ability (castEcho below). While the copy runs, `castScale` shrinks everything that scales with Ability Power; an ability can
// also define its own `echo(w, p, ab, k)` when "half strength" needs more than that (Tail Whirl).
//
// Dash's Stampede is a charge: the cast sets p.abState = {id:'stampede', t, duration, speed, dx, dy, px, py, hit:[], scale}
// and movement.js moves the player along (dx, dy) at `speed` px/s for `duration` s (it advances abState.t). This file does
// the rest: it trampling-hits every enemy along the path once per tick (segment from the last position to the current one)
// and ends the state. Lucky's Jackpot rolls one of four prizes with the world RNG; Hot Streak is a +Damage buff in
// p.abState that is mirrored into p.stats.damage every tick (syncBuffs), so recomputeStats cannot lose or double it.

import { CHARACTERS } from '../../data/characters.js';
import { ENEMIES } from '../../data/enemies.js';
import { SPECIAL_RULES } from '../../data/items.js';
import { clampToArena, emit, spawnHazard, spawnPickup } from '../entities.js';
import { abilityCooldown, abilityCost, abilityMult } from '../stats.js';
import { range, weighted } from '../rng.js';
import { hitEnemy, healPlayer } from './damage.js';
import { applyBurn } from './status.js';
import { addFuse } from '../hooks.js';
import { rollDir } from './movement.js';

/** 1 normally; the Spell Echo copy runs with this < 1 (strength of the copy). */
let castScale = 1;

/** Ability damage grows with Ability Power and gently with the wave so it stays useful late. */
export function abilityDamage(w, p, base) {
  return base * abilityMult(p.stats) * castScale * (1 + 0.12 * Math.max(0, w.wave - 1));
}

function enemiesNear(w, x, y, r) {
  return w.grid.query(x, y, r).filter((e) => !e.dead && !ENEMIES[e.type].neutral);
}

/** Densest enemy cluster within `range` of the player: returns {x, y, n} or null. */
export function densestCluster(w, p, range, radius) {
  let best = null;
  for (const e of w.enemies) {
    if (e.dead || ENEMIES[e.type].neutral) continue;
    if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 > range * range) continue;
    const n = enemiesNear(w, e.x, e.y, radius).length + (e.elite || e.boss ? 4 : 0);
    if (!best || n > best.n) best = { x: e.x, y: e.y, n };
  }
  return best;
}

/** id -> { canCast?(w, p, ab) => bool, cast(w, p, ab), tick?(w, p, ab, dt) } */
export const ABILITIES = {
  roar: {
    cast(w, p, ab) {
      const m = abilityMult(p.stats) * castScale;
      for (const e of enemiesNear(w, p.x, p.y, ab.radius)) {
        e.stun = Math.max(e.stun, ab.stun * Math.sqrt(m) * (e.boss ? 0.3 : e.elite ? 0.5 : 1));
        if (ab.damage) hitEnemy(w, e, abilityDamage(w, p, ab.damage), { pid: p.id, source: 'a' });
        e.target = p.id;
        e.targetT = ab.taunt;
        e.tele = null;
        if (e.st === 'windup' || e.st === 'charge') e.st = 'move';
      }
      p.tauntT = ab.taunt;
    },
  },

  healing_pulse: {
    cast(w, p, ab) {
      const m = abilityMult(p.stats) * castScale;
      for (const q of w.players) {
        if (q.gone) continue;
        if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 > ab.radius * ab.radius) continue;
        q.reviveBoostT = ab.boostTime;
        if (!q.downed) healPlayer(w, q, Math.max(1, Math.round(q.stats.maxHp * ab.healPct * m)), p.id);
      }
      // The pulse also blasts enemies back, so Fern has a panic button when playing solo.
      for (const e of enemiesNear(w, p.x, p.y, ab.radius * 0.8)) {
        hitEnemy(w, e, abilityDamage(w, p, ab.damage), { pid: p.id, kb: ab.knockback, kbAngle: Math.atan2(e.y - p.y, e.x - p.x), source: 'a' });
      }
    },
  },

  tail_whirl: {
    cast(w, p, ab) {
      p.abState = { id: 'tail_whirl', t: 0, next: 0, speedMult: 1.1 };
    },
    // Spell Echo: the copy is a train of weaker pulses around you (see hooks.js, fuse kind 'whirl').
    echo(w, p, ab, k) {
      addFuse(w, {
        kind: 'whirl', t: 0, every: ab.interval, left: Math.round(ab.duration / ab.interval), pid: p.id, r: ab.radius, kb: ab.knockback,
        dmg: (abilityDamage(w, p, ab.damage) + p.stats.meleeDamage * 0.5) * k,
      });
    },
    tick(w, p, ab, dt) {
      const s = p.abState;
      s.t += dt;
      if (s.t >= s.next) {
        s.next += ab.interval;
        const dmg = abilityDamage(w, p, ab.damage) + p.stats.meleeDamage * 0.5;
        for (const e of w.grid.query(p.x, p.y, ab.radius)) {
          if (e.dead) continue;
          hitEnemy(w, e, dmg, { pid: p.id, kb: ab.knockback, kbAngle: Math.atan2(e.y - p.y, e.x - p.x), source: 'a' });
        }
      }
      if (s.t >= ab.duration) p.abState = null;
    },
  },

  meteor_call: {
    canCast(w, p, ab) {
      return !!densestCluster(w, p, ab.range, ab.radius);
    },
    cast(w, p, ab) {
      const c = densestCluster(w, p, ab.range, ab.radius);
      const m = abilityMult(p.stats) * castScale;
      spawnHazard(w, {
        kind: 'meteor', owner: 'player', pid: p.id, x: c.x, y: c.y, r: ab.radius * Math.min(1.5, Math.sqrt(m)),
        delay: ab.delay, dur: 0.35, dmg: abilityDamage(w, p, ab.damage),
        burnTime: ab.burnTime, burnDps: abilityDamage(w, p, ab.burnDps),
      });
    },
  },

  // ---- Pip, Goldie, Bolt, Ash ----
  // Overdrive and Overclock are timed buffs kept in p.abState (like Tail Whirl): `as` is read by stats.js weaponCooldown
  // (stats.abilityAs, kept fresh below), `rate` by summons.js. Spell Echo's copy only refreshes the timer of the running buff.

  overdrive: {
    cast(w, p, ab) {
      p.abState = { id: 'overdrive', t: 0, as: ab.attackSpeed };
      p.stats.abilityAs = ab.attackSpeed;
    },
    echo(w, p, ab) { if (p.abState?.id === 'overdrive') p.abState.t = 0; },
    tick(w, p, ab, dt) {
      const s = p.abState;
      s.t += dt;
      if (s.t >= ab.duration) p.abState = null;
    },
  },

  // Every loose amber pickup flies to the caster. Pickups already flying to someone (a mate) are left alone.
  gold_rush: {
    canCast(w) {
      for (const pk of w.pickups) if (!pk.dead && pk.kind === 'amber' && pk.magnet < 0) return true;
      return false;
    },
    cast(w, p, ab) {
      for (const pk of w.pickups) {
        if (pk.dead || pk.kind !== 'amber' || pk.magnet >= 0) continue;
        pk.magnet = p.id;
        pk.speed = Math.max(pk.speed || 0, ab.pullSpeed);
      }
    },
  },

  overclock: {
    cast(w, p, ab) { p.abState = { id: 'overclock', t: 0, rate: ab.rate }; },
    echo(w, p, ab) { if (p.abState?.id === 'overclock') p.abState.t = 0; },
    tick(w, p, ab, dt) {
      const s = p.abState;
      s.t += dt;
      if (s.t >= ab.duration) p.abState = null;
    },
  },

  // A ring of fire around the caster: damage plus a burn on everything inside.
  eruption: {
    cast(w, p, ab) {
      const dmg = abilityDamage(w, p, ab.damage), dps = abilityDamage(w, p, ab.burnDps);
      for (const e of enemiesNear(w, p.x, p.y, ab.radius)) {
        hitEnemy(w, e, dmg, { pid: p.id, kb: ab.knockback, kbAngle: Math.atan2(e.y - p.y, e.x - p.x), source: 'a' });
        applyBurn(e, dps, ab.burnTime, p.id);
      }
    },
  },

  // ---- Dash, Lucky ----

  // A charge in the move direction (facing when standing still). movement.js does the moving and counts abState.t; the
  // player is unhittable for the charge (+ a short grace); every enemy the path touches is hit once and shoved sideways.
  stampede: {
    cast(w, p, ab) { startStampede(w, p, ab, castScale); },
    // Spell Echo: a second, weaker charge (only when the first one is over).
    echo(w, p, ab, k) { if (!p.abState) startStampede(w, p, ab, k); },
    tick(w, p, ab) {
      const s = p.abState;
      trample(w, p, ab, s);
      s.px = p.x; s.py = p.y;
      if (s.t >= s.duration - 1e-6) p.abState = null;
    },
  },

  // One of four prizes, picked with the world RNG (jackpotWeights). Only Hot Streak keeps a state (the damage buff).
  jackpot: {
    cast(w, p, ab) {
      const prize = weighted(w.rng, jackpotWeights(ab, p.stats.luck));
      JACKPOT_PRIZES[prize](w, p, ab);
      // r = blast radius (coin), t = seconds the effect lasts (lucky: safety, streak: buff); the renderer shows the prize.
      emit(w, {
        type: 'jackpot', pid: p.id, o: prize, x: Math.round(p.x), y: Math.round(p.y),
        r: prize === 'coin' ? ab.radius : 0, t: prize === 'lucky' ? ab.invuln : prize === 'streak' ? ab.streakTime : 0,
      });
    },
    tick(w, p, ab, dt) {
      const s = p.abState;
      s.t += dt;
      if (s.t >= s.time) p.abState = null;
    },
  },
};

const TAU = Math.PI * 2;

/** Squared distance from the point (px, py) to the segment a-b. */
function segDist2(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / l2)) : 0;
  const dx = px - (ax + abx * t), dy = py - (ay + aby * t);
  return dx * dx + dy * dy;
}

/** Begin a Stampede charge from where the player stands. `scale` < 1 is a Spell Echo copy (damage only). */
function startStampede(w, p, ab, scale) {
  const [dx, dy] = rollDir(p.input.mx, p.input.my, p.facing);
  const end = { x: p.x + dx * ab.distance, y: p.y + dy * ab.distance, r: p.r };
  clampToArena(end); // walls: movement.js clamps every step, which ends up at the same place as clamping the end point
  p.abState = { id: 'stampede', t: 0, duration: ab.duration, speed: ab.distance / ab.duration, dx, dy, px: p.x, py: p.y, hit: [], scale };
  p.iframes = Math.max(p.iframes, ab.duration + (ab.grace || 0));
  p.rollT = 0; // a roll in progress gives way to the charge
  if (dx > 0.05) p.facing = 1; else if (dx < -0.05) p.facing = -1;
  emit(w, { type: 'stampede', pid: p.id, x: Math.round(p.x), y: Math.round(p.y), x2: Math.round(end.x), y2: Math.round(end.y), a: +Math.atan2(dy, dx).toFixed(2) });
}

/** Hit every enemy the player's body swept over since the last tick, once each, knocking it off the path. */
function trample(w, p, ab, s) {
  const ax = s.px, ay = s.py, bx = p.x, by = p.y;
  const reach = p.r + 16;
  const len = Math.hypot(bx - ax, by - ay);
  const dmg = abilityDamage(w, p, ab.damage) * s.scale;
  for (const e of w.grid.query((ax + bx) / 2, (ay + by) / 2, len / 2 + reach)) {
    if (e.dead || ENEMIES[e.type].neutral || s.hit.includes(e.id)) continue;
    if (segDist2(e.x, e.y, ax, ay, bx, by) > (reach + e.r) ** 2) continue;
    s.hit.push(e.id);
    const side = (e.x - bx) * -s.dy + (e.y - by) * s.dx >= 0 ? 1 : -1; // which side of the path the enemy is on
    const kbAngle = Math.atan2(side * s.dx * 0.85 + s.dy * 0.5, -side * s.dy * 0.85 + s.dx * 0.5); // mostly sideways, a bit forward
    hitEnemy(w, e, dmg, { pid: p.id, kb: ab.knockback, kbAngle, source: 'a' });
  }
}

/** Jackpot odds as [prize, weight] pairs, in a fixed order. Lucky Break and Hot Streak get likelier with Luck. */
export function jackpotWeights(ab, luck) {
  const o = ab.odds, bonus = Math.max(0, luck || 0) * ab.luckOdds;
  const up = (base) => Math.max(base, Math.min(ab.luckOddsMax, base + bonus));
  return [['coin', o.coin], ['lucky', up(o.lucky)], ['amber', o.amber], ['streak', up(o.streak)]];
}

const JACKPOT_PRIZES = {
  // Coin Bomb: a big blast around you.
  coin(w, p, ab) {
    const dmg = abilityDamage(w, p, ab.damage);
    for (const e of enemiesNear(w, p.x, p.y, ab.radius)) {
      hitEnemy(w, e, dmg, { pid: p.id, kb: ab.knockback, kbAngle: Math.atan2(e.y - p.y, e.x - p.x), source: 'a' });
    }
  },
  // Lucky Break: back to full health and unhittable for a moment.
  lucky(w, p, ab) {
    healPlayer(w, p, Math.max(1, Math.round((p.stats.maxHp - p.hp) * castScale)), p.id);
    p.iframes = Math.max(p.iframes, ab.invuln * castScale);
  },
  // Amber Shower: amberBase + amberPerWave x wave pickups of 1 amber, scattered around you.
  amber(w, p, ab) {
    const n = Math.max(1, Math.round((ab.amberBase + ab.amberPerWave * w.wave) * castScale));
    for (let i = 0; i < n; i++) {
      const a = range(w.rng, 0, TAU), d = range(w.rng, 30, ab.amberRadius);
      const at = { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 10 };
      clampToArena(at);
      const first = w.nextId;
      const pk = spawnPickup(w, 'amber', at.x, at.y, 1);
      if (pk.id >= first) { pk.vx = Math.cos(a) * 90; pk.vy = Math.sin(a) * 90; } // a fresh pickup pops outward a little
    }
  },
  // Hot Streak: +Damage % for a few seconds (syncBuffs keeps stats.damage right while it runs).
  streak(w, p, ab) {
    const dmg = ab.streak * castScale;
    // A Spell Echo copy landing on a running Hot Streak refreshes the timer; it never weakens the buff.
    if (p.abState?.id === 'jackpot') { p.abState.t = 0; p.abState.dmg = Math.max(p.abState.dmg, dmg); return; }
    p.abState = { id: 'jackpot', t: 0, time: ab.streakTime, dmg };
  },
};

/** Per-tick mirror of ability buffs into p.stats (recomputeStats rebuilds stats and knows nothing of Hot Streak). */
function syncBuffs(p) {
  const st = p.abState;
  p.stats.abilityAs = st?.as || 0; // Overdrive's attack speed lasts exactly as long as the buff
  const want = st?.id === 'jackpot' ? st.dmg : 0; // Hot Streak's damage
  const have = p.stats.streakDmg || 0;
  if (want !== have) { p.stats.damage += want - have; p.stats.streakDmg = want; }
}

export function tryCast(w, p) {
  const ab = CHARACTERS[p.char].ability;
  const impl = ABILITIES[ab.id];
  const cost = abilityCost(p, ab.cost);
  if (!impl || p.downed || p.gone || p.abCd > 0 || p.mana < cost || p.abState) return false;
  if (impl.canCast && !impl.canCast(w, p, ab)) return false;
  p.mana -= cost;
  p.abCd = abilityCooldown(p, ab.cooldown);
  p.score.casts++;
  impl.cast(w, p, ab);
  emit(w, { type: 'cast', pid: p.id, ab: ab.id, x: Math.round(p.x), y: Math.round(p.y) });
  if (p.specials?.spellEcho > 0) addFuse(w, { kind: 'echo', t: SPECIAL_RULES.spellEcho.delay, pid: p.id });
  return true;
}

/** Spell Echo: the second, weaker copy of the player's ability (no mana, no cooldown, no score). */
export function castEcho(w, p) {
  const ab = CHARACTERS[p.char].ability;
  const impl = ABILITIES[ab.id];
  if (!impl || p.downed || p.gone) return false;
  if (impl.canCast && !impl.canCast(w, p, ab)) return false;
  const k = SPECIAL_RULES.spellEcho.strength;
  if (impl.echo) impl.echo(w, p, ab, k);
  else {
    castScale = k;
    try { impl.cast(w, p, ab); } finally { castScale = 1; }
  }
  emit(w, { type: 'cast', pid: p.id, ab: ab.id, x: Math.round(p.x), y: Math.round(p.y) });
  return true;
}

export function update(w, dt) {
  for (const p of w.players) {
    if (p.gone) continue;
    if (p.abSeen < 0) p.abSeen = p.input.ab;
    const pressed = p.input.ab > p.abSeen;
    p.abSeen = p.input.ab;
    if (p.downed) { p.abState = null; syncBuffs(p); continue; }
    if (pressed && !tryCast(w, p)) emit(w, { type: 'castFail', pid: p.id });
    if (p.abState) {
      const ab = CHARACTERS[p.char].ability;
      ABILITIES[p.abState.id]?.tick?.(w, p, ab, dt);
    }
    syncBuffs(p);
  }
}
