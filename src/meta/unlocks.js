// Hero unlocks, challenges, unlocked content and Danger levels ("one more run" reasons; docs/PROGRESSION.md), kept per
// browser in localStorage.
//
//   key        tinyarms.progress   (JSON, see emptyProgress)
//   rules      CHARACTERS[id].unlock = {stat, target, text} in src/data/characters.js (the first four heroes have none).
//              stat is a lifetime total (bestWave, amber, kills, wins, revives, rolls, casts) or one of two derived numbers:
//              'challenges' (challenges done) and 'bestDangerWin' (highest Danger won by any hero, -1 none).
//   stats      totals {runs, wins, kills, amber, bestWave, revives, rolls, casts} across runs, plus per hero
//              {runs, wins, bestWave, bestDanger}; bestDanger = the highest Danger level WON with that hero (-1: never won),
//              shown as stars.
//   best       the best single-run numbers (armor, speed, ... see runBests in src/data/challenges.js), for progress bars.
//   challenges done challenge ids (src/data/challenges.js). Each unlocks one item or weapon (LOCKED there) for the shop.
//   Danger     Chill and Normal are open; winning on Danger d (any hero) unlocks d+1 (maxDangerUnlocked).
//
// Every browser records its own player's numbers at the end of each run (app.js trackRun): the host and solo player from the
// scoreboard, a joiner from session.me().result with their own myId row. Storage may be missing or throw (private window,
// blocked site data): then progress lives in memory for this page load and the game works as normal.
// Past play counts: syncChallenges() runs on load and completes every challenge the lifetime numbers already meet.
// Test hooks: ?unlockall=1 (main.js) unlocks every hero, item, weapon and Danger; setStorage() swaps in a fake storage.

import { CHARACTERS, CHARACTER_IDS } from '../data/characters.js';
import { DANGER, clampDanger } from '../data/danger.js';
import { ITEM_IDS } from '../data/items.js';
import { WEAPON_IDS } from '../data/weapons.js';
import { CHALLENGES, LOCKED, BEST_KEYS, runBests, bestDangerWin } from '../data/challenges.js';

export const PROGRESS_KEY = 'tinyarms.progress';
const VERSION = 1;

let override = null;     // a storage-like {getItem, setItem} (tests)
let memory = null;       // the latest progress, used when storage is unavailable
let dirty = false;       // the last save did not reach storage, so memory is newer than what storage holds
let unlockAll = false;   // ?unlockall=1
let lastNew = [];        // heroes unlocked by the most recently recorded run
let lastChal = [];       // challenges it completed
let lastDang = [];       // Danger levels it unlocked

/** Test hook: use this storage instead of localStorage (null goes back to localStorage). Forgets the in-memory copy. */
export function setStorage(st) { override = st || null; memory = null; dirty = false; lastNew = []; lastChal = []; lastDang = []; }
/** ?unlockall=1: every hero, item, weapon and Danger is open (progress, stars and challenges are still recorded for real). */
export function setUnlockAll(on) { unlockAll = !!on; }
export function isUnlockAll() { return unlockAll; }

function storage() {
  if (override) return override;
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}

const num = (v) => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : 0);
const CHALLENGE_BY_ID = Object.fromEntries(CHALLENGES.map((c) => [c.id, c]));

function emptyHero() { return { runs: 0, wins: 0, bestWave: 0, bestDanger: -1 }; }
export function emptyProgress() {
  return {
    v: VERSION,
    totals: { runs: 0, wins: 0, kills: 0, amber: 0, bestWave: 0, revives: 0, rolls: 0, casts: 0 },
    best: Object.fromEntries(BEST_KEYS.map((k) => [k, 0])),
    unlocked: [],
    challenges: [],
    heroes: {},
  };
}

