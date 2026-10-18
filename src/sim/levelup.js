// Level-up choices between waves: 4 stat cards per level gained, pick one.
// Card tiers: level 1 is always I, 5 is II, 10/15/20 are III, 25 and every 5th after are IV;
// other levels roll a tier with the shop rarity table (level instead of wave, boosted by Luck).
// Rerolling the cards costs the same as a shop reroll but has its own counter (p.shop.levelRerolls,
// reset every shop visit).

import { BALANCE } from '../data/balance.js';
import { UPGRADES } from '../data/items.js';
import { recomputeStats } from './stats.js';
import { rollTier, rerollPrice, HERO_LEAN } from './shop.js';
import { shuffle } from './rng.js';

const UPGRADE_KEYS = Object.keys(UPGRADES);

/** Tier for the card offered at `level` (fixed tiers at 1/5/10/15/20/25+, else a luck roll). */
export function levelTier(w, level, luck) {
  if (level >= 25 && level % 5 === 0) return 4;
  if (level === 10 || level === 15 || level === 20) return 3;
  if (level === 5) return 2;
  if (level === 1) return 1;
  return rollTier(w, level, luck);
}

/** The level the cards currently on offer are for. */
export function offeredLevel(p) {
  return p.level - p.pendingLevels + 1;
}

/** Amber price of the next level-up reroll (same table as the shop reroll, separate counter). */
export function levelRerollCost(w, p) {
  return rerollPrice(w.wave, p.shop?.levelRerolls || 0);
}

/** Stats that are already at a hard cap are not worth offering. */
function offerable(p, key) {
  if (key === 'dodge') return (p.stats?.dodge || 0) < BALANCE.stat.dodgeCap;
  if (key === 'critChance') return (p.stats?.critChance || 0) < 100;
  return true;
}

export function rollLevelChoices(w, p) {
  if (p.pendingLevels <= 0) { p.levelChoices = null; return; }
  const level = offeredLevel(p);
  // Two of the four cards come from the hero's favourite stats (HERO_LEAN), the rest from anything.
  const lean = shuffle(w.rng, (HERO_LEAN[p.char] || []).filter((k) => UPGRADES[k] && offerable(p, k))).slice(0, 2);
  const rest = shuffle(w.rng, UPGRADE_KEYS.filter((k) => offerable(p, k) && !lean.includes(k)));
  const keys = shuffle(w.rng, [...lean, ...rest.slice(0, 4 - lean.length)]);
  p.levelChoices = keys.map((stat) => {
    const tier = levelTier(w, level, p.stats.luck);
    return { stat, tier, value: UPGRADES[stat].values[tier - 1] };
  });
}

/** Pay for and roll a fresh set of cards for the level on offer. */
export function rerollLevelChoices(w, p) {
  if (!p.levelChoices || !p.levelChoices.length) return { ok: false, msg: 'No level-up to reroll' };
  const cost = levelRerollCost(w, p);
  if (p.amber < cost) return { ok: false, msg: 'Not enough amber' };
  p.amber -= cost;
  if (p.shop) p.shop.levelRerolls = (p.shop.levelRerolls || 0) + 1;
  rollLevelChoices(w, p);
  return { ok: true };
}

export function chooseLevel(w, p, idx) {
  const c = p.levelChoices?.[idx];
  if (!c) return { ok: false, msg: 'No such choice' };
  p.upgrades[c.stat] = (p.upgrades[c.stat] || 0) + c.value;
  p.pendingLevels--;
  recomputeStats(p);
  rollLevelChoices(w, p);
  return { ok: true };
}
