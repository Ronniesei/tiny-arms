// The 10 playable T-Rexes (the first 4 are always unlocked, the others are unlocked by `unlock`, see src/meta/unlocks.js). `stats` adds flat points to stats; `mult` multiplies the final stat.
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
//   maxWeapons              weapon slots (default BALANCE.shop.maxWeapons). With 1 slot, buying another weapon replaces it (shop.js)
//   weaponDmg, weaponAs     every weapon's damage x weaponDmg, and +weaponAs % attack speed (Pip's Lone Arm)
//   amberBonus              +x of every amber pickup (0.4 = +40%), on top of Ancient Amber
//   hoardPer, hoardPct, hoardMax   +hoardPct % damage for every hoardPer amber held, capped at hoardMax % (stats.js hoardBonus)
//   summonDmg, extraSummons   summon weapons (turrets, drones) deal x summonDmg and get +extraSummons of each (meleeDmg works too)
//   kindleChance, kindleDps, kindleTime   a hit sets the enemy alight with this chance; the burn is kindleDps x the hit per second
//   burnMult                burn damage this hero deals x burnMult (burn ticks and burning ground; not bleeds)
//   speedToDamage           +x Damage % for every +1 Speed % (Dash's Momentum; stats.js)
//   luckToCrit              +x Crit Chance % for every +1 Luck (Lucky Charm; stats.js)
//   rollCdCut               dodge roll cooldown -x (0.4 = 40% shorter; movement.js startRoll)
//   critAmber               chance a crit drops 1 amber (Lucky Charm; hooks.js onHit)
//   abCdCut                 ability cooldown -x (abilityCooldown in stats.js; items can add to it)
// `unlock` (heroes after the first four): {stat, target, text} read by src/meta/unlocks.js. stat is a lifetime stat there:
//   bestWave (highest wave reached), amber / kills / wins / challenges (totals across runs; challenges = challenges done),
//   bestDangerWin (highest Danger index won, -1 for none). `text` is the condition shown in the lobby.

