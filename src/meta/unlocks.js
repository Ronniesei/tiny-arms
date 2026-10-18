// Hero unlocks and lifetime progress ("one more run" reasons), kept per browser in localStorage.
//
//   key        tinyarms.progress   (JSON, see emptyProgress)
//   rules      CHARACTERS[id].unlock = {stat, target, text} in src/data/characters.js (the first four heroes have none)
//   stats      totals {runs, wins, kills, amber, bestWave} across runs, plus per hero {runs, wins, bestWave, bestDanger}
//              bestDanger = the highest Danger level WON with that hero (-1: never won), shown as stars.
//
// Every browser records its own player's numbers at the end of each run (app.js trackRun): the host and solo player from the
// scoreboard, a joiner from session.me().result with their own myId row. Storage may be missing or throw (private window,
// blocked site data): then progress lives in memory for this page load and the game works as normal.
// Test hooks: ?unlockall=1 (main.js) unlocks every hero; setStorage() swaps in a fake storage.

import { CHARACTERS, CHARACTER_IDS } from '../data/characters.js';
import { clampDanger } from '../data/danger.js';

export const PROGRESS_KEY = 'tinyarms.progress';
const VERSION = 1;

let override = null;     // a storage-like {getItem, setItem} (tests)
let memory = null;       // the latest progress, used when storage is unavailable
let dirty = false;       // the last save did not reach storage, so memory is newer than what storage holds
let unlockAll = false;   // ?unlockall=1
let lastNew = [];        // heroes unlocked by the most recently recorded run

/** Test hook: use this storage instead of localStorage (null goes back to localStorage). Forgets the in-memory copy. */
export function setStorage(st) { override = st || null; memory = null; dirty = false; lastNew = []; }
/** ?unlockall=1: every hero is pickable (progress and stars are still recorded for real). */
export function setUnlockAll(on) { unlockAll = !!on; }
export function isUnlockAll() { return unlockAll; }

function storage() {
  if (override) return override;
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}

const num = (v) => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : 0);

function emptyHero() { return { runs: 0, wins: 0, bestWave: 0, bestDanger: -1 }; }
export function emptyProgress() {
  return { v: VERSION, totals: { runs: 0, wins: 0, kills: 0, amber: 0, bestWave: 0 }, unlocked: [], heroes: {} };
}

/** Anything (null, garbage, an older shape) -> a complete, safe progress object. */
function normalise(raw) {
  const p = emptyProgress();
  if (!raw || typeof raw !== 'object') return p;
  const t = raw.totals || {};
  for (const k of Object.keys(p.totals)) p.totals[k] = num(t[k]);
  if (Array.isArray(raw.unlocked)) p.unlocked = raw.unlocked.filter((id) => CHARACTERS[id]?.unlock);
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
  const st = storage();
  try { st && st.setItem(PROGRESS_KEY, JSON.stringify(emptyProgress())); } catch (e) { /* nothing to do */ }
}

// ---- reading ----

/**
 * How far along a hero's unlock rule is: {have, target, frac, done, text, stat}. Heroes without a rule are done.
 * `have` is capped at the target.
 */
export function heroProgress(id, progress = loadProgress()) {
  const u = CHARACTERS[id]?.unlock;
  if (!u) return { have: 1, target: 1, frac: 1, done: true, text: '', stat: '' };
  const raw = num(progress.totals[u.stat]);
  const have = Math.min(raw, u.target);
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

// ---- writing ----

/** The run to record from an end-of-run result and a player id: this player's own scoreboard row. Null if they have none. */
export function runFromResult(res, pid) {
  const row = res && Array.isArray(res.rows) ? res.rows.find((r) => r.pid === pid) : null;
  if (!row || !CHARACTERS[row.char]) return null;
  return { char: row.char, win: !!res.win, wave: num(res.wave), danger: res.danger ?? 1, kills: num(row.kills), amber: num(row.amber) };
}

/**
 * Record one finished run for this browser: totals, the hero's own numbers, Danger stars on a win, and any heroes whose
 * unlock rule is now met. Returns {newly: [hero ids], progress}. Also remembers `newly` for lastNewlyUnlocked().
 * @param {{char:string, win:boolean, wave:number, danger:number, kills:number, amber:number}} run
 */
export function recordRun(run) {
  const p = loadProgress();
  const t = p.totals;
  t.runs++;
  if (run.win) t.wins++;
  t.kills += num(run.kills);
  t.amber += num(run.amber);
  t.bestWave = Math.max(t.bestWave, num(run.wave));
  if (CHARACTERS[run.char]) {
    const h = p.heroes[run.char] || (p.heroes[run.char] = emptyHero());
    h.runs++;
    if (run.win) { h.wins++; h.bestDanger = Math.max(h.bestDanger, clampDanger(run.danger)); }
    h.bestWave = Math.max(h.bestWave, num(run.wave));
  }
  const newly = [];
  for (const id of CHARACTER_IDS) {
    if (!CHARACTERS[id].unlock || p.unlocked.includes(id)) continue;
    if (heroProgress(id, p).done) { p.unlocked.push(id); newly.push(id); }
  }
  saveProgress(p);
  lastNew = newly;
  return { newly, progress: p };
}
