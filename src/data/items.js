// Shop items, level-up upgrades and the numbers behind special item effects.
// tier: 1 common (white), 2 uncommon (blue), 3 rare (purple), 4 legendary (red).
// stats: flat stat changes while held (most items trade one stat up for another down).
// special: numeric effect keys, summed over held items into player.specials by stats.js
//   (burnOnCrit, lowHpAmber, herdBond, manaDiscount, amberBonus, nestAura). Tuning: SPECIAL_RULES below.
// limit: max copies a player can hold (the shop stops offering it). price: base price before wave inflation.
// Icons are assets/sprites/i_<id>.svg.

export const ITEMS = {
  // ---- Tier 1 (common) ----
  sharp_tooth:  { id: 'sharp_tooth',  name: 'Sharp Tooth',  tier: 1, price: 14, icon: 'i_sharp_tooth',  stats: { damage: 8 } },
  thick_hide:   { id: 'thick_hide',   name: 'Thick Hide',   tier: 1, price: 14, icon: 'i_thick_hide',   stats: { armor: 2, speed: -5 } },
  big_heart:    { id: 'big_heart',    name: 'Big Heart',    tier: 1, price: 14, icon: 'i_big_heart',    stats: { maxHp: 5 } },
  fast_feet:    { id: 'fast_feet',    name: 'Fast Feet',    tier: 1, price: 14, icon: 'i_fast_feet',    stats: { speed: 8, armor: -1 }, limit: 6 },
  fern_snack:   { id: 'fern_snack',   name: 'Fern Snack',   tier: 1, price: 13, icon: 'i_fern_snack',   stats: { hpRegen: 3 } },
  shiny_pebble: { id: 'shiny_pebble', name: 'Shiny Pebble', tier: 1, price: 12, icon: 'i_shiny_pebble', stats: { luck: 12 } },
  bone_charm:   { id: 'bone_charm',   name: 'Bone Charm',   tier: 1, price: 15, icon: 'i_bone_charm',   stats: { meleeDamage: 2 } },
  feather:      { id: 'feather',      name: 'Feather',      tier: 1, price: 15, icon: 'i_feather',      stats: { rangedDamage: 2, maxHp: -3 } },
  egg_shell:    { id: 'egg_shell',    name: 'Egg Shell',    tier: 1, price: 13, icon: 'i_egg_shell',    stats: { dodge: 8, armor: -1 }, limit: 5 },
  mud_bath:     { id: 'mud_bath',     name: 'Mud Bath',     tier: 1, price: 13, icon: 'i_mud_bath',     stats: { armor: 3, dodge: -5 } },
  glow_moss:    { id: 'glow_moss',    name: 'Glow Moss',    tier: 1, price: 12, icon: 'i_glow_moss',    stats: { manaRegen: 1.5 } },
  amber_nugget: { id: 'amber_nugget', name: 'Amber Nugget', tier: 1, price: 15, icon: 'i_amber_nugget', stats: { harvesting: 6 } },

  // ---- Tier 2 (uncommon) ----
  war_paint:     { id: 'war_paint',     name: 'War Paint',     tier: 2, price: 32, icon: 'i_war_paint',     stats: { damage: 12, critChance: 6, armor: -2 } },
  turtle_shell:  { id: 'turtle_shell',  name: 'Turtle Shell',  tier: 2, price: 30, icon: 'i_turtle_shell',  stats: { armor: 5, speed: -10 } },
  long_neck:     { id: 'long_neck',     name: 'Long Neck',     tier: 2, price: 28, icon: 'i_long_neck',     stats: { range: 25, attackSpeed: -10 } },
  raptor_claw:   { id: 'raptor_claw',   name: 'Raptor Claw',   tier: 2, price: 34, icon: 'i_raptor_claw',   stats: { critChance: 8, attackSpeed: 12, maxHp: -4 } },
  magnet_rock:   { id: 'magnet_rock',   name: 'Magnet Rock',   tier: 2, price: 28, icon: 'i_magnet_rock',   stats: { pickupRange: 40, harvesting: 5 }, limit: 4 },
  mana_crystal:  { id: 'mana_crystal',  name: 'Mana Crystal',  tier: 2, price: 30, icon: 'i_mana_crystal',  stats: { maxMana: 40, abilityPower: 15 } },
  vampire_bat:   { id: 'vampire_bat',   name: 'Vampire Bat',   tier: 2, price: 36, icon: 'i_vampire_bat',   stats: { lifeSteal: 4, hpRegen: -2 }, limit: 4 },
  coffee_bean:   { id: 'coffee_bean',   name: 'Coffee Bean',   tier: 2, price: 32, icon: 'i_coffee_bean',   stats: { attackSpeed: 18, hpRegen: -3 } },
  volcano_ash:   { id: 'volcano_ash',   name: 'Volcano Ash',   tier: 2, price: 34, icon: 'i_volcano_ash',   stats: { critChance: 5 }, special: { burnOnCrit: 1 }, limit: 1, desc: 'Your crits set enemies on fire.' },

  // ---- Tier 3 (rare) ----
  trex_skull:   { id: 'trex_skull',   name: 'T-Rex Skull',  tier: 3, price: 58, icon: 'i_trex_skull',   stats: { damage: 22, meleeDamage: 3, speed: -10 } },
  comet_shard:  { id: 'comet_shard',  name: 'Comet Shard',  tier: 3, price: 54, icon: 'i_comet_shard',  stats: { abilityPower: 40, manaRegen: 3, maxHp: -6 } },
  golden_egg:   { id: 'golden_egg',   name: 'Golden Egg',   tier: 3, price: 52, icon: 'i_golden_egg',   stats: { harvesting: 4 }, special: { lowHpAmber: 1 }, limit: 1, desc: '+1 amber per kill while you are below 50% HP.' },
  herd_bond:    { id: 'herd_bond',    name: 'Herd Bond',    tier: 3, price: 50, icon: 'i_herd_bond',    stats: { maxHp: 4, manaRegen: 1 }, special: { herdBond: 40 }, limit: 1, desc: 'Reviving a mate gives you both 40 mana.' },
  lucky_clover: { id: 'lucky_clover', name: 'Lucky Clover', tier: 3, price: 56, icon: 'i_lucky_clover', stats: { luck: 30, harvesting: 8 } },
  thunder_egg:  { id: 'thunder_egg',  name: 'Thunder Egg',  tier: 3, price: 52, icon: 'i_thunder_egg',  stats: { maxMana: 20 }, special: { manaDiscount: 0.2 }, limit: 3, desc: 'Abilities cost 20% less mana.' },
  tail_ring:    { id: 'tail_ring',    name: 'Tail Ring',    tier: 3, price: 54, icon: 'i_tail_ring',    stats: { meleeDamage: 2, armor: 3, rangedDamage: -2 } },

  // ---- Tier 4 (legendary) ----
  meteor_heart:  { id: 'meteor_heart',  name: 'Meteor Heart',  tier: 4, price: 96,  icon: 'i_meteor_heart',  stats: { damage: 30, abilityPower: 30, armor: -3 }, limit: 2 },
  ancient_amber: { id: 'ancient_amber', name: 'Ancient Amber', tier: 4, price: 88,  icon: 'i_ancient_amber', stats: { harvesting: 10 }, special: { amberBonus: 0.25 }, limit: 1, desc: '+25% amber from pickups.' },
  mother_nest:   { id: 'mother_nest',   name: "Mother's Nest", tier: 4, price: 92,  icon: 'i_mother_nest',   stats: { maxHp: 15 }, special: { nestAura: 2 }, limit: 1, desc: 'Downed allies near you revive 2x faster.' },
  dino_crown:    { id: 'dino_crown',    name: 'Dino Crown',    tier: 4, price: 110, icon: 'i_dino_crown',    stats: { damage: 10, meleeDamage: 2, rangedDamage: 2, abilityPower: 10, luck: 15 }, limit: 1 },
};

