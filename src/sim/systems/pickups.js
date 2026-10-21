// Amber and berry pickups: pop, magnet toward a player in pickup range, collect.
// Amber gives both currency and XP (one pickup, as in the design).
// Crates (kind 'crate') are stored on the player and opened at wave end (src/sim/crates.js).
// Item hooks: Amber Vacuum (amber magnets from twice as far, +1 XP per pickup), Piggy Egg (+amber at wave end),
// Hoard Heart (its damage follows the amber held).

import { BALANCE } from '../../data/balance.js';
import { CHARACTERS } from '../../data/characters.js';
import { CRATE_RULES, SPECIAL_RULES } from '../../data/items.js';
import { clampToArena, emit } from '../entities.js';
import { pickupRadius, recomputeStats, refreshHoard, resetFrenzy } from '../stats.js';
import { healPlayer } from './damage.js';
import { storeCrate } from '../crates.js';

export function grantXp(w, p, xp) {
  p.xp += xp;
  let need = BALANCE.xpToLevel(p.level);
  while (p.xp >= need) {
    p.xp -= need;
    p.level++;
    p.pendingLevels++;
    recomputeStats(p);
    emit(w, { type: 'levelUp', pid: p.id, lv: p.level, x: Math.round(p.x), y: Math.round(p.y) });
    need = BALANCE.xpToLevel(p.level);
  }
}

/**
 * Give a player amber (and the same amount of XP unless xp is false).
 * Ancient Amber (specials.amberBonus) adds a percentage on top, as amber only; fractions carry over.
 * Returns the amber actually added. Emits a 'pickup' event unless quiet.
 * @param {{xp?:boolean, bonus?:boolean, quiet?:boolean}} [o]
 */
export function awardAmber(w, p, v, x, y, o = {}) {
  let total = v;
  const bonus = o.bonus === false ? 0 : (p.specials?.amberBonus || 0) + (p.stats?.heroAmber || 0); // Ancient Amber + Goldie's Golden Touch
  if (bonus > 0) {
    p.amberAcc = (p.amberAcc || 0) + v * bonus;
    const extra = Math.floor(p.amberAcc + 1e-9);
    p.amberAcc -= extra;
    total += extra;
  }
  p.amber += total;
  p.score.amber += total;
  if (p.specials?.hoard > 0 || p.stats?.hoardPer > 0) refreshHoard(p); // Hoard Heart / Golden Touch: more amber, more damage
  if (o.xp !== false) grantXp(w, p, v * BALANCE.economy.xpPerAmber);
  if (!o.quiet) emit(w, { type: 'pickup', pid: p.id, kind: 'amber', v: total, x: Math.round(x), y: Math.round(y) });
  return total;
}

/**
 * Wave-end Harvesting: pay amber and XP equal to the stat, then grow the stat 5% (rounded up).
 * Negative Harvesting costs amber and does not grow. world.endWave does the same inline.
 */
export function payHarvest(w, p) {
  resetFrenzy(p); // wave end: Spike's Frenzy ends here (world.endWave calls this for every player)
  // Piggy Egg: a flat bonus every wave end (amber and XP, like Harvesting, but it does not grow).
  const piggy = p.specials?.waveAmber || 0;
  if (piggy > 0) {
    p.amber += piggy;
    p.score.amber += piggy;
    grantXp(w, p, piggy * BALANCE.economy.xpPerAmber);
    refreshHoard(p);
  }
  const h = Math.round(p.stats.harvesting);
  if (h === 0) return 0;
  p.amber = Math.max(0, p.amber + h);
  if (h > 0) {
    p.score.amber += h;
    grantXp(w, p, h);
    p.upgrades.harvesting = (p.upgrades.harvesting || 0) + Math.ceil(h * BALANCE.economy.harvestGrowth);
  }
  recomputeStats(p);
  return h;
}

/**
 * Co-op amber is one pot split evenly (Ronnie, 21 Oct, as in Brotato): every pickup is divided between everyone still
 * in the run (downed mates too), so nobody races mates for drops. 30 + 10 picked up by two players = 20 each.
 * Fractions carry over per player. Each player's own bonuses (Goldie, Ancient Amber) and XP apply to their share.
 * Solo, or with BALANCE.coop.shareAmber off: the picker gets it all.
 */