/** Anything (null, garbage, an older shape) -> a complete, safe progress object. */
function normalise(raw) {
  const p = emptyProgress();
  if (!raw || typeof raw !== 'object') return p;
  const t = raw.totals || {};
  for (const k of Object.keys(p.totals)) p.totals[k] = num(t[k]);
  const b = raw.best || {};
  for (const k of BEST_KEYS) p.best[k] = num(b[k]);
  if (Array.isArray(raw.unlocked)) p.unlocked = raw.unlocked.filter((id) => CHARACTERS[id]?.unlock);
  if (Array.isArray(raw.challenges)) p.challenges = [...new Set(raw.challenges.filter((id) => CHALLENGE_BY_ID[id]))];
  for (const id of CHARACTER_IDS) {
    const h = raw.heroes && raw.heroes[id];
    if (!h || typeof h !== 'object') continue;
    const bd = typeof h.bestDanger === 'number' && Number.isFinite(h.bestDanger) ? Math.round(h.bestDanger) : -1;
    p.heroes[id] = { runs: num(h.runs), wins: num(h.wins), bestWave: num(h.bestWave), bestDanger: bd < 0 ? -1 : clampDanger(bd) };
  }
  return p;
}

/** The saved progress (never throws). */
export function loadProgress() {
  const st = storage();
  if (st && !dirty) {
    try {
      const raw = st.getItem(PROGRESS_KEY);
      if (raw) return normalise(JSON.parse(raw));
    } catch (e) { /* unreadable or corrupt: fall back to memory */ }
  }
  return normalise(memory);
}

/** Save progress; returns false when storage is unavailable (the in-memory copy still holds it). */
export function saveProgress(p) {
  memory = JSON.parse(JSON.stringify(p));
  const st = storage();
  dirty = true;
  if (!st) return false;
  try { st.setItem(PROGRESS_KEY, JSON.stringify(p)); dirty = false; return true; } catch (e) { return false; }
}

/** Forget everything (tests, a "reset progress" button if one is ever added). */
export function resetProgress() {
  memory = null;
  dirty = false;
  lastNew = [];
  lastChal = [];
  lastDang = [];
  const st = storage();
  try { st && st.setItem(PROGRESS_KEY, JSON.stringify(emptyProgress())); } catch (e) { /* nothing to do */ }
}

// ---- reading ----

/** The number a hero unlock rule reads: a lifetime total, 'challenges' (done count) or 'bestDangerWin' (-1: never won). */
function statValue(progress, stat) {
  if (stat === 'challenges') return (progress.challenges || []).length;
  if (stat === 'bestDangerWin') return bestDangerWin(progress);
  return num(progress.totals && progress.totals[stat]);
}

/**
 * How far along a hero's unlock rule is: {have, target, frac, done, text, stat}. Heroes without a rule are done.
 * `have` is capped at the target.
 */
export function heroProgress(id, progress = loadProgress()) {
  const u = CHARACTERS[id]?.unlock;
  if (!u) return { have: 1, target: 1, frac: 1, done: true, text: '', stat: '' };
  const raw = statValue(progress, u.stat);
  const have = Math.min(Math.max(raw, 0), u.target);
  return { have, target: u.target, frac: u.target > 0 ? have / u.target : 1, done: raw >= u.target, text: u.text, stat: u.stat };
}

/** Earned by playing (ignores ?unlockall): a starter hero, one already unlocked, or one whose rule is met. */
export function isEarned(id, progress = loadProgress()) {
  const c = CHARACTERS[id];
  if (!c) return false;
  if (!c.unlock) return true;
  return progress.unlocked.includes(id) || heroProgress(id, progress).done;
}

/** Can this browser pick the hero? */
export function isUnlocked(id, progress) {
  if (!CHARACTERS[id]) return false;
  if (unlockAll) return true;
  return isEarned(id, progress || loadProgress());
}

/** Unlocked hero ids in lobby order. */
export function unlockedIds(progress = loadProgress()) {
  return CHARACTER_IDS.filter((id) => isUnlocked(id, progress));
}

/** Danger stars for a hero: 0 (never won) .. DANGER.length. A win on Chill is 1 star, on Extinction 4. */
export function heroStars(id, progress = loadProgress()) {
  return (progress.heroes[id]?.bestDanger ?? -1) + 1;
}

