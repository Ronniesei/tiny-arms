// Hover explanations for every stat, weapon number, item tag and shop term, anywhere in the DOM UI.
// Mark an element with data-gloss="<glossary key>" (explained below) and/or data-tip-text="<extra text>".
// (data-tip is the shop's own rich hover card for items and weapons; it is separate.)
// Texts are built from the real numbers in src/data, so they stay true when balance changes.

import { BALANCE } from '../data/balance.js';
import { TAGS } from '../data/items.js';

const B = BALANCE;
const pct = (v) => `${Math.round(v * 100)}%`;
const armorCut = (a) => 1 - B.stat.armorK / (B.stat.armorK + a);

/** key -> { t: title, d: description } (d may be a function so it reads live numbers). */
export const GLOSSARY = {
  // ---- Stats ----
  maxHp: { t: 'Max HP', d: () => `How much damage you can take before you go down. HP refills at the start of every wave, and each level-up adds +${B.hpPerLevel}.` },
  hpRegen: { t: 'HP Regen', d: () => `Heals you over time: each point restores about ${B.stat.regenPerPoint} HP per second (10 points is ${(10 * B.stat.regenPerPoint).toFixed(1)} HP/s).` },
  lifeSteal: { t: 'Life Steal', d: () => `Each hit has this % chance to heal you 1 HP (at most ${B.stat.lifeStealCapPerSec} HP per second).` },
  damage: { t: 'Damage %', d: 'Boosts the damage of all your weapons by this percentage, on top of their own damage.' },
  meleeDamage: { t: 'Melee Damage', d: 'Flat damage added to melee weapons (clubs, axes, the tail spike), scaled by each weapon\'s melee %.' },
  rangedDamage: { t: 'Ranged Damage', d: 'Flat damage added to ranged weapons (slingshot, spears, bows, staffs, turrets), scaled by each weapon\'s ranged %.' },
  abilityPower: { t: 'Ability Power', d: 'Makes your Space ability stronger (damage, healing, stun time) and boosts burn and fire effects.' },
  attackSpeed: { t: 'Attack Speed', d: 'Weapons fire this much faster. +100% means twice as many attacks.' },
  critChance: { t: 'Crit Chance', d: 'Chance for a hit to be a critical hit, which deals extra damage (each weapon\'s crit multiplier, usually x1.5 to x2).' },
  range: { t: 'Range', d: () => `Weapons reach this much farther. Melee weapons get only ${pct(B.stat.meleeRangeFactor)} of the bonus.` },
  armor: { t: 'Armor', d: () => `Reduces damage you take: 5 armor cuts hits by ${pct(armorCut(5))}, 15 armor by ${pct(armorCut(15))}. Negative armor makes you take more.` },
  dodge: { t: 'Dodge', d: () => `Chance to ignore a hit completely (capped at ${B.stat.dodgeCap}%).` },
  speed: { t: 'Speed', d: () => `How fast your T-Rex walks (${B.player.speed} px/s at 0%). Faster means easier kiting and pickups.` },
  luck: { t: 'Luck', d: 'Raises the odds of rarer (blue, purple, red) items and weapons in the shop, level-ups and crates. +100 Luck roughly doubles them.' },
  harvesting: { t: 'Harvesting', d: () => `At the end of every wave you get this much amber and XP for free, and Harvesting itself grows by ${pct(B.economy.harvestGrowth)}.` },
  maxMana: { t: 'Max Mana', d: 'The most mana you can store for your Space ability.' },
  manaRegen: { t: 'Mana Regen', d: 'Mana you regain every second. Kills also give a little mana.' },
  pickupRange: { t: 'Pickup Range', d: () => `How far away amber and berries fly to you (${B.player.pickupRadius} px at 0%).` },

  // ---- Weapon card numbers ----
  w_damage: { t: 'Damage', d: 'Damage of one hit for you right now: the weapon\'s base damage plus your stats.' },
  w_cooldown: { t: 'Cooldown', d: 'Seconds between attacks. Attack Speed makes it shorter.' },
  w_dps: { t: 'DPS', d: 'Damage per second: damage divided by cooldown. Handy for comparing weapons.' },
  w_range: { t: 'Range', d: 'How far the weapon can reach to shoot an enemy (in pixels).' },
  w_reach: { t: 'Reach', d: 'How far the melee swing reaches from your T-Rex (in pixels).' },
  w_crit: { t: 'Crit', d: 'This weapon\'s chance to crit (including your Crit Chance) and how much a crit multiplies the hit.' },
  w_pierce: { t: 'Pierce', d: 'The shot passes through this many extra enemies. Each extra enemy takes reduced damage; higher tiers reduce it less.' },
  w_blast: { t: 'Blast radius', d: 'Size of the explosion; every enemy inside takes the damage.' },
  w_bounces: { t: 'Bounces', d: 'How many times the shot bounces off the arena walls before it explodes.' },
  w_fire: { t: 'Burning ground', d: 'Leaves a patch of fire that hurts enemies standing in it every second. Ability Power makes it stronger.' },
  w_burn: { t: 'Burn', d: 'Sets the enemy on fire: damage every second for a few seconds. Ability Power makes it stronger.' },
  w_turrets: { t: 'Turrets', d: 'How many egg turrets this weapon keeps on the field. Turrets shoot by themselves.' },
  w_knockback: { t: 'Knockback', d: 'How hard hits shove enemies away from you.' },

  // ---- Shop and run terms ----
  amber: { t: 'Amber', d: 'Your money and your XP in one: dead enemies drop it, you walk over it to collect. Spend it in the shop between waves. Amber you miss is not lost: it comes back as bonus drops next wave.' },
  xp: { t: 'Level', d: 'Collecting amber also gives XP. Each level gives +1 Max HP and a stat card to pick in the shop.' },
  reroll: { t: 'Reroll', d: 'Swap the unlocked offers for new ones. It costs more each time you press it, and the price resets every wave.' },
  lock: { t: 'Lock', d: 'Keeps this offer when you reroll and into the next shop, at today\'s price. Locking is free.' },
  merge: { t: 'Merge', d: 'Two identical weapons of the same tier combine into one weapon of the next tier (I to II to III to IV), freeing a slot.' },
  sell: { t: 'Sell', d: () => `Sell a weapon back for ${pct(B.shop.sellRefund)} of its current price.` },
  tier: { t: 'Tier', d: 'Rarity: white Common, blue Uncommon, purple Rare, red Legendary. Rarer things are stronger and appear more often in later waves and with Luck.' },
  setbonus: { t: 'Set bonus', d: 'Holding 2, 4 or 6 weapons of the same class (Primal, Hunter, Volcanic, Swarm, Odd) gives you a bonus.' },
  crate: { t: 'Loot crate', d: 'Dropped mid-wave (elites always drop one). At the end of the wave you open it: take the item for free, or recycle it for amber.' },
  levelup: { t: 'Level-up', d: 'Pick one of these stat cards for each level you gained. Rerolling them costs amber.' },
  ready: { t: 'Ready', d: 'Start the next wave. In co-op the wave starts when everyone is ready (or the timer runs out).' },
  synergy: { t: 'Synergy', d: 'Items and weapons share tags. The shop leans toward tags you already own, so a build snowballs.' },
  herd: { t: 'Herd', d: () => `Each mate within ${B.coop.herdRadius} px gives you +${pct(B.coop.herdDamage)} damage and +${B.coop.herdArmor} armor (up to ${B.coop.herdMax} mates).` },
  mana: { t: 'Mana', d: 'Your Space ability costs mana. It refills over time and from kills.' },
  ability: { t: 'Ability (Space)', d: 'Each T-Rex has one special move. It costs mana and has a cooldown.' },
  trait: { t: 'Trait', d: 'A rule that is always on for this T-Rex and changes how it plays.' },
  roll: { t: 'Dodge roll (Shift)', d: () => `A quick dive the way you're moving, invulnerable for ${B.roll.iframes} s. Cooldown ${B.roll.cooldown} s.` },
  danger: { t: 'Danger', d: 'Difficulty. Higher levels give enemies more HP and damage, and add extra elite waves. Winning a run on a level opens the next one.' },

  // ---- Progression (challenges, locks) ----
  challenge: { t: 'Challenge', d: 'A goal that unlocks one new item or weapon when you finish it. Challenges are checked at the end of every run and your progress is saved in this browser. In co-op a run uses everything your mates have unlocked too.' },
  locked: { t: 'Locked', d: 'Not available yet. Heroes, items, weapons and Danger levels are earned by playing, and anything locked stays out of your runs until you unlock it.' },
};

