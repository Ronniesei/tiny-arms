// Text for weapons, items, stats and upgrades shown in the UI. Pure data -> text: no DOM, so tests can run it in Node.
//
// A "line" is { text, good?, note?, label?, value?, detail? }:
//   text    the whole line as plain text (always set; tooltips and tests use it)
//   label / value / detail   the same line split for a two-column layout (value is the bold number)
//   good    true = green, false = red, undefined = neutral;   note: true = small muted text
//   effect  (with note) the item's special effect: drawn brighter than other notes

import { WEAPONS, CLASSES } from '../data/weapons.js';
import { ITEMS, UPGRADES, TAGS } from '../data/items.js';
import { CHARACTERS } from '../data/characters.js';
import { PIERCE_FALLOFF } from '../sim/systems/weapons.js';
import { STAT_LABELS, weaponDamage, weaponCooldown, weaponRange, abilityMult, classCounts } from '../sim/stats.js';

export const TIER_NAMES = ['Common', 'Uncommon', 'Rare', 'Legendary'];
export const TIER_CLASS = ['t1', 't2', 't3', 't4'];
export const ROMAN = ['I', 'II', 'III', 'IV'];

/** A stat is a percentage when its label says so ("Damage %"). */
export const isPct = (k) => /%$/.test(STAT_LABELS[k] || '');

/** Stat name without the "%" suffix ("Damage %" -> "Damage"). */
export function statLabel(k) {
  return (STAT_LABELS[k] || k || '').replace(/\s*%$/, '');
}

/** 12 -> "12", 12.345 -> "12.3", 12.0 -> "12". Never "NaN". */
export function fmt(n, digits = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  if (Number.isInteger(v)) return String(v);
  return String(+v.toFixed(digits));
}

/** A stat value with its unit: 12 -> "12%" for percent stats, "12" otherwise. */
export function statValue(k, v) {
  return `${fmt(v)}${isPct(k) ? '%' : ''}`;
}

export function statLine(k, v) {
  const num = Number(v) || 0;
  const label = statLabel(k);
  const value = `${num > 0 ? '+' : ''}${fmt(num)}${isPct(k) ? '%' : ''}`;
  return { text: `${value} ${label}`, good: num > 0, label, value };
}

const tierVal = (v, tier) => (Array.isArray(v) ? v[tier - 1] : v);

/** "100% Ranged Dmg, 10% Max HP" for a weapon's scaling table. */
export function scalingText(d) {
  return Object.entries(d?.scaling || {}).map(([k, v]) => `${fmt(Math.round(v * 100))}% ${statLabel(k)}`).join(', ');
}

/**
 * The numbers for one weapon at one tier. With `stats` (a player's stats) they are what the weapon would
 * really do for that player; without, the base numbers.
 */
export function weaponStats(wid, tier, stats = null) {
  const d = WEAPONS[wid];
  if (!d) return null;
  const i = Math.max(0, Math.min(3, tier - 1));
  const t = i + 1;
  const base = d.dmg[i];
  const dmg = stats ? weaponDamage(d, t, stats) : base;
  const cooldown = stats ? weaponCooldown(d, t, stats) : d.cooldown[i];
  const count = d.behaviour === 'turret' ? (tierVal(d.count, t) || 1) : 1;
  const dps = cooldown > 0 ? (dmg / cooldown) * count : 0;
  const range = stats ? weaponRange(d, stats) : d.range;
  return { base, dmg, cooldown, dps, range, count };
}

/**
 * Lines for a weapon card. `stats` = the player's stats, so Damage / DPS / Range / Crit are what they would
 * really get; leave it out for a stat-free description.
 */
export function weaponLines(wid, tier, stats = null) {
  const d = WEAPONS[wid];
  if (!d) return [];
  const i = Math.max(0, Math.min(3, tier - 1));
  const t = i + 1;
  const s = weaponStats(wid, t, stats);
  const ap = stats ? abilityMult(stats) : 1;
  const lines = [];
  const add = (label, value, detail, extra = {}) => {
    value = String(value);
    lines.push({ label, value, detail: detail || undefined, text: `${label} ${value}${detail ? ` (${detail})` : ''}`, ...extra });
  };

  const scal = scalingText(d);
  add('Damage', fmt(s.dmg), `${fmt(s.base)}${scal ? ` + ${scal}` : ''}`);
  add('Cooldown', `${fmt(s.cooldown, 2)}s`);
  add('DPS', fmt(s.dps), '', { strong: true });
  add(d.kind === 'melee' ? 'Reach' : 'Range', fmt(Math.round(s.range)));

  const crit = (d.critChance || 0) + (stats ? stats.critChance || 0 : 0);
  if (crit > 0) add('Crit', `${fmt(crit)}% x${fmt(Math.max(1.1, (d.critMult || 1.5) + (stats ? stats.critMultAdd || 0 : 0)))}`);

  const pierce = (d.pierce || 0) + (tierVal(d.pierceTier, t) || 0);
  if (pierce > 0) {
    const fall = Math.round((tierVal(d.pierceFalloff, t) ?? PIERCE_FALLOFF[i]) * 100);
    add('Pierce', `${pierce} extra ${pierce === 1 ? 'enemy' : 'enemies'}`, `at ${fall}% damage`);
  }

  const radius = tierVal(d.radius, t);
  if (radius > 0) add('Blast radius', fmt(radius));
  const bounces = tierVal(d.bounces, t);
  if (bounces > 0) add('Bounces', `${bounces}`);
  const fire = tierVal(d.fireDps, t);
  if (fire > 0) add('Burning ground', `${fmt(fire * ap)}/s for ${fmt(tierVal(d.fireDur, t) || 0)}s`);
  if (d.burn) {
    const bd = tierVal(d.burn.dps, t);
    if (bd > 0) add('Burn', `${fmt(bd * ap)}/s for ${fmt(d.burn.time || 0)}s`);
  }
  if (d.behaviour === 'turret') add('Turrets', `${s.count}`);
  if (d.knockback >= 100) add('Knockback', fmt(d.knockback));

  if (d.desc) lines.push({ text: d.desc, note: true });
  // Brutus's Thick Skull changes melee / ranged damage; the Damage number above already includes it.
  const mult = stats ? (d.kind === 'melee' ? stats.meleeMult : stats.rangedMult) ?? 1 : 1;
  if (Math.abs(mult - 1) > 0.001) lines.push({ text: `Hero trait: ${mult > 1 ? '+' : '-'}${Math.round(Math.abs(mult - 1) * 100)}% damage`, note: true });
  return lines;
}

