// Player summons (turrets, drones). Register kinds in SUMMON_KINDS: { update(w, s, dt) }.
// Summons are cleared at wave end; the weapons that create them re-create them (MAINTAIN in weapons.js).
//
// Every summon has {id, kind, pid, x, y, a (facing angle), r, wuid (uid of the owning weapon), wid}.
// A summon dies by itself when its owner leaves or its weapon is sold / replaced.
// Hero/ability hooks: Bolt's Workshop (damage in stats.js, extra summons in weapons.js MAINTAIN) and Overclock (summonRate below).
// Item hooks: Pack Leader's damage bonus lives in stats.js weaponDamage (summons read the same numbers as weapons);
// Egg Clutch adds summons in weapons.js MAINTAIN; Twin Quiver fans extra turret shots here; Sharp Eye and Bouncy Pebbles
// work through the projectile fields (pierce, falloff, bnc).

import { BALANCE } from '../../data/balance.js';
import { WEAPONS } from '../../data/weapons.js';
import { clampToArena, emit, nearestEnemy, spawnProjectile } from '../entities.js';
import { range } from '../rng.js';
import { weaponCooldown, weaponDamage, weaponRange } from '../stats.js';
import { hitEnemy, rollCrit } from './damage.js';
import { PIERCE_FALLOFF, fan } from './weapons.js';

/** Bolt's Overclock: while it runs, the owner's summons count their cooldowns down this many times faster. */
function summonRate(p) {
  const st = p.abState;
  return st && st.id === 'overclock' ? st.rate : 1;
}

/** The weapon instance and definition a summon belongs to, or null when it no longer exists. */
function ownerWeapon(w, s, behaviour) {
  const p = w.players[s.pid];
  const wpn = p && p.weapons.find((x) => x.uid === s.wuid);
  const def = wpn && WEAPONS[wpn.wid];
  if (!def || def.behaviour !== behaviour) return null;
  return { p, wpn, def, slot: p.weapons.indexOf(wpn) };
}

/** Random point 70-120 px from (x, y), kept inside the arena. */
export function pointNear(w, x, y, dmin = 70, dmax = 120) {
  const a = range(w.rng, 0, Math.PI * 2), d = range(w.rng, dmin, dmax);
  const { w: AW, h: AH } = BALANCE.arena;
  return {
    x: Math.min(AW - 20, Math.max(20, x + Math.cos(a) * d)),
    y: Math.min(AH - 20, Math.max(20, y + Math.sin(a) * d)),
  };
}

