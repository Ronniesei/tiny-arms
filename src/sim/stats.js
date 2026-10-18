// Player stat computation. Final stats = (base + character + items + level-ups + class bonuses) x character mult.
// Call recomputeStats(player) whenever weapons, items or upgrades change.

import { BALANCE } from '../data/balance.js';
import { CHARACTERS } from '../data/characters.js';
import { ITEMS, SPECIAL_RULES } from '../data/items.js';
import { WEAPONS, CLASSES } from '../data/weapons.js';

export const STAT_KEYS = Object.keys(BALANCE.baseStats);

export const STAT_LABELS = {
  maxHp: 'Max HP', hpRegen: 'HP Regen', lifeSteal: 'Life Steal %', damage: 'Damage %',
  meleeDamage: 'Melee Dmg', rangedDamage: 'Ranged Dmg', abilityPower: 'Ability Power %',
  attackSpeed: 'Attack Speed %', critChance: 'Crit %', range: 'Range %', armor: 'Armor',
  dodge: 'Dodge %', speed: 'Speed %', luck: 'Luck', harvesting: 'Harvesting',
  maxMana: 'Max Mana', manaRegen: 'Mana Regen', pickupRange: 'Pickup Range %',
};

/** Special item effects, summed over held items into player.specials (see ITEMS[*].special). */
export const SPECIAL_KEYS = ['burnOnCrit', 'lowHpAmber', 'herdBond', 'manaDiscount', 'amberBonus', 'nestAura'];

export function aggregateSpecials(items) {
  const sp = {};
  for (const k of SPECIAL_KEYS) sp[k] = 0;
  for (const id of items) {
    const add = ITEMS[id]?.special;
    if (add) for (const k in add) sp[k] = (sp[k] || 0) + add[k];
  }
  return sp;
}

function addStats(into, add, times = 1) {
  if (!add) return;
  for (const k in add) if (k in into) into[k] += add[k] * times;
}

/** Class counts for set bonuses (duplicates count). */
export function classCounts(player) {
  const counts = {};
  for (const wpn of player.weapons) {
    const def = WEAPONS[wpn.wid];
    if (def) counts[def.cls] = (counts[def.cls] || 0) + 1;
  }
  return counts;
}

/** The active set bonus per class: { cls: {threshold, stats} }. */
export function activeClassBonuses(player) {
  const out = {};
  const counts = classCounts(player);
  for (const cls in counts) {
    const def = CLASSES[cls];
    if (!def) continue;
    let best = null;
    for (const th of Object.keys(def.bonuses).map(Number).sort((a, b) => a - b)) {
      if (counts[cls] >= th) best = th;
    }
    if (best) out[cls] = { threshold: best, stats: def.bonuses[best] };
  }
  return out;
}

/** Spike's Frenzy: attack speed % from `kills` this wave (0 for heroes without the trait). */
function frenzyBonus(trait, kills) {
  return trait?.frenzyPerKill ? Math.min(trait.frenzyMax, (kills || 0) * trait.frenzyPerKill) : 0;
}

/** A kill by this player: Frenzy grows by one kill (capped). Cheap: no stat recompute. */
export function addFrenzy(player) {
  const t = CHARACTERS[player.char]?.trait;
  if (!t?.frenzyPerKill) return;
  const cap = Math.ceil(t.frenzyMax / t.frenzyPerKill);
  if ((player.frenzy || 0) >= cap) return;
  player.frenzy = (player.frenzy || 0) + 1;
  player.stats.frenzyAs = frenzyBonus(t, player.frenzy);
}

/** Frenzy lasts until the end of the wave (pickups.js payHarvest calls this at every wave end). */
export function resetFrenzy(player) {
  player.frenzy = 0;
  if (player.stats) player.stats.frenzyAs = 0;
}

