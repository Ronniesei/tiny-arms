// Global tunable numbers. Every number the game uses should live in src/data/*.js.

export const BALANCE = {
  tickRate: 60,

  arena: { w: 1550, h: 1550 }, // review round 4: smaller so the horde fills it and kiting isn't free

  player: {
    radius: 22,
    speed: 300,            // px/s at 0% Speed
    minSpeedPct: -60,      // Speed stat floor
    iframesMin: 0.15,      // s, after a small hit (owner 18 Oct: running through hordes was too safe)
    iframesMax: 0.3,       // s, after a hit costing >= iframesHitPct of max HP
    iframesHitPct: 0.15,
    pickupRadius: 90,      // px at 0% Pickup Range
    weaponOrbit: 38,       // px from body centre to weapon
  },

  // Starting stats for every player before character, items and level-ups.
  baseStats: {
    maxHp: 20, hpRegen: 0, lifeSteal: 0,
    damage: 0, meleeDamage: 0, rangedDamage: 0, abilityPower: 0,
    attackSpeed: 0, critChance: 0, range: 0,
    armor: 0, dodge: 0, speed: 0, luck: 0, harvesting: 0,
    maxMana: 100, manaRegen: 2.5, pickupRange: 0,
  },

  stat: {
    regenPerPoint: 0.12,   // HP/s per HP Regen point
    armorK: 15,            // damage taken x K/(K+armor)
    dodgeCap: 60,
    critMultDefault: 1.5,
    lifeStealCapPerSec: 5,
    minAttackSpeed: -80,
    meleeRangeFactor: 0.5, // melee weapons get half the Range stat
  },

  // Playtest (17 Oct): abilities came back too often. Mana and cooldowns are the limiters.
  mana: { perKill: 0.4 },

  revive: { radius: 90, time: 3, hpPct: 0.3, decay: 0.5 },

  // Dodge roll on Shift (playtest idea, 17 Oct): a quick dive in the move direction.
  roll: { duration: 0.33, speedMult: 2.4, iframes: 0.36, cooldown: 4 },

  coop: {
    spawnPerExtraPlayer: 0.5, hpPerExtraPlayer: 0.15,
    // Herd spirit: each live mate within herdRadius gives +herdDamage damage and +herdArmor armor (max herdMax mates).
    herdRadius: 220, herdDamage: 0.08, herdArmor: 1, herdMax: 3,
    reviveHelpersMult: 2,     // two or more rescuers revive this much faster
    lastReadyShopTime: 30,    // once everyone else is ready, the shop closes within this many seconds
  },

  enemy: {
    hpGrowth: 0.06,         // owner (18 Oct): "it just feels easy". Regular enemies' HP x (1 + hpGrowth * (wave - 1)) on top of their per-wave growth
    cap: 360,               // live enemies (bushes excluded)
    spawnMarkTime: 0.9,     // s a spawn marker shows before the enemy appears
    spawnMinPlayerDist: 260,
    separation: 0.6,        // push strength between overlapping enemies
    knockbackDecay: 10,     // per second
  },

  pickups: {
    max: 160,               // amber blobs on the map; extras merge
    magnetSpeed: 520,
    magnetAccel: 2400,
    collectDist: 26,
    berryHealPct: 0.12,
    bushEvery: 9,           // s between fern bush spawn attempts
    bushMax: 3,
  },

  // Playtest (17 Oct): too much amber, too many weapons, levelling too fast.
  economy: {
    harvestGrowth: 0.05,    // Harvesting grows 5% (rounded up) each wave end
    xpPerAmber: 1,
    dropStart: 0.9,         // chance a normal kill drops amber, waves 1-2
    dropPerWave: 0.018,     // falls this much per wave after wave 2
    dropMin: 0.55,
    itemPriceMult: 1.25,    // item prices (weapons stay at base so a 2nd weapon is reachable early)
  },

  shop: {
    time: 60,               // s before the next wave starts on its own
    slots: 4,
    maxWeapons: 6,
    sellRefund: 0.25,
    rerollBaseFactor: 0.75, // first reroll = floor(0.75*wave) + step
    rerollStepFactor: 0.4,  // step = max(1, floor(0.4*wave))
  },

  // XP needed to go from level L to L+1.
  xpToLevel: (level) => (level === 0 ? 10 : Math.round(1.1 * (level + 4) * (level + 4))), // first level-up comes in wave 1
  hpPerLevel: 1,

  waves: { count: 20, bossEnrageAfter: 60 }, // fallback; the boss's own enrageAfter (src/data/enemies.js) wins
};
