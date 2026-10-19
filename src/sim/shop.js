// Per-player shop between waves: 4 offers, reroll (price rises per press, resets each wave),
// free locks, buying, selling and merging weapons. All ops go through applyShopOp().
//
// Rules (docs/brotato-reference.md section 3):
//  - waves 1-2: exactly 2 weapons + 2 items; waves 3-5: at least 1 weapon; later each slot is a weapon 35% of the time.
//  - weapon offers: 20% a weapon you own, 15% a weapon of a class you own, else any.
//  - build identity (Brotato principle 9): in waves 1-3 at least one weapon offer is of a class you already own;
//    each hero leans toward a few stats (HERO_LEAN), so 35% of item offers draw from items that raise one of them.
//  - rarity by wave and Luck (TIER_ODDS); price = floor(base + wave + base x 0.1 x wave).
//  - reroll = floor(0.75 x wave) + step x (presses so far + 1), step = max(1, floor(0.4 x wave)); resets every wave.
//  - locked offers survive rerolls and the next wave at their old price; buying all 4 offers rerolls for free.
//  - build snowball (tags): 25% of item offers (SHOP_RULES.tagLeanChance) are drawn from items sharing a tag with your
//    build (the tags of the items you hold, plus what your weapons are: melee, ranged, summon, explosive).
//  - sell a weapon for 25% of its current price; two identical weapons of one tier merge up one tier;
//    buying a duplicate with all slots full merges it automatically.
//  - weapon slots are per hero (maxWeaponsOf): Pip's Lone Arm gives 1. With a single slot, buying a different weapon
//    swaps it in and pays out the old one's sell price (a plain sell would leave Pip with none).
//  - loot crates (crates.js): the crate offers waiting at the top of the shop are settled with {op:'crate'}; Ready takes
//    the ones still unopened.

import { BALANCE } from '../data/balance.js';
import { WEAPONS, WEAPON_IDS } from '../data/weapons.js';
import { ENEMIES } from '../data/enemies.js';
import { WAVES } from '../data/waves.js';
import { ITEMS, ITEM_IDS, TIER_ODDS, SHOP_RULES } from '../data/items.js';
import { recomputeStats, refreshHoard, maxWeaponsOf } from './stats.js';
import { next, pick, chance, shuffle, int, weighted } from './rng.js';
import { crateOp, autoResolve } from './crates.js';
import { chooseLevel, rollLevelChoices, rerollLevelChoices } from './levelup.js';
import { grantXp, payHarvest } from './systems/pickups.js';
import { botShopOp } from './bot.js';
import { privateView } from '../net/protocol.js';

const S = BALANCE.shop;
export const WEAPON_TIER_PRICE = SHOP_RULES.tierPrice;

/** Through this wave the shop always offers at least one weapon of a class the player owns. */
export const OWNED_CLASS_WEAPON_UNTIL = 3;
/** Chance an item offer is drawn only from items that raise one of the hero's leaned stats. */
export const LEAN_CHANCE = 0.35;
/** Stats each hero's shop leans toward (kept here, not in characters.js, so the shop owns its own tuning). */
export const HERO_LEAN = {
  brutus: ['maxHp', 'armor', 'meleeDamage', 'hpRegen'],
  fern: ['hpRegen', 'abilityPower', 'rangedDamage', 'maxHp'],
  spike: ['damage', 'meleeDamage', 'attackSpeed', 'critChance'],
  sparky: ['rangedDamage', 'abilityPower', 'range', 'manaRegen'],
  pip: ['attackSpeed', 'damage', 'meleeDamage', 'critChance'],
  goldie: ['harvesting', 'luck', 'rangedDamage', 'pickupRange'],
  bolt: ['rangedDamage', 'abilityPower', 'attackSpeed', 'range'],
  ash: ['abilityPower', 'rangedDamage', 'maxHp', 'attackSpeed'],
};

/** Does this item raise (positive value) at least one of the stats? */
function raisesAny(id, stats) {
  const st = ITEMS[id].stats;
  return !!st && stats.some((k) => st[k] > 0);
}

