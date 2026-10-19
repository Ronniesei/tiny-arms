// End-of-run scoreboard and banter titles.
//
// scoreboard(w) -> { rows, titles }
//   rows:   [{ pid, name, char, kills, damageDealt, damageTaken, revives, healing, amber, casts, downs, firstFallTick,
//              weapons: [{wid, tier}],                      the final build
//              items: [itemId, ...],                        duplicates repeated
//              byWeapon: [{wid, tier, dmg, uid, gone}] }]   damage per weapon, biggest first. Includes every final weapon
//                                                           (dmg 0 if it never hit) and weapons sold or merged away
//                                                           (gone: true, last-known tier). Ability damage is not in it:
//                                                           damageDealt minus the sum of dmg is "ability and other".
//   titles: [{ id, name, desc, cap, pid }]   `cap` is the one-line funny caption shown beside the badge.
//
// Rules:
// - Solo: one title, "Lone Rex". Comparing a player with nobody is no fun.
// - 2+ players: each title goes to whoever has the highest value of its stat. A title nobody earned
//   (everyone at zero) is not handed out. Ties share the title, unless everybody tied (then it
//   means nothing, so it is skipped).
// - "First to Fall" goes to whoever went down first (the lowest firstFallTick), if anyone fell.
// - Nobody gets more than MAX_PER_PLAYER titles; the lowest-priority ones are dropped.

export const MAX_PER_PLAYER = 3;

/** In priority order (highest first). `stat` returns the number to maximise. */
export const TITLES = [
  { id: 'first', name: 'First to Fall', desc: 'Went down first', cap: 'Took the first nap.' },
  { id: 'mvp', name: 'MVP', desc: 'Most damage dealt', cap: 'Did most of the smashing.', stat: (s) => s.damageDealt },
  { id: 'medic', name: 'Medic', desc: 'Most revives and healing', cap: 'Kept the herd breathing.', stat: (s) => s.revives * 50 + s.healing },
  { id: 'tank', name: 'Tank', desc: 'Most damage taken', cap: 'Used their face as a shield.', stat: (s) => s.damageTaken },
  { id: 'slayer', name: 'Slayer', desc: 'Most kills', cap: 'Raptors whisper this name.', stat: (s) => s.kills },
  { id: 'hoarder', name: 'Hoarder', desc: 'Most amber collected', cap: 'Pockets full of amber.', stat: (s) => s.amber },
  { id: 'caster', name: 'Show-off', desc: 'Most abilities cast', cap: "Space bar's best friend.", stat: (s) => s.casts },
];

export const SOLO_TITLE = { id: 'solo', name: 'Lone Rex', desc: 'Played solo', cap: 'No mates, no excuses.' };

const num = (v) => (Number.isFinite(v) ? v : 0);

/** The pids holding the best (highest) value, or [] if nobody has anything or everyone tied. */
function bestOf(players, valueOf, mode = 'max') {
  const vals = players.map((p) => ({ p, v: valueOf(p) }));
  const eligible = vals.filter((x) => (mode === 'max' ? x.v > 0 : x.v >= 0));
  if (!eligible.length) return [];
  const best = eligible.reduce((b, x) => (mode === 'max' ? Math.max(b, x.v) : Math.min(b, x.v)), mode === 'max' ? -Infinity : Infinity);
  const winners = eligible.filter((x) => x.v === best).map((x) => x.p);
  if (winners.length === players.length && players.length > 1) return []; // everybody tied: not a title
  return winners;
}

/** Final stats for challenges (docs/PROGRESSION.md "Run summary"), rounded to 0.1. */
const SNAP_KEYS = ['maxHp', 'armor', 'dodge', 'speed', 'luck', 'harvesting', 'critChance', 'attackSpeed', 'damage', 'hpRegen',
  'lifeSteal', 'range', 'abilityPower', 'rangedDamage', 'meleeDamage', 'maxMana'];
function statSnapshot(s) {
  const out = {};
  for (const k of SNAP_KEYS) out[k] = Math.round(num(s?.[k]) * 10) / 10;
  return out;
}

/** Final weapons, items and per-weapon damage of one player (see the header comment). */
function buildOf(p) {
  const owned = p.weapons || [];
  const rec = p.score.byWeapon || {};
  const weapons = owned.map((x) => ({ wid: x.wid, tier: x.tier }));
  const byWeapon = [];
  const live = new Set();
  for (const x of owned) {
    live.add(x.uid);
    byWeapon.push({ wid: x.wid, tier: x.tier, dmg: Math.round(num(rec[x.uid]?.dmg)), uid: x.uid, gone: false });
  }
  for (const k of Object.keys(rec)) {
    const r = rec[k];
    if (live.has(+k) || !(num(r.dmg) > 0)) continue;
    byWeapon.push({ wid: r.wid, tier: r.tier, dmg: Math.round(r.dmg), uid: +k, gone: true });
  }
  byWeapon.sort((a, b) => b.dmg - a.dmg || a.gone - b.gone || a.uid - b.uid);
  return { weapons, items: (p.items || []).slice(), byWeapon, level: p.level || 0, stats: statSnapshot(p.stats) };
}

/** @returns {{rows: object[], titles: {id, name, desc, cap, pid}[]}} */
export function scoreboard(w) {
  const players = w.players.filter((p) => !p.gone || num(p.score.damageDealt) > 0);
  const rows = players.map((p) => ({ pid: p.id, name: p.name, char: p.char, ...p.score, ...buildOf(p) }));
  const titles = [];
  if (players.length > 1) {
    for (const t of TITLES) {
      const winners = t.id === 'first'
        ? bestOf(players, (p) => (p.score.firstFallTick >= 0 ? p.score.firstFallTick : -1), 'min')
        : bestOf(players, (p) => num(t.stat(p.score)));
      for (const p of winners) titles.push({ id: t.id, name: t.name, desc: t.desc, cap: t.cap, pid: p.id });
    }
    // Cap titles per player, keeping the highest-priority ones (TITLES order).
    const order = new Map(TITLES.map((t, i) => [t.id, i]));
    const kept = [];
    const count = new Map();
    for (const t of titles.slice().sort((a, b) => order.get(a.id) - order.get(b.id))) {
      const n = count.get(t.pid) || 0;
      if (n >= MAX_PER_PLAYER) continue;
      count.set(t.pid, n + 1);
      kept.push(t);
    }
    titles.length = 0;
    titles.push(...kept);
  } else if (players.length === 1) {
    titles.push({ ...SOLO_TITLE, pid: players[0].id });
  }
  return { rows, titles };
}