export const ITEM_IDS = Object.keys(ITEMS);

/** Numbers behind the special effects (read by damage.js, downed.js, pickups.js, stats.js). */
export const SPECIAL_RULES = {
  // Volcano Ash: a crit burns the enemy for `time` s at max(minDps, hit damage x dpsPerHit) per second.
  burnOnCrit: { time: 3, dpsPerHit: 0.35, minDps: 2 },
  // Golden Egg: kills below this fraction of max HP pay the amber bonus (the amount is the item's special value).
  lowHpAmber: { hpFrac: 0.5 },
  // Thunder Egg: discounts stack but never go past this.
  manaDiscountCap: 0.6,
  // Mother's Nest: revive speed multiplier applies to downed allies within this many px of the holder.
  nestAura: { radius: 150 },
};

/** Shop offer rules (slots, prices and reroll growth are in BALANCE.shop). */
export const SHOP_RULES = {
  exactWeaponsUntil: 2, exactWeapons: 2,  // waves 1-2: exactly 2 weapons + 2 items
  minWeaponsUntil: 5, minWeapons: 1,      // waves 3-5: at least 1 weapon
  weaponSlotChance: 0.35,                 // otherwise each open slot is a weapon this often
  ownedWeaponChance: 0.20,                // a weapon offer repeats a weapon you hold
  ownedClassChance: 0.15,                 // ...or another weapon of a class you hold
  tierPrice: [1, 1.9, 3.6, 6.8],          // weapon price multiplier by tier I-IV
};