// ---- Rarity ----

/** Chances [T1, T2, T3, T4] for a wave (or level) and Luck. */
export function tierOdds(wave, luck = 0) {
  const A = TIER_ODDS.anchors;
  let row = A[A.length - 1];
  if (wave <= A[0][0]) row = A[0];
  else if (wave < A[A.length - 1][0]) {
    let i = 0;
    while (A[i + 1][0] <= wave) i++;
    const t = (wave - A[i][0]) / (A[i + 1][0] - A[i][0]);
    row = A[i].map((v, k) => v + (A[i + 1][k] - v) * t);
  }
  const lm = Math.max(0, 1 + luck / TIER_ODDS.luckScale);
  const hi = [1, 2, 3].map((k) => Math.min(TIER_ODDS.caps[k - 1], row[k] * lm));
  return [Math.max(0, 1 - hi[0] - hi[1] - hi[2]), hi[0], hi[1], hi[2]];
}

/** Rarity roll by wave (or level) and Luck: 1 common .. 4 legendary. */
export function rollTier(w, wave, luck = 0) {
  const [, t2, t3, t4] = tierOdds(wave, luck);
  const r = next(w.rng);
  if (r < t4) return 4;
  if (r < t4 + t3) return 3;
  if (r < t4 + t3 + t2) return 2;
  return 1;
}

// ---- Prices ----

/** Brotato-style inflation: floor(base + wave + base * 0.1 * wave). */
export function inflate(base, wave, mult = 1) {
  return Math.floor((base + wave + base * 0.1 * wave) * mult);
}

export function weaponPrice(wid, tier, wave) {
  return inflate(WEAPONS[wid].price * WEAPON_TIER_PRICE[tier - 1], wave);
}

export function itemPrice(id, wave) {
  return inflate(ITEMS[id].price, wave, BALANCE.economy.itemPriceMult);
}

/** Refund for selling a weapon now. */
export function sellPrice(w, wpn) {
  return Math.max(1, Math.floor(weaponPrice(wpn.wid, wpn.tier, w.wave) * S.sellRefund));
}

/** Price of a reroll after `count` earlier presses this wave. Shared by shop and level-up rerolls. */
export function rerollPrice(wave, count = 0) {
  const step = Math.max(1, Math.floor(S.rerollStepFactor * wave));
  return Math.floor(S.rerollBaseFactor * wave) + step * (1 + count);
}

export function rerollCost(w, p) {
  return rerollPrice(w.wave, p.shop?.rerolls || 0);
}

// ---- Offers ----

/** Is the player at the copy limit of an item? `pending` (item ids) counts as already held. */
export function atItemLimit(p, id, pending = null) {
  const lim = ITEMS[id].limit;
  if (!lim) return false;
  let n = 0;
  for (const x of p.items) if (x === id) n++;
  if (pending) for (const x of pending) if (x === id) n++;
  return n >= lim;
}

/** What a weapon is about, as item tags: melee or ranged, plus summon (drones, turrets) and explosive (lobbers, bombs). */
export function weaponTags(wid) {
  const d = WEAPONS[wid];
  if (!d) return [];
  const t = [d.kind === 'melee' ? 'melee' : 'ranged'];
  if (d.behaviour === 'drone' || d.behaviour === 'turret') t.push('summon');
  if (d.behaviour === 'lob' || d.behaviour === 'bounce') t.push('explosive');
  return t;
}

/**
 * The build's tags with a weight each: one per held item having the tag, one per weapon of that kind.
 * Works on a world player or a private view (both have `items` and `weapons`).
 * @returns {Object<string, number>}
 */
export function ownedTags(p) {
  const n = {};
  for (const id of p.items || []) for (const t of ITEMS[id]?.tags || []) n[t] = (n[t] || 0) + 1;
  for (const wpn of p.weapons || []) for (const t of weaponTags(wpn.wid)) n[t] = (n[t] || 0) + 1;
  return n;
}

