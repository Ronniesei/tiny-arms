// Area effects with an optional telegraph phase (delay) before they act.
// Hazard fields: {kind, x, y, r, delay, dur, t, owner:'enemy'|'player', pid?, dmg?, dps?, ev?}
// `ev` (optional): an event type emitted as {type: ev, x, y, r} at the moment the hazard fires (e.g. 'slam', 'stomp').
// The renderer draws enemy hazards as red warning areas during their delay.
// Register new kinds in HAZARD_KINDS: { fire?(w, h), tick?(w, h, dt) }.

// Danger 4 and 5 add a meteor shower (see `meteors` in src/data/danger.js): meteorShower() below spawns 'skyfall' hazards
// during waves. Each is a red warning circle (enemy-owned hazard, drawn like any other) that lands SKYFALL.delay s later,
// hurts the players inside, and hurts the enemies inside three times as much (no player gets credit for those kills).
// Events: 'skyWarn' {x, y, r, d} when one is called (the renderer draws the fireball falling for d s), and 'skyfall'
// {x, y, r} when it lands (the hazard's `ev`).

import { dangerOf } from '../../data/danger.js';
import { ENEMIES } from '../../data/enemies.js';
import { hitEnemy, hitPlayer } from './damage.js';
import { clampToArena, emit, spawnHazard } from '../entities.js';
import { next, pick, range } from '../rng.js';

export const SKYFALL = {
  first: 3,        // s: no meteor in the first seconds of a wave (the first one lands no earlier than max(first, every))
  delay: 1.2,      // s of red warning before it lands
  scatter: 120,    // px: lands up to this far from the player it picked
  enemyMult: 3,    // enemies inside take this times the players' damage
  dur: 0.35,       // s the impact flash stays
  kb: 180,         // knockback on enemies hit
};

function playersIn(w, x, y, r) {
  return w.players.filter((p) => !p.gone && !p.downed && (p.x - x) ** 2 + (p.y - y) ** 2 <= (r + p.r * 0.6) ** 2);
}

export const HAZARD_KINDS = {
  // Enemy: telegraphed circle that hits players inside once when the delay ends.
  circle: {
    fire(w, h) { for (const p of playersIn(w, h.x, h.y, h.r)) hitPlayer(w, p, h.dmg, { source: 'hazard' }); },
  },

  // Enemy: ring expanding from r0 (default 0) to r over dur; hits each player once as the ring passes them.
  // The ring moves at (r - r0) / dur px/s: keep that under the player's speed so it can be outrun.
  ring: {
    tick(w, h, dt) {
      const k = Math.min(1, (h.t - h.delay) / h.dur);
      const r0 = h.r0 || 0;
      const cur = r0 + (h.r - r0) * k;
      h.cur = cur;
      h.hitIds ||= [];
      for (const p of w.players) {
        if (p.gone || p.downed || h.hitIds.includes(p.id)) continue;
        const d = Math.hypot(p.x - h.x, p.y - h.y);
        if (Math.abs(d - cur) < (h.band || 24) + p.r * 0.5) {
          h.hitIds.push(p.id);
          hitPlayer(w, p, h.dmg, { source: 'ring' });
        }
      }
    },
  },

  // Enemy side (Danger 4-5): a meteor from the sky. Players inside (circle edge + a little of their body) take h.dmg,
  // enemies inside take SKYFALL.enemyMult times that. Bushes are left alone.
  skyfall: {
    fire(w, h) {
      for (const p of w.players) {
        if (p.gone || p.downed) continue;
        if ((p.x - h.x) ** 2 + (p.y - h.y) ** 2 <= (h.r + p.r * 0.3) ** 2) hitPlayer(w, p, h.dmg, { source: 'meteor' });
      }
      for (const e of w.grid.query(h.x, h.y, h.r)) {
        if (e.dead || ENEMIES[e.type].neutral) continue;
        hitEnemy(w, e, h.dmg * SKYFALL.enemyMult, { kb: SKYFALL.kb, kbAngle: Math.atan2(e.y - h.y, e.x - h.x), source: 'hazard' });
      }
    },
  },

  // Player: meteor impact; damages enemies, then leaves burning ground.
  meteor: {
    fire(w, h) {
      for (const e of w.grid.query(h.x, h.y, h.r)) {
        if (!e.dead) hitEnemy(w, e, h.dmg, { pid: h.pid, kb: 220, kbAngle: Math.atan2(e.y - h.y, e.x - h.x), source: 'a' });
      }
      if (h.burnTime > 0) spawnHazard(w, { kind: 'fire', owner: 'player', pid: h.pid, x: h.x, y: h.y, r: h.r * 0.9, dur: h.burnTime, dps: h.burnDps });
    },
  },

  // Player: burning ground, damages enemies inside 4 times a second.
  fire: {
    tick(w, h, dt) {
      h.acc = (h.acc || 0) + dt;
      if (h.acc < 0.25) return;
      h.acc -= 0.25;
      for (const e of w.grid.query(h.x, h.y, h.r)) {
        if (!e.dead) hitEnemy(w, e, h.dps * 0.25, { pid: h.pid, source: 'burn', noLifeSteal: true, wuid: h.wuid });
      }
    },
  },
};

/**
 * Danger 4-5: call a meteor on a random live player every `every` s of the wave (see SKYFALL for the rest).
 * The next call time is kept on the wave director (w.dir.meteorT, in wave seconds), so every wave starts fresh.
 */
export function meteorShower(w) {
  const M = dangerOf(w).meteors;
  const d = w.dir;
  if (!M || !d || w.phase !== 'wave') return;
  if (d.meteorT === undefined) d.meteorT = Math.max(SKYFALL.first, M.every);
  if (w.waveTime < d.meteorT) return;
  d.meteorT += M.every;
  const live = w.players.filter((p) => !p.gone && !p.downed);
  if (!live.length) return;
  const target = pick(w.rng, live);
  const a = range(w.rng, 0, Math.PI * 2), dist = SKYFALL.scatter * Math.sqrt(next(w.rng));
  const at = { x: target.x + Math.cos(a) * dist, y: target.y + Math.sin(a) * dist, r: 20 };
  clampToArena(at);
  const dmg = M.dmg + M.perWave * Math.max(0, w.wave - 1);
  spawnHazard(w, { kind: 'skyfall', owner: 'enemy', x: at.x, y: at.y, r: M.r, delay: SKYFALL.delay, dur: SKYFALL.dur, dmg, ev: 'skyfall' });
  emit(w, { type: 'skyWarn', x: Math.round(at.x), y: Math.round(at.y), r: M.r, d: SKYFALL.delay });
}

export function update(w, dt) {
  meteorShower(w);
  for (const h of w.hazards) {
    if (h.dead) continue;
    h.t += dt;
    if (h.t < h.delay) continue;
    const kind = HAZARD_KINDS[h.kind];
    if (!h.fired) {
      h.fired = true;
      kind?.fire?.(w, h);
      if (h.ev) emit(w, { type: h.ev, x: Math.round(h.x), y: Math.round(h.y), r: Math.round(h.r) });
    }
    kind?.tick?.(w, h, dt);
    if (h.t >= h.delay + h.dur) h.dead = true;
  }
}
