// Between-wave screen: loot crates first (take or recycle), then level-up picks, then the 4-offer shop, plus your build
// (weapons, sets, items, stats). Item cards show tag chips; a chip lights up when your build already has that tag.
// Plain HTML, re-rendered by ui.js whenever `me` (the privateView) changes. Clicks use data-act / data-* and are
// routed to `shopActions` at the bottom. Keyboard (1-4 buy or pick, R reroll, Space/Enter ready) and the hover
// tooltip are installed once, on the first render, and only act while the shop is on screen.

import { WEAPONS, CLASSES } from '../data/weapons.js';
import { eliteTypeFor } from '../data/danger.js';
import { tip as tipAttr } from './tips.js';
import { ITEMS } from '../data/items.js';
import { BALANCE } from '../data/balance.js';
import { WAVES } from '../data/waves.js';
import { STAT_KEYS, STAT_LABELS, activeClassBonuses, classCounts, maxWeaponsOf } from '../sim/stats.js';
import { weaponPrice, ownedTags } from '../sim/shop.js';
import { PLAYER_COLORS_CSS } from '../render/art.js';
import {
  TIER_NAMES, TIER_CLASS, ROMAN, esc, fmt, statLine, statValue, weaponLines, weaponStats, weaponClass, itemLines,
  upgradeInfo, setBonusHint, classThresholds, bonusText, bonusLines, itemTags, sharedTags,
} from './describe.js';

const SPR = (key) => `assets/sprites/${key}.svg`;
const IMG_ERR = `onerror="this.style.visibility='hidden'"`;
const AMBER = `<img class="amb" src="${SPR('amber')}" alt="">`;
const ICON = {
  check: `<svg class="svgi" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.6l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  lock: `<svg class="svgi" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="2" fill="currentColor"/><path d="M5.2 7V5.3a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  unlock: `<svg class="svgi" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="2" fill="currentColor"/><path d="M5.2 7V5.3a2.8 2.8 0 0 1 5.3-1.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  dice: `<svg class="svgi" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="5.6" cy="5.6" r="1.1" fill="currentColor"/><circle cx="10.4" cy="10.4" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/></svg>`,
};
const FLASH_MS = 1400;

// ---------------------------------------------------------------------------------------------------------------
// Small pure helpers

const tierName = (t) => TIER_NAMES[Math.max(1, Math.min(4, t)) - 1];
const tcls = (t) => TIER_CLASS[Math.max(1, Math.min(4, t)) - 1];
const nameOf = (o) => (o.kind === 'weapon' ? WEAPONS[o.id]?.name : ITEMS[o.id]?.name) || o.id;
const hasLevels = (me) => !!(me.levelChoices && me.levelChoices.length);
const hasCrates = (me) => !!(me.crates && me.crates.length);

/** Refund for selling a weapon now: the same sum the sim uses (25% of the current price). */
export function sellValue(wpn, wave) {
  return Math.max(1, Math.floor(weaponPrice(wpn.wid, wpn.tier, wave) * BALANCE.shop.sellRefund));
}

function countItems(items) {
  const n = {};
  for (const id of items) n[id] = (n[id] || 0) + 1;
  return n;
}

/** Lines -> <li>s. Key/value lines are laid out in two columns, notes are small and muted. */
// Weapon card labels -> glossary keys (src/ui/tips.js).
const LABEL_TIP = {
  Damage: 'w_damage', Cooldown: 'w_cooldown', DPS: 'w_dps', Range: 'w_range', Reach: 'w_reach', Crit: 'w_crit',
  Pierce: 'w_pierce', 'Blast radius': 'w_blast', Bounces: 'w_bounces', 'Burning ground': 'w_fire', Burn: 'w_burn',
  Turrets: 'w_turrets', Knockback: 'w_knockback',
};

function linesHtml(lines) {
  return lines.map((l) => {
    if (l.note) return `<li class="note${l.effect ? ' fx' : ''}">${esc(l.text)}</li>`;
    const good = l.good === true ? 'good' : l.good === false ? 'bad' : '';
    if (l.label !== undefined && l.value !== undefined) {
      return `<li class="kv ${good} ${l.strong ? 'strong' : ''}"${tipAttr(l.key || LABEL_TIP[l.label])}><span>${esc(l.label)}</span><b>${esc(l.value)}</b>${l.detail ? `<small>${esc(l.detail)}</small>` : ''}</li>`;
    }
    return `<li class="${good}"${tipAttr(l.key)}>${esc(l.text)}</li>`;
  }).join('');
}