// The run's pool (docs/PROGRESSION.md): locked content stays out of the shop and crates. w.pool is null for everything.
// Weapons you already own can still be offered (a hero's starting weapon may be locked for everyone else).
const weaponPool = (w) => w.pool?.weapons || WEAPON_IDS;
const itemPool = (w) => w.pool?.items || ITEM_IDS;

/**
 * One weapon offer. `offers` are the other current offers (avoids showing the same weapon twice).
 * `opts.classes` (a Set of weapon classes) limits the roll to weapons of those classes.
 */
export function rollWeaponOffer(w, p, offers = [], opts = {}) {
  const owned = p.weapons.map((x) => x.wid);
  const taken = new Set(offers.filter((o) => o && o.kind === 'weapon').map((o) => o.id));
  const all = weaponPool(w);
  const only = opts.classes ? all.filter((id) => opts.classes.has(WEAPONS[id].cls)) : null;
  let wid = null;
  for (let tries = 0; tries < 6; tries++) {
    const r = next(w.rng);
    if (only && only.length) wid = pick(w.rng, only);
    else if (owned.length && r < SHOP_RULES.ownedWeaponChance) wid = pick(w.rng, owned);
    else if (owned.length && r < SHOP_RULES.ownedWeaponChance + SHOP_RULES.ownedClassChance) {
      const cls = WEAPONS[pick(w.rng, owned)].cls;
      const same = all.filter((id) => WEAPONS[id].cls === cls);
      wid = pick(w.rng, same.length ? same : all);
    } else wid = pick(w.rng, all);
    if (!taken.has(wid)) break;
  }
  const tier = Math.min(4, rollTier(w, w.wave, p.stats.luck));
  return { kind: 'weapon', id: wid, tier, price: weaponPrice(wid, tier, w.wave), locked: false };
}

/**
 * One item offer: roll a rarity, take an item of that rarity (or the next lower one with stock).
 * Two independent leans decide which items are considered (each falls back to the whole pool when nothing is in stock,
 * so an offer always comes out):
 *  - 35% of the time (LEAN_CHANCE) only items that raise one of the hero's leaned stats;
 *  - 25% of the time (SHOP_RULES.tagLeanChance) only items sharing a tag with your build (ownedTags), the tag picked at
 *    random weighted by how much of it you own. When both apply, items that satisfy both come first.
 * `opts.rolls` rolls the rarity several times and keeps the best (elite crates); `opts.pending` = item ids that count as held
 * for the copy limits (defaults to the player's unopened crate offers).
 */
export function rollItemOffer(w, p, offers = [], opts = {}) {
  const taken = new Set(offers.filter((o) => o && o.kind === 'item').map((o) => o.id));
  const pend = opts.pending || (p.crateOffers && p.crateOffers.length ? p.crateOffers.map((o) => o.id) : null);
  let start = rollTier(w, w.wave, p.stats.luck);
  for (let r = 1; r < (opts.rolls || 1); r++) start = Math.max(start, rollTier(w, w.wave, p.stats.luck));
  const lean = HERO_LEAN[p.char];
  const leaning = !!lean && chance(w.rng, LEAN_CHANCE);
  let tag = null;
  if (chance(w.rng, SHOP_RULES.tagLeanChance)) {
    const have = Object.entries(ownedTags(p));
    if (have.length) tag = weighted(w.rng, have);
  }
  const passes = [];
  if (tag && leaning) passes.push({ lean: true, tag });
  if (tag) passes.push({ tag });
  if (leaning) passes.push({ lean: true });
  passes.push({});
  // A tag pass may also step UP to a rarity that is already unlocked at this wave (a small tag pool rarely has an item of
  // exactly the rolled rarity), so the lean really shows up. Plain passes only ever step down, as before.
  const odds = tierOdds(w.wave, p.stats.luck);
  let top = 1;
  for (let t = 2; t <= 4; t++) if (odds[t - 1] > 0) top = t;
  for (const avoidTaken of [true, false]) { // a different item beats a leaned duplicate
    for (const pass of passes) {
      const order = [];
      for (let t = start; t >= 1; t--) order.push(t);
      if (pass.tag) for (let t = start + 1; t <= top; t++) order.push(t);
      for (const tier of order) {
        const pool = itemPool(w).filter((id) => ITEMS[id].tier === tier && !atItemLimit(p, id, pend) && !(avoidTaken && taken.has(id))
          && (!pass.lean || raisesAny(id, lean)) && (!pass.tag || ITEMS[id].tags?.includes(pass.tag)));
        if (pool.length) {
          const id = pick(w.rng, pool);
          return { kind: 'item', id, tier, price: itemPrice(id, w.wave), locked: false };
        }
      }
    }
  }
  return rollWeaponOffer(w, p, offers);
}

