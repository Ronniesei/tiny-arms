// Wire format. The host encodes the world into compact snapshots; everyone (host included)
// renders from decoded snapshots, so the renderer has exactly one input format: the "view".
//
// View shape (what the renderer, HUD and client bot read):
//   { tick, phase, wave, waveDur, timeLeft, shopTime, bag,
//     players:  [{id, name, char, x, y, r, hp, maxHp, mana, maxMana, facing, moving, downed, gone,
//                 reviveP, flash, iframes, casting, amber, level, spd, weapons:[{wid,tier}], lastSeq, abCd, abCost, rolling, rollCd,
//                 herd, crates (loot crates held this wave)}],
//     enemies:  [{id, type, x, y, r, hpP, facing, flash, stun, burn, elite, boss, tele}],
//     projectiles: [{id, kind, x, y, a}], shots: [{id, x, y}], pickups: [{id, kind:'amber'|'berry'|'crate', x, y, gold?}],
//     hazards:  [{id, kind, x, y, r, p, owner, cur}], summons: [{id, kind, pid, x, y, a}], marks: [{x, y, p, type}] }

import { ENEMIES, ENEMY_IDS } from '../data/enemies.js';
import { WEAPON_IDS } from '../data/weapons.js';
import { CHARACTER_IDS } from '../data/characters.js';
import { BALANCE } from '../data/balance.js';
import { moveSpeed } from '../sim/stats.js';
import { rerollCost } from '../sim/shop.js';
import { levelRerollCost } from '../sim/levelup.js';
import { abilityCost } from '../sim/stats.js';
import { CHARACTERS } from '../data/characters.js';

/** The HUD's "HERD x": nearby mates plus Herd Horn's extra one (damage.js herdOf), capped like the bonus. */
const herdShown = (pl) => (pl.downed || pl.gone ? 0 : Math.min(BALANCE.coop.herdMax, (pl.herd || 0) + (pl.specials?.herdHorn || 0)));

const TELE_KINDS = ['flash', 'line', 'circle'];
// Projectile, hazard and summon kinds are sent as strings (low volume, no index table to keep in sync).

const r1 = (v) => Math.round(v);

function weaponCode(wpn) {
  return WEAPON_IDS.indexOf(wpn.wid) * 8 + wpn.tier;
}
function decodeWeapon(c) {
  return { wid: WEAPON_IDS[c >> 3], tier: c & 7 };
}

