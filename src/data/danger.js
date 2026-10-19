// Danger levels, picked by the host in the lobby ("easy mode exists, the hardest mode still feels fair").
// Level 1 (Normal) is the default and changes nothing.
//
//   desc        one line for the lobby button (the lobby adds the HP / damage numbers itself)
//   hp          enemy HP multiplier (elites and the boss included)
//   dmg         enemy damage multiplier (contact damage; see dangerOf(w).dmg for the other attack types)
//   extraElites wave numbers that get an elite ON TOP of the wave table's own elite waves (WAVES[n].elite)
//   bossHp      extra multiplier for the boss only (on top of hp)
//   speed       enemy move speed multiplier (optional, default 1)
//   meteors     {every, dmg, perWave, r} or null: during waves a meteor lands near a random player every `every` s
//               (red circle warning first). dmg = base damage at wave 1, +perWave each wave. r = blast radius.
//               Implemented in src/sim/systems/hazards.js.
//
// Unlocking: Chill and Normal are open. Winning on level d unlocks d+1 (src/meta/unlocks.js maxDangerUnlocked).
//
// Everything here is plain data: weekly tweaks are number edits.

import { WAVES } from './waves.js';

export const DANGER = [
  { id: 0, name: 'Chill', desc: 'Relaxed. Softer enemies, good for learning.', hp: 0.75, dmg: 0.75, extraElites: [], bossHp: 1, speed: 1, meteors: null },
  { id: 1, name: 'Normal', desc: 'The standard run. Start here.', hp: 1, dmg: 1, extraElites: [], bossHp: 1, speed: 1, meteors: null },
  { id: 2, name: 'Hard', desc: 'Tougher enemies and another elite late on.', hp: 1.25, dmg: 1.2, extraElites: [17], bossHp: 1, speed: 1, meteors: null },
  { id: 3, name: 'Extinction', desc: 'Brutal. Elites late on and a much tougher boss.', hp: 1.5, dmg: 1.4, extraElites: [17], bossHp: 1.3, speed: 1, meteors: null },
  { id: 4, name: 'Meteor Shower', desc: 'Meteors rain on the arena. Faster enemies, more elites.', hp: 1.75, dmg: 1.55, extraElites: [12, 17], bossHp: 1.5, speed: 1.06, meteors: { every: 5, dmg: 8, perWave: 1.2, r: 90 } },
  { id: 5, name: 'Apocalypse', desc: 'The sky is falling. Everything is faster, tougher and angrier.', hp: 2.05, dmg: 1.75, extraElites: [8, 12, 17], bossHp: 1.8, speed: 1.12, meteors: { every: 3, dmg: 10, perWave: 1.5, r: 100 } },
];

export const DEFAULT_DANGER = 1;

/** The elite type that the extra elite waves bring (the same one the wave table uses). */
export const EXTRA_ELITE_TYPE = 'spino';

/** Clamp anything (undefined, "2", 7) to a valid danger index. */
export function clampDanger(d) {
  const n = Math.round(Number(d));
  return Number.isFinite(n) ? Math.max(0, Math.min(DANGER.length - 1, n)) : DEFAULT_DANGER;
}

/** The danger entry for a world (or any object with a `danger` index). */
export function dangerOf(w) {
  return DANGER[clampDanger(w && w.danger !== undefined ? w.danger : DEFAULT_DANGER)];
}

/** Elite type spawned on `wave` at this danger level, or null. The wave table's elite wins. */
export function eliteTypeFor(wave, danger) {
  const W = WAVES[Math.min(WAVES.length, Math.max(1, wave)) - 1];
  if (W.elite) return W.elite;
  return DANGER[clampDanger(danger)].extraElites.includes(wave) ? EXTRA_ELITE_TYPE : null;
}

/** All waves that have an elite at this danger level, ascending (the wave table's plus the extra ones). */
export function eliteWaves(danger) {
  return WAVES.filter((W) => eliteTypeFor(W.wave, danger)).map((W) => W.wave);
}