// Item tags get generated entries.
const TAG_TEXT = {
  melee: 'Melee weapons and items that boost them.', ranged: 'Ranged weapons and items that boost them.',
  explosive: 'Explosions: blasts, bombs and things that make them bigger.', summon: 'Turrets and drones that fight for you.',
  crit: 'Critical hits and things that trigger on them.', mana: 'Mana and your Space ability.', greed: 'Amber and economy: more money now, power later.',
  defense: 'Armor, dodge and staying alive.', sustain: 'Healing and regeneration.', speed: 'Moving and attacking faster.',
  luck: 'Luck and rarer offers.', damage: 'Raw damage.', cursed: 'Big upside with a real downside.',
};
for (const [id, name] of Object.entries(TAGS)) {
  GLOSSARY[`tag_${id}`] = { t: `${name} tag`, d: `${TAG_TEXT[id] || ''} The shop leans toward tags you already own.`.trim() };
}

/** ` data-gloss="key"` for templates (empty when the key is unknown). */
export function tip(key) {
  return GLOSSARY[key] ? ` data-gloss="${key}"` : '';
}

function textFor(el) {
  const key = el.getAttribute('data-gloss');
  const extra = el.getAttribute('data-tip-text');
  const g = key && GLOSSARY[key];
  if (!g && !extra) return null;
  const d = g ? (typeof g.d === 'function' ? g.d() : g.d) : '';
  return { title: g ? g.t : '', body: [d, extra].filter(Boolean).join('\n') };
}