export function recomputeStats(player) {
  const s = { ...BALANCE.baseStats };
  const c = CHARACTERS[player.char];
  addStats(s, c.stats);
  for (const id of player.items) addStats(s, ITEMS[id]?.stats);
  addStats(s, player.upgrades);
  const bonuses = activeClassBonuses(player);
  for (const cls in bonuses) addStats(s, bonuses[cls].stats);
  s.maxHp += player.level * BALANCE.hpPerLevel;
  const t = c.trait;
  if (t?.armorEvery) s.armor += Math.floor(player.level / t.armorEvery) * (t.armorPer ?? 1);
  for (const k in c.mult) s[k] *= c.mult[k];
  s.maxHp = Math.max(1, Math.round(s.maxHp));
  s.maxMana = Math.max(10, Math.round(s.maxMana));
  // Hero trait numbers the systems read (see `trait` in src/data/characters.js).
  s.meleeMult = t?.meleeDmg ?? 1;
  s.rangedMult = t?.rangedDmg ?? 1;
  s.extraPierce = t?.extraPierce ?? 0;
  s.frenzyAs = frenzyBonus(t, player.frenzy);
  const prevMax = player.stats.maxHp;
  player.stats = s;
  player.specials = aggregateSpecials(player.items);
  // Gaining max HP also heals that amount; losing it clamps.
  if (prevMax !== undefined && s.maxHp > prevMax && !player.downed) player.hp += s.maxHp - prevMax;
  player.hp = Math.min(player.hp, s.maxHp);
  player.mana = Math.min(player.mana, s.maxMana);
  return s;
}

// ---- Derived values (used by systems and by the UI for display) ----

export function moveSpeed(stats) {
  return BALANCE.player.speed * (1 + Math.max(BALANCE.player.minSpeedPct, stats.speed) / 100);
}

export function pickupRadius(stats) {
  return BALANCE.player.pickupRadius * Math.max(0.3, 1 + stats.pickupRange / 100);
}

export function regenPerSec(stats) {
  return Math.max(0, stats.hpRegen) * BALANCE.stat.regenPerPoint;
}

/** Multiplier on incoming damage from armor (negative armor increases damage). */
export function armorFactor(stats) {
  const K = BALANCE.stat.armorK, a = stats.armor;
  return a >= 0 ? K / (K + a) : 1 + -a / K;
}

export function dodgeChance(stats) {
  return Math.min(BALANCE.stat.dodgeCap, Math.max(0, stats.dodge)) / 100;
}

export function weaponRange(def, stats) {
  const f = def.kind === 'melee' ? BALANCE.stat.meleeRangeFactor : 1;
  return def.range * Math.max(0.3, 1 + (stats.range * f) / 100);
}

export function weaponCooldown(def, tier, stats) {
  const as = Math.max(BALANCE.stat.minAttackSpeed, stats.attackSpeed + (stats.frenzyAs || 0));
  return def.cooldown[tier - 1] / (1 + as / 100);
}

export function weaponDamage(def, tier, stats) {
  let d = def.dmg[tier - 1];
  if (def.scaling) for (const k in def.scaling) d += def.scaling[k] * (stats[k] || 0);
  d *= 1 + stats.damage / 100;
  d *= def.kind === 'melee' ? (stats.meleeMult ?? 1) : (stats.rangedMult ?? 1); // Brutus's Thick Skull
  return Math.max(1, d);
}

/** Mana cost of an ability after item discounts (Thunder Egg). Use this wherever an ability is paid for. */
export function abilityCost(player, baseCost) {
  const d = Math.min(SPECIAL_RULES.manaDiscountCap, Math.max(0, player?.specials?.manaDiscount || 0));
  return Math.max(1, Math.round(baseCost * (1 - d)));
}

/** Cooldown in seconds of the player's ability (Sparky's Spark trait shortens it). */
export function abilityCooldown(player, baseCooldown) {
  return baseCooldown * (CHARACTERS[player?.char]?.trait?.abilityCooldownMult ?? 1);
}

export function abilityMult(stats) {
  return Math.max(0.1, 1 + stats.abilityPower / 100);
}
