// Area effects with an optional telegraph phase (delay) before they act.
// Hazard fields: {kind, x, y, r, delay, dur, t, owner:'enemy'|'player', pid?, dmg?, dps?, ev?}
// `ev` (optional): an event type emitted as {type: ev, x, y, r} at the moment the hazard fires (e.g. 'slam', 'stomp').
// The renderer draws enemy hazards as red warning areas during their delay.
// Register new kinds in HAZARD_KINDS: { fire?(w, h), tick?(w, h, dt) }.

import { hitEnemy, hitPlayer } from './damage.js';
import { emit, spawnHazard } from '../entities.js';

function playersIn(w, x, y, r) {
  return w.players.filter((p) => !p.gone && !p.downed && (p.x - x) ** 2 + (p.y - y) ** 2 <= (r + p.r * 0.6) ** 2);
}

export const HAZARD_KINDS = {
  // Enemy: telegraphed circle that hits players inside once when the delay ends.
  circle: {
    fire(w, h) { for (const p of playersIn(w, h.x, h.y, h.r)) hitPlayer(w, p, h.dmg, { source: 'hazard' }); },
  },

  // Enemy: ring expanding from r0 (default 0) to r over dur; hits each player once as the ring passes them.
  // The ring moves at (r - r0) / dur px/s: keep that under the player's speed so it can be outrun.
  ring: {
    tick(w, h, dt) {
      const k = Math.min(1, (h.t - h.delay) / h.dur);
      const r0 = h.r0 || 0;
      const cur = r0 + (h.r - r0) * k;
      h.cur = cur;
      h.hitIds ||= [];
      for (const p of w.players) {
        if (p.gone || p.downed || h.hitIds.includes(p.id)) continue;
        const d = Math.hypot(p.x - h.x, p.y - h.y);
        if (Math.abs(d - cur) < (h.band || 24) + p.r * 0.5) {
          h.hitIds.push(p.id);
          hitPlayer(w, p, h.dmg, { source: 'ring' });
        }
      }
    },
  },

  // Player: meteor impact; damages enemies, then leaves burning ground.
  meteor: {
    fire(w, h) {
      for (const e of w.grid.query(h.x, h.y, h.r)) {
        if (!e.dead) hitEnemy(w, e, h.dmg, { pid: h.pid, kb: 220, kbAngle: Math.atan2(e.y - h.y, e.x - h.x), source: 'a' });
      }
      if (h.burnTime > 0) spawnHazard(w, { kind: 'fire', owner: 'player', pid: h.pid, x: h.x, y: h.y, r: h.r * 0.9, dur: h.burnTime, dps: h.burnDps });
    },
  },

  // Player: burning ground, damages enemies inside 4 times a second.
  fire: {
    tick(w, h, dt) {
      h.acc = (h.acc || 0) + dt;
      if (h.acc < 0.25) return;
      h.acc -= 0.25;
      for (const e of w.grid.query(h.x, h.y, h.r)) {
        if (!e.dead) hitEnemy(w, e, h.dps * 0.25, { pid: h.pid, source: 'burn', noLifeSteal: true, wuid: h.wuid });
      }
    },
  },
};

export function update(w, dt) {
  for (const h of w.hazards) {
    if (h.dead) continue;
    h.t += dt;
    if (h.t < h.delay) continue;
    const kind = HAZARD_KINDS[h.kind];
    if (!h.fired) {
      h.fired = true;
      kind?.fire?.(w, h);
      if (h.ev) emit(w, { type: h.ev, x: Math.round(h.x), y: Math.round(h.y), r: Math.round(h.r) });
    }
    kind?.tick?.(w, h, dt);
    if (h.t >= h.delay + h.dur) h.dead = true;
  }
}
