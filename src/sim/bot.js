// Bots for tests, ?bot=1 and headless balance runs.
// botInput() only reads fields that exist in both the world and the client view
// (players {id,x,y,downed,gone,hp,mana,char}, enemies {x,y,type,r}, shots {x,y}, pickups {x,y,kind}),
// so the same bot can drive a host player or a joining client.
// botShopOp() reads the private player view (protocol.privateView shape) and returns one op or null.

import { BALANCE } from '../data/balance.js';
import { CHARACTERS } from '../data/characters.js';
import { ENEMIES } from '../data/enemies.js';
import { WEAPONS } from '../data/weapons.js';
import { ITEMS } from '../data/items.js';

const AW = BALANCE.arena.w, AH = BALANCE.arena.h;

/** Per-bot memory (ability press counter, wander target). */
export function createBotState() {
  return { ab: 0, dr: 0, wx: AW / 2, wy: AH / 2, wt: 0 };
}

/**
 * @param {{players:any[], enemies:any[], shots:any[], pickups:any[], hazards?:any[]}} src
 * @param {number} pid
 * @param {object} bs bot state from createBotState()
 * @param {number} time seconds (for wander changes)
 * @param {{skill?:number}} [opt]  skill 0..1 (1 = default good bot)
 */
export function botInput(src, pid, bs, time, opt = {}) {
  const skill = opt.skill ?? 1;
  const me = src.players.find((p) => p.id === pid);
  if (!me || me.downed || me.gone) return { mx: 0, my: 0, ab: bs.ab, dr: bs.dr };
  let fx = 0, fy = 0;
  const maxHp = me.maxHp ?? me.stats?.maxHp ?? 20;
  const hpFrac = me.hp / maxHp;
  const wl = me.weapons || [];
  const meleeShare = wl.length ? wl.filter((x) => WEAPONS[x.wid]?.kind === 'melee').length / wl.length : 0;

  // Nearest threat and crowd size.
  let nearest = null, nd = Infinity, close = 0;
  for (const e of src.enemies) {
    if (ENEMIES[e.type]?.neutral) continue;
    const d = Math.hypot(me.x - e.x, me.y - e.y);
    if (d < nd) { nd = d; nearest = e; }
    if (d < 150) close++;
  }
  // Melee builds engage when healthy and not swarmed; ranged builds keep their distance.
  // Melee builds engage when healthy and not swarmed (a boss only between its telegraphed attacks).
  const engage = meleeShare >= 0.5 && hpFrac > 0.4 && close <= 4 && nearest && (!nearest.boss || !nearest.tele);
  const dangerR = (engage ? 70 : meleeShare >= 0.5 ? 150 : 260) * skill + 60;

  // Flee enemies (inverse-square), stronger for close ones and big ones.
  for (const e of src.enemies) {
    if (ENEMIES[e.type]?.neutral) continue;
    const dx = me.x - e.x, dy = me.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > dangerR + (e.r || 20)) continue;
    const big = e.boss ? 3 : e.elite ? 2 : 1;
    const wgt = (big * 1.0) / Math.max(0.15, (d - (e.r || 20)) / 100) ** 2;
    fx += (dx / d) * wgt;
    fy += (dy / d) * wgt;
  }
  if (engage && nd > 80 + (nearest.r || 20)) {
    const dx = nearest.x - me.x, dy = nearest.y - me.y;
    fx += (dx / nd) * 1.6;
    fy += (dy / nd) * 1.6;
  }
  // Circle-kite around the arena centre so crowds trail behind instead of cornering us.
  if (close > 0 || nd < 300) {
    const cx = me.x - AW / 2, cy = me.y - AH / 2;
    const cd = Math.hypot(cx, cy) || 1;
    fx += (-cy / cd) * 0.5;
    fy += (cx / cd) * 0.5;
  }
  // Dodge enemy shots.
  for (const s of src.shots) {
    const dx = me.x - s.x, dy = me.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > 160 * skill) continue;
    const wgt = 3 / Math.max(0.2, d / 100) ** 2;
    fx += (dx / d) * wgt;
    fy += (dy / d) * wgt;
  }
  let inDanger = false;
  // Step out of telegraphed attacks (charge/dive lines, tail-swing circles), as a person would.
  if (skill > 0.5) {
    for (const e of src.enemies) {
      const tl = e.tele;
      if (!tl) continue;
      if (tl.k === 'line') {
        const c = Math.cos(tl.a), s = Math.sin(tl.a);
        const along = (me.x - e.x) * c + (me.y - e.y) * s;
        const side = -(me.x - e.x) * s + (me.y - e.y) * c;
        const half = (tl.wd || 40) / 2 + me.r + 18;
        if (along > -20 && along < (tl.len || 300) + 30 && Math.abs(side) < half) {
          inDanger = true;
          const dir = side >= 0 ? 1 : -1;
          fx += -s * dir * 9;
          fy += c * dir * 9;
        }
      } else if (tl.k === 'circle') {
        const dx = me.x - e.x, dy = me.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < (tl.r || 100) + me.r + 25) { fx += (dx / d) * 9; fy += (dy / d) * 9; inDanger = true; }
      }
    }
  }
  // Avoid enemy hazard areas.
  for (const h of src.hazards || []) {
    if (h.owner !== 'enemy') continue;
    const dx = me.x - h.x, dy = me.y - h.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > h.r + 60) continue;
    fx += (dx / d) * 6; fy += (dy / d) * 6;
  }
  // Walls and corners.
  const m = 160;
  if (me.x < m) fx += ((m - me.x) / m) * 4;
  if (me.x > AW - m) fx -= ((me.x - (AW - m)) / m) * 4;
  if (me.y < m) fy += ((m - me.y) / m) * 4;
  if (me.y > AH - m) fy -= ((me.y - (AH - m)) / m) * 4;

  // Stay near the herd (mates within BALANCE.coop.herdRadius buff each other), like a team would.
  let mate = null, md = Infinity;
  for (const q of src.players) {
    if (q.id === pid || q.gone || q.downed) continue;
    const d = Math.hypot(q.x - me.x, q.y - me.y);
    if (d < md) { md = d; mate = q; }
  }
  if (mate && md > BALANCE.coop.herdRadius * 0.8) {
    const k = Math.min(1.5, (md - BALANCE.coop.herdRadius * 0.8) / 200);
    fx += ((mate.x - me.x) / md) * k;
    fy += ((mate.y - me.y) / md) * k;
  }
  // Go revive a downed ally; else collect amber; else drift toward a wander point.
  const downedAlly = src.players.find((p) => p.id !== pid && p.downed && !p.gone);
  let gx = null, gy = null, gw = 0;
  if (downedAlly) { gx = downedAlly.x; gy = downedAlly.y; gw = 2.5; }
  else {
    let best = null, bd = 450 * 450;
    for (const pk of src.pickups) {
      if (pk.kind === 'berry' && hpFrac >= 0.95) continue;
      const d = (pk.x - me.x) ** 2 + (pk.y - me.y) ** 2;
      if (d < bd) { bd = d; best = pk; }
    }
    if (best) { gx = best.x; gy = best.y; gw = 1.2; }
    else {
      if (time > bs.wt) { bs.wt = time + 3; bs.wx = AW * (0.3 + 0.4 * ((time * 7.3) % 1)); bs.wy = AH * (0.3 + 0.4 * ((time * 3.7) % 1)); }
      gx = bs.wx; gy = bs.wy; gw = 0.6;
    }
  }
  if (gx !== null) {
    const dx = gx - me.x, dy = gy - me.y;
    const d = Math.hypot(dx, dy) || 1;
    fx += (dx / d) * gw;
    fy += (dy / d) * gw;
  }

  // Ability: cast when it would help.
  const ab = CHARACTERS[me.char]?.ability;
  const cost = me.abCost ?? ab?.cost ?? 999;
  if (ab && me.mana >= cost && !(me.abCd > 0)) {
    let want = false;
    if (ab.id === 'healing_pulse') want = hpFrac < 0.6 || !!downedAlly || close >= 4;
    else if (ab.id === 'meteor_call') want = src.enemies.length >= 6;
    else want = close >= 3;
    // Don't sit on full mana: a person spends it whenever something is in reach.
    const full = me.mana >= (me.maxMana ?? me.stats?.maxMana ?? 100) * 0.9;
    if (full && (close >= 1 || nd < 260)) want = true;
    if (want && skill > 0.3) bs.ab++;
  }

  // Dodge roll out of a telegraph or a crowd.
  if (skill > 0.5 && !(me.rollCd > 0) && (inDanger || close >= 5 || (close >= 3 && hpFrac < 0.4))) bs.dr++;

  const len = Math.hypot(fx, fy);
  if (len < 0.05) return { mx: 0, my: 0, ab: bs.ab, dr: bs.dr };
  return { mx: +(fx / len).toFixed(3), my: +(fy / len).toFixed(3), ab: bs.ab, dr: bs.dr };
}

