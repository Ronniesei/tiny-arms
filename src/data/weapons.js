// Weapons. Per-tier arrays hold tiers I-IV. Behaviour code: src/sim/systems/weapons.js.
//
// behaviour (registry BEHAVIOURS / MAINTAIN in systems/weapons.js):
//   'swing'      melee arc around the player.            arc, knockback
//   'thrust'     melee stab: hits every enemy on a line. width (half-width px), knockback
//   'projectile' one shot at the nearest enemy.          projectile, speed, pierce, pierceTier?, burn?
//   'lob'        arcing shell, explodes at the target and leaves fire.  flight, radius[], fireDps[], fireDur[], fireR
//   'bounce'     projectile that ricochets off arena walls, explodes on the first enemy hit.  bounces[], radius[]
//   'beam'       instant line through every enemy in range. width (half-width px)
//   'boomerang'  thrown projectile that flies out to its range and back, hitting every enemy on both legs.  projectile, speed
//   'drone'      keeps one flying summon that dives at enemies.  diveSpeed, orbitSpeed;  count[] (default 1) and summon (kind
//                string, default 'ptero') make swarms of them (Beetle Jar)
//   'turret'     keeps count[tier] stationary summons that shoot.  projectile, speed, count[]
// range: px from the player at 0% Range (melee gets half the Range stat).
// scaling: weapon damage = (dmg[tier] + sum(scaling[stat] * stat)) * (1 + Damage%/100).
// Tier IV is roughly x4.4 the damage of tier I with slightly faster cooldowns. Tier I single-target DPS is
// about 7-9 for every weapon; area, piercing and summon weapons are priced a little lower per DPS in return
// for hitting several enemies. Base prices stay 18-28 (the shop multiplies by tier and wave).

