// Mana abilities (one per character, on Space). Numbers live in src/data/characters.js.
// input.ab is a press counter: each increase is one press. A press that can't cast is dropped.

import { CHARACTERS } from '../../data/characters.js';
import { ENEMIES } from '../../data/enemies.js';
import { emit, spawnHazard } from '../entities.js';
import { abilityCooldown, abilityCost, abilityMult } from '../stats.js';
import { hitEnemy, healPlayer } from './damage.js';

/** Ability damage grows with Ability Power and gently with the wave so it stays useful late. */
export function abilityDamage(w, p, base) {
  return base * abilityMult(p.stats) * (1 + 0.12 * Math.max(0, w.wave - 1));
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
      const m = abilityMult(p.stats);
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
      const m = abilityMult(p.stats);
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
      const m = abilityMult(p.stats);
      spawnHazard(w, {
        kind: 'meteor', owner: 'player', pid: p.id, x: c.x, y: c.y, r: ab.radius * Math.min(1.5, Math.sqrt(m)),
        delay: ab.delay, dur: 0.35, dmg: abilityDamage(w, p, ab.damage),
        burnTime: ab.burnTime, burnDps: abilityDamage(w, p, ab.burnDps),
      });
    },
  },
};

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
  return true;
}

export function update(w, dt) {
  for (const p of w.players) {
    if (p.gone) continue;
    if (p.abSeen < 0) p.abSeen = p.input.ab;
    const pressed = p.input.ab > p.abSeen;
    p.abSeen = p.input.ab;
    if (p.downed) { p.abState = null; continue; }
    if (pressed && !tryCast(w, p)) emit(w, { type: 'castFail', pid: p.id });
    if (p.abState) {
      const ab = CHARACTERS[p.char].ability;
      ABILITIES[p.abState.id]?.tick?.(w, p, ab, dt);
    }
  }
}