// ---------------------------------------------------------------------------------------------------------------
// Change tracking: which stats moved since the shop opened (delta pills) and since the last render (pop highlight)

const track = { session: null, wave: -1, level: 0, items: 0, open: {}, prev: {}, changedAt: {}, amber: 0, amberDelta: 0, amberAt: 0 };

function trackChanges(ui, me) {
  const fresh = track.session !== ui.app.session || track.wave !== me.wave || me.level < track.level || me.items.length < track.items;
  const now = performance.now();
  if (fresh) {
    Object.assign(track, { session: ui.app.session, wave: me.wave, open: { ...me.stats }, prev: { ...me.stats }, changedAt: {}, amber: me.amber, amberDelta: 0, amberAt: 0 });
  }
  for (const k of STAT_KEYS) {
    if (Math.abs((me.stats[k] || 0) - (track.prev[k] || 0)) > 0.0001) track.changedAt[k] = now;
  }
  if (me.amber !== track.amber) { track.amberDelta = me.amber - track.amber; track.amberAt = now; }
  track.prev = { ...me.stats };
  track.level = me.level;
  track.items = me.items.length;
  track.amber = me.amber;
  return now;
}

// ---------------------------------------------------------------------------------------------------------------
// Screen

export function shopScreen(ui) {
  installHandlers();
  activeUi = ui;
  const s = ui.app.session;
  const me = s.me();
  const v = s.view();
  if (!me || !me.shop) return `<div class="center"><div class="panel small"><h2>Shop</h2><p>Loading…</p></div></div>`;
  const now = trackChanges(ui, me);
  return `<div class="shopwrap">
    ${headerHtml(me, v, now, ui.app.session?.lobby?.().danger ?? 1)}
    <div class="shopbody">
      <main class="col main">
        ${crateArea(me)}
        ${levelArea(me)}
        ${shopHtml(me)}
      </main>
      <aside class="col side">${buildHtml(me, now)}</aside>
    </div>
  </div>`;
}

function headerHtml(me, v, now, danger = 1) {
  // The countdown number is updated IN PLACE by ui.js (element with data-shop-timer), so nothing here may
  // depend on shopTime after this render: the bar is a CSS animation that starts at the current time left.
  const left = Math.max(0, v?.shopTime ?? 0);
  const time = Math.ceil(left);
  const total = BALANCE.shop.time;
  const elapsed = Math.max(0, Math.min(total, total - left));
  const levels = hasLevels(me);
  const crates = hasCrates(me);
  const next = WAVES[me.wave]; // the wave about to start (WAVES is 0-based)
  const nextTag = next?.boss ? '<em class="warn">Boss wave!</em>' : eliteTypeFor(me.wave + 1, danger) ? '<em class="warn">Elite wave!</em>' : '';
  const amberFlash = track.amberDelta && now - track.amberAt < FLASH_MS
    ? `<i class="adelta ${track.amberDelta > 0 ? 'good' : 'bad'}" style="animation-delay:-${Math.round(now - track.amberAt)}ms">${track.amberDelta > 0 ? '+' : ''}${track.amberDelta}</i>` : '';
  const mates = me.team.map((t) => {
    const you = t.id === me.id;
    return `<span class="mate ${t.ready ? 'ready' : ''} ${you ? 'you' : ''}" style="--pc:${PLAYER_COLORS_CSS[t.id % 4]}" data-tip-text="${esc(t.name)}${t.ready ? ' is ready' : ' is shopping'}">`
      + `<img src="${SPR(`h_${t.char}`)}" ${IMG_ERR} alt=""><b>${esc(t.name)}</b>`
      + `<span class="tick">${t.ready ? ICON.check : '<i class="dots"></i>'}</span></span>`;
  }).join('');
  const readyLabel = me.ready ? `Ready ${ICON.check} Waiting for mates` : 'Ready for next wave';
  return `<header class="shophead">
    <div class="hl">
      <div class="title">Wave ${me.wave} cleared</div>
      <div class="sub">Next: wave ${me.wave + 1} ${nextTag}</div>
    </div>
    <div class="amberbox"${tipAttr('amber')}>${AMBER}<b>${me.amber}</b>${amberFlash}</div>
    ${me.team.length > 1
      ? `<div class="timer"><span>Next wave in <b data-shop-timer>${time}</b>s</span><i class="bar"><u style="animation-duration:${total}s;animation-delay:-${elapsed.toFixed(1)}s"></u></i></div>`
      : '<div class="timer"><span>Take your time</span></div>'}
    <div class="team">${mates}</div>
    <button class="big go readybtn ${me.ready ? 'on' : ''}" data-act="shopready"${tipAttr('ready')}${crates ? ' data-tip-text="You still have loot crates. Going now opens them for you (you take the items)."' : levels ? ' data-tip-text="You still have a level-up to pick. It carries over if you go now."' : ''}><span>${readyLabel}</span><kbd>Space</kbd></button>
  </header>`;
}

