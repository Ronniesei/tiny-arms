// Player weapons: orbit slots, targeting and firing. Behaviours are looked up by def.behaviour.
// A behaviour is (w, player, weapon, def, target, slotPos, slotIndex) => void and must emit
// an event with {type:'swing'|'shoot'|'beam', pid, slot, a, wid} so the renderer can animate the weapon.
// Weapons that own summons (drone, turret) have a MAINTAIN entry instead: it runs every frame without a
// target and re-creates the summons when they are missing (they are cleared at every wave start and end).
//
// Every damage path passes `wuid: weapon.uid` to hitEnemy (and puts it on projectiles / summons), so the end screen can
// show damage per weapon (p.score.byWeapon, see damage.js). Abilities pass no wuid.
//
// Events added by this file / projectiles.js (draw them in render/fx.js):
//   swing {pid, slot, a, r, arc, wid, thrust?}   melee; thrust:1 means a stab along a narrow line
//   shoot {pid, slot, a, wid}                    projectile / lob / bounce shot, drone dive, turret shot
//   beam  {pid, slot, a, x, y, x2, y2, wid}      instant line from (x, y) to (x2, y2)
//   explode {x, y, r, pid}                       area blast (Lava Lobber, Coconut Bomb, Dino Dynamite, Boom Boots)
//   (Boomerang Bone sends `shoot` like any projectile weapon; its p_boomerang kind lives in projectiles.js)
//
// Item hooks (src/sim/hooks.js): melee hits pass `melee: true` and a `swing` id so Serrated Tooth and Shockwave Club can react;
// Twin Quiver adds extra projectiles here (fan()); Egg Clutch adds summons in MAINTAIN; update() runs hooks.update (fuses, bleeds).
// Adrenaline Gland's attack speed is applied by cooldownOf() (every weapon and summon cooldown goes through it).

import { BALANCE } from '../../data/balance.js';
import { WEAPONS } from '../../data/weapons.js';
import { emit, nearestEnemy, spawnProjectile, spawnSummon } from '../entities.js';
import { range } from '../rng.js';
import { abilityMult, weaponCooldown, weaponDamage, weaponRange } from '../stats.js';
import { hitEnemy, rollCrit } from './damage.js';
import { pointNear } from './summons.js';
import { SPECIAL_RULES } from '../../data/items.js';
import { update as updateHooks } from '../hooks.js';

/** Orbit position of weapon slot i of n around a player (same formula in the renderer). */
export function slotPos(p, i, n) {
  const a = n <= 1 ? 0 : (i * Math.PI * 2) / n;
  const R = BALANCE.player.weaponOrbit;
  return { x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R * 0.8, a };
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Enemies whose circle touches the segment from (x, y) at angle `ang` for `len` px (line half-width `halfW`). */
export function lineHits(w, x, y, ang, len, halfW) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const out = [];
  for (const e of w.grid.query(x + c * len * 0.5, y + s * len * 0.5, len * 0.5 + halfW)) {
    if (e.dead) continue;
    const t = Math.min(len, Math.max(0, (e.x - x) * c + (e.y - y) * s));
    const dx = e.x - (x + c * t), dy = e.y - (y + s * t);
    const rr = e.r + halfW;
    if (dx * dx + dy * dy <= rr * rr) out.push(e);
  }
  return out;
}

/** Damage multiplier for every enemy a piercing shot hits after the first, by weapon tier. */
export const PIERCE_FALLOFF = [0.6, 0.7, 0.8, 0.9];
const SPREAD_PX = 110;      // enemies this much farther than the nearest still count as "about as close"
const CLAIM_TIME = 0.35;    // s a target stays claimed by one of the player's weapons

/**
 * Target for a ranged weapon: among the enemies about as close as the nearest one, prefer one that
 * the shots already in flight won't kill and that this player's other weapons haven't just picked,
 * so a volley fans out over a crowd (Brotato-style) but still focuses a lone tough enemy.
 */
export function pickRangedTarget(w, p, x, y, reach) {
  const r2 = reach * reach;
  let nd = Infinity;
  for (const e of w.enemies) {
    if (e.dead) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2 - e.r * e.r;
    if (d < nd) nd = d;
  }
  if (nd > r2) return null;
  const limit = (Math.sqrt(Math.max(0, nd)) + SPREAD_PX) ** 2;
  const claims = p.claims || (p.claims = new Map());
  let best = null, bs = Infinity;
  for (const e of w.enemies) {
    if (e.dead) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2 - e.r * e.r;
    if (d > limit || d > r2) continue;
    let s = Math.sqrt(Math.max(0, d));
    if ((e.pending || 0) >= e.hp) s += 1000;            // already dead on arrival
    const c = claims.get(e.id);
    if (c !== undefined && w.time - c < CLAIM_TIME) s += SPREAD_PX * 0.9;
    if (s < bs) { bs = s; best = e; }
  }
  if (best) claims.set(best.id, w.time);
  if (claims.size > 64) for (const [id, t] of claims) if (w.time - t > CLAIM_TIME) claims.delete(id);
  return best;
}

