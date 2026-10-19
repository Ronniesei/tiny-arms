// Shop items, level-up upgrades and the numbers behind special item effects.
// tier: 1 common (white), 2 uncommon (blue), 3 rare (purple), 4 legendary (red).
// stats: flat stat changes while held (most items trade one stat up for another down).
// special: numeric effect keys, summed over held items into player.specials by stats.js (SPECIAL_KEYS there lists
//   them all). The first six (burnOnCrit ... nestAura) are small perks; the "build-maker" items at the bottom change
//   HOW you play (explosions, extra shots, bouncing, summons, crit procs, economy, mana, melee procs, curses). The
//   code that runs them is src/sim/hooks.js (on hit / kill / crit / roll / cast / wave end) plus a few lines in
//   stats, weapons, projectiles, summons, pickups and movement. Tuning numbers: SPECIAL_RULES below.
// tags: what the item is about (TAGS below). The shop leans toward tags you already own (SHOP_RULES.tagLeanChance),
//   so a build snowballs.
// limit: max copies a player can hold (the shop stops offering it). price: base price before wave inflation.
// Icons are assets/sprites/i_<id>.svg.

export const ITEMS = {
  // ---- Tier 1 (common) ----
  sharp_tooth:  { id: 'sharp_tooth',  name: 'Sharp Tooth',  tier: 1, price: 14, icon: 'i_sharp_tooth', tags: ['damage'],  stats: { damage: 8 } },
  thick_hide:   { id: 'thick_hide',   name: 'Thick Hide',   tier: 1, price: 14, icon: 'i_thick_hide', tags: ['defense'],   stats: { armor: 2, speed: -5 } },
  big_heart:    { id: 'big_heart',    name: 'Big Heart',    tier: 1, price: 14, icon: 'i_big_heart', tags: ['defense'],    stats: { maxHp: 5 } },
  fast_feet:    { id: 'fast_feet',    name: 'Fast Feet',    tier: 1, price: 14, icon: 'i_fast_feet', tags: ['speed'],    stats: { speed: 8, armor: -1 }, limit: 6 },
  fern_snack:   { id: 'fern_snack',   name: 'Fern Snack',   tier: 1, price: 13, icon: 'i_fern_snack', tags: ['sustain'],   stats: { hpRegen: 3 } },
  shiny_pebble: { id: 'shiny_pebble', name: 'Shiny Pebble', tier: 1, price: 12, icon: 'i_shiny_pebble', tags: ['luck'], stats: { luck: 12 } },
  bone_charm:   { id: 'bone_charm',   name: 'Bone Charm',   tier: 1, price: 15, icon: 'i_bone_charm', tags: ['melee'],   stats: { meleeDamage: 2 } },
  feather:      { id: 'feather',      name: 'Feather',      tier: 1, price: 15, icon: 'i_feather', tags: ['ranged'],      stats: { rangedDamage: 2, maxHp: -3 } },
  egg_shell:    { id: 'egg_shell',    name: 'Egg Shell',    tier: 1, price: 13, icon: 'i_egg_shell', tags: ['defense'],    stats: { dodge: 8, armor: -1 }, limit: 5 },
  mud_bath:     { id: 'mud_bath',     name: 'Mud Bath',     tier: 1, price: 13, icon: 'i_mud_bath', tags: ['defense'],     stats: { armor: 3, dodge: -5 } },
  glow_moss:    { id: 'glow_moss',    name: 'Glow Moss',    tier: 1, price: 12, icon: 'i_glow_moss', tags: ['mana'],    stats: { manaRegen: 1.5 } },
  amber_nugget: { id: 'amber_nugget', name: 'Amber Nugget', tier: 1, price: 15, icon: 'i_amber_nugget', tags: ['greed'], stats: { harvesting: 6 } },

  // ---- Tier 2 (uncommon) ----
  war_paint:     { id: 'war_paint',     name: 'War Paint',     tier: 2, price: 32, icon: 'i_war_paint', tags: ['damage', 'crit'],     stats: { damage: 12, critChance: 6, armor: -2 } },
  turtle_shell:  { id: 'turtle_shell',  name: 'Turtle Shell',  tier: 2, price: 30, icon: 'i_turtle_shell', tags: ['defense'],  stats: { armor: 5, speed: -10 } },
  long_neck:     { id: 'long_neck',     name: 'Long Neck',     tier: 2, price: 28, icon: 'i_long_neck', tags: ['ranged'],     stats: { range: 25, attackSpeed: -10 } },
  raptor_claw:   { id: 'raptor_claw',   name: 'Raptor Claw',   tier: 2, price: 34, icon: 'i_raptor_claw', tags: ['crit', 'speed'],   stats: { critChance: 8, attackSpeed: 12, maxHp: -4 } },
  magnet_rock:   { id: 'magnet_rock',   name: 'Magnet Rock',   tier: 2, price: 28, icon: 'i_magnet_rock', tags: ['greed'],   stats: { pickupRange: 40, harvesting: 5 }, limit: 4 },
  mana_crystal:  { id: 'mana_crystal',  name: 'Mana Crystal',  tier: 2, price: 30, icon: 'i_mana_crystal', tags: ['mana'],  stats: { maxMana: 40, abilityPower: 15 } },
  vampire_bat:   { id: 'vampire_bat',   name: 'Vampire Bat',   tier: 2, price: 36, icon: 'i_vampire_bat', tags: ['sustain'],   stats: { lifeSteal: 4, hpRegen: -2 }, limit: 4 },
  coffee_bean:   { id: 'coffee_bean',   name: 'Coffee Bean',   tier: 2, price: 32, icon: 'i_coffee_bean', tags: ['speed'],   stats: { attackSpeed: 18, hpRegen: -3 } },
  volcano_ash:   { id: 'volcano_ash',   name: 'Volcano Ash',   tier: 2, price: 34, icon: 'i_volcano_ash', tags: ['crit'],   stats: { critChance: 5 }, special: { burnOnCrit: 1 }, limit: 1, desc: 'Your crits set enemies on fire.' },

  // ---- Tier 3 (rare) ----
  trex_skull:   { id: 'trex_skull',   name: 'T-Rex Skull',  tier: 3, price: 58, icon: 'i_trex_skull', tags: ['damage', 'melee'],   stats: { damage: 22, meleeDamage: 3, speed: -10 } },
  comet_shard:  { id: 'comet_shard',  name: 'Comet Shard',  tier: 3, price: 54, icon: 'i_comet_shard', tags: ['mana'],  stats: { abilityPower: 40, manaRegen: 3, maxHp: -6 } },
  golden_egg:   { id: 'golden_egg',   name: 'Golden Egg',   tier: 3, price: 52, icon: 'i_golden_egg', tags: ['greed'],   stats: { harvesting: 4 }, special: { lowHpAmber: 1 }, limit: 1, desc: '+1 amber per kill while you are below 50% HP.' },
  herd_bond:    { id: 'herd_bond',    name: 'Herd Bond',    tier: 3, price: 50, icon: 'i_herd_bond', tags: ['mana'],    stats: { maxHp: 4, manaRegen: 1 }, special: { herdBond: 40 }, limit: 1, desc: 'Reviving a mate gives you both 40 mana.' },
  lucky_clover: { id: 'lucky_clover', name: 'Lucky Clover', tier: 3, price: 56, icon: 'i_lucky_clover', tags: ['luck', 'greed'], stats: { luck: 30, harvesting: 8 } },
  thunder_egg:  { id: 'thunder_egg',  name: 'Thunder Egg',  tier: 3, price: 52, icon: 'i_thunder_egg', tags: ['mana'],  stats: { maxMana: 20 }, special: { manaDiscount: 0.2 }, limit: 3, desc: 'Abilities cost 20% less mana.' },
  tail_ring:    { id: 'tail_ring',    name: 'Tail Ring',    tier: 3, price: 54, icon: 'i_tail_ring', tags: ['melee', 'defense'],    stats: { meleeDamage: 2, armor: 3, rangedDamage: -2 } },

  // ---- Tier 4 (legendary) ----
  meteor_heart:  { id: 'meteor_heart',  name: 'Meteor Heart',  tier: 4, price: 96,  icon: 'i_meteor_heart', tags: ['damage', 'mana'],  stats: { damage: 30, abilityPower: 30, armor: -3 }, limit: 2 },
  ancient_amber: { id: 'ancient_amber', name: 'Ancient Amber', tier: 4, price: 88,  icon: 'i_ancient_amber', tags: ['greed'], stats: { harvesting: 10 }, special: { amberBonus: 0.25 }, limit: 1, desc: '+25% amber from pickups.' },
  mother_nest:   { id: 'mother_nest',   name: "Mother's Nest", tier: 4, price: 92,  icon: 'i_mother_nest', tags: ['defense'],   stats: { maxHp: 15 }, special: { nestAura: 2 }, limit: 1, desc: 'Downed allies near you revive 2x faster.' },
  dino_crown:    { id: 'dino_crown',    name: 'Dino Crown',    tier: 4, price: 110, icon: 'i_dino_crown', tags: ['damage', 'luck'],    stats: { damage: 10, meleeDamage: 2, rangedDamage: 2, abilityPower: 10, luck: 15 }, limit: 1 },

  // ======== Build-makers: items that change how you play and stack into combos ========
  // (every one has `stats` even when empty, and a `desc` that states the mechanic; numbers: SPECIAL_RULES below)

  // ---- Tier 1 ----
  lucky_strike:   { id: 'lucky_strike',   name: 'Lucky Strike',   tier: 1, price: 18, icon: 'i_lucky_strike',   tags: ['crit', 'luck'], stats: { critChance: 10 },
    special: { critMult: -0.25 }, limit: 3, desc: 'Crits are more common but hit softer: -0.25x crit damage.' },
  serrated_tooth: { id: 'serrated_tooth', name: 'Serrated Tooth', tier: 1, price: 16, icon: 'i_serrated_tooth', tags: ['melee'], stats: {},
    special: { bleed: 0.15 }, limit: 3, desc: 'Melee hits make enemies bleed for 15% of the hit over 2 s. Bleeds stack.' },
  mana_leech:     { id: 'mana_leech',     name: 'Mana Leech',     tier: 1, price: 16, icon: 'i_mana_leech',     tags: ['mana'], stats: { maxHp: -2 },
    special: { killMana: 0.5 }, limit: 3, desc: 'Every kill gives +0.5 mana.' },
  piggy_egg:      { id: 'piggy_egg',      name: 'Piggy Egg',      tier: 1, price: 15, icon: 'i_piggy_egg',      tags: ['greed'], stats: { damage: -8 },
    special: { waveAmber: 15 }, limit: 3, desc: '+15 amber at the end of every wave.' },

  // ---- Tier 2 ----
  dino_dynamite:  { id: 'dino_dynamite',  name: 'Dino Dynamite',  tier: 2, price: 34, icon: 'i_dino_dynamite',  tags: ['explosive'], stats: {},
    special: { killBoom: 0.12 }, limit: 4, desc: 'Kills have a 12% chance to explode for 60% of the killing hit. Chances stack.' },
  boom_boots:     { id: 'boom_boots',     name: 'Boom Boots',     tier: 2, price: 32, icon: 'i_boom_boots',     tags: ['explosive', 'speed'], stats: {},
    special: { rollBomb: 1 }, limit: 1, desc: 'Your dodge roll drops a bomb that explodes 0.6 s later.' },
  bouncy_pebbles: { id: 'bouncy_pebbles', name: 'Bouncy Pebbles', tier: 2, price: 34, icon: 'i_bouncy_pebbles', tags: ['ranged'], stats: {},
    special: { bounceHit: 1 }, limit: 3, desc: 'Your projectiles bounce to 1 nearby enemy after hitting, for 70% damage.' },
  sharp_eye:      { id: 'sharp_eye',      name: 'Sharp Eye',      tier: 2, price: 36, icon: 'i_sharp_eye',      tags: ['ranged'], stats: {},
    special: { pierce: 1, pierceFalloff: 0.15 }, limit: 3, desc: '+1 pierce, and pierced hits lose 15 points less damage.' },
  bloodthirst:    { id: 'bloodthirst',    name: 'Bloodthirst',    tier: 2, price: 34, icon: 'i_bloodthirst',    tags: ['crit', 'sustain'], stats: { critChance: 4, maxHp: -2 },
    special: { critHeal: 1 }, limit: 3, desc: 'Crits heal 1 HP (up to 3 HP per second).' },
  amber_vacuum:   { id: 'amber_vacuum',   name: 'Amber Vacuum',   tier: 2, price: 30, icon: 'i_amber_vacuum',   tags: ['greed'], stats: {},
    special: { vacuum: 1 }, limit: 1, desc: 'Amber flies to you from twice as far and gives +1 XP each.' },
  shockwave_club: { id: 'shockwave_club', name: 'Shockwave Club', tier: 2, price: 36, icon: 'i_shockwave_club', tags: ['melee'], stats: { meleeDamage: 2, speed: -5 },
    special: { shockwave: 0.2, meleeKb: 0.5 }, limit: 2, desc: 'Melee hits knock enemies back harder, into the ones behind them, who take 20% of the hit.' },
  hoard_heart:    { id: 'hoard_heart',    name: 'Hoard Heart',    tier: 2, price: 34, icon: 'i_hoard_heart',    tags: ['greed', 'damage'], stats: {},
    special: { hoard: 1 }, limit: 1, desc: '+1% damage for every 25 amber you hold (max +40%). Spend it and the bonus fades.' },

  // ---- Tier 3 ----
  volatile_eggs:  { id: 'volatile_eggs',  name: 'Volatile Eggs',  tier: 3, price: 50, icon: 'i_volatile_eggs',  tags: ['explosive'], stats: { attackSpeed: -10 },
    special: { blastSize: 0.4, blastDmg: 0.4 }, limit: 3, desc: '+40% explosion size and damage for all your explosions.' },
  twin_quiver:    { id: 'twin_quiver',    name: 'Twin Quiver',    tier: 3, price: 52, icon: 'i_twin_quiver',    tags: ['ranged'], stats: {},
    special: { extraShots: 1, rangedMult: -0.15 }, limit: 3, desc: 'Projectile weapons and turrets fire 1 extra shot in a small spread. All ranged damage -15%.' },
  egg_clutch:     { id: 'egg_clutch',     name: 'Egg Clutch',     tier: 3, price: 54, icon: 'i_egg_clutch',     tags: ['summon'], stats: {},
    special: { clutch: 1 }, limit: 2, desc: 'Each turret weapon you hold gets +1 turret, each drone weapon +1 pterodactyl.' },
  pack_leader:    { id: 'pack_leader',    name: 'Pack Leader',    tier: 3, price: 46, icon: 'i_pack_leader',    tags: ['summon'], stats: {},
    special: { summonDmg: 0.4, ownDmg: -0.1 }, limit: 2, desc: 'Turrets and pterodactyls deal +40% damage. Your other weapons deal -10%.' },
  chain_spark:    { id: 'chain_spark',    name: 'Chain Spark',    tier: 3, price: 52, icon: 'i_chain_spark',    tags: ['crit'], stats: { critChance: 4 },
    special: { chainZap: 1 }, limit: 2, desc: 'Crits zap the nearest other enemy within 160 px for 50% damage.' },
  spell_echo:     { id: 'spell_echo',     name: 'Spell Echo',     tier: 3, price: 54, icon: 'i_spell_echo',     tags: ['mana'], stats: { manaRegen: -1 },
    special: { spellEcho: 1 }, limit: 1, desc: 'Your ability fires a second, 50% strength copy 0.4 s later, for no extra mana.' },
  berserker_sap:  { id: 'berserker_sap',  name: 'Berserker Sap',  tier: 3, price: 50, icon: 'i_berserker_sap',  tags: ['cursed', 'speed'], stats: { armor: -3 },
    special: { berserkAs: 30 }, limit: 1, desc: '+30% attack speed while you are below half HP.' },

  // ---- Tier 4 ----
  glass_jaw:      { id: 'glass_jaw',      name: 'Glass Jaw',      tier: 4, price: 88, icon: 'i_glass_jaw',      tags: ['cursed', 'damage'], stats: { damage: 40 },
    special: { halfHp: 1 }, limit: 1, desc: 'Your max HP is cut in half. Do not get hit.' },

  // ======== Unlockable items (challenge rewards, docs/PROGRESSION.md): speed, luck, defense and explosive builds ========
  // (numbers for the special ones: SPECIAL_RULES below; code: hooks.js, damage.js, weapons.js, stats.js)

  // ---- Tier 1 ----
  wind_feather:   { id: 'wind_feather',   name: 'Wind Feather',   tier: 1, price: 15, icon: 'i_wind_feather',   tags: ['speed', 'defense'], stats: { speed: 6, dodge: 5 }, limit: 4 },
  nest_egg:       { id: 'nest_egg',       name: 'Nest Egg',       tier: 1, price: 15, icon: 'i_nest_egg',       tags: ['greed'], stats: { harvesting: 9, speed: -3 } },
  cave_painting:  { id: 'cave_painting',  name: 'Cave Painting',  tier: 1, price: 15, icon: 'i_cave_painting',  tags: ['damage', 'mana'], stats: { damage: 6, abilityPower: 8 } },

  // ---- Tier 2 ----
  rolling_stone:  { id: 'rolling_stone',  name: 'Rolling Stone',  tier: 2, price: 34, icon: 'i_rolling_stone',  tags: ['speed', 'melee'], stats: { speed: 5 },
    special: { rollCdCut: 0.25, rollBowl: 1 }, limit: 2, desc: 'Dodge roll cooldown -25%. Rolling through enemies bowls them over for damage and knockback.' },
  adrenaline_gland: { id: 'adrenaline_gland', name: 'Adrenaline Gland', tier: 2, price: 34, icon: 'i_adrenaline_gland', tags: ['speed', 'damage'], stats: { speed: 3 },
    special: { adrenaline: 1 }, limit: 1, desc: 'After a dodge roll: +20% damage and +25% attack speed for 2 s.' },
  quill_coat:     { id: 'quill_coat',     name: 'Quill Coat',     tier: 2, price: 32, icon: 'i_quill_coat',     tags: ['defense'], stats: { armor: 2, speed: -4 },
    special: { thorns: 1.5 }, limit: 3, desc: 'An enemy that hits you in contact takes 150% of that hit back (at least 3).' },
  four_leaf_fern: { id: 'four_leaf_fern', name: 'Four-Leaf Fern', tier: 2, price: 30, icon: 'i_four_leaf_fern', tags: ['luck', 'sustain'], stats: { luck: 18, hpRegen: 2 } },
  herd_horn:      { id: 'herd_horn',      name: 'Herd Horn',      tier: 2, price: 30, icon: 'i_herd_horn',      tags: ['defense'], stats: { maxHp: 4, hpRegen: 1 },
    special: { herdHorn: 1 }, limit: 1, desc: 'Your herd bonus counts one extra mate, even when you play alone (+8% damage, +1 armor).' },
  ember_heart:    { id: 'ember_heart',    name: 'Ember Heart',    tier: 2, price: 34, icon: 'i_ember_heart',    tags: ['explosive'], stats: { abilityPower: 8 },
    special: { emberBurst: 1 }, limit: 3, desc: 'Enemies that die while burning burst in a small explosion.' },

  // ---- Tier 3 ----
  momentum_horn:  { id: 'momentum_horn',  name: 'Momentum Horn',  tier: 3, price: 54, icon: 'i_momentum_horn',  tags: ['speed', 'damage'], stats: { speed: 8 },
    special: { speedToDamage: 0.5 }, limit: 2, desc: 'You gain +1% damage for every 2% Speed you have.' },
  loaded_dice:    { id: 'loaded_dice',    name: 'Loaded Dice',    tier: 3, price: 52, icon: 'i_loaded_dice',    tags: ['luck', 'crit'], stats: { luck: 20 },
    special: { luckToCrit: 0.1 }, limit: 2, desc: 'Every 10 Luck gives you +1% crit chance.' },
  fossil_shield:  { id: 'fossil_shield',  name: 'Fossil Shield',  tier: 3, price: 54, icon: 'i_fossil_shield',  tags: ['defense'], stats: { armor: 2, speed: -5 },
    special: { fossilShield: 1 }, limit: 1, desc: 'Blocks one hit completely, then needs 15 s to recharge.' },
  second_wind:    { id: 'second_wind',    name: 'Second Wind',    tier: 3, price: 56, icon: 'i_second_wind',    tags: ['sustain'], stats: { maxHp: 4 },
    special: { secondWind: 1 }, limit: 1, desc: 'Once per wave, a hit that would down you leaves you at 1 HP and invulnerable for 1 s.' },

  // ---- Tier 4 ----
  jackpot_gem:    { id: 'jackpot_gem',    name: 'Jackpot Gem',    tier: 4, price: 90, icon: 'i_jackpot_gem',    tags: ['luck', 'greed'], stats: { luck: 30, harvesting: 8 },
    special: { critAmber: 0.08 }, limit: 2, desc: 'Crits have an 8% chance to drop 1 amber.' },
  big_bang:       { id: 'big_bang',       name: 'Big Bang',       tier: 4, price: 96, icon: 'i_big_bang',       tags: ['explosive'], stats: { abilityPower: 20 },
    special: { blastSize: 0.4, blastDmg: 0.2, killBoom: 0.1 }, limit: 1, desc: '+40% explosion size and +20% damage for all your explosions. Kills have a 10% chance to explode.' },
  time_amber:     { id: 'time_amber',     name: 'Time Amber',     tier: 4, price: 92, icon: 'i_time_amber',     tags: ['mana'], stats: { maxMana: 40, manaRegen: 1 },
    special: { abCdCut: 0.25 }, limit: 2, desc: 'Your ability cooldown is 25% shorter.' },
};