// ---- Shop bot ----

const STAT_PRIORITY = {
  brutus: ['maxHp', 'armor', 'meleeDamage', 'hpRegen', 'damage', 'attackSpeed', 'lifeSteal'],
  fern: ['hpRegen', 'maxHp', 'rangedDamage', 'abilityPower', 'armor', 'attackSpeed', 'manaRegen'],
  spike: ['damage', 'attackSpeed', 'meleeDamage', 'maxHp', 'lifeSteal', 'critChance', 'armor'],
  sparky: ['rangedDamage', 'maxHp', 'abilityPower', 'armor', 'attackSpeed', 'damage', 'manaRegen'],
};

function itemScore(me, id) {
  const it = ITEMS[id];
  const pri = STAT_PRIORITY[me.char] || [];
  let s = it.tier * 2;
  for (const k in it.stats || {}) {
    const v = it.stats[k];
    const i = pri.indexOf(k);
    const wgt = i >= 0 ? 3 - i * 0.3 : 0.6;
    s += Math.sign(v) * wgt * (v < 0 ? 1.4 : 1);
  }
  if (it.special) s += 2;
  if (it.special?.halfHp) s -= 8;      // Glass Jaw halves max HP (not in its stats)
  if (it.special?.berserkAs) s -= 1;   // only pays off at low HP
  return s;
}

