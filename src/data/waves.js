// Wave table (index 0 = wave 1). The director in src/sim/systems/waves.js reads this.
//
//   dur    seconds (0 = boss wave: no timer, it ends when the boss dies)
//   total  enemies spawned over the wave for ONE player (more players -> faster spawning, see BALANCE.coop)
//   rate   (only when dur = 0) enemies per second for one player
//   mix    relative share of the enemies by type (it is a share of enemies, not of spawn bursts, so a
//          mosquito cloud of 10 and a lone ankylo can be compared directly). Group sizes: ENEMIES[type].group.
//   elite  enemy type spawned once as an elite ~2 s into the wave (marked on the ground first)
//   boss   enemy type spawned at the start as the boss
//
// New enemy types arrive in steps: W2 spitters, W3 cavemen, W4 mosquito clouds, W6 pteros, W8 ankylos,
// W10 + W15 elite Spinosaurus, W17-19 the heaviest mixes, W20 the Triceratops boss with raptor support.

import { ENEMIES } from './enemies.js';

/** First spawn burst and the quiet time at the end of a timed wave (matches the director). */
export const SPAWN_START = 0.4;
export const SPAWN_END_QUIET = 1.5;

// Playtest (17 Oct): waves felt short and easy, so they start at 30 s and grow to 70 s.
// Owner (19 Oct): "match them to the same time as Brotato": 20 s, +5 s a wave to 60 s at wave 9, then 60 s.
// Wave 20 (the boss) has no timer here: it ends when the boss dies (it enrages if the fight drags on).
const DUR = [20, 25, 30, 35, 40, 45, 50, 55, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 0];

/** Spawn rate grows every wave; within a wave it ramps (see RAMP), so each wave builds to a crescendo. */
export const RAMP = { start: 0.8, end: 1.2 }; // averages 1x, so W.total stays true
const ratePerSec = (wave) => 1.9 + 0.38 * (wave - 1) + 0.12 * Math.max(0, wave - 7); // review rounds 2 and 6: denser mid and late

// Review round 1: a Brotato wave is a horde of weak enemies. More enemies must not mean more money,
// so amber income is pinned per wave and each kill's drop chance is derived from it (W.drop).
const amberPerSec = (wave) => 2.1 + 0.12 * (wave - 1); // more buys per shop (builds need purchases)

//          wave  total  mix
const ROWS = [
  [1, 26, { raptor: 100 }],
  [2, 40, { raptor: 78, spitter: 22 }],
  [3, 52, { raptor: 64, spitter: 16, caveman: 20 }],
  [4, 76, { raptor: 48, spitter: 12, caveman: 18, mosquito: 22 }],
  [5, 94, { raptor: 46, spitter: 12, caveman: 18, mosquito: 24 }],
  [6, 112, { raptor: 38, spitter: 12, caveman: 16, mosquito: 22, ptero: 12 }],
  [7, 128, { raptor: 36, spitter: 12, caveman: 16, mosquito: 22, ptero: 14 }],
  [8, 144, { raptor: 36, spitter: 12, caveman: 15, mosquito: 20, ptero: 14, ankylo: 3 }],
  [9, 162, { raptor: 33, spitter: 12, caveman: 15, mosquito: 20, ptero: 15, ankylo: 5 }],
  [10, 150, { raptor: 33, spitter: 12, caveman: 15, mosquito: 20, ptero: 15, ankylo: 5 }], // + elite
  [11, 178, { raptor: 31, spitter: 12, caveman: 16, mosquito: 19, ptero: 16, ankylo: 6 }],
  [12, 190, { raptor: 30, spitter: 12, caveman: 16, mosquito: 19, ptero: 16, ankylo: 7 }],
  [13, 202, { raptor: 29, spitter: 12, caveman: 17, mosquito: 18, ptero: 16, ankylo: 8 }],
  [14, 212, { raptor: 28, spitter: 12, caveman: 17, mosquito: 18, ptero: 16, ankylo: 9 }],
  [15, 196, { raptor: 28, spitter: 12, caveman: 17, mosquito: 18, ptero: 16, ankylo: 9 }], // + elite
  [16, 226, { raptor: 26, spitter: 12, caveman: 18, mosquito: 17, ptero: 17, ankylo: 10 }],
  [17, 238, { raptor: 25, spitter: 12, caveman: 18, mosquito: 17, ptero: 18, ankylo: 10 }],
  [18, 248, { raptor: 23, spitter: 12, caveman: 19, mosquito: 17, ptero: 18, ankylo: 11 }],
  [19, 256, { raptor: 22, spitter: 12, caveman: 19, mosquito: 17, ptero: 19, ankylo: 11 }],
  [20, 0, { raptor: 100 }], // boss wave: raptor support on top of the boss's own calls
];

/** Mean enemies per spawn burst of a type. */
const meanGroup = (type) => {
  const g = ENEMIES[type].group;
  return (g[0] + g[1]) / 2;
};

export const WAVES = ROWS.map(([wave, , mix]) => {
  const dur = DUR[wave - 1];
  const eliteWave = wave === 10 || wave === 15;
  const total = dur > 0 ? Math.round(ratePerSec(wave) * (dur - SPAWN_START - SPAWN_END_QUIET) * (eliteWave ? 0.85 : 1)) : 0;
  const W = {
    wave, dur, total, mix,
    rate: dur > 0 ? total / (dur - SPAWN_START - SPAWN_END_QUIET) : 0.5,
    elite: wave === 10 || wave === 15 ? 'spino' : null,
    boss: wave === 20 ? 'trike' : null,
  };
  // Burst odds: a type's share of enemies divided by how many enemies one burst brings.
  W.weights = Object.entries(mix).map(([type, share]) => [type, share / meanGroup(type)]);
  let shareSum = 0, amberSum = 0;
  for (const [type, share] of Object.entries(mix)) { shareSum += share; amberSum += share * (ENEMIES[type].amber || 0); }
  const meanAmber = shareSum ? amberSum / shareSum : 1;
  W.drop = Math.min(1, amberPerSec(wave) / Math.max(0.1, W.rate * meanAmber));
  return W;
});
