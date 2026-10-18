// Damage, healing, kills and drops. Every system deals damage through these functions,
// so events, scores, life steal and knockback stay consistent.

import { BALANCE } from '../../data/balance.js';
import { ENEMIES } from '../../data/enemies.js';
import { WAVES } from '../../data/waves.js';
import { SPECIAL_RULES } from '../../data/items.js';
import { emit, spawnPickup } from '../entities.js';
import { addFrenzy, armorFactor, dodgeChance } from '../stats.js';
import { next, chance, range } from '../rng.js';
import { applyBurn } from './status.js';
import { awardAmber } from './pickups.js';

/**
 * Credit `dealt` damage to one of the player's weapons (end-screen "damage per weapon").
 * Records live in p.score.byWeapon, keyed by the weapon's uid, one {wid, tier, dmg} per weapon ever owned;
 * a sold or merged-away weapon keeps its record (and its last-known tier) so its damage is not lost.
 * Created lazily, once per weapon. A uid that never existed is ignored.
 */
function creditWeapon(p, uid, dealt) {
  const score = p.score;
  const bw = score.byWeapon || (score.byWeapon = {});
  let cur = null;
  const ws = p.weapons;
  for (let i = 0; i < ws.length; i++) if (ws[i].uid === uid) { cur = ws[i]; break; }
  let rec = bw[uid];
  if (!rec) {
    if (!cur) return;
    rec = bw[uid] = { wid: cur.wid, tier: cur.tier, dmg: 0 };
  } else if (cur) rec.tier = cur.tier; // merges raise the tier
  rec.dmg += dealt;
}

/**
 * Damage an enemy.
 * @param {object} w world
 * @param {object} e enemy
 * @param {number} amount
 * @param {{pid?:number, crit?:boolean, kb?:number, kbAngle?:number, source?:string, noLifeSteal?:boolean, wuid?:number}} [o]
 *   wuid: uid of the player's weapon that dealt this (omit for abilities); credited in p.score.byWeapon.
 * @returns {number} damage actually dealt
 */
export function hitEnemy(w, e, amount, o = {}) {
  if (e.dead) return 0;
  // Boss phase-change roar: immune (no damage, no numbers). enemies.js sets invHp and st 'roar'.
  if (e.invHp > 0 && e.st === 'roar') return 0;
  const by = o.pid !== undefined && o.pid >= 0 ? w.players[o.pid] : null;
  if (by?.herd) amount *= 1 + BALANCE.coop.herdDamage * by.herd; // herd spirit
  const dmg = Math.max(1, Math.round(amount));
  const dealt = Math.min(dmg, e.hp);
  e.hp -= dmg;
  e.flash = 0.08;
  const def = ENEMIES[e.type];
  if (o.kb && o.kbAngle !== undefined) {
    const res = Math.min(1, def.kbResist + (e.boss ? 0.9 : e.elite ? 0.6 : 0));
    const f = o.kb * (1 - res);
    e.kbx += Math.cos(o.kbAngle) * f;
    e.kby += Math.sin(o.kbAngle) * f;
  }
  const p = o.pid !== undefined && o.pid >= 0 ? w.players[o.pid] : null;
  if (p) {
    p.score.damageDealt += dealt;
    if (o.wuid > 0) creditWeapon(p, o.wuid, dealt);
    if (!o.noLifeSteal && p.stats.lifeSteal > 0 && !p.downed && chance(w.rng, p.stats.lifeSteal / 100)) {
      if (p.lifeStealAcc < BALANCE.stat.lifeStealCapPerSec) {
        p.lifeStealAcc += 1;
        healPlayer(w, p, 1, p.id, true);
      }
    }
  }
  emit(w, { type: 'hit', id: e.id, x: Math.round(e.x), y: Math.round(e.y - e.r), a: dmg, c: o.crit ? 1 : 0, s: o.source || 'w' });
  // Volcano Ash: a crit sets the enemy on fire.
  if (o.crit && p && e.hp > 0 && p.specials?.burnOnCrit > 0) {
    const B = SPECIAL_RULES.burnOnCrit;
    applyBurn(e, Math.max(B.minDps, dmg * B.dpsPerHit) * p.specials.burnOnCrit, B.time, p.id, o.wuid);
  }
  if (e.hp <= 0) killEnemy(w, e, p ? p.id : -1);
  return dealt;
}

/** Roll a crit for a player's hit. Returns [damage, isCrit]. */
export function rollCrit(w, player, base, critChance = 0, critMult = BALANCE.stat.critMultDefault) {
  const ch = (critChance + player.stats.critChance) / 100;
  if (ch > 0 && next(w.rng) < ch) return [base * critMult, true];
  return [base, false];
}

