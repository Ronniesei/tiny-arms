// Loot crates (Brotato's mid-wave surprise).
//
//   drop    a normal kill drops a crate pickup with a small chance (CRATE_RULES.chance, a bit higher with Luck; at most
//           CRATE_RULES.maxPerWave per player and wave); an elite always drops one.
//   pickup  walking into it stores it on the player (p.crates) and heals CRATE_RULES.heal HP (pickups.js collect()).
//           Crates still on the ground when the wave ends go to the nearest player.
//   offer   at wave end every stored crate becomes an offer in p.crateOffers: an item rolled like a shop item (the shop's
//           rarity odds, Luck, hero and tag leaning, item limits). An elite's crate rolls the rarity twice and keeps the best.
//   choose  in the shop, op {op:'crate', idx, take:true|false, cid?}: Take adds the item to your build, Recycle pays
//           CRATE_RULES.recycle of the item's price in amber. Pressing Ready (or the shop timer running out) takes the
//           crates still unopened (recycling an item you can no longer hold), so nothing is lost.
//
// Offer shape: {cid, id, tier, price, recycle, elite}. The private view sends them as `crates` (net/protocol.js).

import { CRATE_RULES } from '../data/items.js';
import { spawnPickup } from './entities.js';
import { range, chance } from './rng.js';
import { recomputeStats, refreshHoard } from './stats.js';
import { rollItemOffer, atItemLimit } from './shop.js';
import { endWaveCleanup } from './hooks.js';

/** Chance that a normal kill drops a crate, for a player with this much Luck. */
export function crateChance(luck = 0) {
  return CRATE_RULES.chance * Math.max(0, 1 + luck / CRATE_RULES.luckScale);
}

/** Called for every kill (damage.js dropLoot). `pid` = who killed it (-1: nobody; no crate then, except elites). */
export function maybeDropCrate(w, e, def, pid) {
  if (def.neutral || e.boss) return null; // a boss kill ends the run; bushes drop berries
  let elite = false;
  if (e.elite) elite = true;
  else {
    const killer = pid >= 0 ? w.players[pid] : null;
    if (!killer || killer.gone) return null;
    if ((killer.cratesDropped || 0) >= CRATE_RULES.maxPerWave) return null;
    if (!chance(w.rng, crateChance(killer.stats.luck))) return null;
    killer.cratesDropped = (killer.cratesDropped || 0) + 1;
  }
  const pk = spawnPickup(w, 'crate', e.x, e.y, elite ? 2 : 1);
  const a = range(w.rng, 0, Math.PI * 2), s = range(w.rng, 30, 90);
  pk.vx = Math.cos(a) * s; pk.vy = Math.sin(a) * s;
  return pk;
}

/** A player walked into a crate pickup (pickups.js collect). */
export function storeCrate(w, p, pk) {
  (p.crates || (p.crates = [])).push({ elite: pk.v >= 2 });
}

/** The wave is over (world.endWave, before the ground is cleared): loose crates go to the nearest player. */
export function collectLeftovers(w) {
  endWaveCleanup(w); // bombs and echoes that never fired
  for (const pk of w.pickups) {
    if (pk.kind !== 'crate' || pk.dead) continue;
    let best = null, bd = Infinity;
    for (const p of w.players) {
      if (p.gone) continue;
      const d = (p.x - pk.x) ** 2 + (p.y - pk.y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    if (best) storeCrate(w, best, pk);
    pk.dead = true;
  }
}

/** Roll one crate's item for player p. `pending` = the player's other open offers (kept distinct, count toward limits). */
export function rollCrateOffer(w, p, elite, pending = []) {
  const o = rollItemOffer(w, p, pending.map((x) => ({ kind: 'item', id: x.id })), {
    rolls: elite ? CRATE_RULES.eliteRolls : 1, pending: pending.map((x) => x.id),
  });
  if (o.kind !== 'item') return null;
  p.crateSeq = (p.crateSeq || 0) + 1;
  return { cid: p.crateSeq, id: o.id, tier: o.tier, price: o.price, recycle: recyclePrice(o.price), elite: !!elite };
}

export function recyclePrice(price) {
  return Math.max(1, Math.floor(price * CRATE_RULES.recycle));
}

/** Wave end (world.endWave, before openShop): turn every stored crate into an offer. Also resets the per-wave drop count. */
export function openCrates(w) {
  for (const p of w.players) {
    p.cratesDropped = 0;
    if (p.gone) { p.crates = []; continue; }
    // Offers nobody opened last time are settled first, so they never pile up.
    autoResolve(w, p);
    const stored = p.crates || [];
    p.crates = [];
    const offers = [];
    for (const c of stored) {
      const o = rollCrateOffer(w, p, c.elite, offers);
      if (o) offers.push(o);
    }
    p.crateOffers = offers;
  }
}

/** Take or recycle one offer. Returns {ok, msg?}. */
export function crateOp(w, p, op) {
  const offers = p.crateOffers;
  const o = offers && Number.isInteger(op.idx) ? offers[op.idx] : null; // ops come off the network: never trust idx
  if (!o || (op.cid !== undefined && op.cid !== o.cid)) return { ok: false, msg: 'That crate is already open' };
  if (op.take) {
    if (atItemLimit(p, o.id)) return { ok: false, msg: 'You cannot hold more of that. Recycle it instead.' };
    p.items.push(o.id);
    recomputeStats(p);
  } else {
    p.amber += o.recycle;
    refreshHoard(p); // Hoard Heart's damage follows the amber you hold
  }
  offers.splice(op.idx, 1);
  return { ok: true };
}

/** Open every crate still unopened: take the item, or recycle it when the player can no longer hold it. */
export function autoResolve(w, p) {
  const offers = p.crateOffers;
  if (!offers || !offers.length) return 0;
  let n = 0;
  while (offers.length) {
    const take = !atItemLimit(p, offers[0].id);
    if (!crateOp(w, p, { idx: 0, take }).ok) break;
    n++;
  }
  return n;
}

/** Players that left, or the shop timer ran out: open everything for everyone (world.stepShop). */
export function autoResolveAll(w) {
  for (const p of w.players) autoResolve(w, p);
}
