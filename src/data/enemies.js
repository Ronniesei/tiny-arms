// Enemy types. HP and damage grow per wave: value = base + perWave * (wave - 1).
// (HP is also multiplied for extra players by entities.enemyScale.)
// ai: key into the AI registry in src/sim/systems/enemies.js.
//
// Common fields
//   radius/size   collision radius / sprite size in px          mass       how hard others push it (bigger = steadier)
//   speed         px/s (cruise speed)                           kbResist   0..1 knockback resistance
//   dmg           contact damage (touching the player)          amber      amber dropped (elites/boss drop fixed amounts in damage.js)
//   group:[a,b]   enemies per spawn burst; pack:true = bunched around one point (spread px), else scattered
//   initCd:[a,b]  random delay before the first special attack  speedJitter  +/- fraction of random speed per enemy
//   contact       'always' (default) or 'attack' (only hurts while charging)
//   chargeDmg     damage while charging (also grows per wave)   neutral    not an enemy (fern bush)
// Attack timings are in seconds, speeds in px/s, lengths in px. Every attack has a windup that shows a telegraph.

export const ENEMIES = {
  // Fast chaser, low HP, comes in packs.
  raptor: {
    id: 'raptor', name: 'Raptor', ai: 'chase', sprite: 'e_raptor', size: 64, radius: 18,
    hp: 4.2, hpPerWave: 1.65, speed: 210, dmg: 2, dmgPerWave: 0.8, amber: 1, kbResist: 0,
    group: [3, 5], pack: true, spread: 90, speedJitter: 0.08,
  },

  // Medium. Walks up, raises its club (line telegraph), then charges along the line.
  caveman: {
    id: 'caveman', name: 'Caveman', ai: 'caveman', sprite: 'e_caveman', size: 64, radius: 22,
    hp: 10.2, hpPerWave: 3.45, speed: 105, dmg: 2, dmgPerWave: 0.4, amber: 1.5, kbResist: 0.1,
    group: [1, 2], initCd: [0.3, 1.0],
    chargeDmg: 3.5, chargeDmgPerWave: 0.875,
    triggerRange: 320, windup: 0.6, lockFrac: 0.55, chargeSpeed: 720, chargeDur: 0.5, recover: 0.55, attackCd: 3.0, wallDaze: 0.8,
  },

  // Tiny, very low HP, spawns as a cloud of 8-12 that drifts toward players with wobbly movement.
  mosquito: {
    id: 'mosquito', name: 'Mosquito', ai: 'swarm', sprite: 'e_mosquito', size: 34, radius: 9,
    hp: 1.7, hpPerWave: 0.49, speed: 125, dmg: 1, dmgPerWave: 0.25, amber: 0.4, kbResist: 0, mass: 0.4,
    group: [8, 12], pack: true, spread: 70,
    wobble: 0.95, wobbleFreq: 3.2,
  },

  // Keeps its distance, flares for 0.5 s, then spits a slow magenta shot.
  spitter: {
    id: 'spitter', name: 'Spitter', ai: 'spitter', sprite: 'e_spitter', size: 64, radius: 20,
    hp: 7.6, hpPerWave: 2.25, speed: 150, dmg: 2, dmgPerWave: 0.45, amber: 1, kbResist: 0.2,
    group: [1, 2], initCd: [0.4, 2.0],
    keepDist: 340, attackRange: 560, windup: 0.5, attackCd: 2.6,
    shotSpeed: 240, shotDmg: 2, shotDmgPerWave: 0.438, shotRadius: 10,
  },

  // Circles a player at orbitR, shows a line, dive-bombs along it, flies off, circles again. Only hurts while diving.
  ptero: {
    id: 'ptero', name: 'Pterodactyl', ai: 'ptero', sprite: 'e_ptero', size: 72, radius: 22,
    hp: 8.5, hpPerWave: 2.4, speed: 200, dmg: 0, dmgPerWave: 0, amber: 1.5, kbResist: 0.15,
    contact: 'attack', noSep: true, // flies over the crowd
    group: [1, 2], initCd: [1.0, 3.0],
    chargeDmg: 3, chargeDmgPerWave: 0.688,
    orbitR: 260, orbitLead: 0.55, triggerRange: 420, windup: 0.7, lockFrac: 0.7, chargeSpeed: 900, chargeDur: 0.6, awayTime: 0.9, attackCd: 2.4,
  },

  // Slow and tanky. When a player is close it winds up (circle telegraph) and tail-swings everything inside.
  ankylo: {
    id: 'ankylo', name: 'Ankylosaurus', ai: 'ankylo', sprite: 'e_ankylo', size: 104, radius: 40,
    hp: 51, hpPerWave: 10.5, speed: 62, dmg: 3, dmgPerWave: 0.5, amber: 3, kbResist: 0.85, mass: 6,
    group: [1, 1], initCd: [0, 0.5],
    swingDmg: 5, swingDmgPerWave: 1,
    triggerRange: 120, swingR: 135, windup: 0.6, recover: 0.6, attackCd: 2.8,
  },

  // ELITE (waves 10 and 15). Alternates a telegraphed charge and a telegraphed ring of spit. Below half HP it roars (event
  // elitePhase), is faster, double-rings and adds the pounce: a leap onto a marked spot, twice in a row.
  spino: {
    id: 'spino', name: 'Spinosaurus', ai: 'spino', sprite: 'e_spino', size: 150, radius: 56,
    hp: 595, hpPerWave: 312, speed: 105, dmg: 3, dmgPerWave: 0.5, amber: 0, kbResist: 0.3, mass: 14,
    chargeDmg: 6, chargeDmgPerWave: 1.125,
    initCd: [1.0, 1.0], attackCd: 2.2, attackCdRage: 1.3, rageHp: 0.5, rageSpeed: 1.4, rageRoar: 0.6,
    // attack order, indexed by the attack count (the rage list is used below rageHp)
    pattern: ['charge', 'ring'], patternRage: ['pounce', 'ring', 'charge'],
    // charge
    chargeRange: 650, windup: 0.85, lockFrac: 0.6, chargeSpeed: 760, chargeDur: 0.65, recover: 0.7, wallDaze: 1.1,
    // ring of spit
    ringWindup: 0.8, ringR: 110, ringShots: 10, ringShotsRage: 12, ringGap: 0.45,
    shotSpeed: 250, shotDmg: 4, shotDmgPerWave: 0.625, shotRadius: 11, shotLife: 3.4,
    // pounce (rage only): a red circle (pounceR) marks the landing spot for pounceWindup s (pounceWindup2 for the second
    // pounce of the chain); the spino crouches, then flies there during the last pounceFlight s and the circle hits.
    pounceRange: 560, pounceWindup: 1.0, pounceWindup2: 0.75, pounceFlight: 0.4, pounceChain: 2, pounceR: 125, pounceRecover: 0.9,
    pounceDmg: 4.5, pounceDmgPerWave: 0.812,
  },

  // BOSS (wave 20), 3 phases by HP. Phase 1: horn charge, stomp shockwave, raptor calls. Phase 2 adds a spit fan and chains
  // charges. Phase 3 adds a ground slam of warning circles and shortens cooldowns. A short invulnerable roar marks each
  // change (event bossPhase). Enrages after enrageAfter seconds.
  // Damage target at wave 20 (about 47 max HP, 5 armor): charge / stomp hit about 25% of max HP, slam circle about 22%, spit shot about 10%.
  trike: {
    id: 'trike', name: 'Triceratops', ai: 'trike', sprite: 'e_trike', size: 200, radius: 74,
    hp: 790, hpPerWave: 580, speed: 135, dmg: 3, dmgPerWave: 0.375, amber: 0, kbResist: 0.5, mass: 40,
    chargeDmg: 4, chargeDmgPerWave: 0.812,
    initCd: [1.2, 1.2], attackCd: 2.2, minWindup: 0.5, // no windup (enraged or not) is ever shorter than minWindup
    // phases: HP fractions that start phase 2 and 3, the roar, and per-phase attack order (indexed by the attack count),
    // cooldown multiplier, walking speed multiplier and number of charges per charge attack
    phaseHp: [0.66, 0.33], phaseRoar: 1.0, phaseRoarCd: 0.7,
    phaseAttacks: [['charge', 'stomp'], ['spit', 'charge', 'stomp'], ['slam', 'charge', 'spit', 'stomp']],
    phaseCd: [1, 0.8, 0.6], phaseSpeed: [1, 1.08, 1.16], phaseChain: [1, 2, 2],
    // horn charge (chained charges: shorter windup, line locks earlier in it)
    chargeRange: 700, windup: 0.95, lockFrac: 0.6, chargeSpeed: 640, chargeDur: 0.8, recover: 0.9, wallDaze: 1.6,
    chainWindup: 0.7, chainLock: 0.5,
    // stomp: the telegraphed circle is the whole danger zone; a ring sweeps out through it at ringReach/ringDur px/s
    stompRange: 480, stompWindup: 0.9, stompR: 420, stompR0: 40, ringDur: 1.8, ringBand: 24, stompRecover: 1.0,
    stompDmg: 3.5, stompDmgPerWave: 0.812,
    // spit fan (phase 2+): flash, then spitShots[phase-1] slow shots spread over spitArc[phase-1] radians at the target
    spitRange: 900, spitWindup: 0.75, spitRecover: 0.7, spitShots: [0, 5, 7], spitArc: [0, 0.8, 1.05],
    shotSpeed: 230, shotDmg: 3, shotDmgPerWave: 0.213, shotRadius: 11, shotLife: 4,
    // ground slam (phase 3): red circles (slamR) all fire after slamWindup s: one on each of up to slamOnPlayers players,
    // the rest ringed around the main target at slamRing px (slamCount circles in all, one more when enraged)
    slamRange: 1000, slamWindup: 0.85, slamRecover: 0.9, slamR: 115, slamRing: 260, slamCount: 4, slamOnPlayers: 3,
    slamDmg: 3.5, slamDmgPerWave: 0.688,
    // raptor call
    callWindup: 0.9, callFirst: 5, callEvery: 10, callPacks: 3, callCount: 6, callBonusMul: 1.5, callSpread: 80, callRecover: 0.7,
    // enrage (after enrageAfter s; this replaces BALANCE.waves.bossEnrageAfter): faster, shorter windups, more frequent attacks
    enrageAfter: 60, enrageSpeed: 1.3, enrageWindup: 0.8, enrageCd: 0.55, enrageCallEvery: 9, enrageChargeSpeed: 1.15,
  },

  // Neutral: break it for berries.
  bush: {
    id: 'bush', name: 'Fern Bush', ai: 'none', sprite: 'e_bush', size: 64, radius: 22,
    hp: 12, hpPerWave: 4, speed: 0, dmg: 0, dmgPerWave: 0, amber: 2, kbResist: 1, mass: 10000, neutral: true,
  },
};

export const ENEMY_IDS = Object.keys(ENEMIES);