/** Heroes unlocked by the most recently recorded run (for the end screen). */
export function lastNewlyUnlocked() { return lastNew.slice(); }

/** Everything the most recently recorded run unlocked: {heroes: ids, challenges: ids, dangers: levels} (for the end screen). */
export function lastUnlocks() { return { heroes: lastNew.slice(), challenges: lastChal.slice(), dangers: lastDang.slice() }; }

/**
 * One challenge's state: {done, have, target, frac}. `done` is what has been recorded (recordRun / syncChallenges); `have` is
 * capped at the target and equals it once done. A challenge without a progress() counts 0/1.
 */
export function challengeState(id, progress = loadProgress()) {
  const c = CHALLENGE_BY_ID[id];
  if (!c) return { done: false, have: 0, target: 1, frac: 0 };
  const done = (progress.challenges || []).includes(id);
  let have = 0, target = 1;
  if (c.progress) {
    try {
      const r = c.progress(null, progress) || {};
      target = Math.max(1, +r.target || 1);
      have = Math.max(0, +r.have || 0);
    } catch (e) { /* a broken progress bar must not break the screen */ }
  }
  have = done ? target : Math.min(have, target);
  return { done, have, target, frac: have / target };
}

/** Item and weapon ids this browser may see in the shop and crates: everything except rewards whose challenge is not done. */
export function unlockedContent(progress = loadProgress()) {
  if (unlockAll) return { items: ITEM_IDS.slice(), weapons: WEAPON_IDS.slice() };
  const items = new Set(), weapons = new Set();
  for (const id of progress.challenges || []) {
    const r = CHALLENGE_BY_ID[id]?.reward;
    if (r) (r.kind === 'weapon' ? weapons : items).add(r.id);
  }
  return {
    items: ITEM_IDS.filter((id) => !LOCKED.items.has(id) || items.has(id)),
    weapons: WEAPON_IDS.filter((id) => !LOCKED.weapons.has(id) || weapons.has(id)),
  };
}

/** The highest Danger earned by playing: one above the highest won, and Normal at least. Ignores ?unlockall. */
function earnedMaxDanger(progress) {
  return Math.min(DANGER.length - 1, Math.max(1, bestDangerWin(progress) + 1));
}

/** The highest Danger this browser can pick (Chill and Normal are open; winning on d opens d+1). All of them with ?unlockall. */
export function maxDangerUnlocked(progress = loadProgress()) {
  return unlockAll ? DANGER.length - 1 : earnedMaxDanger(progress);
}

export function isDangerUnlocked(d, progress = loadProgress()) {
  const n = Math.round(Number(d));
  return Number.isFinite(n) && n >= 0 && n < DANGER.length && n <= maxDangerUnlocked(progress);
}

// ---- writing ----

const numArr = (v) => (Array.isArray(v) ? v : []);

/** Fill every field of a run summary (docs/PROGRESSION.md "Run summary"): older callers and rows may lack some. */
function fillRun(run) {
  const r = run || {};
  const stats = {};
  for (const [k, v] of Object.entries(r.stats && typeof r.stats === 'object' ? r.stats : {})) if (Number.isFinite(+v)) stats[k] = +v;
  return {
    char: r.char, win: !!r.win, wave: num(r.wave), danger: r.danger ?? 1, team: Math.max(1, num(r.team)),
    kills: num(r.kills), amber: num(r.amber), damageDealt: num(r.damageDealt), damageTaken: num(r.damageTaken),
    revives: num(r.revives), healing: num(r.healing), casts: num(r.casts), downs: num(r.downs), rolls: num(r.rolls),
    cleanWaves: num(r.cleanWaves), level: num(r.level),
    weapons: numArr(r.weapons).filter((w) => w && w.wid).map((w) => ({ wid: w.wid, tier: num(w.tier) || 1 })),
    items: numArr(r.items).filter((id) => typeof id === 'string'),
    stats,
  };
}