export function killEnemy(w, e, pid = -1) {
  if (e.dead) return;
  e.dead = true;
  e.hp = 0;
  const def = ENEMIES[e.type];
  emit(w, { type: 'kill', id: e.id, x: Math.round(e.x), y: Math.round(e.y), et: e.type, pid });
  const p = pid >= 0 ? w.players[pid] : null;
  if (p && !def.neutral) {
    p.score.kills++;
    p.mana = Math.min(p.stats.maxMana, p.mana + BALANCE.mana.perKill);
    addFrenzy(p); // Spike's Frenzy trait
    // Golden Egg: extra amber per kill while below half HP.
    const bonus = p.specials?.lowHpAmber || 0;
    if (bonus > 0 && !p.downed && p.hp < p.stats.maxHp * SPECIAL_RULES.lowHpAmber.hpFrac) {
      awardAmber(w, p, bonus, e.x, e.y, { bonus: false });
    }
  }
  if (e.boss) w.bossDead = true;
  dropLoot(w, e, def);
}

function dropLoot(w, e, def) {
  // Drop chance falls over the run (BALANCE.economy); nothing is lost thanks to the bag.
  // Drop chance comes from the wave table: amber income per wave is fixed however many enemies spawn.
  const dropChance = WAVES[Math.max(0, Math.min(WAVES.length, w.wave) - 1)].drop ?? 1;
  let value = def.amber || 0;
  // Fractional amber is a chance at the extra 1 (0.4 = 40% chance of 1; 1.5 = 1, or 2 half the time).
  if (value % 1) value = Math.floor(value) + (chance(w.rng, value % 1) ? 1 : 0);
  if (e.elite) value = 45;
  if (e.boss) value = 60;
  if (value > 0 && (def.neutral || e.elite || e.boss || chance(w.rng, dropChance))) {
    if (w.bag > 0) { const extra = Math.min(w.bag, Math.ceil(value)); w.bag -= extra; value += extra; }
    const blobs = e.elite || e.boss ? 8 : 1;
    for (let i = 0; i < blobs; i++) {
      const pk = spawnPickup(w, 'amber', e.x, e.y, Math.max(1, Math.round(value / blobs)));
      const a = range(w.rng, 0, Math.PI * 2), s = range(w.rng, 40, blobs > 1 ? 260 : 120);
      pk.vx = Math.cos(a) * s; pk.vy = Math.sin(a) * s;
    }
  }
  if (def.neutral) {
    const b = spawnPickup(w, 'berry', e.x + 10, e.y, 1);
    b.vx = 60; b.vy = -40;
  } else if (chance(w.rng, e.elite || e.boss ? 1 : 0.012)) {
    spawnPickup(w, 'berry', e.x, e.y, 1);
  }
}

/**
 * Damage a player. Respects downed, i-frames, dodge and armor.
 * @param {{source?:string, x?:number, y?:number, ignoreIframes?:boolean}} [o]
 */
export function hitPlayer(w, p, amount, o = {}) {
  if (p.downed || p.gone || w.phase !== 'wave') return 0;
  if (p.iframes > 0 && !o.ignoreIframes) return 0;
  if (next(w.rng) < dodgeChance(p.stats)) {
    p.iframes = BALANCE.player.iframesMin;
    emit(w, { type: 'dodge', pid: p.id, x: Math.round(p.x), y: Math.round(p.y - p.r) });
    return 0;
  }
  const st = p.herd ? { ...p.stats, armor: p.stats.armor + p.herd * BALANCE.coop.herdArmor } : p.stats; // herd spirit
  const dmg = Math.max(1, Math.round(amount * armorFactor(st)));
  p.hp -= dmg;
  p.flash = 0.1;
  const frac = Math.min(1, dmg / p.stats.maxHp / BALANCE.player.iframesHitPct);
  p.iframes = BALANCE.player.iframesMin + (BALANCE.player.iframesMax - BALANCE.player.iframesMin) * frac;
  p.score.damageTaken += dmg;
  emit(w, { type: 'phit', pid: p.id, x: Math.round(p.x), y: Math.round(p.y - p.r), a: dmg });
  if (p.hp <= 0) downPlayer(w, p);
  return dmg;
}

export function downPlayer(w, p) {
  p.hp = 0;
  p.downed = true;
  p.reviveT = 0;
  p.abState = null;
  p.score.downs++;
  if (p.score.firstFallTick < 0) p.score.firstFallTick = w.tick;
  emit(w, { type: 'downed', pid: p.id, x: Math.round(p.x), y: Math.round(p.y) });
}

/** Heal a player; `byPid` gets the healing credit. Returns the amount healed. */
export function healPlayer(w, p, amount, byPid = p.id, quiet = false) {
  if (p.downed || p.gone) return 0;
  const healed = Math.min(amount, p.stats.maxHp - p.hp);
  if (healed <= 0) return 0;
  p.hp += healed;
  const by = w.players[byPid];
  if (by && by !== p) by.score.healing += healed; // only healing others counts toward Medic
  if (!quiet) emit(w, { type: 'heal', pid: p.id, x: Math.round(p.x), y: Math.round(p.y - p.r), a: Math.round(healed) });
  return healed;
}