// ---- Loot crates -----------------------------------------------------------------------------------------------

// Nothing below may jump under the mouse while crates are opened (review round 6: that caused misbuys). So every crate shown
// in this shop keeps its place: once opened, its card stays, dimmed, without buttons and stamped Taken or Recycled. When the
// last one is opened the whole area is the same height as before.
let crateLog = { session: null, wave: -1, cards: [], how: {} };
function crateArea(me) {
  if (crateLog.session !== track.session || crateLog.wave !== me.wave) crateLog = { session: track.session, wave: me.wave, cards: [], how: {} };
  if (!hasCrates(me) && !crateLog.cards.length) return '';
  const owned = ownedTags(me);
  const live = new Set(me.crates.map((c) => c.cid));
  me.crates.forEach((c, i) => {
    let e = crateLog.cards.find((x) => x.cid === c.cid);
    if (!e) crateLog.cards.push((e = { cid: c.cid }));
    e.html = crateCard(c, i, me, owned);
  });
  const cards = crateLog.cards.map((e) => (live.has(e.cid)
    ? e.html
    : `<div class="cdone">${e.html.replace(/data-act="[^"]*"/g, '')}<span class="stamp">${crateLog.how[e.cid] || 'Opened'}</span></div>`));
  const n = me.crates.length;
  return `<section class="crates${n ? '' : ' done'}">
    <div class="sechead">
      <h2>${n ? `Loot ${n > 1 ? 'crates' : 'crate'}!` : 'Loot crates opened'}</h2>
      <span class="hint">${n ? `${n} to open · take the item, or recycle it for amber` : 'Level-ups and the shop are below.'}</span>
    </div>
    <div class="crgrid">${cards.join('')}</div>
  </section>`;
}

function tagChips(id, owned) {
  const tags = itemTags(id);
  if (!tags.length) return '';
  return `<div class="tags">${tags.map((t) => {
    const n = owned[t.id] || 0;
    return `<span class="tag t-${t.id}${n > 0 ? ' on' : ''}"${tipAttr('tag_' + t.id)}${n > 0 ? ` data-tip-text="Your build already has ${n} ${esc(t.name)}"` : ''}>${esc(t.name)}${n > 0 ? `<i>${n}</i>` : ''}</span>`;
  }).join('')}</div>`;
}