export function weaponTitle(wid) {
  const d = WEAPONS[wid];
  return d ? `${d.name}` : wid;
}

export function weaponClass(wid) {
  const d = WEAPONS[wid];
  return d ? CLASSES[d.cls]?.name || d.cls : '';
}

/** Sorted thresholds of a class set bonus: [2, 4, 6]. */
export function classThresholds(cls) {
  return Object.keys(CLASSES[cls]?.bonuses || {}).map(Number).sort((a, b) => a - b);
}

/** Lines for the bonus a class gives at threshold `th` ("+2 Melee Dmg"). */
export function bonusLines(cls, th) {
  const b = CLASSES[cls]?.bonuses?.[th];
  return b ? Object.entries(b).map(([k, v]) => statLine(k, v)) : [];
}

export const bonusText = (cls, th) => bonusLines(cls, th).map((l) => l.text).join(', ');

/**
 * If adding one `wid` weapon to `weapons` ([{wid}]) reaches a set-bonus threshold of its class, describe it:
 * { cls, name, count, threshold, text } where text is the stats the bonus gives at that threshold. Else null.
 */
export function setBonusHint(wid, weapons) {
  const d = WEAPONS[wid];
  if (!d) return null;
  const owned = classCounts({ weapons })[d.cls] || 0;
  const count = owned + 1;
  if (!classThresholds(d.cls).includes(count)) return null;
  return { cls: d.cls, name: CLASSES[d.cls]?.name || d.cls, count, threshold: count, text: bonusText(d.cls, count) };
}

// Fallback wording for special item effects whose item has no `desc`.
const SPECIAL_TEXT = {
  burnOnCrit: 'Your crits set enemies on fire.',
  lowHpAmber: '+1 amber per kill while you are below 50% HP.',
  herdBond: 'Reviving a mate gives you both mana.',
  manaDiscount: 'Abilities cost less mana.',
  amberBonus: 'More amber from pickups.',
  nestAura: 'Downed allies near you revive faster.',
};

/** An item's tags as chips: [{id, name}] (see TAGS in data/items.js). */
export function itemTags(id) {
  return (ITEMS[id]?.tags || []).map((t) => ({ id: t, name: TAGS[t] || t }));
}

/**
 * Tags the item shares with the build: [{id, name, n}] where n = how much of that tag the build already has
 * (`owned` = ownedTags() from sim/shop.js: held items plus what the weapons are).
 */
export function sharedTags(id, owned = {}) {
  return itemTags(id).filter((t) => owned[t.id] > 0).map((t) => ({ ...t, n: owned[t.id] }));
}

export function itemLines(id) {
  const it = ITEMS[id];
  if (!it) return [];
  const lines = Object.entries(it.stats || {}).map(([k, v]) => statLine(k, v));
  if (it.desc) lines.push({ text: it.desc, note: true, effect: true });
  else for (const k of Object.keys(it.special || {})) if (SPECIAL_TEXT[k]) lines.push({ text: SPECIAL_TEXT[k], note: true, effect: true });
  if (it.limit) lines.push({ text: `Limit ${it.limit}`, note: true });
  return lines;
}

export function upgradeLine(c) {
  const u = UPGRADES[c?.stat];
  return statLine(c.stat, c.value).text || `${u?.name} +${c.value}`;
}

/**
 * Everything a level-up card needs: the change, and what the stat is now and would be after picking it.
 * `stats` = the player's current stats, `charId` applies the character's multiplier (Brutus's x1.4 Max HP).
 */
export function upgradeInfo(c, stats = {}, charId = null) {
  const line = statLine(c.stat, c.value);
  const mult = CHARACTERS[charId]?.mult?.[c.stat] ?? 1;
  const cur = Number(stats?.[c.stat]) || 0;
  let after = cur + c.value * mult;
  if (c.stat === 'maxHp') after = Math.max(1, Math.round(after));
  else if (c.stat === 'maxMana') after = Math.max(10, Math.round(after));
  return {
    label: line.label, value: line.value, text: line.text, tier: c.tier,
    before: statValue(c.stat, cur), after: statValue(c.stat, after),
    change: `${statLabel(c.stat)} ${statValue(c.stat, cur)} → ${statValue(c.stat, after)}`,
  };
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
