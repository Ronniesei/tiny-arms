// End of run: VICTORY / EXTINCT banner, an "Unlocked!" panel (new heroes, finished challenges with their reward, newly open Danger
// levels) and "Next goals", scoreboard with banter titles (badge + caption), a "Builds" recap (each player's weapons with tier and
// damage dealt, plus items), play again.

import { BALANCE } from '../data/balance.js';
import { CHARACTERS } from '../data/characters.js';
import { DANGER } from '../data/danger.js';
import { ITEMS } from '../data/items.js';
import { WEAPONS } from '../data/weapons.js';
import { PLAYER_COLORS_CSS } from '../render/art.js';
import { CHALLENGES } from '../data/challenges.js';
import { lastUnlocks } from '../meta/unlocks.js';
import { tip } from './tips.js';
import { ROMAN, TIER_CLASS, TIER_NAMES, esc } from './describe.js';
import { rewardInfo, rewardLines, rewardTip, nextGoalsHtml } from './collection.js';

const SPR = (key) => `assets/sprites/${key}.svg`;
const IMG_ERR = `onerror="this.style.visibility='hidden'"`;
const n = (v) => Math.round(Number(v) || 0);
const fmt = (v) => n(v).toLocaleString('en');
/** Damage for a small chip: 12,345 up to 99,999, then 123k / 1.2M. */
const short = (v) => {
  const x = n(v);
  if (x >= 1e6) return `${+(x / 1e6).toFixed(1)}M`;
  if (x >= 1e5) return `${Math.round(x / 1e3)}k`;
  return x.toLocaleString('en');
};
const tier = (t) => Math.max(1, Math.min(4, n(t) || 1));

/** [row key, column heading, what it measures (tooltip)] */
const COLUMNS = [
  ['kills', 'Kills', 'Kills: enemies this player defeated, including kills made by burns, turrets and abilities.'],
  ['damageDealt', 'Damage', 'Damage: all the damage this player dealt, from weapons, abilities and burns.'],
  ['damageTaken', 'Taken', 'Taken: damage this player took from enemies, after armor. The Tank title goes to the highest.'],
  ['revives', 'Revives', 'Revives: how many times this player brought a downed mate back up.'],
  ['healing', 'Healed mates', 'Healed mates: HP this player restored on other players (healing yourself is not counted).'],
  ['amber', 'Amber', 'Amber: amber this player collected, bonuses and Harvesting included. Amber is also what you spend in the shop.'],
  ['casts', 'Casts', 'Casts: how many times this player used their Space ability.'],
];

/** One weapon chip: icon with its tier numeral, the damage it dealt and a bar showing its share of the player's total. */
function weaponChip(x, total, star) {
  const d = WEAPONS[x.wid];
  const t = tier(x.tier);
  const pct = total > 0 ? Math.min(100, Math.round((n(x.dmg) / total) * 100)) : 0;
  const name = d?.name || x.wid;
  const text = `${name} ${ROMAN[t - 1]} (${TIER_NAMES[t - 1]}): ${fmt(x.dmg)} damage${total > 0 ? `, ${pct}% of this player's total` : ''}${x.gone ? '. Sold or merged away earlier in the run.' : ''}`;
  return `<div class="wchip ${TIER_CLASS[t - 1]}${x.gone ? ' gone' : ''}${star ? ' top' : ''}" data-tip-text="${esc(text)}">
      <div class="wi"><img src="${SPR(`w_${x.wid}`)}" ${IMG_ERR} alt=""><span class="rom">${ROMAN[t - 1]}</span></div>
      <b>${short(x.dmg)}</b><i class="share" style="--s:${pct}%"></i>
    </div>`;
}

/** Item ids -> icon tiles with a count for duplicates (best tier first). */
function itemTiles(ids) {
  const counts = new Map();
  for (const id of ids || []) counts.set(id, (counts.get(id) || 0) + 1);
  const list = [...counts.keys()].filter((id) => ITEMS[id])
    .sort((a, b) => (ITEMS[b].tier || 1) - (ITEMS[a].tier || 1) || ITEMS[a].name.localeCompare(ITEMS[b].name));
  return list.map((id) => {
    const it = ITEMS[id], c = counts.get(id), t = tier(it.tier);
    return `<div class="bitem ${TIER_CLASS[t - 1]}" data-tip-text="${esc(`${it.name}${c > 1 ? ` x${c}` : ''}${it.desc ? `: ${it.desc}` : ''}`)}"><img src="${SPR(it.icon || 'amber')}" ${IMG_ERR} alt="">${c > 1 ? `<i>x${c}</i>` : ''}</div>`;
  }).join('');
}