function crateCard(c, i, me, owned) {
  const it = ITEMS[c.id];
  if (!it) return '';
  const have = me.items.filter((x) => x === c.id).length;
  const full = !!it.limit && have >= it.limit;
  const own = have ? `<li class="note">You own ${have}${it.limit ? ` / ${it.limit}` : ''}</li>` : '';
  const kbd = (k) => (i === 0 ? `<kbd>${k}</kbd>` : '');
  const ids = `data-act="crate" data-idx="${i}" data-cid="${c.cid}"`;
  return `<article class="crate ${tcls(c.tier)} ${c.elite ? 'elite' : ''}">
    ${c.elite ? '<div class="ribbons"><span class="rb elite">Elite crate</span></div>' : ''}
    <div class="ico"><img src="${SPR(it.icon || 'amber')}" ${IMG_ERR} alt=""><img class="boxi" src="${SPR('crate')}" ${IMG_ERR} alt=""></div>
    <div class="cbody">
      <div class="nm"><b>${esc(it.name)}</b><span class="tierpill">${tierName(c.tier)}</span></div>
      ${tagChips(c.id, owned)}
      <ul class="lines">${linesHtml(itemLines(c.id))}${own}</ul>
    </div>
    <div class="cbtns">
      <button class="take ${full ? 'off' : ''}" ${ids} data-take="1"${full ? ' disabled data-tip-text="You cannot hold more of this item. Recycle it instead."' : ''}>${full ? 'Limit reached' : 'Take'}${kbd(1)}</button>
      <button class="recycle" ${ids} data-take="0" data-tip-text="Sell the item back for ${c.recycle} amber (25% of its price ${c.price})">Recycle ${AMBER} +${c.recycle}${kbd(2)}</button>
    </div>
  </article>`;
}

// ---- Level-ups -------------------------------------------------------------------------------------------------

// Once level-ups were shown in this shop, keep their space after the last pick so the offers below
// never jump up under the mouse (review round 6: that caused misbuys).
let lastLevel = { wave: -1, html: '' };
function levelArea(me) {
  if (hasLevels(me)) {
    lastLevel = { wave: me.wave, html: levelHtml(me) };
    return lastLevel.html;
  }
  return lastLevel.wave === me.wave ? `<div class="lvlgone">${lastLevel.html.replace(/data-act="[^"]*"/g, '')}</div>` : '';
}

function levelHtml(me) {
  const lvl = me.level - me.pendingLevels + 1;
  const more = me.pendingLevels - 1;
  const cost = me.shop.levelRerollCost;
  const poor = me.amber < cost;
  const cards = me.levelChoices.map((c, i) => {
    const info = upgradeInfo(c, me.stats, me.char);
    return `<button class="lv ${tcls(c.tier)}" data-act="level" data-idx="${i}" aria-label="${esc(`${info.text}, ${tierName(c.tier)} level-up`)}">
      <kbd class="num">${i + 1}</kbd>
      <span class="tierpill">${tierName(c.tier)}</span>
      <strong>${esc(info.value)}</strong>
      <em>${esc(info.label)}</em>
      <small>${esc(info.before)} <i>→</i> <b>${esc(info.after)}</b></small>
    </button>`;
  }).join('');
  return `<section class="lvl">
    <div class="sechead">
      <h2>Level up! Pick a stat</h2>
      <span class="hint">Level ${lvl} · pick 1 of ${me.levelChoices.length}${more > 0 ? ` · ${more} more level-up${more > 1 ? 's' : ''} after this` : ''}</span>
      <button class="reroll ${poor ? 'poor' : ''}" data-act="levelReroll"${tipAttr('levelup')} data-tip-text="New level-up cards">${ICON.dice} Reroll ${AMBER} ${cost}<kbd>Shift+R</kbd></button>
    </div>
    <div class="lvcards">${cards}</div>
  </section>`;
}

// ---- Shop offers -----------------------------------------------------------------------------------------------

function shopHtml(me) {
  const cost = me.shop.rerollCost;
  const poor = me.amber < cost;
  return `<section class="shopsec ${hasLevels(me) || hasCrates(me) ? 'withlvl' : ''}">
    <div class="sechead">
      <h2>Shop</h2>
      <span class="hint">Buy all 4 for a free reroll · Lock keeps an offer for next wave</span>
      <button class="reroll ${poor ? 'poor' : ''}" data-act="reroll"${tipAttr('reroll')} data-tip-text="Roll 4 new offers (locked ones stay)">${ICON.dice} Reroll ${AMBER} ${cost}<kbd>R</kbd></button>
    </div>
    <div class="offers">${me.shop.offers.map((o, i) => offerCard(o, i, me)).join('')}</div>
  </section>`;
}