export const SUMMON_KINDS = {
  // Pterodactyl Pal: circles its owner, periodically dives along a line at the nearest enemy and
  // damages every enemy it touches once per dive, then glides back.
  ptero: {
    update(w, s, dt) {
      const o = ownerWeapon(w, s, 'drone');
      if (!o) { s.dead = true; return; }
      const { p, wpn, def } = o;
      s.cd -= dt * summonRate(p);
      const px = s.x, py = s.y;

      if (s.st === 'dive') {
        const step = (def.diveSpeed || 780) * dt;
        s.x += s.dx * step;
        s.y += s.dy * step;
        s.left -= step;
        for (const e of w.grid.query(s.x, s.y, s.r + 4)) {
          if (e.dead || s.hitIds.includes(e.id)) continue;
          s.hitIds.push(e.id);
          const [d, crit] = rollCrit(w, p, s.base, def.critChance, def.critMult);
          hitEnemy(w, e, d, { pid: p.id, crit, kb: def.knockback, kbAngle: Math.atan2(s.dy, s.dx), source: 'p', wuid: s.wuid });
        }
        const { w: AW, h: AH } = BALANCE.arena;
        if (s.left <= 0 || s.x < 10 || s.y < 10 || s.x > AW - 10 || s.y > AH - 10) s.st = 'return';
        clampToArena(s);
        s.a = Math.atan2(s.dy, s.dx);
        return;
      }

      // Orbit (or glide back to the orbit) around the owner.
      s.ang += (def.orbitSpeed || 2.4) * dt;
      const ox = p.x + Math.cos(s.ang) * 62;
      const oy = p.y - 14 + Math.sin(s.ang) * 38;
      const k = 1 - Math.exp(-(s.st === 'return' ? 9 : 7) * dt);
      s.x += (ox - s.x) * k;
      s.y += (oy - s.y) * k;
      if (s.st === 'return' && (ox - s.x) ** 2 + (oy - s.y) ** 2 < 30 * 30) s.st = 'orbit';
      const mx = s.x - px, my = s.y - py;
      if (mx * mx + my * my > 0.04) s.a = Math.atan2(my, mx);

      if (s.st === 'orbit' && s.cd <= 0 && !p.downed) {
        const reach = weaponRange(def, p.stats);
        const target = nearestEnemy(w, p.x, p.y, reach);
        if (!target) { s.cd = 0; return; }
        const speed = def.diveSpeed || 780;
        const dist0 = Math.hypot(target.x - s.x, target.y - s.y) || 1;
        // Lead a moving target a little.
        const tx = target.x + (target.vx || 0) * (dist0 / speed);
        const ty = target.y + (target.vy || 0) * (dist0 / speed);
        const dist = Math.hypot(tx - s.x, ty - s.y) || 1;
        s.dx = (tx - s.x) / dist;
        s.dy = (ty - s.y) / dist;
        s.left = dist + 90;
        s.st = 'dive';
        s.hitIds = [];
        s.base = weaponDamage(def, wpn.tier, p.stats);
        s.cd = weaponCooldown(def, wpn.tier, p.stats);
        s.a = Math.atan2(s.dy, s.dx);
        emit(w, { type: 'shoot', pid: p.id, slot: o.slot, a: +s.a.toFixed(2), wid: def.id });
      }
    },
  },

  // Egg Turret: stationary; shoots the nearest enemy in range. Moves next to its owner if left far behind for 2.5 s.
  turret: {
    update(w, s, dt) {
      const o = ownerWeapon(w, s, 'turret');
      if (!o) { s.dead = true; return; }
      const { p, wpn, def } = o;

      s.farT = (s.farT || 0);
      if ((p.x - s.x) ** 2 + (p.y - s.y) ** 2 > 560 * 560 && !p.downed) {
        s.farT += dt;
        if (s.farT > 2.5) {
          const q = pointNear(w, p.x, p.y);
          s.x = q.x; s.y = q.y; s.farT = 0; s.cd = Math.max(s.cd, 0.3);
        }
      } else s.farT = 0;

      s.cd -= dt * summonRate(p);
      if (s.cd > 0) return;
      const reach = weaponRange(def, p.stats);
      const target = nearestEnemy(w, s.x, s.y, reach);
      if (!target) { s.cd = 0.08; return; }
      const ang = Math.atan2(target.y - s.y, target.x - s.x);
      s.a = ang;
      const base = weaponDamage(def, wpn.tier, p.stats);
      const falloff = Math.min(1, (Array.isArray(def.pierceFalloff) ? def.pierceFalloff[wpn.tier - 1] : (def.pierceFalloff ?? PIERCE_FALLOFF[wpn.tier - 1])) + (p.stats.pierceFalloff || 0)); // only matters once a shot can pierce (Sparky's Spark, Sharp Eye)
      for (const off of fan(p.specials?.extraShots)) { // Twin Quiver: [0] normally
        const [d, crit] = rollCrit(w, p, base, def.critChance, def.critMult);
        const a = ang + off;
        spawnProjectile(w, {
          kind: def.projectile, pid: p.id, wid: def.id, wuid: s.wuid, x: s.x, y: s.y - 8,
          vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed,
          dmg: d, crit, pierce: (def.pierce || 0) + (p.stats.extraPierce || 0), kb: def.knockback || 0,
          life: (reach * 1.2) / def.speed, r: def.projRadius || 7, falloff,
        });
      }
      emit(w, { type: 'shoot', pid: p.id, slot: o.slot, a: +ang.toFixed(2), wid: def.id });
      s.cd = weaponCooldown(def, wpn.tier, p.stats);
    },
  },
};

export function update(w, dt) {
  for (const s of w.summons) {
    if (s.dead) continue;
    const owner = w.players[s.pid];
    if (!owner || owner.gone) { s.dead = true; continue; }
    SUMMON_KINDS[s.kind]?.update(w, s, dt);
  }
}