function tierVal(v, tier) {
  return Array.isArray(v) ? v[tier - 1] : v;
}

/** Cooldown of one of the player's weapons or summons: weaponCooldown, plus Adrenaline Gland's attack speed while its timer runs. */
export function cooldownOf(p, def, tier) {
  if (!(p.adrenT > 0)) return weaponCooldown(def, tier, p.stats);
  const bonus = SPECIAL_RULES.adrenaline.attackSpeed;
  p.stats.attackSpeed += bonus; // borrowed for this one call
  const cd = weaponCooldown(def, tier, p.stats);
  p.stats.attackSpeed -= bonus;
  return cd;
}

/**
 * Twin Quiver: angle offsets (radians) for `1 + extra` projectiles fanned around the aim line, centred on it.
 * Returns [0] when there are no extras.
 */
export function fan(extra) {
  const n = 1 + Math.max(0, Math.floor(extra || 0));
  if (n === 1) return [0];
  const step = (SPECIAL_RULES.twinQuiver.spreadDeg * Math.PI) / 180;
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * step);
}

/** Index of the shot that stays on the aim line (the one that claims the target): the middle of the fan. */
export const fanMain = (n) => Math.floor((n - 1) / 2);

/** Mark the enemies one melee swing hits with a fresh swing id, so Shockwave Club does not shove ones already in the swing. */
function markSwing(w, list) {
  const id = (w.swingSerial = (w.swingSerial || 0) + 1);
  for (const e of list) e.swing = id;
  return id;
}