/** What buying this offer would do to the player's build. */
function analyse(o, me) {
  const out = { afford: me.amber >= o.price, ribbons: [], hint: '', blocked: false, buyLabel: '' };
  if (o.kind === 'weapon') {
    const maxW = maxWeaponsOf(me.char);
    const full = me.weapons.length >= maxW;
    const pair = o.tier < 4 && me.weapons.some((w) => w.wid === o.id && w.tier === o.tier);
    if (pair) {
      out.merge = true;
      out.ribbons.push({ cls: 'merge', text: full ? `Auto-merges into ${ROMAN[o.tier]}` : `Merges into ${ROMAN[o.tier]}` });
      if (!full) out.hint = `Buy it, then press Merge on your ${WEAPONS[o.id]?.name} to make a tier ${ROMAN[o.tier]}.`;
    } else if (full && maxW === 1 && me.weapons.length === 1) {
      // One weapon slot (Pip's Lone Arm): the new weapon takes the slot and the old one is sold.
      const old = me.weapons[0];
      out.ribbons.push({ cls: 'swap', text: 'Replaces your weapon' });
      out.hint = `It takes your only slot: your ${WEAPONS[old.wid]?.name} ${ROMAN[old.tier - 1]} is sold for ${sellValue(old, me.wave)} amber.`;
    } else if (full) {
      out.blocked = true;
      out.ribbons.push({ cls: 'full', text: 'Slots full' });
    } else {
      const set = setBonusHint(o.id, me.weapons);
      if (set) out.set = set;
    }
  } else {
    const have = me.items.filter((x) => x === o.id).length;
    const limit = ITEMS[o.id]?.limit || 0;
    out.have = have;
    if (limit && have >= limit) { out.blocked = true; out.ribbons.push({ cls: 'full', text: 'Limit reached' }); }
    else if (limit && have === limit - 1) out.hint = `Last one you can hold (limit ${limit}).`;
    // Synergy: it shares a tag with at least two things in your build (items you hold, what your weapons are).
    if (!out.blocked && sharedTags(o.id, ownedTags(me)).some((t) => t.n >= 2)) out.ribbons.push({ cls: 'syn', text: 'Synergy' });
  }
  return out;
}

export function offerCard(o, i, me) {
  if (!o) return `<article class="offer sold"><kbd class="num">${i + 1}</kbd><span>Sold</span></article>`;
  const isW = o.kind === 'weapon';
  const a = analyse(o, me);
  const def = isW ? WEAPONS[o.id] : ITEMS[o.id];
  const icon = isW ? `w_${o.id}` : def?.icon || 'amber';
  const lines = isW ? weaponLines(o.id, o.tier, me.stats) : itemLines(o.id);
  const sub = isW ? `${weaponClass(o.id)} weapon · Tier ${ROMAN[o.tier - 1]}` : 'Item';
  const ribbons = a.ribbons.map((r) => `<span class="rb ${r.cls}">${esc(r.text)}</span>`).join('');
  const own = !isW && a.have ? `<li class="note">You own ${a.have}${def?.limit ? ` / ${def.limit}` : ''}</li>` : '';
  const set = a.set
    ? `<div class="setnote">Set bonus: <b>${esc(a.set.name)} (${a.set.threshold})</b> ${esc(a.set.text)}</div>` : '';
  const state = !a.afford ? 'poor' : a.blocked ? 'blocked' : '';
  const need = a.afford ? '' : ` data-tip-text="Need ${o.price - me.amber} more amber"`;
  return `<article class="offer ${tcls(o.tier)} ${o.locked ? 'locked' : ''} ${a.merge ? 'merge' : ''} ${a.blocked ? 'blocked' : ''}">
    <kbd class="num">${i + 1}</kbd>
    ${ribbons ? `<div class="ribbons">${ribbons}</div>` : ''}
    <div class="top">
      <div class="ico"><img src="${SPR(icon)}" ${IMG_ERR} alt="">${isW ? `<span class="rom">${ROMAN[o.tier - 1]}</span>` : ''}</div>
      <div class="nm"><b>${esc(nameOf(o))}</b><span class="tierpill">${tierName(o.tier)}</span><small>${esc(sub)}</small></div>
    </div>
    ${isW ? '' : tagChips(o.id, ownedTags(me))}
    <ul class="lines">${linesHtml(lines)}${own}</ul>
    ${a.hint ? `<div class="mergenote">${esc(a.hint)}</div>` : ''}${set}
    <div class="buyrow">
      <button class="buy ${state}" data-act="buy" data-slot="${i}"${need}>${a.blocked && a.ribbons[0] ? `<span>${esc(a.ribbons[0].text)}</span>` : `Buy ${AMBER} ${o.price}`}</button>
      <button class="lock ${o.locked ? 'on' : ''}" data-act="lock" data-slot="${i}"${tipAttr('lock')} aria-pressed="${!!o.locked}" data-tip-text="Lock: keep this offer through rerolls and into the next wave at today's price">${o.locked ? ICON.lock : ICON.unlock}<span>${o.locked ? 'Locked' : 'Lock'}</span></button>
    </div>
  </article>`;
}

