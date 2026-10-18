// Player movement, timers, HP regen and mana regen.
// The client predicts its own T-Rex with predictMove(), which must stay identical to the move here.

import { clampToArena, emit } from '../entities.js';
import { moveSpeed, regenPerSec } from '../stats.js';
import { healPlayer } from './damage.js';
import { BALANCE } from '../../data/balance.js';
import { CHARACTERS } from '../../data/characters.js';
import { SPECIAL_RULES } from '../../data/items.js';
import { onRoll } from '../hooks.js';

/** Shared by host simulation and client prediction. Mutates pos {x, y, r}. */
export function predictMove(pos, mx, my, speed, dt) {
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  pos.x += mx * speed * dt;
  pos.y += my * speed * dt;
  clampToArena(pos);
}

/** Roll direction: the move input, or straight ahead when standing still. Shared with client prediction. */
export function rollDir(mx, my, facing) {
  const len = Math.hypot(mx, my);
  return len > 0.1 ? [mx / len, my / len] : [facing < 0 ? -1 : 1, 0];
}

function startRoll(w, p, mx, my) {
  const R = BALANCE.roll;
  [p.rollDx, p.rollDy] = rollDir(mx, my, p.facing);
  p.rollT = R.duration;
  p.rollCd = R.cooldown;
  p.iframes = Math.max(p.iframes, R.iframes);
  if (p.rollDx > 0.05) p.facing = 1; else if (p.rollDx < -0.05) p.facing = -1;
  emit(w, { type: 'roll', pid: p.id, x: Math.round(p.x), y: Math.round(p.y), a: +Math.atan2(p.rollDy, p.rollDx).toFixed(2) });
  onRoll(w, p); // Boom Boots drop a bomb
}

function herdCount(w, p) {
  const C = BALANCE.coop;
  let n = 0;
  for (const q of w.players) {
    if (q === p || q.gone || q.downed) continue;
    if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= C.herdRadius * C.herdRadius) n++;
  }
  return Math.min(C.herdMax, n);
}

export function update(w, dt) {
  for (const p of w.players) p.herd = p.gone || p.downed ? 0 : herdCount(w, p);
  for (const p of w.players) {
    if (p.gone) continue;
    p.iframes = Math.max(0, p.iframes - dt);
    p.flash = Math.max(0, p.flash - dt);
    p.abCd = Math.max(0, p.abCd - dt);
    p.rollCd = Math.max(0, p.rollCd - dt);
    p.reviveBoostT = Math.max(0, p.reviveBoostT - dt);
    p.tauntT = Math.max(0, p.tauntT - dt);
    p.lifeStealAcc = Math.max(0, p.lifeStealAcc - BALANCE.stat.lifeStealCapPerSec * dt);
    p.critHealAcc = Math.max(0, (p.critHealAcc || 0) - SPECIAL_RULES.critHeal.perSec * dt); // Bloodthirst heal rate cap
    // Berserker Sap: attack speed while below half HP (weaponCooldown reads stats.berserkAs).
    const berserk = p.specials?.berserkAs || 0;
    if (berserk > 0 || p.stats.berserkAs) p.stats.berserkAs = berserk > 0 && !p.downed && p.hp < p.stats.maxHp * 0.5 ? berserk : 0;
    if (p.drSeen < 0) p.drSeen = p.input.dr || 0;
    if (p.downed) { p.moving = false; p.drSeen = p.input.dr || 0; p.rollT = 0; continue; }

    p.regenAcc += regenPerSec(p.stats) * dt;
    if (p.regenAcc >= 1) {
      const n = Math.floor(p.regenAcc);
      p.regenAcc -= n;
      healPlayer(w, p, n, p.id, true);
    }
    // Fern's Green Thumb: her regen also heals mates in range at a fraction of the rate (credited to her).
    const aura = CHARACTERS[p.char]?.trait;
    if (aura?.auraRadius) {
      p.auraAcc += regenPerSec(p.stats) * aura.auraRegen * dt;
      if (p.auraAcc >= 1) {
        const n = Math.floor(p.auraAcc);
        p.auraAcc -= n;
        const r2 = aura.auraRadius * aura.auraRadius;
        for (const q of w.players) {
          if (q === p || q.gone || q.downed) continue;
          if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= r2) healPlayer(w, q, n, p.id, true);
        }
      }
    }
    p.mana = Math.min(p.stats.maxMana, p.mana + p.stats.manaRegen * dt);

    const { mx, my } = p.input;
    const speed = moveSpeed(p.stats) * (p.abState?.speedMult || 1);
    // Dodge roll: dr is a press counter like the ability key.
    const dr = p.input.dr || 0;
    if (dr > p.drSeen && p.rollCd <= 0) startRoll(w, p, mx, my);
    p.drSeen = dr;
    if (p.rollT > 0) {
      p.rollT -= dt;
      predictMove(p, p.rollDx, p.rollDy, speed * BALANCE.roll.speedMult, dt);
      p.moving = true;
      continue;
    }
    predictMove(p, mx, my, speed, dt);
    p.moving = Math.abs(mx) + Math.abs(my) > 0.05;
    if (mx > 0.05) p.facing = 1; else if (mx < -0.05) p.facing = -1;
  }
}