/** Which slots (weapon or item) to fill, given what is locked. */
function planKinds(w, freeCount, lockedWeapons) {
  let kinds;
  if (w.wave <= SHOP_RULES.exactWeaponsUntil) {
    const nW = Math.max(0, Math.min(freeCount, SHOP_RULES.exactWeapons - lockedWeapons));
    kinds = Array.from({ length: freeCount }, (_, i) => (i < nW ? 'weapon' : 'item'));
  } else {
    kinds = Array.from({ length: freeCount }, () => (chance(w.rng, SHOP_RULES.weaponSlotChance) ? 'weapon' : 'item'));
    if (w.wave <= SHOP_RULES.minWeaponsUntil && lockedWeapons < SHOP_RULES.minWeapons && freeCount > 0
      && !kinds.includes('weapon')) {
      kinds[int(w.rng, 0, freeCount - 1)] = 'weapon';
    }
  }
  return shuffle(w.rng, kinds); // weapons land in random slots
}

/** Fill every unlocked slot with a fresh offer. Early waves guarantee weapons. */
export function rollOffers(w, p) {
  const offers = p.shop.offers;
  const free = [];
  for (let i = 0; i < S.slots; i++) if (!offers[i] || !offers[i].locked) free.push(i);
  const lockedWeapons = offers.filter((o) => o && o.locked && o.kind === 'weapon').length;
  const kinds = planKinds(w, free.length, lockedWeapons);
  for (const slot of free) offers[slot] = null;
  free.forEach((slot, j) => {
    offers[slot] = kinds[j] === 'weapon' ? rollWeaponOffer(w, p, offers) : rollItemOffer(w, p, offers);
  });
  if (w.wave <= OWNED_CLASS_WEAPON_UNTIL) ensureOwnedClassWeapon(w, p, free);
}

/**
 * Early shops steer toward a build: if no weapon offer (locked ones count) is of a class the player owns,
 * one of the freshly rolled weapon offers is re-rolled within the owned classes.
 */
function ensureOwnedClassWeapon(w, p, free) {
  const classes = new Set(p.weapons.map((x) => WEAPONS[x.wid].cls));
  if (!classes.size) return;
  const offers = p.shop.offers;
  if (offers.some((o) => o && o.kind === 'weapon' && classes.has(WEAPONS[o.id].cls))) return;
  const slots = free.filter((i) => offers[i] && offers[i].kind === 'weapon');
  if (!slots.length) return;
  const slot = pick(w.rng, slots);
  offers[slot] = null;
  offers[slot] = rollWeaponOffer(w, p, offers, { classes });
}

/** Called for each player when the shop phase starts. Locked offers stay, at their old price. */
export function openShop(w, p) {
  const kept = p.shop ? p.shop.offers.map((o) => (o && o.locked ? o : null)) : [];
  p.shop = { offers: kept.length ? kept : new Array(S.slots).fill(null), rerolls: 0, levelRerolls: 0 };
  while (p.shop.offers.length < S.slots) p.shop.offers.push(null);
  rollOffers(w, p);
  p.ready = false;
  rollLevelChoices(w, p);
}

// ---- Weapons ----