// ---- Your build ------------------------------------------------------------------------------------------------

function buildHtml(me, now) {
  const maxW = maxWeaponsOf(me.char);
  const counts = classCounts({ weapons: me.weapons });
  const bonuses = activeClassBonuses({ weapons: me.weapons });
  const pairs = new Set();
  for (const a of me.weapons) {
    if (a.tier < 4 && me.weapons.some((b) => b.uid !== a.uid && b.wid === a.wid && b.tier === a.tier)) pairs.add(a.uid);
  }
  const rows = me.weapons.map((w) => weaponRow(w, me, pairs.has(w.uid))).join('')
    + '<div class="wrow empty">Empty slot</div>'.repeat(Math.max(0, maxW - me.weapons.length));
  const sets = Object.entries(counts).map(([cls, n]) => setChip(cls, n, bonuses[cls])).join('');
  const itemCounts = countItems(me.items);
  const itemIds = Object.keys(itemCounts).sort((a, b) => (ITEMS[b]?.tier || 1) - (ITEMS[a]?.tier || 1) || a.localeCompare(b));
  const items = itemIds.map((id) => itemTile(id, itemCounts[id])).join('');
  const xpPct = Math.max(0, Math.min(100, ((me.xp || 0) / Math.max(1, me.xpNext || 1)) * 100));
  return `<div class="bhead"><h3>Weapons <span>${me.weapons.length}/${maxW}</span></h3>
      <div class="xp"${tipAttr('xp')} data-tip-text="${fmt(me.xp)} / ${me.xpNext} XP to the next level"><b>LV ${me.level}</b><i class="bar"><u style="width:${xpPct.toFixed(1)}%"></u></i></div></div>
    <div class="weapons">${rows}</div>
    ${sets ? `<h3>Set bonuses</h3><div class="sets">${sets}</div>` : ''}
    <h3>Items <span>${me.items.length}</span></h3>
    <div class="items">${items || '<p class="muted none">None yet. Items trade one stat for another.</p>'}</div>
    <h3>Stats</h3>
    <div class="stats">${statsHtml(me, now)}</div>`;
}

function weaponRow(w, me, isPair) {
  const d = WEAPONS[w.wid];
  const st = weaponStats(w.wid, w.tier, me.stats);
  const sell = sellValue(w, me.wave);
  const only = me.weapons.length <= 1;
  const tip = `<div class="tt-h ${tcls(w.tier)}"><b>${esc(d?.name || w.wid)}</b> <i>${ROMAN[w.tier - 1]}</i></div>`
    + `<div class="tt-s">${esc(weaponClass(w.wid))} weapon · ${tierName(w.tier)}</div><ul class="lines">${linesHtml(weaponLines(w.wid, w.tier, me.stats))}</ul>`
    + `<div class="tt-s">Sells for ${sell} amber${only ? ' (you must keep one weapon)' : ''}</div>`;
  return `<div class="wrow ${tcls(w.tier)} ${isPair ? 'pair' : ''}" data-tip="${esc(tip)}">
    <div class="ico"><img src="${SPR(`w_${w.wid}`)}" ${IMG_ERR} alt=""><span class="rom">${ROMAN[w.tier - 1]}</span></div>
    <div class="wt"><b>${esc(d?.name || w.wid)}</b><span>${esc(weaponClass(w.wid))} · ${st ? `${fmt(st.dmg)} dmg · ${fmt(st.dps)} DPS` : ''}</span></div>
    <div class="wb">
      ${isPair ? `<button class="mini merge" data-act="merge" data-uid="${w.uid}"${tipAttr('merge')} data-tip-text="Merge two identical weapons into tier ${ROMAN[w.tier]}">Merge → ${ROMAN[w.tier]}</button>` : ''}
      <button class="mini sell ${only ? 'off' : ''}" data-act="sell" data-uid="${w.uid}"${tipAttr('sell')} data-tip-text="${only ? 'Keep at least one weapon' : `Sell for ${sell} amber (25% of its price)`}">Sell ${AMBER} +${sell}</button>
    </div>
  </div>`;
}

