// Challenges: goals that each unlock one piece of content (docs/PROGRESSION.md). Plain data, weekly tweaks are edits here.
//
//   id, name, desc   shown on the Challenges screen ("Roll Model": "Dodge roll 100 times (all runs)")
//   tier             'easy' | 'medium' | 'hard' (a hint of effort; the UI may colour it)
//   reward           {kind: 'item'|'weapon', id}: locked in the shop and crates until this challenge is done
//   check(run, progress) -> boolean
//                    Evaluated at the end of every run with that run's summary (src/meta/unlocks.js runFromResult), and on
//                    load with run = null. `progress` already includes the run just finished. Lifetime goals (totals, hero
//                    wins, danger wins) read progress and so work with run = null (past play counts). Goals about one run's
//                    build or numbers need the run, so they return false for null.
//   progress(run, progress) -> {have, target}
//                    Drives the progress bar. Always called with run = null and the saved progress, so it reads lifetime
//                    totals and `progress.best` (the best value of a single-run number across all runs, see runBests).
//
// Stat values in run.stats are what the game stores: percents and points (speed 50 = +50%, armor 25, luck 100).

import { WEAPONS } from './weapons.js';

const n = (v) => (Number.isFinite(+v) ? +v : 0);
const stat = (run, k) => n(run && run.stats && run.stats[k]);
const total = (p, k) => n(p && p.totals && p.totals[k]);
const best = (p, k) => n(p && p.best && p.best[k]);
const single = (fn) => (run, p) => !!run && fn(run, p);

/** Highest Danger won by any hero (-1: never won). */
export function bestDangerWin(p) {
  let b = -1;
  for (const h of Object.values((p && p.heroes) || {})) if (h && typeof h.bestDanger === 'number') b = Math.max(b, h.bestDanger);
  return b;
}

/** Most weapons of one class in this run's final build. */
export function sameClassCount(run) {
  const by = {};
  for (const w of (run && run.weapons) || []) {
    const c = WEAPONS[w.wid] && WEAPONS[w.wid].cls;
    if (c) by[c] = (by[c] || 0) + 1;
  }
  return Math.max(0, ...Object.values(by));
}

/** Highest weapon tier (1-4) in this run's final build. */
export const topTier = (run) => Math.max(0, ...(((run && run.weapons) || []).map((w) => n(w.tier))));

/**
 * The single-run numbers worth remembering across runs (progress.best keeps the maximum of each), for progress bars.
 * To track a new single-run number: add it here and to BEST_KEYS.
 */
export function runBests(run) {
  return {
    armor: stat(run, 'armor'),
    speed: stat(run, 'speed'),
    luck: stat(run, 'luck'),
    items: ((run && run.items) || []).length,
    casts: n(run && run.casts),
    cleanWaves: n(run && run.cleanWaves),
    tier: topTier(run),
    classCount: sameClassCount(run),
    teamWin: run && run.win ? n(run.team) : 0, // team size of the biggest won run
  };
}
export const BEST_KEYS = ['armor', 'speed', 'luck', 'items', 'casts', 'cleanWaves', 'tier', 'classCount', 'teamWin'];

// ---- builders ----
const item = (id) => ({ kind: 'item', id });
const weapon = (id) => ({ kind: 'weapon', id });
const heroWin = (id, name, hero, tier, reward) => ({
  id: `win_${id}`, name, desc: `Win a run with ${hero}`, tier, reward,
  check: (run, p) => n(p && p.heroes && p.heroes[id] && p.heroes[id].wins) > 0 || !!(run && run.win && run.char === id),
  progress: (run, p) => ({ have: n(p && p.heroes && p.heroes[id] && p.heroes[id].wins) > 0 ? 1 : 0, target: 1 }),
});
const dangerWin = (d, key, name, level, tier, reward) => ({
  id: `win_${key}`, name, desc: `Win a run on ${level}`, tier, reward,
  check: (run, p) => bestDangerWin(p) >= d || !!(run && run.win && n(run.danger) >= d),
  progress: (run, p) => ({ have: bestDangerWin(p) >= d ? 1 : 0, target: 1 }),
});
const lifetime = (id, name, desc, tier, reward, stat, target) => ({
  id, name, desc, tier, reward,
  check: (run, p) => total(p, stat) >= target,
  progress: (run, p) => ({ have: total(p, stat), target }),
});
// A number in one run's final summary, remembered as progress.best[key].
const inRun = (id, name, desc, tier, reward, key, target, read) => ({
  id, name, desc, tier, reward,
  check: single((run) => read(run) >= target),
  progress: (run, p) => ({ have: best(p, key), target }),
});