/** Encode the public state of the world (sent ~20 times a second). */
export function encodeSnap(w) {
  const p = [];
  for (const pl of w.players) {
    const flags = (pl.facing < 0 ? 1 : 0) | (pl.moving ? 2 : 0) | (pl.downed ? 4 : 0) | (pl.gone ? 8 : 0)
      | (pl.flash > 0 ? 16 : 0) | (pl.iframes > 0 ? 32 : 0) | (pl.abState ? 64 : 0) | (pl.rollT > 0 ? 128 : 0);
    p.push([
      pl.id, r1(pl.x), r1(pl.y), Math.ceil(pl.hp), pl.stats.maxHp, r1(pl.mana), pl.stats.maxMana, flags,
      r1((pl.reviveT / BALANCE.revive.time) * 100), r1(moveSpeed(pl.stats) * (pl.abState?.speedMult || 1)),
      pl.amber, pl.level, pl.weapons.map(weaponCode), pl.lastSeq, CHARACTER_IDS.indexOf(pl.char), pl.abCd > 0 ? r1(pl.abCd * 10) : 0,
      abilityCost(pl, CHARACTERS[pl.char].ability.cost), pl.rollCd > 0 ? r1(pl.rollCd * 10) : 0, herdShown(pl),
      (pl.crates || []).length, // 19: loot crates held this wave (the HUD badge)
    ]);
  }
  const e = [];
  const tl = [];
  for (const en of w.enemies) {
    if (en.dead) continue;
    const flags = (en.facing < 0 ? 1 : 0) | (en.flash > 0 ? 2 : 0) | (en.stun > 0 ? 4 : 0) | (en.burn > 0 ? 8 : 0)
      | (en.elite ? 16 : 0) | (en.boss ? 32 : 0);
    e.push(en.id, ENEMY_IDS.indexOf(en.type), r1(en.x), r1(en.y), r1((en.hp / en.maxHp) * 100), flags);
    if (en.tele) {
      const t = en.tele;
      tl.push(en.id, TELE_KINDS.indexOf(t.k), r1((t.a || 0) * 100), r1(t.len || 0), r1(t.wd || t.r || 0), r1(Math.min(1, t.t / (t.dur || 1)) * 100));
    }
  }
  const j = [];
  for (const pr of w.projectiles) if (!pr.dead) j.push(pr.id, pr.kind || '', r1(pr.x), r1(pr.y), r1(Math.atan2(pr.vy || 0, pr.vx || 1) * 100));
  const s = [];
  for (const sh of w.shots) if (!sh.dead) s.push(sh.id, r1(sh.x), r1(sh.y), r1(sh.r));
  const a = [];
  // kind code: 0 amber, 1 berry, 2 crate, 3 golden crate (from an elite)
  for (const pk of w.pickups) if (!pk.dead) a.push(pk.id, pk.kind === 'berry' ? 1 : pk.kind === 'crate' ? (pk.v >= 2 ? 3 : 2) : 0, r1(pk.x), r1(pk.y));
  const h = [];
  for (const hz of w.hazards) {
    if (hz.dead) continue;
    const prog = hz.t < hz.delay ? hz.t / hz.delay : 1 + (hz.t - hz.delay) / Math.max(0.01, hz.dur);
    h.push([hz.id, hz.kind, r1(hz.x), r1(hz.y), r1(hz.r), r1(prog * 100), hz.owner === 'enemy' ? 1 : 0, r1(hz.cur || 0)]);
  }
  const u = [];
  for (const sm of w.summons) if (!sm.dead) u.push([sm.id, sm.kind, sm.pid, r1(sm.x), r1(sm.y), r1((sm.a || 0) * 100)]);
  const m = [];
  for (const mk of w.marks) m.push(r1(mk.x), r1(mk.y), r1((1 - mk.t / BALANCE.enemy.spawnMarkTime) * 100), ENEMY_IDS.indexOf(mk.type));
  return {
    t: 'snap', k: w.tick, ph: w.phase, wv: w.wave, wd: w.waveDur,
    tl: r1(Math.max(0, w.waveDur - w.waveTime) * 10), st: r1(Math.max(0, w.shopTime) * 10), bag: w.bag,
    p, e, tg: tl, j, s, a, h, u, m,
  };
}