function setChip(cls, n, active) {
  const ths = classThresholds(cls);
  const nextTh = ths.find((t) => t > n);
  const name = CLASSES[cls]?.name || cls;
  const body = active
    ? `<span>${esc(bonusText(cls, active.threshold))}</span>`
    : `<span class="muted">${nextTh ? `${nextTh} for ${esc(bonusText(cls, nextTh))}` : ''}</span>`;
  const tip = `<div class="tt-h"><b>${esc(name)} set</b></div><ul class="lines">${ths.map((t) => {
    const lines = bonusLines(cls, t);
    const on = n >= t;
    return `<li class="kv ${on ? 'good' : ''}"><span>${t} weapons</span><b>${esc(lines.map((l) => l.text).join(', '))}</b></li>`;
  }).join('')}</ul><div class="tt-s">Duplicates count towards the set.</div>`;
  return `<div class="set ${active ? 'on' : ''}" data-tip="${esc(tip)}"><b>${esc(name)} ×${n}</b>${body}</div>`;
}

function itemTile(id, n) {
  const it = ITEMS[id];
  if (!it) return '';
  const lines = itemLines(id);
  const totals = n > 1
    ? `<div class="tt-s">All ${n} together:</div><ul class="lines">${linesHtml(Object.entries(it.stats || {}).map(([k, val]) => statLine(k, val * n)))}</ul>` : '';
  const tagNames = itemTags(id).map((t) => t.name).join(', ');
  const tip = `<div class="tt-h ${tcls(it.tier)}"><b>${esc(it.name)}</b></div><div class="tt-s">${tierName(it.tier)} item${n > 1 ? ` · you own ${n}` : ''}${tagNames ? ` · ${esc(tagNames)}` : ''}</div>`
    + `<ul class="lines">${linesHtml(lines)}</ul>${totals}`;
  return `<div class="item ${tcls(it.tier)}" data-tip="${esc(tip)}"><img src="${SPR(it.icon || 'amber')}" ${IMG_ERR} alt="">${n > 1 ? `<i>x${n}</i>` : ''}</div>`;
}

function statsHtml(me, now) {
  return STAT_KEYS.map((k) => {
    const val = +(me.stats[k] || 0);
    const base = BALANCE.baseStats[k] || 0;
    const d = val - (track.open[k] ?? val);
    const delta = Math.abs(d) > 0.049 ? `<i class="dl ${d > 0 ? 'good' : 'bad'}">${d > 0 ? '+' : ''}${fmt(d)}</i>` : '';
    const age = now - (track.changedAt[k] || -1e9);
    const popCls = age < FLASH_MS ? ' pop' : '';
    const popStyle = popCls ? ` style="animation-delay:-${Math.round(age)}ms"` : '';
    const tone = val > base + 1e-6 ? 'good' : val < base - 1e-6 ? 'bad' : '';
    const label = (STAT_LABELS[k] || k).replace(/\s*%$/, '');
    return `<div${tipAttr(k)}><span>${esc(label)}</span><b class="${tone}${popCls}"${popStyle}>${esc(statValue(k, val))}</b>${delta}</div>`;
  }).join('');
}

// ---------------------------------------------------------------------------------------------------------------
// Actions (ui.js maps data-act to these)

