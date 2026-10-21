// Player-owned projectiles: movement, hits, pierce. Special kinds can register update/onHit/onExpire
// handlers in PROJECTILE_KINDS (keyed by projectile.kind, which is also the sprite key).
//
// Optional projectile fields set by weapon behaviours:
//   burnDps, burnTime   apply a burn to every enemy hit (status.js)
//   noHit               fly without touching anything (lobbed shells)
//   boom                {r, dmg, crit, kb, fireDps?, fireDur?, fireR?} explosion data for lobbed / bouncing bombs
//   wuid                uid of the weapon that fired it; hits, explosions, burns and fire are credited to that weapon
//   Boomerang Bone (kind p_boomerang) uses its own fields: dx/dy (real velocity), leg (0 out, 1 back), dist/maxD, speed, spin,
//                       critChance/critMult (crit is rolled for every hit). Its vx/vy are only the heading sent to clients (spins).
//   bnc                 bounces left (Bouncy Pebbles, set in entities.js spawnProjectile): after its last hit it turns toward a
//                       nearby enemy it has not hit, at 70% damage

import { BALANCE } from '../../data/balance.js';
import { ENEMIES } from '../../data/enemies.js';
import { SPECIAL_RULES } from '../../data/items.js';
import { emit, spawnHazard } from '../entities.js';
import { hitEnemy, rollCrit } from './damage.js';
import { applyBurn } from './status.js';

/**
 * Area damage centred on (x, y). Emits {type:'explode'}. `o.wuid` credits the weapon. Returns the number of enemies hit.
 * A player's explosions (o.pid) grow with Volatile Eggs: +blastSize radius and +blastDmg damage.
 */
export function explode(w, x, y, r, dmg, o = {}) {
  const owner = o.pid >= 0 ? w.players[o.pid] : null;
  const sp = owner?.specials;
  if (sp && (sp.blastSize || sp.blastDmg)) { r *= 1 + (sp.blastSize || 0); dmg *= 1 + (sp.blastDmg || 0); }
  emit(w, { type: 'explode', x: Math.round(x), y: Math.round(y), r: Math.round(r), pid: o.pid ?? -1 });
  let n = 0;
  for (const e of w.grid.query(x, y, r)) {
    if (e.dead) continue;
    n++;
    hitEnemy(w, e, dmg, {
      pid: o.pid, crit: !!o.crit, kb: o.kb || 0, kbAngle: Math.atan2(e.y - y, e.x - x), source: o.source || 'p', wuid: o.wuid,
    });
  }
  return n;
}

/**
 * Burning ground for the player's Volcanic weapons. Nearby fire from the same player is refreshed, not stacked.
 * `wuid` (optional) is the weapon that set it; its fire damage is credited to that weapon.
 */
export function addFire(w, pid, x, y, r, dur, dps, wuid = 0) {
  for (const h of w.hazards) {
    if (h.dead || h.kind !== 'fire' || h.owner !== 'player' || h.pid !== pid) continue;
    if ((h.x - x) ** 2 + (h.y - y) ** 2 < (r * 0.5) ** 2) {
      h.t = 0; h.dur = Math.max(h.dur, dur); h.dps = Math.max(h.dps, dps); h.r = Math.max(h.r, r);
      if (wuid) h.wuid = wuid;
      return h;
    }
  }
  return spawnHazard(w, { kind: 'fire', owner: 'player', pid, x, y, r, dur, dps, wuid });
}

/**
 * Ember Staff: the bolt bursts where it lands. Every other enemy within burst.r takes burst.frac of the hit and catches
 * the bolt's burn, so Ash's fire spreads through a crowd (Ronnie, 21 Oct: the staff fell far behind a melee club).
 */
function fireBurst(w, pr, e0, dmg) {
  const b = pr.burst;
  emit(w, { type: 'explode', x: Math.round(e0.x), y: Math.round(e0.y), r: b.r, pid: pr.pid, fire: 1 });
  for (const e of w.grid.query(e0.x, e0.y, b.r + 30)) {
    if (e === e0 || e.dead || Math.hypot(e.x - e0.x, e.y - e0.y) > b.r + e.r) continue;
    hitEnemy(w, e, dmg * b.frac, { pid: pr.pid, source: 'p', wuid: pr.wuid, secondary: true });
    if (pr.burnDps > 0 && !e.dead) applyBurn(e, pr.burnDps, pr.burnTime || 2, pr.pid, pr.wuid);
  }
}