/** How a weapon offer would join the build: 'add' (free slot), 'merge' (same weapon and tier), 'swap' (one-slot heroes), or null. */
function canAddWeapon(p, wid, tier) {
  const max = maxWeaponsOf(p.char);
  if (p.weapons.length < max) return 'add';
  if (tier < 4 && p.weapons.some((x) => x.wid === wid && x.tier === tier)) return 'merge';
  if (max === 1 && p.weapons.length === 1) return 'swap';
  return null;
}

function mergeInto(p, wid, tier) {
  const target = p.weapons.find((x) => x.wid === wid && x.tier === tier);
  target.tier++;
  return target;
}

/**
 * Apply a shop op for player pid. Ops:
 *  {op:'buy', slot} {op:'reroll'} {op:'lock', slot} {op:'sell', uid} {op:'merge', uid}
 *  {op:'level', idx} {op:'levelReroll'} {op:'crate', idx, take:true|false, cid?} {op:'ready', value?}
 * @returns {{ok:boolean, msg?:string}}
 */
export function applyShopOp(w, pid, op) {
  const p = w.players[pid];
  if (!p || p.gone || w.phase !== 'shop' || !op || !p.shop) return { ok: false, msg: 'Not in shop' };
  const res = runShopOp(w, p, op);
  refreshHoard(p); // Hoard Heart's damage follows the amber held
  return res;
}

function runShopOp(w, p, op) {
  switch (op.op) {
    case 'buy': {
      const o = p.shop.offers[op.slot];
      if (!o) return { ok: false, msg: 'Sold out' };
      if (p.amber < o.price) return { ok: false, msg: 'Not enough amber' };
      if (o.kind === 'weapon') {
        const how = canAddWeapon(p, o.id, o.tier);
        if (!how) return { ok: false, msg: 'Weapon slots full' };
        if (how === 'add') p.weapons.push({ wid: o.id, tier: o.tier, cd: 0.3, uid: p.nextWeaponUid++ });
        else if (how === 'swap') {
          const old = p.weapons[0];
          p.amber += sellPrice(w, old); // the old weapon is sold; its damage record stays in the score
          p.weapons[0] = { wid: o.id, tier: o.tier, cd: 0.3, uid: p.nextWeaponUid++ };
        } else mergeInto(p, o.id, o.tier);
      } else {
        if (atItemLimit(p, o.id)) return { ok: false, msg: 'Item limit reached' };
        p.items.push(o.id);
      }
      p.amber -= o.price;
      p.shop.offers[op.slot] = null;
      recomputeStats(p);
      if (p.shop.offers.every((x) => !x)) rollOffers(w, p); // bought everything: free reroll
      return { ok: true };
    }
    case 'reroll': {
      const cost = rerollCost(w, p);
      if (p.amber < cost) return { ok: false, msg: 'Not enough amber' };
      p.amber -= cost;
      p.shop.rerolls++;
      rollOffers(w, p);
      return { ok: true };
    }
    case 'lock': {
      const o = p.shop.offers[op.slot];
      if (!o) return { ok: false };
      o.locked = !o.locked;
      return { ok: true };
    }
    case 'sell': {
      if (p.weapons.length <= 1) return { ok: false, msg: 'Keep at least one weapon' };
      const i = p.weapons.findIndex((x) => x.uid === op.uid);
      if (i < 0) return { ok: false };
      p.amber += sellPrice(w, p.weapons[i]);
      p.weapons.splice(i, 1);
      recomputeStats(p);
      return { ok: true };
    }
    case 'merge': {
      const a = p.weapons.find((x) => x.uid === op.uid);
      if (!a || a.tier >= 4) return { ok: false, msg: 'Cannot merge' };
      const b = p.weapons.find((x) => x !== a && x.wid === a.wid && x.tier === a.tier);
      if (!b) return { ok: false, msg: 'Need a matching weapon' };
      p.weapons.splice(p.weapons.indexOf(b), 1);
      a.tier++;
      recomputeStats(p);
      return { ok: true };
    }
    case 'level':
      return chooseLevel(w, p, op.idx);
    case 'levelReroll':
      return rerollLevelChoices(w, p);
    case 'crate':
      return crateOp(w, p, op);
    case 'ready':
      p.ready = op.value === undefined ? !p.ready : !!op.value;
      if (p.ready) autoResolve(w, p); // crates left unopened are taken (or recycled if the item can't be held any more)
      return { ok: true };
    default:
      return { ok: false, msg: 'Unknown op' };
  }
}

