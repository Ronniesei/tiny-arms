// Danger levels, picked by the host in the lobby ("easy mode exists, the hardest mode still feels fair").
// Level 1 (Normal) is the default and changes nothing.
//
//   desc        one line for the lobby button (the lobby adds the HP / damage numbers itself)
//   hp          enemy HP multiplier (elites and the boss included)
//   dmg         enemy damage multiplier (contact damage; see dangerOf(w).dmg for the other attack types)
//   extraElites wave numbers that get an elite ON TOP of the wave table's own elite waves (WAVES[n].elite)
//   bossHp      extra multiplier for the boss only (on top of hp)
//
// Everything here is plain data: weekly tweaks are number edits.

import { WAVES } from './waves.js';

export const DANGER = [
  { id: 0, name: 'Chill', desc: 'Relaxed. Softer enemies, good for learning.', hp: 0.75, dmg: 0.75, extraElites: [], bossHp: 1 },
  { id: 1, name: 'Normal', desc: 'The standard run. Start here.', hp: 1, dmg: 1, extraElites: [], bossHp: 1 },
  { id: 2, name: 'Hard', desc: 'Tougher enemies and another elite late on.', hp: 1.25, dmg: 1.2, extraElites: [17], bossHp: 1 },
  { id: 3, name: 'Extinction', desc: 'Brutal. Elites late on and a much tougher boss.', hp: 1.5, dmg: 1.4, extraElites: [17], bossHp: 1.3 },
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