export const BEHAVIOURS = {
  swing(w, p, wpn, def, target, pos, slot) {
    const ang = Math.atan2(target.y - p.y, target.x - p.x);
    const reach = weaponRange(def, p.stats);
    const half = (def.arc * Math.PI) / 360;
    const base = weaponDamage(def, wpn.tier, p.stats);
    const kb = def.knockback * (1 + (p.specials?.meleeKb || 0)); // Shockwave Club
    const struck = [];
    for (const e of w.grid.query(p.x, p.y, reach)) {
      if (e.dead) continue;
      const ea = Math.atan2(e.y - p.y, e.x - p.x);
      const close = Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r + 10;
      if (!close && Math.abs(angleDiff(ea, ang)) > half) continue;
      struck.push(e);
    }
    const swing = markSwing(w, struck);
    for (const e of struck) {
      if (e.dead) continue;
      const ea = Math.atan2(e.y - p.y, e.x - p.x);
      const [d, crit] = rollCrit(w, p, base, def.critChance, def.critMult);
      hitEnemy(w, e, d, { pid: p.id, crit, kb, kbAngle: ea, source: 'w', wuid: wpn.uid, melee: true, swing });
    }
    emit(w, { type: 'swing', pid: p.id, slot, a: +ang.toFixed(2), r: Math.round(reach), arc: def.arc, wid: def.id });
  },

  // Tail Spike: a stab that hits every enemy along a narrow line from the player to its range.
  thrust(w, p, wpn, def, target, pos, slot) {
    const ang = Math.atan2(target.y - p.y, target.x - p.x);
    const reach = weaponRange(def, p.stats);
    const base = weaponDamage(def, wpn.tier, p.stats);
    const kb = def.knockback * (1 + (p.specials?.meleeKb || 0));
    const struck = lineHits(w, p.x, p.y, ang, reach, def.width || 16);
    const swing = markSwing(w, struck);
    for (const e of struck) {
      if (e.dead) continue;
      const [d, crit] = rollCrit(w, p, base, def.critChance, def.critMult);
      hitEnemy(w, e, d, { pid: p.id, crit, kb, kbAngle: ang, source: 'w', wuid: wpn.uid, melee: true, swing });
    }
    emit(w, { type: 'swing', pid: p.id, slot, a: +ang.toFixed(2), r: Math.round(reach), arc: def.arc || 24, wid: def.id, thrust: 1 });
  },

  // Slingshot, Spear Thrower, Bone Bow, Ember Staff: one projectile at the nearest enemy.
  projectile(w, p, wpn, def, target, pos, slot) {
    const ang = Math.atan2(target.y - pos.y, target.x - pos.x);
    const base = weaponDamage(def, wpn.tier, p.stats);
    const reach = weaponRange(def, p.stats);
    const offsets = fan(p.specials?.extraShots); // Twin Quiver: [0] normally
    const main = fanMain(offsets.length);
    for (let k = 0; k < offsets.length; k++) {
      const [d, crit] = rollCrit(w, p, base, def.critChance, def.critMult);
      const a = ang + offsets[k];
      const pr = spawnProjectile(w, {
        kind: def.projectile, pid: p.id, wid: def.id, wuid: wpn.uid, x: pos.x, y: pos.y,
        vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed,
        dmg: d, crit, pierce: (def.pierce || 0) + (tierVal(def.pierceTier, wpn.tier) || 0) + (p.stats.extraPierce || 0), kb: def.knockback || 0,
        life: (reach * 1.2) / def.speed, r: def.projRadius || 8,
        falloff: Math.min(1, tierVal(def.pierceFalloff || PIERCE_FALLOFF, wpn.tier) + (p.stats.pierceFalloff || 0)),
      });
      // Remember in-flight damage so other weapons don't waste shots on an enemy that is already dead.
      if (k === main) {
        pr.tgt = target;
        target.pending = (target.pending || 0) + d;
      }
      if (def.burn) {
        pr.burnDps = tierVal(def.burn.dps, wpn.tier) * abilityMult(p.stats);
        pr.burnTime = def.burn.time;
      }
      if (def.burst) pr.burst = { r: tierVal(def.burst.r, wpn.tier), frac: def.burst.frac }; // Ember Staff (projectiles.js)
    }
    emit(w, { type: 'shoot', pid: p.id, slot, a: +ang.toFixed(2), wid: def.id });
  },

  // Lava Lobber: a shell flies to where the target is going to be (ignoring enemies on the way), then
  // explodes (projectiles.js, kind p_lava) and leaves burning ground.
  lob(w, p, wpn, def, target, pos, slot) {
    const tier = wpn.tier;
    const { w: AW, h: AH } = BALANCE.arena;
    const flight = def.flight || 0.5;
    const tx = Math.min(AW - 10, Math.max(10, target.x + (target.vx || 0) * flight));
    const ty = Math.min(AH - 10, Math.max(10, target.y + (target.vy || 0) * flight));
    const ang = Math.atan2(ty - pos.y, tx - pos.x);
    const base = weaponDamage(def, tier, p.stats);
    const [d, crit] = rollCrit(w, p, base, def.critChance, def.critMult);
    const radius = tierVal(def.radius, tier);
    spawnProjectile(w, {
      kind: def.projectile, pid: p.id, wid: def.id, wuid: wpn.uid, x: pos.x, y: pos.y,
      vx: (tx - pos.x) / flight, vy: (ty - pos.y) / flight, tx, ty,
      dmg: d, crit, pierce: 0, noHit: true, life: flight, r: 10,
      boom: {
        r: radius, dmg: d, crit, kb: def.knockback,
        fireDps: tierVal(def.fireDps, tier) * abilityMult(p.stats),
        fireDur: tierVal(def.fireDur, tier), fireR: radius * (def.fireR || 0.8),
      },
    });
    emit(w, { type: 'shoot', pid: p.id, slot, a: +ang.toFixed(2), wid: def.id });
  },

  // Coconut Bomb: ricochets off the arena walls, explodes on the first enemy it touches (projectiles.js, kind p_coconut).
  bounce(w, p, wpn, def, target, pos, slot) {
    const tier = wpn.tier;
    const ang = Math.atan2(target.y - pos.y, target.x - pos.x);
    const base = weaponDamage(def, tier, p.stats);
    const [d, crit] = rollCrit(w, p, base, def.critChance, def.critMult);
    spawnProjectile(w, {
      kind: def.projectile, pid: p.id, wid: def.id, wuid: wpn.uid, x: pos.x, y: pos.y,
      vx: Math.cos(ang) * def.speed, vy: Math.sin(ang) * def.speed,
      dmg: d, crit, pierce: 0, kb: 0, life: def.life || 2.4, r: def.projRadius || 11,
      bounces: tierVal(def.bounces, tier),
      boom: { r: tierVal(def.radius, tier), dmg: d, crit, kb: def.knockback },
    });
    emit(w, { type: 'shoot', pid: p.id, slot, a: +ang.toFixed(2), wid: def.id });
  },

  // Boomerang Bone: flies straight out to the weapon's range, turns and flies back to the player, hitting every enemy it passes
  // on the way out and again on the way back (projectiles.js, kind p_boomerang). Twin Quiver throws extra ones in a fan.
  boomerang(w, p, wpn, def, target, pos, slot) {
    const ang = Math.atan2(target.y - pos.y, target.x - pos.x);
    const base = weaponDamage(def, wpn.tier, p.stats);
    const reach = weaponRange(def, p.stats);
    for (const off of fan(p.specials?.extraShots)) {
      const a = ang + off;
      spawnProjectile(w, {
        kind: def.projectile, pid: p.id, wid: def.id, wuid: wpn.uid, x: pos.x, y: pos.y,
        vx: Math.cos(a), vy: Math.sin(a), // the sent heading: projectiles.js spins it so the boomerang turns in flight
        dx: Math.cos(a) * def.speed, dy: Math.sin(a) * def.speed, spin: a, speed: def.speed,
        dmg: base, critChance: def.critChance, critMult: def.critMult, kb: def.knockback || 0,
        leg: 0, dist: 0, maxD: reach, life: (reach / def.speed) * 2 + 3, r: def.projRadius || 14, pierce: 0,
      });
    }
    emit(w, { type: 'shoot', pid: p.id, slot, a: +ang.toFixed(2), wid: def.id });
  },

  // Amber Laser: an instant line from the weapon through every enemy in range.
  beam(w, p, wpn, def, target, pos, slot) {
    const ang = Math.atan2(target.y - pos.y, target.x - pos.x);
    const len = weaponRange(def, p.stats) + BALANCE.player.weaponOrbit; // range is measured from the player's centre
    const x2 = pos.x + Math.cos(ang) * len, y2 = pos.y + Math.sin(ang) * len;
    const base = weaponDamage(def, wpn.tier, p.stats);
    for (const e of lineHits(w, pos.x, pos.y, ang, len, def.width || 12)) {
      const [d, crit] = rollCrit(w, p, base, def.critChance, def.critMult);
      hitEnemy(w, e, d, { pid: p.id, crit, kb: def.knockback, kbAngle: ang, source: 'p', wuid: wpn.uid });
    }
    emit(w, {
      type: 'beam', pid: p.id, slot, a: +ang.toFixed(2),
      x: Math.round(pos.x), y: Math.round(pos.y), x2: Math.round(x2), y2: Math.round(y2), wid: def.id,
    });
  },

  // Summon weapons do their work through their summons; see MAINTAIN.
  drone() {},
  turret() {},
};