/** Install one hover tooltip for the whole page (idempotent). */
export function installTips(doc = document) {
  if (doc.getElementById('tip')) return;
  const box = doc.createElement('div');
  box.id = 'tip';
  box.setAttribute('role', 'tooltip');
  doc.body.appendChild(box);
  let current = null;
  const place = (x, y) => {
    const pad = 14, w = box.offsetWidth, h = box.offsetHeight;
    const vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
    let left = x + pad, top = y + pad;
    if (left + w > vw - 8) left = x - w - pad;
    if (top + h > vh - 8) top = y - h - pad;
    box.style.left = `${Math.max(8, left)}px`;
    box.style.top = `${Math.max(8, top)}px`;
  };
  doc.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[data-gloss],[data-tip-text]');
    if (el === current) return;
    current = el;
    const tx = el && textFor(el);
    if (!tx) { box.classList.remove('show'); return; }
    box.innerHTML = '';
    if (tx.title) { const b = doc.createElement('b'); b.textContent = tx.title; box.appendChild(b); }
    for (const line of tx.body.split('\n')) { const p = doc.createElement('p'); p.textContent = line; box.appendChild(p); }
    box.classList.add('show');
    place(e.clientX, e.clientY);
  });
  doc.addEventListener('mousemove', (e) => { if (current) place(e.clientX, e.clientY); });
  doc.addEventListener('mouseleave', () => { current = null; box.classList.remove('show'); });
  // Re-renders replace elements under the mouse: hide when the hovered element leaves the page.
  doc.addEventListener('pointerdown', () => { current = null; box.classList.remove('show'); });
}
