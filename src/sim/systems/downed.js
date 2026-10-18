// Downed players and revives: a teammate standing within revive.radius for revive.time revives them.
// Item hooks: Mother's Nest (specials.nestAura) speeds up revives of allies near its holder;
// Herd Bond (specials.herdBond) gives the reviver and the revived mana.

import { BALANCE } from '../../data/balance.js';
import { SPECIAL_RULES } from '../../data/items.js';
import { emit } from '../entities.js';

export function update(w, dt) {
  const R = BALANCE.revive;
  for (const p of w.players) {
    if (p.gone || !p.downed) continue;
    let helper = null, hd = Infinity, boosted = p.reviveBoostT > 0, nest = 1, helpers = 0;
    for (const q of w.players) {
      if (q === p || q.gone || q.downed) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= R.radius) {
        helpers++;
        if (q.reviveBoostT > 0) boosted = true;
        if (d < hd) { hd = d; helper = q; }
      }
      // Mother's Nest: any live holder close enough speeds the revive up.
      if (q.specials?.nestAura > 0 && d <= SPECIAL_RULES.nestAura.radius) nest = Math.max(nest, q.specials.nestAura);
    }
    if (helper) {
      p.reviveT += dt * (boosted ? 3 : 1) * nest * (helpers >= 2 ? BALANCE.coop.reviveHelpersMult : 1);
      if (p.reviveT >= R.time) {
        p.downed = false;
        p.reviveT = 0;
        p.hp = Math.max(1, Math.ceil(p.stats.maxHp * R.hpPct));
        p.iframes = 1.2;
        helper.score.revives++;
        const bond = helper.specials?.herdBond || 0;
        if (bond > 0) {
          helper.mana = Math.min(helper.stats.maxMana, helper.mana + bond);
          p.mana = Math.min(p.stats.maxMana, p.mana + bond);
        }
        emit(w, { type: 'revive', pid: p.id, by: helper.id, x: Math.round(p.x), y: Math.round(p.y) });
      }
    } else {
      p.reviveT = Math.max(0, p.reviveT - R.decay * dt);
    }
  }
}