function ownedSummons(w, pid, wuid, kind) {
  let n = 0;
  for (const s of w.summons) if (!s.dead && s.pid === pid && s.wuid === wuid && s.kind === kind) n++;
  return n;
}

/** Per-frame upkeep for summon weapons: (w, player, weapon, def, slotIndex) => void. Needs no target. */
export const MAINTAIN = {
  drone(w, p, wpn, def, slot) {
    const kind = def.summon || 'ptero'; // Beetle Jar: s_beetle (same behaviour, its own sprite)
    const want = (tierVal(def.count, wpn.tier) || 1) + (p.specials?.clutch || 0) + (p.stats.extraSummons || 0); // Egg Clutch: +1 per copy; Bolt's Workshop: +1
    const have = ownedSummons(w, p.id, wpn.uid, kind);
    if (have >= want) return;
    spawnSummon(w, {
      kind, pid: p.id, wuid: wpn.uid, wid: def.id, x: p.x, y: p.y - 40, a: 0, r: kind === 'ptero' ? 12 : 10,
      st: 'orbit', ang: range(w.rng, 0, Math.PI * 2), cd: 0.4 + 0.35 * have, hitIds: [],
    });
  },

  turret(w, p, wpn, def, slot) {
    const want = (tierVal(def.count, wpn.tier) || 1) + (p.specials?.clutch || 0) + (p.stats.extraSummons || 0); // Egg Clutch: +1 turret per copy; Bolt's Workshop: +1
    const have = ownedSummons(w, p.id, wpn.uid, 'turret');
    if (have >= want) return;
    const q = pointNear(w, p.x, p.y);
    spawnSummon(w, {
      kind: 'turret', pid: p.id, wuid: wpn.uid, wid: def.id, x: q.x, y: q.y, a: 0, r: 16, cd: 0.3,
    });
  },
};

export function update(w, dt) {
  updateHooks(w, dt); // item fuses (bombs, echoes) and bleeds
  for (const p of w.players) {
    if (p.gone || p.downed) continue;
    const n = p.weapons.length;
    for (let i = 0; i < n; i++) {
      const wpn = p.weapons[i];
      const def = WEAPONS[wpn.wid];
      if (!def) continue;
      if (wpn.uid === undefined) wpn.uid = p.nextWeaponUid++; // every weapon needs a uid: damage is credited per weapon
      const maintain = MAINTAIN[def.behaviour];
      if (maintain) {
        maintain(w, p, wpn, def, i);
        continue;
      }
      wpn.cd -= dt;
      if (wpn.cd > 0) continue;
      const reach = weaponRange(def, p.stats);
      const target = def.kind === 'ranged' ? pickRangedTarget(w, p, p.x, p.y, reach) : nearestEnemy(w, p.x, p.y, reach);
      if (!target) { wpn.cd = 0; continue; }
      const behaviour = BEHAVIOURS[def.behaviour];
      if (!behaviour) continue;
      behaviour(w, p, wpn, def, target, slotPos(p, i, n), i);
      wpn.cd = cooldownOf(p, def, wpn.tier);
    }
  }
}