export const ITEM_IDS = Object.keys(ITEMS);

/** Item tags, in the order the shop shows them. `name` is the chip text. */
export const TAGS = {
  melee: 'Melee', ranged: 'Ranged', explosive: 'Explosive', summon: 'Summon', crit: 'Crit', mana: 'Mana',
  greed: 'Greed', defense: 'Defense', sustain: 'Sustain', speed: 'Speed', luck: 'Luck', damage: 'Damage', cursed: 'Cursed',
};

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

  // ---- build-maker items (src/sim/hooks.js unless noted) ----
  // Dino Dynamite: a kill explodes (chance = killBoom) for `dmgFrac` of the killing hit in `radius` px.
  // `maxDepth` stops a chain of explosions from going on forever (a blast that kills can set off the next).
  dynamite: { dmgFrac: 0.6, radius: 70, maxDepth: 2 },
  // Boom Boots: the bomb waits `fuse` s, then hits everything in `radius` px for dmg (grows with the wave and Damage %).
  rollBomb: { fuse: 0.6, radius: 85, dmg: 26, perWave: 0.12 },
  // Twin Quiver: extra shots fan out `spreadDeg` degrees apart; rangedMult never drops below `minMult`.
  twinQuiver: { spreadDeg: 9, minMult: 0.4 },
  // Bouncy Pebbles: a bounce looks for a target within `radius` px of the enemy it just hit, at `dmgFrac` of its damage.
  bounce: { radius: 220, dmgFrac: 0.7 },
  // Bloodthirst: at most `perSec` HP healed per second this way.
  critHeal: { perSec: 3 },
  // Chain Spark: the zap reaches `radius` px and deals `dmgFrac` of the crit.
  chainZap: { radius: 160, dmgFrac: 0.5 },
  // Spell Echo: the copy comes `delay` s later at `strength` of the ability.
  spellEcho: { delay: 0.4, strength: 0.5 },
  // Hoard Heart: +pct% damage per `per` amber held, up to `max`%.
  hoard: { per: 25, pct: 1, max: 40 },
  // Shockwave Club: the knocked enemy shoves those within `radius` px of it, on its far side (dot > 0 of the knock direction).
  shockwave: { radius: 90 },
  // Serrated Tooth: a bleed lasts `time` s; one enemy carries at most `maxStacks`.
  bleed: { time: 2, maxStacks: 8 },
  // Piggy Egg and Amber Vacuum: the wave-end amber also pays XP like Harvesting; the vacuum gives `vacuumXp` XP per pickup per copy.
  vacuumXp: 1,

  // ---- unlockable items ----
  // Rolling Stone (hooks.js update): each enemy the roll passes through, once per roll, takes
  // (dmg + melee x Melee Damage) x (1 + perWave x (wave - 1)) x Damage % and `kb` knockback.
  rollBowl: { dmg: 8, melee: 1.5, perWave: 0.14, kb: 380 },
  // Adrenaline Gland (hooks.js onRoll sets the timer; damage.js hitEnemy and weapons.js cooldownOf read it): for `time` s after a roll,
  // damage x (1 + damage) and +attackSpeed % attack speed.
  adrenaline: { time: 2, damage: 0.2, attackSpeed: 25 },
  // Quill Coat (damage.js hitPlayer): a contact hit reflects (hit before armor x thorns), at least `min`, with `kb` knockback.
  thorns: { min: 3, kb: 100 },
  // Fossil Shield (damage.js hitPlayer): blocks one whole hit, `cooldown` s to recharge (it is ready at the start of every wave),
  // `iframes` s of invulnerability after the block.
  fossilShield: { cooldown: 15, iframes: 0.5 },
  // Second Wind (damage.js hitPlayer): once per wave a lethal hit leaves 1 HP and `iframes` s of invulnerability.
  secondWind: { iframes: 1 },
  // Ember Heart (hooks.js onKill): an enemy that dies burning explodes in `radius` px for dmg x (1 + perWave x (wave - 1)) x Damage %.
  emberBurst: { radius: 80, dmg: 12, perWave: 0.14, maxDepth: 2 },
};