/** The "Builds" recap: one card per player. Reads rows[].weapons / byWeapon / items (src/sim/score.js). */
function buildsHtml(rows) {
  const lists = rows.map((r) => (Array.isArray(r.byWeapon) && r.byWeapon.length ? r.byWeapon : (r.weapons || []).map((x) => ({ ...x, dmg: 0 }))));
  // The single hardest-hitting weapon of the whole herd gets a star.
  let best = null;
  for (const l of lists) for (const x of l) if (n(x.dmg) > 0 && (!best || n(x.dmg) > n(best.dmg))) best = x;
  const cards = rows.map((r, i) => {
    const bw = lists[i];
    const total = n(r.damageDealt);
    const wsum = bw.reduce((a, x) => a + n(x.dmg), 0);
    const other = total - wsum;           // abilities and anything else that is not a weapon
    const chips = bw.map((x) => weaponChip(x, total, x === best)).join('')
      + (other >= Math.max(1, total * 0.02)
        ? `<div class="wchip other" data-tip-text="${esc(`Abilities and other damage: ${fmt(other)}. Damage that did not come from a weapon, like your Space ability.`)}"><div class="wi"><span class="spark">&#10022;</span></div><b>${short(other)}</b><i class="share" style="--s:${Math.min(100, Math.round((other / total) * 100))}%"></i></div>`
        : '');
    const items = itemTiles(r.items);
    const col = PLAYER_COLORS_CSS[r.pid % 4];
    return `<div class="bcard" style="--pc:${col}">
      <div class="bwho"><img src="${SPR(`h_${r.char}`)}" ${IMG_ERR} alt=""><b>${esc(r.name)}</b></div>
      <div class="bws">${chips || '<span class="none">No weapons</span>'}</div>
      <div class="bis">${items || '<span class="none">No items</span>'}</div>
    </div>`;
  }).join('');
  return `<div class="builds" style="--n:${rows.length}"><h3>Builds <small>damage dealt by each weapon</small></h3>${cards}</div>`;
}

/** "NEW HERO UNLOCKED: Pip!" for every hero this browser's last recorded run unlocked (src/meta/unlocks.js, app.js trackRun). */
export function unlockPanels(heroes = lastUnlocks().heroes, firstIndex = 0) {
  return heroes.filter((id) => CHARACTERS[id]).map((id, i) => {
    const c = CHARACTERS[id];
    return `<div class="unlocked" style="--hc:${c.color};--i:${firstIndex + i}" role="status" data-tip-text="${esc(`${c.name} is now unlocked in this browser. Pick ${c.name} in the lobby for your next run.`)}">
      <span class="uport"><img src="${SPR(`h_${id}`)}" ${IMG_ERR} alt=""></span>
      <div class="utext"><b class="uline"><span class="ukick">NEW HERO UNLOCKED:</span> <span class="uname">${esc(c.name)}!</span></b>
        <small>${esc(c.role)} · ${esc(c.trait?.name || '')}: ${esc(c.trait?.desc || c.blurb)}</small>
        <small class="uhint">${esc(c.name)} is waiting in the lobby for your next run.</small></div>
    </div>`;
  }).join('');
}

/** A finished challenge: its reward's icon, "Roll Model done:" and "Rolling Stone unlocked". */
function challengeCard(c, i) {
  const r = rewardInfo(c.reward);
  const effect = rewardLines(c.reward).slice(0, 2).join(' · ');
  return `<div class="ucard chal ${TIER_CLASS[r.tier - 1]}" style="--i:${i}" role="status" data-tip-text="${esc(rewardTip(c, true))}">
      <span class="uicon"><img src="${SPR(r.icon)}" ${IMG_ERR} alt=""></span>
      <div class="utext"><b class="uline"><span class="ukick">${esc(c.name)} done:</span> <span class="uname">${esc(r.name)} unlocked</span></b>
        <small>${r.kind}${effect ? ` · ${esc(effect)}` : ''}</small></div>
    </div>`;
}

/** A Danger level this run opened: "Hard is now open". */
function dangerCard(d, i) {
  const D = DANGER[d];
  return `<div class="ucard dang d${D.id}" style="--i:${i}" role="status"${tip('danger')} data-tip-text="${esc(`${D.name} can be picked in the lobby now. The whole team can use it as soon as one of you has unlocked it.`)}">
      <span class="dbadge">${D.id}</span>
      <div class="utext"><b class="uline"><span class="ukick">New Danger level:</span> <span class="uname">${esc(D.name)} is now open</span></b>
        <small>${esc(D.desc)}</small></div>
    </div>`;
}

