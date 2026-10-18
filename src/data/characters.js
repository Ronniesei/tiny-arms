// The 4 playable T-Rexes. `stats` adds flat points to stats; `mult` multiplies the final stat.
// Ability numbers live here too; the behaviour is in src/sim/systems/abilities.js.
// `trait` is the hero's one rule twist: `name` and `desc` are shown on the lobby card, the other fields are
// read by the sim (stats.js recomputeStats / weaponDamage / weaponCooldown / abilityCooldown, weapons.js and
// summons.js pierce, damage.js kills, movement.js regen aura, pickups.js berries, waves.js bushes):
//   meleeDmg, rangedDmg     damage multipliers for melee / ranged weapons (summons count as ranged)
//   armorEvery, armorPer    +armorPer Armor every armorEvery levels
//   bushRate                fern bush spawn rate x, while this hero is in the run (any player)
//   berryHeal               berry healing x for this hero
//   auraRadius, auraRegen   this hero's HP regen also heals mates within auraRadius px at auraRegen x the rate
//   frenzyPerKill, frenzyMax  +% attack speed per kill until the end of the wave, capped at frenzyMax %
//   extraPierce             extra enemies this hero's projectiles pierce (same falloff as normal pierce)
//   abilityCooldownMult     multiplier on the ability cooldown

export const CHARACTERS = {
  brutus: {
    id: 'brutus', name: 'Brutus', role: 'Tank', color: '#3f7d3a',
    blurb: 'Big, slow and hard to kill. Roars to stun and pull enemies onto himself.',
    stats: { armor: 4, speed: -5 },
    mult: { maxHp: 1.5 },
    weapon: 'bone_club',
    trait: {
      name: 'Thick Skull',
      desc: 'Melee weapons deal +15% damage, ranged weapons -30%. +1 Armor every 4 levels.',
      meleeDmg: 1.15, rangedDmg: 0.7, armorEvery: 4, armorPer: 1,
    },
    ability: {
      id: 'roar', name: 'Roar', cost: 45, cooldown: 12,
      desc: 'Stuns and hurts enemies within 190 px for 1.5 s and pulls their aggro for 3 s.',
      radius: 190, stun: 1.5, taunt: 3, damage: 8,
    },
  },
  fern: {
    id: 'fern', name: 'Fern', role: 'Healer', color: '#8fd16a',
    blurb: 'Keeps the herd alive. Heals everyone nearby and speeds up revives.',
    stats: { hpRegen: 4, abilityPower: 20, rangedDamage: 1, attackSpeed: 10, armor: 1, damage: 10 },
    mult: { maxHp: 1.1 },
    weapon: 'slingshot',
    trait: {
      name: 'Green Thumb',
      desc: 'Fern bushes appear twice as often and berries heal you double. Your HP regen also heals mates within 150 px.',
      bushRate: 2, berryHeal: 2, auraRadius: 150, auraRegen: 1,
    },
    ability: {
      id: 'healing_pulse', name: 'Healing Pulse', cost: 55, cooldown: 15,
      desc: 'Heals you and allies within 220 px by 25% max HP and blasts nearby enemies back. Revives are 3x faster for 5 s.',
      radius: 220, healPct: 0.25, reviveBoost: 3, boostTime: 5, damage: 10, knockback: 420,
    },
  },
  spike: {
    id: 'spike', name: 'Spike', role: 'Damage', color: '#f08a24',
    blurb: 'All offence. Hits hard and fast, but cannot take many hits back.',
    stats: { damage: 20, attackSpeed: 15 },
    mult: { maxHp: 0.8 },
    weapon: 'stone_axe',
    trait: {
      name: 'Frenzy',
      desc: 'Each kill gives +1% attack speed until the wave ends (max +15%).',
      frenzyPerKill: 1, frenzyMax: 15,
    },
    ability: {
      id: 'tail_whirl', name: 'Tail Whirl', cost: 40, cooldown: 10,
      desc: 'Spin for 1.2 s, hitting all enemies within 120 px every 0.2 s with knockback.',
      radius: 120, duration: 1.2, interval: 0.2, damage: 8, knockback: 260,
    },
  },
  sparky: {
    id: 'sparky', name: 'Sparky', role: 'Support', color: '#6b6fe0',
    blurb: 'Long range and lots of mana. Calls meteors down on the biggest crowd.',
    stats: { range: 25, manaRegen: 2, armor: 2, maxHp: 4 },
    mult: {},
    weapon: 'spear_thrower',
    trait: {
      name: 'Spark',
      desc: 'Your projectiles pierce 1 extra enemy. Meteor Call recharges 15% faster.',
      extraPierce: 1, abilityCooldownMult: 0.85,
    },
    ability: {
      id: 'meteor_call', name: 'Meteor Call', cost: 60, cooldown: 14,
      desc: 'Marks the densest enemy cluster in range; a meteor lands 1 s later and leaves burning ground for 3 s.',
      range: 520, radius: 130, delay: 1, damage: 40, burnTime: 3, burnDps: 8,
    },
  },
};

export const CHARACTER_IDS = ['brutus', 'fern', 'spike', 'sparky'];