// ---- Test hook: a fair build for ?wave=N ----

/**
 * Amber a decent player collects during `wave` (before Harvesting), per player.
 * Derived from the wave table and enemy amber values (75% collected); falls back to a plain curve.
 */
export function expectedWaveAmber(wave, players = 1) {
  const W = WAVES[Math.min(WAVES.length, Math.max(1, wave)) - 1];
  let share = 0, amber = 0;
  for (const [type, wt] of Object.entries(W.mix || {})) { share += wt; amber += wt * (ENEMIES[type]?.amber ?? 1); }
  const E = BALANCE.economy;
  const drop = Math.max(E.dropMin, E.dropStart - Math.max(0, wave - 2) * E.dropPerWave);
  let base = (W.total || 0) * (share ? amber / share : 1) * drop + (W.elite ? 25 : 0) + (W.boss ? 60 : 0);
  if (!Number.isFinite(base) || base <= 0) base = 12 + 9 * wave;
  const n = Math.max(1, players);
  const coop = (1 + BALANCE.coop.spawnPerExtraPlayer * (n - 1)) / n; // more enemies, split between players
  return Math.max(1, Math.round(base * 0.68 * coop)); // a player misses some pickups (calibrated to real bot runs)
}

/** After the shop bot is satisfied, a real player still spends most of their amber: buy the priciest offers. */
function spendLeftovers(w, p) {
  for (let guard = 0; guard < 8; guard++) {
    let best = -1, bestScore = -1;
    p.shop.offers.forEach((o, slot) => {
      if (!o || o.price > p.amber) return;
      if (o.kind === 'weapon') {
        const how = canAddWeapon(p, o.id, o.tier);
        if (!how || (how === 'swap' && o.tier <= p.weapons[0].tier)) return; // never swap sideways or down on its own
      } else if (atItemLimit(p, o.id)) return;
      const score = o.tier * 1000 + o.price;
      if (score > bestScore) { bestScore = score; best = slot; }
    });
    if (best < 0 || !applyShopOp(w, p.id, { op: 'buy', slot: best }).ok) return;
  }
}

/**
 * Give every player the build a fair run would have at the start of `targetWave`: for waves
 * 1..targetWave-1 add the expected amber and XP, pay Harvesting, and let a greedy buyer shop and pick
 * level-ups. Leaves w.wave and w.phase as they were and does not leave events behind.
 */
export function autoLoadout(w, targetWave) {
  const savedWave = w.wave, savedPhase = w.phase, evLen = w.events.length;
  const live = w.players.filter((p) => !p.gone);
  const n = Math.max(1, live.length);
  for (let wave = 1; wave < targetWave; wave++) {
    w.wave = wave;
    w.phase = 'shop';
    for (const p of live) {
      const earned = expectedWaveAmber(wave, n);
      p.amber += earned;
      p.score.amber += earned;
      grantXp(w, p, earned);
      payHarvest(w, p);
      openShop(w, p);
      let op, guard = 0;
      while ((op = botShopOp(privateView(w, p.id))) && guard++ < 80) {
        if (!applyShopOp(w, p.id, op).ok) break;
      }
      while (p.levelChoices && p.levelChoices.length) chooseLevel(w, p, 0); // never leave a level-up open
      spendLeftovers(w, p);
    }
  }
  w.wave = savedWave;
  w.phase = savedPhase;
  w.events.length = Math.min(w.events.length, evLen);
  for (const p of live) {
    p.shop = null;
    p.levelChoices = null;
    p.ready = false;
    recomputeStats(p);
    p.hp = p.stats.maxHp;
  }
}
