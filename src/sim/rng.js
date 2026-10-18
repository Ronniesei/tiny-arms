// Seeded RNG (mulberry32). The state is a plain object so the world stays serialisable.
// The simulation must use these functions, never Math.random.

/** @param {number} seed */
export function createRng(seed) {
  return { s: seed >>> 0 };
}

/** @param {{s:number}} r @returns {number} in [0, 1) */
export function next(r) {
  let t = (r.s = (r.s + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const range = (r, a, b) => a + (b - a) * next(r);
export const int = (r, a, b) => a + Math.floor(next(r) * (b - a + 1));
export const chance = (r, p) => next(r) < p;
export const pick = (r, arr) => arr[Math.floor(next(r) * arr.length)];

/** @param {{s:number}} r @param {Array<[any, number]>} entries [value, weight] pairs */
export function weighted(r, entries) {
  let total = 0;
  for (const [, wt] of entries) total += Math.max(0, wt);
  let roll = next(r) * total;
  for (const [v, wt] of entries) {
    roll -= Math.max(0, wt);
    if (roll < 0) return v;
  }
  return entries[entries.length - 1][0];
}

/** In-place Fisher-Yates shuffle. */
export function shuffle(r, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next(r) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