export const WEAPONS = {
  // ---- Primal (melee, Melee Damage) ----
  bone_club: {
    id: 'bone_club', name: 'Bone Club', cls: 'primal', kind: 'melee', behaviour: 'swing',
    price: 20, sprite: 'w_bone_club',
    dmg: [12, 20, 32, 50], cooldown: [1.4, 1.3, 1.2, 1.1],
    range: 115, arc: 90, knockback: 260,
    scaling: { meleeDamage: 1, maxHp: 0.1 }, critChance: 0, critMult: 1.5,
    desc: 'Slow, heavy, big knockback. Scales a little with Max HP.',
  },
  stone_axe: {
    id: 'stone_axe', name: 'Stone Axe', cls: 'primal', kind: 'melee', behaviour: 'swing',
    price: 22, sprite: 'w_stone_axe',
    dmg: [9, 15, 25, 40], cooldown: [1.05, 0.95, 0.85, 0.75],
    range: 130, arc: 110, knockback: 120,
    scaling: { meleeDamage: 1 }, critChance: 5, critMult: 2,
    desc: 'Chops everything in a wide arc.',
  },
  tail_spike: {
    id: 'tail_spike', name: 'Tail Spike', cls: 'primal', kind: 'melee', behaviour: 'thrust',
    price: 22, sprite: 'w_tail_spike',
    dmg: [5, 8, 14, 22], cooldown: [0.6, 0.55, 0.5, 0.45],
    range: 150, width: 18, arc: 24, knockback: 60,
    scaling: { meleeDamage: 1 }, critChance: 10, critMult: 2,
    desc: 'Fast stab that skewers every enemy in a line.',
  },

  // ---- Hunter (ranged, Ranged Damage) ----
  slingshot: {
    id: 'slingshot', name: 'Slingshot', cls: 'hunter', kind: 'ranged', behaviour: 'projectile',
    price: 18, sprite: 'w_slingshot', projectile: 'p_pebble',
    dmg: [7, 12, 19, 30], cooldown: [0.75, 0.68, 0.6, 0.52],
    range: 420, speed: 900, pierce: 0, knockback: 30,
    scaling: { rangedDamage: 1 }, critChance: 5, critMult: 1.5,
    desc: 'Quick pebbles at the nearest enemy.',
  },
  spear_thrower: {
    id: 'spear_thrower', name: 'Spear Thrower', cls: 'hunter', kind: 'ranged', behaviour: 'projectile',
    price: 24, sprite: 'w_spear_thrower', projectile: 'p_spear',
    dmg: [10, 16, 26, 42], cooldown: [1.15, 1.05, 0.95, 0.85],
    range: 480, speed: 1000, pierce: 1, knockback: 60,
    scaling: { rangedDamage: 1.2 }, critChance: 5, critMult: 2,
    desc: 'Long spears that pierce one extra enemy.',
  },
  bone_bow: {
    id: 'bone_bow', name: 'Bone Bow', cls: 'hunter', kind: 'ranged', behaviour: 'projectile',
    price: 22, sprite: 'w_bone_bow', projectile: 'p_arrow',
    dmg: [4, 7, 11, 18], cooldown: [0.55, 0.5, 0.45, 0.4],
    range: 450, speed: 1300, pierce: 0, pierceTier: [0, 0, 1, 1], knockback: 20,
    scaling: { rangedDamage: 1 }, critChance: 15, critMult: 2,
    desc: 'Fast arrows that crit a lot. Pierces one extra enemy from tier III.',
  },

  // ---- Volcanic (area and burn; Ranged Damage plus Ability Power) ----
  lava_lobber: {
    id: 'lava_lobber', name: 'Lava Lobber', cls: 'volcanic', kind: 'ranged', behaviour: 'lob',
    price: 28, sprite: 'w_lava_lobber', projectile: 'p_lava',
    dmg: [12, 20, 33, 53], cooldown: [1.9, 1.75, 1.6, 1.45],
    range: 400, flight: 0.5, radius: [70, 76, 82, 90], knockback: 80,
    fireDps: [4, 6, 9, 14], fireDur: [2.5, 2.7, 3, 3.3], fireR: 0.8, // fire radius = fireR x blast radius; fire dps x Ability Power
    scaling: { rangedDamage: 0.6, abilityPower: 0.15 }, critChance: 3, critMult: 1.5,
    desc: 'Lobs molten rock that explodes and leaves burning ground. Scales with Ability Power.',
  },
  ember_staff: {
    id: 'ember_staff', name: 'Ember Staff', cls: 'volcanic', kind: 'ranged', behaviour: 'projectile',
    price: 24, sprite: 'w_ember_staff', projectile: 'p_ember',
    dmg: [6, 10, 16, 25], cooldown: [1.0, 0.92, 0.84, 0.76],
    range: 400, speed: 700, pierce: 0, knockback: 20,
    burn: { dps: [4, 6, 9, 14], time: 3 }, // burn dps x Ability Power
    burst: { r: [45, 55, 65, 75], frac: 0.4 }, // the bolt bursts: nearby enemies take 40% of the hit and catch the burn
    scaling: { rangedDamage: 0.5, abilityPower: 0.35 }, critChance: 3, critMult: 1.5, // an Ability Power weapon (Ash)
    desc: 'Fireballs that set enemies alight. Burn grows with Ability Power.',
  },

  // ---- Swarm (summons; Ranged Damage plus Ability Power) ----
  ptero_pal: {
    id: 'ptero_pal', name: 'Pterodactyl Pal', cls: 'swarm', kind: 'ranged', behaviour: 'drone',
    price: 24, sprite: 'w_ptero_pal',
    dmg: [10, 16, 26, 43], cooldown: [1.3, 1.2, 1.1, 1.0],
    range: 380, diveSpeed: 780, orbitSpeed: 2.4, knockback: 40,
    scaling: { rangedDamage: 0.8, abilityPower: 0.15 }, critChance: 5, critMult: 1.5,
    desc: 'A friendly flyer that circles you and dives at enemies, hitting everything it touches.',
  },
  egg_turret: {
    id: 'egg_turret', name: 'Egg Turret', cls: 'swarm', kind: 'ranged', behaviour: 'turret',
    price: 26, sprite: 'w_egg_turret', projectile: 'p_egg',
    dmg: [5, 7, 8, 12], cooldown: [0.55, 0.5, 0.5, 0.45],
    range: 380, speed: 800, pierce: 0, knockback: 20, count: [1, 1, 2, 2],
    scaling: { rangedDamage: 0.8, abilityPower: 0.15 }, critChance: 3, critMult: 1.5,
    desc: 'Drops an egg turret that shoots nearby enemies. Two turrets from tier III.',
  },

  // ---- Odd ----
  coconut_bomb: {
    id: 'coconut_bomb', name: 'Coconut Bomb', cls: 'odd', kind: 'ranged', behaviour: 'bounce',
    price: 26, sprite: 'w_coconut_bomb', projectile: 'p_coconut',
    dmg: [11, 18, 30, 48], cooldown: [1.7, 1.55, 1.4, 1.25],
    range: 420, speed: 520, life: 2.4, bounces: [2, 3, 4, 5], radius: [65, 70, 76, 84], knockback: 140,
    scaling: { rangedDamage: 1 }, critChance: 5, critMult: 1.5,
    desc: 'Bounces off the walls and explodes on the first enemy it touches.',
  },
  amber_laser: {
    id: 'amber_laser', name: 'Amber Laser', cls: 'odd', kind: 'ranged', behaviour: 'beam',
    price: 28, sprite: 'w_amber_laser',
    dmg: [6, 10, 16, 26], cooldown: [0.75, 0.68, 0.61, 0.55],
    range: 420, width: 12, knockback: 20,
    scaling: { rangedDamage: 0.8 }, critChance: 8, critMult: 1.5,
    desc: 'An instant beam that burns through every enemy in line.',
  },

  // ---- Unlockable weapons (challenge rewards / hero starting weapon, docs/PROGRESSION.md). Added last: the network
  // sends a weapon as its index in this list, so the order of the older weapons must not change. ----
  raptor_claws: {
    id: 'raptor_claws', name: 'Raptor Claws', cls: 'primal', kind: 'melee', behaviour: 'swing',
    price: 21, sprite: 'w_raptor_claws',
    dmg: [4, 7, 11, 17], cooldown: [0.4, 0.36, 0.32, 0.28],
    range: 110, arc: 80, knockback: 30,
    scaling: { meleeDamage: 0.6 }, critChance: 20, critMult: 2,
    desc: 'Lightning-fast slashes that crit a lot. Short reach.',
  },
  boomerang_bone: {
    id: 'boomerang_bone', name: 'Boomerang Bone', cls: 'hunter', kind: 'ranged', behaviour: 'boomerang',
    price: 23, sprite: 'w_boomerang_bone', projectile: 'p_boomerang',
    dmg: [4, 7, 12, 19], cooldown: [1.2, 1.1, 1.0, 0.9],
    range: 380, speed: 620, projRadius: 15, knockback: 20,
    scaling: { rangedDamage: 0.8 }, critChance: 6, critMult: 2,
    desc: 'Flies out, turns and flies back, hitting every enemy on the way out and again on the way back.',
  },
  beetle_jar: {
    id: 'beetle_jar', name: 'Beetle Jar', cls: 'swarm', kind: 'ranged', behaviour: 'drone',
    price: 24, sprite: 'w_beetle_jar', summon: 's_beetle',
    dmg: [4, 6, 8, 12], cooldown: [1.1, 1.0, 0.9, 0.85],
    range: 320, diveSpeed: 860, orbitSpeed: 3.4, knockback: 20, count: [2, 2, 3, 3],
    scaling: { rangedDamage: 0.5, abilityPower: 0.12 }, critChance: 5, critMult: 1.5,
    desc: 'Frees scuttling beetles that circle you and dart at enemies. Three beetles from tier III.',
  },
};

// Class set bonuses: applied by stats.js when a player holds N weapons of a class (duplicates count).
export const CLASSES = {
  primal:   { name: 'Primal',   bonuses: { 2: { meleeDamage: 2 }, 4: { meleeDamage: 4, maxHp: 3 }, 6: { meleeDamage: 7, maxHp: 6 } } },
  hunter:   { name: 'Hunter',   bonuses: { 2: { range: 10 }, 4: { range: 20, rangedDamage: 2 }, 6: { range: 30, rangedDamage: 5 } } },
  volcanic: { name: 'Volcanic', bonuses: { 2: { abilityPower: 10 }, 4: { abilityPower: 20, rangedDamage: 2 }, 6: { abilityPower: 35, rangedDamage: 4 } } },
  swarm:    { name: 'Swarm',    bonuses: { 2: { attackSpeed: 5, abilityPower: 5 }, 4: { attackSpeed: 10, abilityPower: 10, rangedDamage: 1 }, 6: { attackSpeed: 18, abilityPower: 20, rangedDamage: 3 } } },
  odd:      { name: 'Odd',      bonuses: { 2: { luck: 10 }, 4: { luck: 20 }, 6: { luck: 35 } } },
};

export const WEAPON_IDS = Object.keys(WEAPONS);