export const CHARACTERS = {
  brutus: {
    id: 'brutus', name: 'Brutus', role: 'Tank', color: '#3f7d3a',
    blurb: 'Big, slow and hard to kill. Roars to stun and pull enemies onto himself.',
    stats: { armor: 4, speed: -5 },
    mult: { maxHp: 1.5 },
    weapon: 'bone_club',
    trait: {
      name: 'Thick Skull',
      desc: 'Melee weapons deal +5% damage, ranged weapons -30%. +1 Armor every 4 levels.',
      meleeDmg: 1.05, rangedDmg: 0.7, armorEvery: 4, armorPer: 1,
    },
    ability: {
      id: 'roar', name: 'Roar', cost: 45, cooldown: 12,
      desc: 'Stuns and hurts enemies within 210 px for 1.5 s and pulls their aggro for 3 s.',
      radius: 210, stun: 1.5, taunt: 3, damage: 8,
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
      desc: 'Your projectiles pierce 1 extra enemy (each one takes less than the last). Meteor Call recharges 15% faster.',
      extraPierce: 1, abilityCooldownMult: 0.85,
    },
    ability: {
      id: 'meteor_call', name: 'Meteor Call', cost: 60, cooldown: 14,
      desc: 'Marks the densest enemy cluster in range; a meteor lands 1 s later and leaves burning ground for 3 s.',
      range: 520, radius: 130, delay: 1, damage: 40, burnTime: 3, burnDps: 8,
    },
  },

  pip: {
    id: 'pip', name: 'Pip', role: 'One-Armed', color: '#f06aa0',
    blurb: 'One weapon, one tiny arm, one big grudge. Every swing counts for a lot more.',
    stats: {},
    mult: {},
    weapon: 'tail_spike',
    unlock: { stat: 'bestWave', target: 10, text: 'Reach wave 10' },
    trait: {
      name: 'Lone Arm',
      desc: 'Only ONE weapon slot, but that weapon deals x2.5 damage and +40% attack speed. A better weapon replaces it.',
      maxWeapons: 1, weaponDmg: 2.5, weaponAs: 40,
    },
    ability: {
      id: 'overdrive', name: 'Overdrive', cost: 45, cooldown: 14,
      desc: '+100% attack speed for 5 s.',
      duration: 5, attackSpeed: 100,
    },
  },
  goldie: {
    id: 'goldie', name: 'Goldie', role: 'Hoarder', color: '#e8b830',
    blurb: 'Sits on a pile of amber and gets mightier the bigger it grows. Spend it, and the power fades.',
    stats: { damage: -20, rangedDamage: 3, attackSpeed: 15, maxHp: 5 },
    mult: {},
    weapon: 'slingshot',
    unlock: { stat: 'amber', target: 1500, text: 'Collect 1,500 amber in total' },
    trait: {
      name: 'Golden Touch',
      desc: '+40% amber from pickups. +1% damage for every 20 amber held (max +60%), but -20% damage.',
      amberBonus: 0.4, hoardPer: 20, hoardPct: 1, hoardMax: 60,
    },
    ability: {
      id: 'gold_rush', name: 'Gold Rush', cost: 50, cooldown: 16,
      desc: 'Every amber pickup on the map flies to you.',
      pullSpeed: 420,
    },
  },
  bolt: {
    id: 'bolt', name: 'Bolt', role: 'Engineer', color: '#2fb5a8',
    blurb: 'Would rather build a turret than throw a punch. Surrounds herself with gadgets.',
    stats: { attackSpeed: -12, speed: -5 },
    mult: {},
    weapon: 'egg_turret',
    unlock: { stat: 'kills', target: 2000, text: 'Kill 2,000 enemies in total' },
    trait: {
      name: 'Workshop',
      desc: 'Turrets and drones deal +60% damage and you get +1 extra of each. Melee weapons deal -50% damage.',
      summonDmg: 1.6, extraSummons: 1, meleeDmg: 0.5,
    },
    ability: {
      id: 'overclock', name: 'Overclock', cost: 50, cooldown: 15,
      desc: 'Your turrets and drones attack twice as fast for 6 s.',
      duration: 6, rate: 2,
    },
  },
  ash: {
    id: 'ash', name: 'Ash', role: 'Firebrand', color: '#5a4a52',
    blurb: 'Smoulders. Whatever Ash touches has a habit of catching fire, and the fire hits harder.',
    stats: { rangedDamage: 4, abilityPower: 25, attackSpeed: 35, armor: 3, maxHp: 8 },
    mult: { maxHp: 0.75 },
    weapon: 'ember_staff',
    unlock: { stat: 'wins', target: 1, text: 'Win a run (any Danger)' },
    trait: {
      name: 'Kindling',
      desc: 'Hits have a 20% chance to ignite (25% of the hit per second for 2 s). Burns deal +30%, but you have -25% max HP.',
      kindleChance: 0.2, kindleDps: 0.25, kindleTime: 2, burnMult: 1.3,
    },
    ability: {
      id: 'eruption', name: 'Eruption', cost: 50, cooldown: 13,
      desc: 'A ring of fire bursts around you (170 px), hurting and igniting every enemy in it.',
      radius: 170, damage: 14, burnDps: 8, burnTime: 3, knockback: 220,
    },
  },
  dash: {
    id: 'dash', name: 'Dash', role: 'Speedster', color: '#e04a3a',
    blurb: 'Fast, twitchy and never where the teeth are. All that speed turns into damage.',
    stats: { speed: 15, dodge: 5, attackSpeed: 10, meleeDamage: 1 },
    mult: { maxHp: 0.9 },
    weapon: 'raptor_claws',
    unlock: { stat: 'challenges', target: 8, text: 'Complete 8 challenges' },
    trait: {
      name: 'Momentum',
      desc: 'Every +1% Speed also gives +1% Damage. Dodge rolls recharge 40% faster.',
      speedToDamage: 1, rollCdCut: 0.4,
    },
    ability: {
      id: 'stampede', name: 'Stampede', cost: 40, cooldown: 9,
      desc: 'Charge 420 px the way you are moving, unhittable, trampling everything on the way and shoving it aside.',
      distance: 420, duration: 0.35, damage: 30, knockback: 340, grace: 0.1,
    },
  },
  lucky: {
    id: 'lucky', name: 'Lucky', role: 'Gambler', color: '#3aa860',
    blurb: 'Never reads the odds, always seems to win. Crits shake amber loose.',
    stats: { luck: 25, critChance: 5, damage: 10 },
    mult: {},
    weapon: 'slingshot',
    unlock: { stat: 'bestDangerWin', target: 2, text: 'Win a run on Hard' },
    trait: {
      name: 'Lucky Charm',
      desc: 'Crits have a 12% chance to drop amber. Every 10 Luck gives +1% Crit Chance.',
      critAmber: 0.12, luckToCrit: 0.1,
    },
    ability: {
      id: 'jackpot', name: 'Jackpot', cost: 50, cooldown: 14,
      desc: 'Spin for a prize: a Coin Bomb, a full heal with 2 s of safety, an amber shower or +50% damage for 5 s. Luck favours the big ones.',
      // Coin Bomb: blast around you.
      radius: 210, damage: 45, knockback: 300,
      // Lucky Break: full heal, then this many seconds unhittable.
      invuln: 2,
      // Amber Shower: amberBase + amberPerWave x wave pickups of 1 amber, thrown out to amberRadius.
      amberBase: 8, amberPerWave: 1, amberRadius: 150,
      // Hot Streak: +streak Damage % for streakTime s.
      streak: 50, streakTime: 5,
      // Odds (weights): Lucky Break and Hot Streak gain luckOdds weight per point of Luck.
      odds: { coin: 35, lucky: 15, amber: 35, streak: 15 }, luckOdds: 0.3, luckOddsMax: 45,
    },
  },
};

export const CHARACTER_IDS = ['brutus', 'fern', 'spike', 'sparky', 'pip', 'goldie', 'bolt', 'ash', 'dash', 'lucky'];

/** Heroes that are unlocked from the start (no `unlock` rule). */
export const STARTER_IDS = CHARACTER_IDS.filter((id) => !CHARACTERS[id].unlock);
