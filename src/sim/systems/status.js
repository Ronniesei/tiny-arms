// Status effects on enemies: burn (damage over time) and slow.
// Apply a burn with applyBurn(); stun is handled in enemies.js.
// Burn deals its damage in 0.5 s ticks as whole numbers (the remainder carries over and is paid when the burn ends),
// credited to the player who lit it (source 'burn': no life steal, orange numbers).

import { hitEnemy } from './damage.js';

const TICK = 0.5;

/**
 * Set an enemy alight. A stronger or longer burn replaces a weaker one; it never stacks.
 * `wuid` (optional): uid of the weapon that lit it, so the burn damage is credited to that weapon's total.
 */
export function applyBurn(e, dps, duration, pid, wuid = 0) {
  if (e.dead || dps <= 0 || duration <= 0) return;
  e.burn = Math.max(e.burn, duration);
  e.burnDps = Math.max(e.burnDps, dps);
  e.burnPid = pid;
  e.burnWuid = wuid;
}

export function update(w, dt) {
  for (const e of w.enemies) {
    if (e.dead) continue;
    if (e.slow > 0) e.slow -= dt;
    if (e.burn > 0) {
      e.burn -= dt;
      e.burnAcc = (e.burnAcc || 0) + e.burnDps * dt;
      e.burnTick = (e.burnTick || 0) + dt;
      const over = e.burn <= 0;
      if (e.burnTick >= TICK || over) {
        e.burnTick = 0;
        const d = Math.floor(e.burnAcc);
        if (d >= 1) {
          e.burnAcc -= d;
          hitEnemy(w, e, d, { pid: e.burnPid, source: 'burn', noLifeSteal: true, wuid: e.burnWuid });
        }
      }
      if (over) { e.burn = 0; e.burnDps = 0; e.burnAcc = 0; e.burnTick = 0; e.burnWuid = 0; }
    }
  }
}