export const CHALLENGES = [
  // ---- easy: done within the first runs ----
  lifetime('wave5', 'Warm Up', 'Reach wave 5', 'easy', item('cave_painting'), 'bestWave', 5),
  lifetime('kills500', 'Pest Control', 'Kill 500 enemies (all runs)', 'easy', weapon('boomerang_bone'), 'kills', 500),
  lifetime('amber500', 'Sticky Fingers', 'Collect 500 amber (all runs)', 'easy', item('nest_egg'), 'amber', 500),
  lifetime('rolls100', 'Roll Model', 'Dodge roll 100 times (all runs)', 'easy', item('rolling_stone'), 'rolls', 100),
  inRun('items12', 'Pack Rat', 'Own 12 items at the end of a run', 'easy', item('quill_coat'), 'items', 12, (r) => (r.items || []).length),

  // ---- medium ----
  lifetime('revive10', 'Herd Medic', 'Revive mates 10 times (all runs)', 'medium', item('herd_horn'), 'revives', 10),
  inRun('tier4', 'Fully Evolved', 'End a run with a tier IV weapon', 'medium', weapon('amber_laser'), 'tier', 4, topTier),
  inRun('speed50', 'Gotta Go Fast', 'Reach +50% Speed in a run', 'medium', item('wind_feather'), 'speed', 50, (r) => stat(r, 'speed')),
  inRun('casts40', 'Show-off', 'Cast your ability 40 times in one run', 'medium', item('thunder_egg'), 'casts', 40, (r) => n(r.casts)),
  dangerWin(2, 'hard', 'Tough Cookie', 'Hard', 'medium', item('volatile_eggs')),
  heroWin('brutus', 'Immovable', 'Brutus', 'medium', item('fossil_shield')),
  heroWin('fern', 'Green Thumbs', 'Fern', 'medium', item('second_wind')),
  heroWin('spike', 'Sharp Finish', 'Spike', 'medium', item('adrenaline_gland')),
  heroWin('sparky', 'Shock Victory', 'Sparky', 'medium', item('chain_spark')),
  heroWin('pip', 'Small but Mighty', 'Pip', 'medium', item('twin_quiver')),
  heroWin('goldie', 'Gold Standard', 'Goldie', 'medium', item('jackpot_gem')),
  heroWin('bolt', 'Tinkerer', 'Bolt', 'medium', weapon('beetle_jar')),
  heroWin('ash', 'Burn It Down', 'Ash', 'medium', item('ember_heart')),

  // ---- hard ----
  dangerWin(3, 'extinction', 'Not Extinct', 'Extinction', 'hard', item('time_amber')),
  dangerWin(4, 'meteor', 'Dodged the Sky', 'Meteor Shower', 'hard', item('big_bang')),
  dangerWin(5, 'apocalypse', 'Doomsday Rex', 'Apocalypse', 'hard', item('dino_crown')),
  heroWin('dash', 'Speed Run', 'Dash', 'hard', item('momentum_horn')),
  heroWin('lucky', 'Lucky Break', 'Lucky', 'hard', item('loaded_dice')),
  inRun('luck100', 'Four-Leaf Legend', 'Reach 100 Luck in a run', 'hard', item('four_leaf_fern'), 'luck', 100, (r) => stat(r, 'luck')),
  inRun('clean5', 'Untouchable', 'Finish 5 waves in one run without taking damage', 'hard', item('glass_jaw'), 'cleanWaves', 5, (r) => n(r.cleanWaves)),
  inRun('class6', 'Class Act', 'Hold 6 weapons of one class at the end of a run', 'hard', weapon('raptor_claws'), 'classCount', 6, sameClassCount),
  inRun('armor25', 'Iron Hide', 'Reach 25 Armor in a run', 'hard', item('golden_egg'), 'armor', 25, (r) => stat(r, 'armor')),
  {
    id: 'team3', name: 'Bro Night', desc: 'Win a run with 3 or more players', tier: 'hard', reward: item('mother_nest'),
    check: single((run) => !!run.win && n(run.team) >= 3),
    progress: (run, p) => ({ have: Math.min(best(p, 'teamWin'), 3), target: 3 }),
  },
];

/** Every reward id: locked until its challenge is done. */
export const LOCKED = { items: new Set(), weapons: new Set() };
for (const c of CHALLENGES) (c.reward.kind === 'weapon' ? LOCKED.weapons : LOCKED.items).add(c.reward.id);