function weaponScore(me, id, tier) {
  const def = WEAPONS[id];
  let s = tier * 3;
  const owned = me.weapons.filter((x) => x.wid === id);
  if (owned.some((x) => x.tier === tier && tier < 4)) s += 4; // merge fodder
  const melee = me.char === 'brutus' || me.char === 'spike';
  if ((def.kind === 'melee') === melee) s += 2;
  const cls = me.weapons.map((x) => WEAPONS[x.wid]?.cls);
  if (cls.includes(def.cls)) s += 1.5;
  // Early on, every extra weapon is a big damage jump: fill the slots like a person would.
  if (me.weapons.length < 4) s += 4;
  else if (me.weapons.length < BALANCE.shop.maxWeapons) s += 2;
  return s;
}

/**
 * One shop decision for a player, or null when done (then send {op:'ready', value:true}).
 * @param {object} me privateView
 * @param {{random?:boolean, rng?:() => number}} [opt]
 */
export function botShopOp(me, opt = {}) {
  if (me.levelChoices && me.levelChoices.length) {
    if (opt.random) return { op: 'level', idx: Math.floor(opt.rng() * me.levelChoices.length) };
    const pri = STAT_PRIORITY[me.char] || [];
    let best = 0, bs = -Infinity;
    me.levelChoices.forEach((c, i) => {
      const k = pri.indexOf(c.stat);
      const s = (k >= 0 ? 10 - k : 2) + c.tier * 2;
      if (s > bs) { bs = s; best = i; }
    });
    return { op: 'level', idx: best };
  }
  // Merge duplicates first.
  for (const a of me.weapons) {
    if (a.tier < 4 && me.weapons.some((b) => b !== a && b.wid === a.wid && b.tier === a.tier)) return { op: 'merge', uid: a.uid };
  }
  const offers = me.shop?.offers || [];
  const affordable = offers.map((o, slot) => ({ o, slot })).filter(({ o }) => o && o.price <= me.amber);
  const canTake = (o) => o.kind === 'item' || me.weapons.length < BALANCE.shop.maxWeapons
    || me.weapons.some((x) => x.wid === o.id && x.tier === o.tier && o.tier < 4);
  const options = affordable.filter(({ o }) => canTake(o));
  // Save (and lock) for weapons until we have three: an extra weapon beats any early item.
  if (!opt.random && me.weapons.length < 3) {
    const fits = (o) => me.char !== 'brutus' || WEAPONS[o.id]?.kind === 'melee'; // Brutus's trait punishes ranged
    const wo = offers.map((o, slot) => ({ o, slot })).filter(({ o }) => o && o.kind === 'weapon' && canTake(o) && fits(o));
    if (wo.length) {
      const cheap = wo.reduce((a, b) => (a.o.price <= b.o.price ? a : b));
      if (cheap.o.price <= me.amber) return { op: 'buy', slot: cheap.slot };
      if (!cheap.o.locked) return { op: 'lock', slot: cheap.slot };
      return null;
    }
  }
  if (opt.random) {
    if (!options.length || opt.rng() < 0.15) return null;
    return { op: 'buy', slot: options[Math.floor(opt.rng() * options.length)].slot };
  }
  let best = null, bs = me.amber > 150 ? 0.8 : 1.6; // rich: buy anything decent
  for (const { o, slot } of options) {
    const s = (o.kind === 'item' ? itemScore(me, o.id) : weaponScore(me, o.id, o.tier)) / Math.max(1, o.price / 30);
    if (s > bs) { bs = s; best = slot; }
  }
  if (best !== null) return { op: 'buy', slot: best };
  // Nothing worth it: reroll while there is money to spend (a person rarely banks amber).
  const cost = me.shop?.rerollCost ?? 999;
  const rich = me.amber > cost * 6;
  if (((me.shop?.rerolls || 0) < 4 || (rich && (me.shop?.rerolls || 0) < 10)) && me.amber >= cost + 25) return { op: 'reroll' };
  return null;
}