/** Loot crates (src/sim/crates.js). */
export const CRATE_RULES = {
  chance: 0.007,       // a normal kill drops a crate this often at 0 Luck (~0.8 crates a wave)
  luckScale: 200,      // ...x(1 + Luck / luckScale), so +100 Luck is x1.5
  maxPerWave: 2,       // per player and wave (elites ignore the cap)
  heal: 3,             // HP healed when a crate is picked up
  recycle: 0.25,       // Recycle pays this fraction of the item's shop price in amber
  eliteRolls: 2,       // an elite or boss crate rolls the rarity this many times and keeps the best
};

/** Shop offer rules (slots, prices and reroll growth are in BALANCE.shop). */
export const SHOP_RULES = {
  exactWeaponsUntil: 2, exactWeapons: 2,  // waves 1-2: exactly 2 weapons + 2 items
  minWeaponsUntil: 5, minWeapons: 1,      // waves 3-5: at least 1 weapon
  weaponSlotChance: 0.35,                 // otherwise each open slot is a weapon this often
  ownedWeaponChance: 0.20,                // a weapon offer repeats a weapon you hold
  ownedClassChance: 0.15,                 // ...or another weapon of a class you hold
  tierPrice: [1, 1.9, 3.6, 6.8],          // weapon price multiplier by tier I-IV
  tagLeanChance: 0.25,                    // an item offer is drawn from items sharing a tag with your build this often
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