/** Decode a snapshot into a view. `names` maps player id -> name (sent once at run start). */
export function decodeSnap(sn, names = {}) {
  const players = sn.p.map((q) => {
    const f = q[7];
    return {
      id: q[0], name: names[q[0]] || `P${q[0] + 1}`, char: CHARACTER_IDS[q[14]] || 'spike',
      x: q[1], y: q[2], r: BALANCE.player.radius, hp: q[3], maxHp: q[4], mana: q[5], maxMana: q[6],
      facing: f & 1 ? -1 : 1, moving: !!(f & 2), downed: !!(f & 4), gone: !!(f & 8), flash: !!(f & 16),
      iframes: !!(f & 32), casting: !!(f & 64), reviveP: q[8] / 100, spd: q[9], amber: q[10], level: q[11],
      weapons: q[12].map(decodeWeapon), lastSeq: q[13], abCd: q[15] / 10, abCost: q[16], rolling: !!(f & 128), rollCd: (q[17] || 0) / 10, herd: q[18] || 0, crates: q[19] || 0,
    };
  });
  const teles = {};
  for (let i = 0; i < sn.tg.length; i += 6) {
    teles[sn.tg[i]] = { k: TELE_KINDS[sn.tg[i + 1]], a: sn.tg[i + 2] / 100, len: sn.tg[i + 3], wd: sn.tg[i + 4], r: sn.tg[i + 4], p: sn.tg[i + 5] / 100 };
  }
  const enemies = [];
  for (let i = 0; i < sn.e.length; i += 6) {
    const type = ENEMY_IDS[sn.e[i + 1]];
    const f = sn.e[i + 5];
    const id = sn.e[i];
    enemies.push({
      id, type, x: sn.e[i + 2], y: sn.e[i + 3], r: ENEMIES[type]?.radius || 20, hpP: sn.e[i + 4] / 100,
      facing: f & 1 ? -1 : 1, flash: !!(f & 2), stun: !!(f & 4), burn: !!(f & 8), elite: !!(f & 16), boss: !!(f & 32),
      tele: teles[id] || null,
    });
  }
  const projectiles = [];
  for (let i = 0; i < sn.j.length; i += 5) projectiles.push({ id: sn.j[i], kind: sn.j[i + 1], x: sn.j[i + 2], y: sn.j[i + 3], a: sn.j[i + 4] / 100 });
  const shots = [];
  for (let i = 0; i < sn.s.length; i += 4) shots.push({ id: sn.s[i], x: sn.s[i + 1], y: sn.s[i + 2], r: sn.s[i + 3] });
  const pickups = [];
  for (let i = 0; i < sn.a.length; i += 4) {
    const code = sn.a[i + 1];
    const pk = { id: sn.a[i], kind: code === 1 ? 'berry' : code >= 2 ? 'crate' : 'amber', x: sn.a[i + 2], y: sn.a[i + 3] };
    if (code === 3) pk.gold = true;
    pickups.push(pk);
  }
  const hazards = sn.h.map((q) => ({ id: q[0], kind: q[1], x: q[2], y: q[3], r: q[4], p: q[5] / 100, owner: q[6] ? 'enemy' : 'player', cur: q[7] }));
  const summons = sn.u.map((q) => ({ id: q[0], kind: q[1], pid: q[2], x: q[3], y: q[4], a: q[5] / 100 }));
  const marks = [];
  for (let i = 0; i < sn.m.length; i += 4) marks.push({ x: sn.m[i], y: sn.m[i + 1], p: sn.m[i + 2] / 100, type: ENEMY_IDS[sn.m[i + 3]] });
  return {
    tick: sn.k, phase: sn.ph, wave: sn.wv, waveDur: sn.wd, timeLeft: sn.tl / 10, shopTime: sn.st / 10, bag: sn.bag,
    players, enemies, projectiles, shots, pickups, hazards, summons, marks,
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function lerpList(listA, listB, t, angle = false) {
  const byId = new Map();
  for (const e of listA) byId.set(e.id, e);
  return listB.map((b) => {
    const a = byId.get(b.id);
    if (!a) return b;
    const out = { ...b, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
    if (angle && a.a !== undefined) out.a = lerpAngle(a.a, b.a, t);
    return out;
  });
}

/** Interpolate between two decoded views (t in 0..1). Entities only in B appear at B. */
export function interpolateViews(A, B, t) {
  if (!A) return B;
  return {
    ...B,
    players: lerpList(A.players, B.players, t),
    enemies: lerpList(A.enemies, B.enemies, t),
    projectiles: lerpList(A.projectiles, B.projectiles, t, true),
    shots: lerpList(A.shots, B.shots, t),
    pickups: lerpList(A.pickups, B.pickups, t),
    summons: lerpList(A.summons, B.summons, t, true),
  };
}

/** Private per-player state for the shop/level-up UI and the shop bot. */
export function privateView(w, pid) {
  const p = w.players[pid];
  if (!p) return null;
  return {
    id: p.id, char: p.char, name: p.name, phase: w.phase, wave: w.wave, shopTime: w.shopTime,
    amber: p.amber, xp: p.xp, xpNext: BALANCE.xpToLevel(p.level), level: p.level, pendingLevels: p.pendingLevels,
    levelChoices: p.levelChoices, stats: { ...p.stats }, hp: p.hp,
    weapons: p.weapons.map((x) => ({ uid: x.uid, wid: x.wid, tier: x.tier, last: p.score.byWeapon?.[x.uid]?.last || 0, total: p.score.byWeapon?.[x.uid]?.dmg || 0 })),
    lastWaveDealt: p.score.lastWaveDealt || 0, lastWaveAmber: p.score.lastWaveAmber || 0, items: p.items.slice(),
    // Loot crates waiting to be taken or recycled: [{cid, id, tier, price, recycle, elite}] (ops {op:'crate', idx, take, cid}).
    crates: (p.crateOffers || []).map((o) => ({ ...o })),
    shop: p.shop ? { offers: p.shop.offers.map((o) => (o ? { ...o } : null)), rerolls: p.shop.rerolls, rerollCost: rerollCost(w, p), levelRerollCost: levelRerollCost(w, p) } : null,
    ready: p.ready,
    // Mates who dropped out stay listed (gone) so everyone can see why they are missing; '-' are empty slots.
    team: w.players.filter((q) => !(q.gone && q.name === '-')).map((q) => ({
      id: q.id, name: q.name, char: q.char, ready: q.ready, level: q.level, gone: !!q.gone, connected: q.connected !== false,
    })),
    result: w.result,
  };
}

/** Events worth sending to clients (drops nothing important; caps floods of hit numbers). */
export function filterEvents(evs, maxHits = 50) {
  const out = [];
  let hits = 0;
  for (const e of evs) {
    if (e.type === 'hit') { if (++hits > maxHits) continue; }
    out.push(e);
  }
  return out;
}