function detonate(w, pr) {
  if (pr.boomed || !pr.boom) return;
  pr.boomed = true;
  const b = pr.boom;
  explode(w, pr.x, pr.y, b.r, b.dmg, { pid: pr.pid, crit: b.crit, kb: b.kb, wuid: pr.wuid });
  if (b.fireDps > 0) addFire(w, pr.pid, pr.x, pr.y, b.fireR || b.r * 0.8, b.fireDur, b.fireDps, pr.wuid);
}

/** Drop the projectile's claim on its intended target (see pickRangedTarget in weapons.js). */
function releaseTarget(pr) {
  if (pr.tgt) { pr.tgt.pending = Math.max(0, (pr.tgt.pending || 0) - pr.dmg); pr.tgt = null; }
}

/**
 * Bouncy Pebbles: after its last hit on `from`, turn the projectile toward the nearest enemy near `from` that it has not
 * hit yet. Returns false when there is none (then the projectile just ends).
 */
function bounceOff(w, pr, from) {
  const R = SPECIAL_RULES.bounce;
  let best = null, bd = Infinity;
  for (const q of w.grid.query(from.x, from.y, R.radius)) {
    if (q.dead || q === from || pr.hitIds.includes(q.id) || ENEMIES[q.type]?.neutral) continue;
    const d = (q.x - from.x) ** 2 + (q.y - from.y) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  if (!best) return false;
  const speed = Math.hypot(pr.vx, pr.vy) || 600;
  const dx = best.x - pr.x, dy = best.y - pr.y;
  const dist = Math.hypot(dx, dy) || 1;
  pr.vx = (dx / dist) * speed;
  pr.vy = (dy / dist) * speed;
  pr.bnc--;
  pr.dmg *= R.dmgFrac;
  pr.pierce = 0;
  pr.nHit = 0;
  pr.life = Math.max(pr.life, dist / speed + 0.3);
  return true;
}

/** Boomerang Bone turns around: the way back may hit every enemy again. */
function turnBack(pr) {
  pr.leg = 1;
  pr.hitIds.length = 0;
}

const BOOMERANG = { returnMult: 1.2, spin: 14 }; // the way back is 20% faster; spin in rad/s (shown to clients through vx/vy)

/** kind -> { update?(w, proj, dt), onHit?(w, proj, enemy) => boolean (true = handled), onExpire?(w, proj) } */
export const PROJECTILE_KINDS = {
  // Lava Lobber shell: flies to a fixed point, ignoring enemies on the way, then explodes and leaves fire.
  p_lava: {
    onExpire(w, pr) {
      if (pr.tx !== undefined) { pr.x = pr.tx; pr.y = pr.ty; }
      detonate(w, pr);
    },
  },

  // Coconut Bomb: ricochets off the arena walls (pr.bounces times), explodes on the first enemy touched
  // (or when it runs out of bounces / life).
  p_coconut: {
    update(w, pr, dt) {
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      const { w: AW, h: AH } = BALANCE.arena;
      const r = pr.r;
      let hitWall = false;
      if (pr.x < r) { pr.x = r; pr.vx = Math.abs(pr.vx); hitWall = true; }
      else if (pr.x > AW - r) { pr.x = AW - r; pr.vx = -Math.abs(pr.vx); hitWall = true; }
      if (pr.y < r) { pr.y = r; pr.vy = Math.abs(pr.vy); hitWall = true; }
      else if (pr.y > AH - r) { pr.y = AH - r; pr.vy = -Math.abs(pr.vy); hitWall = true; }
      if (hitWall && pr.bounces-- <= 0) pr.life = 0;
    },
    onHit(w, pr) {
      detonate(w, pr);
      pr.dead = true;
      return true;
    },
    onExpire(w, pr) { detonate(w, pr); },
  },

  // Boomerang Bone: straight out to maxD px (or the arena wall), then back: it homes on the owner's current position and ends
  // when it reaches them. Every enemy is hit once per leg (the generic loop has already put it in hitIds; turnBack clears them).
  p_boomerang: {
    update(w, pr, dt) {
      const { w: AW, h: AH } = BALANCE.arena;
      const owner = w.players[pr.pid];
      if (pr.leg === 0) {
        pr.x += pr.dx * dt;
        pr.y += pr.dy * dt;
        pr.dist += pr.speed * dt;
        const m = pr.r;
        if (pr.x < m || pr.x > AW - m || pr.y < m || pr.y > AH - m) {
          pr.x = Math.min(AW - m, Math.max(m, pr.x));
          pr.y = Math.min(AH - m, Math.max(m, pr.y));
          turnBack(pr);
        } else if (pr.dist >= pr.maxD) turnBack(pr);
      } else {
        if (!owner || owner.gone || owner.downed) { pr.life = 0; return; }
        const dx = owner.x - pr.x, dy = owner.y - pr.y;
        const d = Math.hypot(dx, dy) || 1;
        const step = pr.speed * BOOMERANG.returnMult * dt;
        if (d <= step + owner.r) { pr.life = 0; return; } // caught
        pr.dx = (dx / d) * pr.speed * BOOMERANG.returnMult;
        pr.dy = (dy / d) * pr.speed * BOOMERANG.returnMult;
        pr.x += pr.dx * dt;
        pr.y += pr.dy * dt;
      }
      pr.spin += BOOMERANG.spin * dt;
      pr.vx = Math.cos(pr.spin);
      pr.vy = Math.sin(pr.spin);
    },
    onHit(w, pr, e) {
      const owner = w.players[pr.pid];
      const [d, crit] = owner ? rollCrit(w, owner, pr.dmg, pr.critChance, pr.critMult) : [pr.dmg, false]; // a fresh crit roll per hit
      hitEnemy(w, e, d, { pid: pr.pid, crit, kb: pr.kb, kbAngle: Math.atan2(pr.dy, pr.dx), source: 'p', wuid: pr.wuid });
      return true;
    },
  },
};

export function update(w, dt) {
  const { w: AW, h: AH } = BALANCE.arena;
  for (const pr of w.projectiles) {
    if (pr.dead) continue;
    const kind = PROJECTILE_KINDS[pr.kind];
    if (kind?.update) kind.update(w, pr, dt);
    else { pr.x += pr.vx * dt; pr.y += pr.vy * dt; }
    pr.life -= dt;
    if (pr.life <= 0 || pr.x < -20 || pr.y < -20 || pr.x > AW + 20 || pr.y > AH + 20) {
      kind?.onExpire?.(w, pr);
      releaseTarget(pr);
      pr.dead = true;
      continue;
    }
    if (pr.noHit) continue;
    const hits = w.grid.query(pr.x, pr.y, pr.r);
    for (const e of hits) {
      if (e.dead || pr.hitIds.includes(e.id)) continue;
      pr.hitIds.push(e.id);
      if (kind?.onHit && kind.onHit(w, pr, e)) { if (pr.dead) break; continue; }
      if (pr.burnDps > 0) applyBurn(e, pr.burnDps, pr.burnTime || 2, pr.pid, pr.wuid);
      releaseTarget(pr);
      // Piercing shots lose damage with every enemy they pass through: each one takes `falloff` of the hit before
      // (tier I 60%: 10, 6, 3.6...; higher tiers keep more). Ronnie, 21 Oct: Sparky's first spear killed three raptors.
      const dmg = pr.dmg * (pr.falloff ?? 1) ** (pr.nHit || 0);
      pr.nHit = (pr.nHit || 0) + 1;
      hitEnemy(w, e, dmg, { pid: pr.pid, crit: pr.crit, kb: pr.kb, kbAngle: Math.atan2(pr.vy, pr.vx), source: 'p', wuid: pr.wuid });
      if (pr.burst && pr.nHit === 1) fireBurst(w, pr, e, dmg);
      if (pr.pierce-- <= 0) {
        if (pr.bnc > 0 && bounceOff(w, pr, e)) break; // flies on toward another enemy
        pr.dead = true;
        break;
      }
    }
  }
}