export const shopActions = {
  buy: (ui, d) => ui.shopOp({ op: 'buy', slot: +d.slot }, 'buy'),
  lock: (ui, d) => ui.shopOp({ op: 'lock', slot: +d.slot }),
  reroll: (ui) => ui.shopOp({ op: 'reroll' }),
  level: (ui, d) => ui.shopOp({ op: 'level', idx: +d.idx }, 'levelup'),
  crate: (ui, d) => {
    crateLog.how[+d.cid] = d.take === '1' ? 'Taken' : 'Recycled';
    return ui.shopOp({ op: 'crate', idx: +d.idx, take: d.take === '1', cid: +d.cid }, d.take === '1' ? 'buy' : undefined);
  },
  levelReroll: (ui) => ui.shopOp({ op: 'levelReroll' }),
  sell: (ui, d) => ui.shopOp({ op: 'sell', uid: +d.uid }),
  merge: (ui, d) => ui.shopOp({ op: 'merge', uid: +d.uid }, 'buy'),
  shopready: (ui) => {
    const me = ui.app.session.me();
    ui.shopOp({ op: 'ready', value: !me?.ready });
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Keyboard and tooltip (installed once; both do nothing unless the shop is on screen)

let activeUi = null;
let installed = false;
const mouse = { x: -1, y: -1, seen: false };
let tipEl = null;
let tipShown = false;
let tipLoop = 0;

const shopOpen = () => !!document.querySelector('.shopwrap');

function installHandlers() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.seen = true;
    updateTip();
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', hideTip);
  window.addEventListener('blur', hideTip);
}

function onKeyDown(e) {
  const ui = activeUi;
  if (!ui || !shopOpen() || ui.settingsOpen) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const me = ui.app.session?.me?.();
  if (!me || !me.shop) return;
  const levels = hasLevels(me);
  const digit = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
  let handled = true;
  if (digit) {
    const idx = +digit[1] - 1;
    if (!e.repeat) {
      // Loot crates come first: 1 takes the first crate, 2 recycles it.
      if (hasCrates(me)) {
        const c = me.crates[0];
        if (idx === 0) ui.act('crate', { idx: 0, take: '1', cid: c.cid });
        else if (idx === 1) ui.act('crate', { idx: 0, take: '0', cid: c.cid });
      }
      else if (levels) { if (me.levelChoices[idx]) ui.act('level', { idx }); }
      else if (me.shop.offers[idx]) ui.act('buy', { slot: idx });
    }
  } else if (e.code === 'KeyR') {
    if (!e.repeat) ui.act(levels && e.shiftKey ? 'levelReroll' : 'reroll');
  } else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (!e.repeat) ui.act('shopready');
  } else handled = false;
  if (!handled) return;
  // Keep Space from reaching the game's ability key, and from "clicking" a focused button as well.
  e.preventDefault();
  e.stopPropagation();
  const f = document.activeElement;
  if (f && f !== document.body && f.blur) f.blur();
}

function ensureTip() {
  if (tipEl && tipEl.isConnected) return tipEl;
  tipEl = document.createElement('div');
  tipEl.id = 'shoptip';
  document.body.appendChild(tipEl);
  return tipEl;
}

function hideTip() {
  tipShown = false;
  if (tipEl) tipEl.className = '';
}

/** Show the tooltip for whatever [data-tip] is under the mouse. Re-run each frame while shown so it survives re-renders. */
function updateTip() {
  if (!mouse.seen) return;
  if (!shopOpen()) { hideTip(); return; }
  const el = document.elementFromPoint(mouse.x, mouse.y)?.closest?.('[data-tip]');
  if (!el) { hideTip(); return; }
  const tip = ensureTip();
  const html = el.getAttribute('data-tip');
  if (tip.dataset.src !== html) { tip.innerHTML = html; tip.dataset.src = html; }
  tip.className = 'show';
  const w = tip.offsetWidth, h = tip.offsetHeight, pad = 8;
  let x = mouse.x + 18, y = mouse.y + 14;
  if (x + w > innerWidth - pad) x = mouse.x - w - 18;
  if (y + h > innerHeight - pad) y = innerHeight - h - pad;
  tip.style.left = `${Math.max(pad, x)}px`;
  tip.style.top = `${Math.max(pad, y)}px`;
  if (!tipShown) {
    tipShown = true;
    cancelAnimationFrame(tipLoop);
    const loop = () => { if (!tipShown) return; updateTip(); tipLoop = requestAnimationFrame(loop); };
    tipLoop = requestAnimationFrame(loop);
  }
}