/**
 * The run to record from an end-of-run result and a player id: this player's own scoreboard row plus the run's win, wave and
 * Danger, as the "Run summary" in docs/PROGRESSION.md. Missing numbers are 0, missing lists empty. Null if they have no row.
 */
export function runFromResult(res, pid) {
  const rows = res && Array.isArray(res.rows) ? res.rows : [];
  const row = rows.find((r) => r.pid === pid);
  if (!row || !CHARACTERS[row.char]) return null;
  return fillRun({ ...row, win: res.win, wave: res.wave, danger: res.danger, team: rows.length });
}

/** Complete every not-yet-done challenge whose check passes; pushes onto p.challenges and returns the new ids. */
function evaluateChallenges(run, p) {
  const newly = [];
  for (const c of CHALLENGES) {
    if (p.challenges.includes(c.id)) continue;
    let ok = false;
    try { ok = !!c.check(run, p); } catch (e) { ok = false; }
    if (ok) { p.challenges.push(c.id); newly.push(c.id); }
  }
  return newly;
}

/** Unlock every hero whose rule is now met; returns the new ids. */
function unlockHeroes(p) {
  const newly = [];
  for (const id of CHARACTER_IDS) {
    if (!CHARACTERS[id].unlock || p.unlocked.includes(id)) continue;
    if (heroProgress(id, p).done) { p.unlocked.push(id); newly.push(id); }
  }
  return newly;
}

/**
 * Past play counts: mark every challenge that the lifetime numbers (totals, hero wins, Danger wins) already meet, and unlock
 * the heroes whose rule is now met. Needs no run, so goals about one run's build are left alone. Safe to call any time: it
 * only saves when something changed, and a second call finds nothing. Returns the newly done challenge ids.
 */
export function syncChallenges(progress) {
  const p = progress || loadProgress();
  if (!Array.isArray(p.challenges)) p.challenges = [];
  if (!Array.isArray(p.unlocked)) p.unlocked = [];
  const done = evaluateChallenges(null, p);
  const heroes = unlockHeroes(p);
  if (done.length || heroes.length) saveProgress(p);
  return done;
}

/**
 * Record one finished run for this browser: totals, the hero's own numbers, Danger stars on a win, the best single-run
 * numbers, then any challenges it completes, then any heroes whose unlock rule is now met (challenge counts can unlock one),
 * then any Danger level it opened. Returns {newly: [hero ids], challenges: [ids], dangers: [levels], progress} and remembers
 * them for lastNewlyUnlocked() / lastUnlocks().
 * @param {{char:string, win:boolean, wave:number, danger:number, kills:number, amber:number}} run  at least these; the rest of
 *   the run summary (runFromResult) is optional and defaults to 0 / empty.
 */
export function recordRun(run) {
  const r = fillRun(run);
  const p = loadProgress();
  const dangerBefore = earnedMaxDanger(p);
  const t = p.totals;
  t.runs++;
  if (r.win) t.wins++;
  t.kills += r.kills;
  t.amber += r.amber;
  t.revives += r.revives;
  t.rolls += r.rolls;
  t.casts += r.casts;
  t.bestWave = Math.max(t.bestWave, r.wave);
  if (CHARACTERS[r.char]) {
    const h = p.heroes[r.char] || (p.heroes[r.char] = emptyHero());
    h.runs++;
    if (r.win) { h.wins++; h.bestDanger = Math.max(h.bestDanger, clampDanger(r.danger)); }
    h.bestWave = Math.max(h.bestWave, r.wave);
  }
  const bests = runBests(r);
  for (const k of BEST_KEYS) p.best[k] = Math.max(p.best[k], num(bests[k]));

  const challenges = evaluateChallenges(r, p);
  const newly = unlockHeroes(p);
  const dangerAfter = earnedMaxDanger(p);
  const dangers = [];
  for (let d = dangerBefore + 1; d <= dangerAfter; d++) dangers.push(d);

  saveProgress(p);
  lastNew = newly;
  lastChal = challenges;
  lastDang = dangers;
  return { newly, challenges, dangers, progress: p };
}
