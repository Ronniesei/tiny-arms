// Enemy projectiles (drawn magenta). Straight-line by default.
// Optional per-shot fields set by whoever spawns it (spawnShot): `update(w, s, dt)` runs before the move
// (use it to curve or speed up a shot), `life` seconds before it fades, `pierce` (true = passes through players,
// each player is hit at most once).

import { BALANCE } from '../../data/balance.js';
import { hitPlayer } from './damage.js';

export function update(w, dt) {
  const { w: AW, h: AH } = BALANCE.arena;
  for (const s of w.shots) {
    if (s.dead) continue;
    if (s.update) s.update(w, s, dt);
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    if (s.life <= 0 || s.x < -30 || s.y < -30 || s.x > AW + 30 || s.y > AH + 30) { s.dead = true; continue; }
    for (const p of w.players) {
      if (p.gone || p.downed) continue;
      const rr = s.r + p.r * 0.75;
      if ((p.x - s.x) ** 2 + (p.y - s.y) ** 2 < rr * rr) {
        if (s.pierce) {
          s.hitIds ||= [];
          if (s.hitIds.includes(p.id)) continue;
          s.hitIds.push(p.id);
          hitPlayer(w, p, s.dmg, { source: 'shot' });
        } else {
          hitPlayer(w, p, s.dmg, { source: 'shot' });
          s.dead = true;
          break;
        }
      }
    }
  }
}
