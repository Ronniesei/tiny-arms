// Wave director: spawn markers, spawn bursts, fern bushes, elites and the boss.
// Enemies appear at a marker (shown for BALANCE.enemy.spawnMarkTime) so spawns are never a surprise.
//
// Pacing: the wave table gives `total` enemies for one player. They arrive in bursts (a raptor pack, a
// mosquito cloud, one ankylo ...) at a steady rate: the gap after a burst is burstSize / rate, so the stream
// of enemies is even whatever the mix. Extra players raise the rate (BALANCE.coop.spawnPerExtraPlayer).

import { BALANCE } from '../../data/balance.js';
import { CHARACTERS } from '../../data/characters.js';
import { ENEMIES } from '../../data/enemies.js';
import { RAMP, SPAWN_END_QUIET, SPAWN_START, WAVES } from '../../data/waves.js';
import { eliteTypeFor } from '../../data/danger.js';
import { emit, spawnEnemy } from '../entities.js';
import { int, range, weighted } from '../rng.js';

export function waveDef(w) {
  return WAVES[Math.min(WAVES.length, Math.max(1, w.wave)) - 1];
}

/** A random point at least spawnMinPlayerDist from every live player. */
export function randomSpawnPos(w, margin = 70) {
  const { w: AW, h: AH } = BALANCE.arena;
  const minD = BALANCE.enemy.spawnMinPlayerDist;
  let x = AW / 2, y = AH / 2;
  for (let tries = 0; tries < 30; tries++) {
    x = range(w.rng, margin, AW - margin);
    y = range(w.rng, margin, AH - margin);
    let ok = true;
    for (const p of w.players) {
      if (p.gone || p.downed) continue;
      if ((p.x - x) ** 2 + (p.y - y) ** 2 < minD * minD) { ok = false; break; }
    }
    if (ok) break;
  }
  return { x, y };
}

export function mark(w, type, x, y, extra) {
  w.marks.push({ type, x, y, t: BALANCE.enemy.spawnMarkTime, extra });
}

/** Live enemies (bushes excluded) plus the ones about to appear. */
export function liveCount(w) {
  let n = 0;
  for (const e of w.enemies) if (!e.dead && !ENEMIES[e.type].neutral) n++;
  return n + w.marks.length;
}

/** How many extra enemies/second a team of this size brings, as a multiplier. */
export function coopMul(w) {
  return 1 + BALANCE.coop.spawnPerExtraPlayer * (Math.max(1, w.activeCount) - 1);
}

/**
 * Mark `count` enemies bunched around one point (a pack/cloud), keeping them inside the arena.
 * Respects the live-enemy cap. Returns how many were marked. Used by the director and by the boss's call.
 */
export function spawnPack(w, type, count, spread, extra, center) {
  const { w: AW, h: AH } = BALANCE.arena;
  count = Math.min(count, BALANCE.enemy.cap - liveCount(w));
  if (count <= 0) return 0;
  const c = center || randomSpawnPos(w, 120);
  const m = 40;
  for (let i = 0; i < count; i++) {
    const a = range(w.rng, 0, Math.PI * 2), d = spread * Math.sqrt(range(w.rng, 0, 1));
    const x = Math.min(AW - m, Math.max(m, c.x + Math.cos(a) * d));
    const y = Math.min(AH - m, Math.max(m, c.y + Math.sin(a) * d));
    mark(w, type, x, y, extra);
  }
  return count;
}

/** One spawn burst. Returns the planned size of the burst (used to space the next one). */
function burst(w, W, d) {
  const type = weighted(w.rng, W.weights);
  const def = ENEMIES[type];
  const planned = int(w.rng, def.group[0], def.group[1]);
  const count = Math.min(planned, BALANCE.enemy.cap - liveCount(w));
  if (count <= 0) return planned;
  if (def.pack) {
    const extra = type === 'mosquito' ? { cloud: ++d.cloud } : undefined;
    spawnPack(w, type, count, def.spread, extra);
  } else {
    for (let i = 0; i < count; i++) {
      const p = randomSpawnPos(w);
      mark(w, type, p.x, p.y);
    }
  }
  d.spawned += count;
  return planned;
}

/** Fern bush spawn-rate multiplier: the best `bushRate` trait of any player still in the run (1 if none). */
export function bushRate(w) {
  let r = 1;
  for (const p of w.players) if (!p.gone) r = Math.max(r, CHARACTERS[p.char]?.trait?.bushRate || 1);
  return r;
}

export function begin(w) {
  w.dir = { spawnT: SPAWN_START, bushT: BALANCE.pickups.bushEvery * 0.4 / bushRate(w), eliteDone: false, bossDone: false, cloud: 0, spawned: 0 };
  w.bossDead = false;
}

export function update(w, dt) {
  const W = waveDef(w);
  const d = w.dir;

  for (const m of w.marks) {
    m.t -= dt;
    if (m.t <= 0) {
      spawnEnemy(w, m.type, m.x, m.y, m.extra);
      m.done = true;
      // Tell the HUD an elite / the boss has arrived (banner, red pulse).
      if (m.extra && m.extra.boss) emit(w, { type: 'bossSpawn', et: m.type, x: Math.round(m.x), y: Math.round(m.y) });
      else if (m.extra && m.extra.elite) emit(w, { type: 'eliteSpawn', et: m.type, x: Math.round(m.x), y: Math.round(m.y) });
    }
  }
  if (w.marks.some((m) => m.done)) w.marks = w.marks.filter((m) => !m.done);

  if (W.boss && !d.bossDone) {
    d.bossDone = true;
    const { w: AW, h: AH } = BALANCE.arena;
    mark(w, W.boss, AW / 2, AH * 0.25, { boss: true });
  }
  // The wave table's elite, or the extra elite waves the danger level adds (src/data/danger.js).
  const eliteType = eliteTypeFor(w.wave, w.danger);
  if (eliteType && !d.eliteDone && w.waveTime > 2) {
    d.eliteDone = true;
    const p = randomSpawnPos(w, 200);
    mark(w, eliteType, p.x, p.y, { elite: true });
  }

  const ending = W.dur > 0 && w.waveDur - w.waveTime < SPAWN_END_QUIET;
  if (!ending) {
    d.spawnT -= dt;
    if (d.spawnT <= 0) {
      const size = burst(w, W, d);
      // Gentle start, crescendo at the end (average 1x over the wave).
      const k = W.dur > 0 ? Math.min(1, w.waveTime / W.dur) : 0.5;
      const ramp = RAMP.start + (RAMP.end - RAMP.start) * k;
      d.spawnT += size / (W.rate * coopMul(w) * ramp);
    }
  }

  d.bushT -= dt;
  if (d.bushT <= 0) {
    d.bushT += BALANCE.pickups.bushEvery / bushRate(w);
    const bushes = w.enemies.filter((e) => !e.dead && e.type === 'bush').length;
    if (bushes < BALANCE.pickups.bushMax) {
      const p = randomSpawnPos(w, 120);
      mark(w, 'bush', p.x, p.y);
    }
  }
}
