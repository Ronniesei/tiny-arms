// Entity creation helpers shared by all systems. Entities are plain objects with numeric ids.
//
// World arrays and the fields the renderer/protocol read:
//   players     {id, name, char, x, y, r, hp, mana, facing, downed, ...}  (see createPlayer)
//   enemies     {id, type, x, y, r, hp, maxHp, facing, flash, stun, burn, tele, elite, boss, dead}
//   projectiles {id, kind, pid, x, y, vx, vy, r, dmg, ..., dead}   player-owned shots
//   shots       {id, x, y, vx, vy, r, dmg, dead}                   enemy shots (magenta)
//   pickups     {id, kind:'amber'|'berry', x, y, v, dead}
//   hazards     {id, kind, x, y, r, t, dur, delay, owner:'enemy'|'player', ..., dead}
//   summons     {id, kind, pid, x, y, r, ..., dead}                player turrets / drones
//   marks       {x, y, type, t}                                    spawn markers

import { BALANCE } from '../data/balance.js';
import { CHARACTERS } from '../data/characters.js';
import { ENEMIES } from '../data/enemies.js';
import { dangerOf } from '../data/danger.js';

/** Push an event for the renderer/audio/network. */
export function emit(w, ev) {
  ev.k = w.tick;
  w.events.push(ev);
}

export function newId(w) {
  return w.nextId++;
}

export function createPlayer(w, { id, name, char }) {
  const c = CHARACTERS[char] || CHARACTERS.spike;
  return {
    id, name: name || `Player ${id + 1}`, char: c.id,
    x: 0, y: 0, r: BALANCE.player.radius, facing: 1, moving: false,
    hp: 1, mana: 0, stats: {},
    weapons: [{ wid: c.weapon, tier: 1, cd: 0.5, uid: 1 }],
    nextWeaponUid: 2,
    items: [],          // item ids (duplicates allowed)
    upgrades: {},       // stat -> total from level-ups
    amber: 15, xp: 0, level: 0, pendingLevels: 0,  // 15 starting amber: wave 1 always ends with a buy
    harvestBonus: 0,    // growth applied to Harvesting each wave end
    downed: false, reviveT: 0, gone: false, connected: true,
    iframes: 0, flash: 0, regenAcc: 0, lifeStealAcc: 0,
    frenzy: 0,          // Spike's Frenzy: kills this wave (stats.frenzyAs is the attack speed it gives)
    auraAcc: 0,         // Fern's regen aura: healing owed to mates in range
    abCd: 0, abSeen: -1, abState: null, reviveBoostT: 0, tauntT: 0,
    rollT: 0, rollCd: 0, rollDx: 1, rollDy: 0, drSeen: -1,
    input: { mx: 0, my: 0, ab: 0, dr: 0 }, lastSeq: 0,
    ready: false, shop: null, levelChoices: null,
    score: {
      kills: 0, damageDealt: 0, damageTaken: 0, revives: 0, healing: 0,
      amber: 0, casts: 0, downs: 0, firstFallTick: -1, byWeapon: {},
    },
  };
}

/**
 * Enemy HP/damage for the current wave, team size and danger level (w.danger; elites and the boss scale too,
 * the boss also by the level's bossHp). `o` is the spawn's extra fields ({elite, boss}). Neutral bushes ignore danger.
 */
export function enemyScale(w, def, o = {}) {
  const n = Math.max(1, w.activeCount || 1);
  const waveIdx = Math.max(0, w.wave - 1);
  const hpMul = 1 + BALANCE.coop.hpPerExtraPlayer * (n - 1);
  const D = def.neutral ? { hp: 1, dmg: 1, bossHp: 1 } : dangerOf(w);
  const dmg = Math.max(0, Math.round(def.dmg + def.dmgPerWave * waveIdx));
  return {
    hp: Math.round((def.hp + def.hpPerWave * waveIdx) * hpMul * D.hp * (o.boss ? D.bossHp : 1)),
    // Kept unrounded when danger changes it: hitPlayer rounds once, after armour.
    dmg: D.dmg === 1 ? dmg : Math.round(dmg * D.dmg * 100) / 100,
  };
}

export function spawnEnemy(w, type, x, y, extra = {}) {
  const def = ENEMIES[type];
  const sc = enemyScale(w, def, extra);
  if (!extra.elite && !extra.boss && !def.neutral) {
    sc.hp = Math.round(sc.hp * (1 + BALANCE.enemy.hpGrowth * Math.max(0, w.wave - 1)));
  }
  const e = {
    id: newId(w), type, x, y, r: def.radius,
    hp: sc.hp, maxHp: sc.hp, dmg: sc.dmg, speed: def.speed,
    vx: 0, vy: 0, kbx: 0, kby: 0, facing: 1,
    flash: 0, stun: 0, slow: 0, burn: 0, burnDps: 0, burnPid: -1,
    tele: null, st: 'move', t: 0, cd: 0, target: -1,
    elite: false, boss: false, dead: false,
    ...extra,
  };
  w.enemies.push(e);
  return e;
}

export function spawnProjectile(w, p) {
  const proj = { id: newId(w), r: 8, pierce: 0, hitIds: [], life: 2, dead: false, kb: 0, ...p };
  w.projectiles.push(proj);
  return proj;
}

export function spawnShot(w, s) {
  const shot = { id: newId(w), r: 10, life: 6, dead: false, ...s };
  w.shots.push(shot);
  return shot;
}

export function spawnPickup(w, kind, x, y, v = 1) {
  if (kind === 'amber' && w.pickups.length >= BALANCE.pickups.max) {
    // Merge into an existing amber blob so nothing is lost.
    for (let i = w.pickups.length - 1; i >= 0; i--) {
      const p = w.pickups[i];
      if (p.kind === 'amber' && !p.dead) { p.v += v; return p; }
    }
  }
  const p = { id: newId(w), kind, x, y, v, vx: 0, vy: 0, r: 10, magnet: -1, dead: false };
  w.pickups.push(p);
  return p;
}

export function spawnHazard(w, h) {
  const hz = { id: newId(w), t: 0, delay: 0, dur: 0.3, r: 60, owner: 'enemy', dead: false, ...h };
  w.hazards.push(hz);
  return hz;
}

export function spawnSummon(w, s) {
  const sm = { id: newId(w), r: 14, cd: 0, dead: false, ...s };
  w.summons.push(sm);
  return sm;
}

/** Players that can act: present and not downed. */
export function livePlayers(w) {
  return w.players.filter((p) => !p.gone && !p.downed);
}

export function nearestPlayer(w, x, y) {
  let best = null, bd = Infinity;
  for (const p of w.players) {
    if (p.gone || p.downed) continue;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/** Nearest enemy (including neutral bushes) within range of (x, y), or null. */
export function nearestEnemy(w, x, y, range) {
  let best = null, bd = range * range;
  for (const e of w.enemies) {
    if (e.dead) continue;
    const dx = e.x - x, dy = e.y - y;
    const d = dx * dx + dy * dy - e.r * e.r;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

export function clampToArena(e) {
  const { w, h } = BALANCE.arena;
  if (e.x < e.r) e.x = e.r; else if (e.x > w - e.r) e.x = w - e.r;
  if (e.y < e.r) e.y = e.r; else if (e.y > h - e.r) e.y = h - e.r;
}