// Shop and level-up rarity chance at 0 Luck (matches docs/brotato-reference.md section 3).
// Anchors are [wave, T2, T3, T4]; T1 is the rest. Linear between anchors, flat after the last.
// Level-up cards use the same table with the level instead of the wave.
export const TIER_ODDS = {
  anchors: [
    [1, 0, 0, 0], [2, 0.05, 0, 0], [3, 0.10, 0, 0], [4, 0.15, 0.01, 0], [5, 0.20, 0.04, 0],
    [7, 0.30, 0.08, 0], [8, 0.34, 0.10, 0.002], [10, 0.40, 0.133, 0.007], [14, 0.40, 0.18, 0.016],
    [19, 0.35, 0.22, 0.028], [20, 0.35, 0.225, 0.03],
  ],
  luckScale: 100,         // +100 Luck doubles the T2-T4 chances (+50 = x1.5)
  caps: [0.6, 0.25, 0.08], // T2, T3, T4 never go above these
};

// Level-up cards: one stat, value per tier (I-IV).
export const UPGRADES = {
  maxHp:        { name: 'Max HP',        values: [3, 6, 9, 12] },
  hpRegen:      { name: 'HP Regen',      values: [2, 3, 4, 5] },
  lifeSteal:    { name: 'Life Steal',    values: [1, 2, 3, 4] },
  damage:       { name: 'Damage',        values: [5, 8, 12, 16], pct: true },
  meleeDamage:  { name: 'Melee Damage',  values: [2, 3, 4, 5] },
  rangedDamage: { name: 'Ranged Damage', values: [1, 2, 3, 4] },
  abilityPower: { name: 'Ability Power', values: [6, 10, 15, 20], pct: true },
  attackSpeed:  { name: 'Attack Speed',  values: [5, 10, 15, 20], pct: true },
  critChance:   { name: 'Crit Chance',   values: [3, 5, 7, 9], pct: true },
  range:        { name: 'Range',         values: [6, 10, 15, 20], pct: true },
  armor:        { name: 'Armor',         values: [1, 2, 3, 4] },
  dodge:        { name: 'Dodge',         values: [3, 6, 9, 12], pct: true },
  speed:        { name: 'Speed',         values: [3, 6, 9, 12], pct: true },
  luck:         { name: 'Luck',          values: [5, 10, 15, 20] },
  harvesting:   { name: 'Harvesting',    values: [5, 8, 10, 12] },
  maxMana:      { name: 'Max Mana',      values: [10, 15, 20, 30] },
  manaRegen:    { name: 'Mana Regen',    values: [1, 1.5, 2, 3] },
};