/**
 * The "Unlocked!" panel: everything the run that just ended unlocked in this browser (lastUnlocks()). Empty text when nothing was.
 * Each card pops in one after the other.
 */
export function unlockedBox(u = lastUnlocks()) {
  const heroes = u.heroes.filter((id) => CHARACTERS[id]);
  const chals = u.challenges.map((id) => CHALLENGES.find((c) => c.id === id)).filter(Boolean);
  const dangers = u.dangers.filter((d) => DANGER[d]);
  if (!heroes.length && !chals.length && !dangers.length) return '';
  const cards = unlockPanels(heroes, 0)
    + chals.map((c, i) => challengeCard(c, heroes.length + i)).join('')
    + dangers.map((d, i) => dangerCard(d, heroes.length + chals.length + i)).join('');
  return `<section class="ubox" role="status"><h2 class="uhead">Unlocked!</h2><div class="ulist">${cards}</div></section>`;
}

export function endScreen(ui) {
  const s = ui.app.session;
  const res = s.me()?.result || s.world?.result;
  if (!res) return `<div class="center"><div class="panel small"><h2>Run over</h2></div></div>`;
  const rows = res.rows || [];
  const titles = res.titles || [];
  const total = BALANCE.waves?.count || 20;
  const multi = rows.length > 1;

  // Best value per column gets a highlight (only when there is someone to beat).
  const best = {};
  for (const [k] of COLUMNS) best[k] = multi ? Math.max(...rows.map((r) => n(r[k]))) : 0;

  const titleList = (pid) => titles.filter((t) => t.pid === pid)
    .map((t) => `<li data-tip-text="${esc(t.desc || '')}"><span class="badge">${esc(t.name)}</span><span class="cap">${esc(t.cap || t.desc || '')}</span></li>`).join('');

  const body = rows.map((r, i) => `<tr style="--pc:${PLAYER_COLORS_CSS[r.pid % 4]};--i:${i}">
      <td class="who"><div class="id"><img src="${SPR(`h_${r.char}`)}" alt=""><div><b>${esc(r.name)}</b><small>${esc(CHARACTERS[r.char]?.name || '')}</small></div></div>
        <ul class="ttl">${titleList(r.pid)}</ul></td>
      ${COLUMNS.map(([k]) => `<td class="num ${best[k] > 0 && n(r[k]) === best[k] ? 'top' : ''}">${fmt(r[k])}</td>`).join('')}
    </tr>`).join('');

  const sum = (k) => rows.reduce((a, r) => a + n(r[k]), 0);
  const team = multi ? `Herd total: ${fmt(sum('kills'))} kills · ${fmt(sum('damageDealt'))} damage · ${fmt(sum('amber'))} amber` : '';

  return `<div class="center"><div class="panel end ${res.win ? 'is-win' : 'is-lose'}">
    <div class="banner">
      <h1 class="${res.win ? 'win' : 'lose'}">${res.win ? 'VICTORY!' : 'EXTINCT'}</h1>
      <p class="tag">${res.win ? `The herd survived all ${total} waves.` : `The herd fell on wave ${n(res.wave)}.`}</p>
      <span class="wavepill">Wave ${n(res.wave)} / ${total}</span>${res.danger !== undefined ? `<span class="wavepill">${esc(DANGER[res.danger]?.name || '')}</span>` : ''}
    </div>
    ${unlockedBox()}
    ${nextGoalsHtml()}
    <div class="escroll">
      <table class="score">
        <thead><tr><th data-tip-text="Each player, their hero and the titles they earned.&#10;A star marks the best number in a column."></th>${COLUMNS.map(([, label, hint]) => `<th data-tip-text="${esc(hint)}">${label}</th>`).join('')}</tr></thead>
        <tbody>${body}</tbody>
      </table>
      ${team ? `<p class="teamline">${team}</p>` : ''}
      ${rows.length ? buildsHtml(rows) : ''}
    </div>
    <div class="row efoot">${s.isHost ? `<button class="big go" data-act="again">Play again</button>` : '<p class="muted waiting">Waiting for the host to start another run<span class="dots"></span></p>'}<button data-act="menu">Back to menu</button></div>
  </div></div>`;
}

export const endActions = {};