export function shareAmber(w, p, pk) {
  const team = BALANCE.coop.shareAmber ? w.players.filter((q) => !q.gone) : [p];
  if (!team.includes(p)) team.push(p);
  const each = pk.v / team.length;
  for (const q of team) {
    q.shareAcc = (q.shareAcc || 0) + each;
    const whole = Math.floor(q.shareAcc + 1e-9);
    q.shareAcc -= whole;
    if (whole > 0) awardAmber(w, q, whole, pk.x, pk.y, { quiet: true });
  }
  // One event for the pickup itself (spark and sound for the picker); the HUD pops everyone's amber as it rises.
  emit(w, { type: 'pickup', pid: p.id, kind: 'amber', v: pk.v, x: Math.round(pk.x), y: Math.round(pk.y) });
}

export function collect(w, p, pk) {
  pk.dead = true;
  if (pk.kind === 'amber') {
    p.score.picked = (p.score.picked || 0) + pk.v; // the Hoarder title: who picked up the most
    shareAmber(w, p, pk);
    if (p.specials?.vacuum > 0) grantXp(w, p, SPECIAL_RULES.vacuumXp * p.specials.vacuum); // Amber Vacuum
  } else if (pk.kind === 'crate') {
    const to = storeCrate(w, p, pk); // co-op: the crate may go to a mate (crates.js crateReceiver); the picker is still healed
    healPlayer(w, p, CRATE_RULES.heal, p.id);
    // pid = who gets the crate, by = who picked it up (they differ when it is shared out)
    emit(w, { type: 'pickup', pid: to.id, by: p.id, kind: 'crate', v: pk.v, x: Math.round(pk.x), y: Math.round(pk.y) });
  } else if (pk.kind === 'berry') {
    const mult = CHARACTERS[p.char]?.trait?.berryHeal ?? 1; // Fern's Green Thumb
    healPlayer(w, p, Math.max(2, Math.round(p.stats.maxHp * BALANCE.pickups.berryHealPct)) * mult, p.id);
    emit(w, { type: 'pickup', pid: p.id, kind: 'berry', v: 1, x: Math.round(pk.x), y: Math.round(pk.y) });
  }
}

export function update(w, dt) {
  const P = BALANCE.pickups;
  const drag = Math.max(0, 1 - 6 * dt);
  for (const pk of w.pickups) {
    if (pk.dead) continue;
    if (pk.magnet < 0) {
      if (pk.vx || pk.vy) {
        pk.x += pk.vx * dt; pk.y += pk.vy * dt;
        pk.vx *= drag; pk.vy *= drag;
        if (Math.abs(pk.vx) + Math.abs(pk.vy) < 2) pk.vx = pk.vy = 0;
        clampToArena(pk);
      }
      let best = null, bd = Infinity;
      for (const p of w.players) {
        if (p.gone || p.downed) continue;
        if (pk.kind === 'berry' && p.hp >= p.stats.maxHp && w.players.length > 1) continue;
        const d = (p.x - pk.x) ** 2 + (p.y - pk.y) ** 2;
        let pr = pickupRadius(p.stats);
        if (pk.kind === 'amber' && p.specials?.vacuum > 0) pr *= 1 + p.specials.vacuum; // Amber Vacuum: twice as far
        if (d < pr * pr && d < bd) { bd = d; best = p; }
      }
      if (best) { pk.magnet = best.id; pk.speed = 120; }
      continue;
    }
    const p = w.players[pk.magnet];
    if (!p || p.downed || p.gone) { pk.magnet = -1; continue; }
    pk.speed = Math.min(P.magnetSpeed * 2, pk.speed + P.magnetAccel * dt);
    const dx = p.x - pk.x, dy = p.y - pk.y;
    const d = Math.hypot(dx, dy);
    if (d < P.collectDist || d < pk.speed * dt) { collect(w, p, pk); continue; }
    pk.x += (dx / d) * pk.speed * dt;
    pk.y += (dy / d) * pk.speed * dt;
  }
}
