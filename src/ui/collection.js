// The Challenges screen (menu -> "Challenges") and the small pieces other screens share with it: reward chips, the "next goals"
// list, Danger star/lock helpers. Progression design: docs/PROGRESSION.md.
//
// Three tabs (ui.collectionTab): Challenges (28 goals by difficulty, progress and the reward each one unlocks), Heroes (portraits,
// Danger stars, or the lock rule and progress) and Danger (the six levels as a ladder). It reads this browser's progress
// (src/meta/unlocks.js) and the data in src/data. This module imports no other screen, so menu, lobby and end can all use it.

import { CHARACTERS, CHARACTER_IDS } from '../data/characters.js';
import { DANGER } from '../data/danger.js';
import { CHALLENGES } from '../data/challenges.js';
import { ITEMS } from '../data/items.js';
import { WEAPONS, CLASSES } from '../data/weapons.js';
import { loadProgress, isUnlocked, heroProgress, heroStars, challengeState, maxDangerUnlocked, isDangerUnlocked } from '../meta/unlocks.js';
import { esc, itemLines, weaponLines, TIER_CLASS, TIER_NAMES } from './describe.js';
import { tip } from './tips.js';

export const SPR = (key) => `assets/sprites/${key}.svg`;
const IMG_ERR = `onerror="this.style.visibility='hidden'"`;
const fmtN = (v) => (Number(v) || 0).toLocaleString('en');
const pct = (frac) => Math.round(Math.max(0, Math.min(1, frac)) * 100);

export const LOCK_ICO = '<svg class="lockico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1zm2 0h6V8a3 3 0 0 0-6 0v2z"/></svg>';
const TICK = '<svg class="tickico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 17.2 4.8 12.5l1.9-1.9 2.8 2.8 7.8-7.8 1.9 1.9z"/></svg>';

export const CHALLENGE_COUNT = CHALLENGES.length;
const TIERS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
const TIER_RANK = { easy: 0, medium: 1, hard: 2 };
/** The challenge that unlocks a reward by winning on that Danger level (shown on the Danger ladder). */
const DANGER_CHALLENGE = { 2: 'win_hard', 3: 'win_extinction', 4: 'win_meteor', 5: 'win_apocalypse' };

// ---- shared helpers (stars, hero progress text, Danger text) ----

/** Danger stars (best Danger won with the hero): one star per Danger level, filled up to the best win. */
export function starsHtml(n) {
  const title = n > 0
    ? `Best win: ${DANGER[Math.min(n, DANGER.length) - 1].name} (${n} of ${DANGER.length} stars)`
    : 'Win a run with this hero to earn stars. The higher the Danger, the more stars.';
  return `<span class="stars" data-tip-text="${esc(title)}" aria-label="${esc(title)}">${DANGER.map((D, i) => `<i class="${i < n ? 'on' : ''}">&#9733;</i>`).join('')}</span>`;
}

/** "best 7/10" for the wave rule, "1,240 / 1,500" for totals. */
export function progressText(id, progress) {
  const g = heroProgress(id, progress);
  return g.stat === 'bestWave' ? `best ${fmtN(g.have)}/${fmtN(g.target)}` : `${fmtN(g.have)} / ${fmtN(g.target)}`;
}

const pctText = (m) => `${m >= 1 ? '+' : '-'}${Math.round(Math.abs(m - 1) * 100)}%`;

/** Short chips for a Danger level, built from its numbers so a data edit shows up here. */
export function dangerChips(D) {
  if (D.hp === 1 && D.dmg === 1 && D.bossHp === 1 && !D.extraElites.length) return 'Base game';
  return `HP ${pctText(D.hp)} · DMG ${pctText(D.dmg)}`;
}

/** A list of "8, 12 and 17". */
const andList = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/** What a Danger level changes, from its numbers (the hover text of its button). */
export function dangerTip(D) {
  const parts = [D.hp === 1 ? 'Enemies have normal HP' : `Enemies have ${Math.round(D.hp * 100)}% HP`];
  parts.push(D.dmg === 1 ? 'deal normal damage' : `deal ${Math.round(D.dmg * 100)}% damage`);
  if (D.bossHp !== 1) parts.push(`and the boss has another ${pctText(D.bossHp)} HP`);
  let text = `${D.name}: ${parts.join(', ')}.`;
  const el = D.extraElites || [];
  if (el.length === 1) text += ` An extra elite joins wave ${el[0]}.`;
  else if (el.length > 1) text += ` Extra elites join waves ${andList(el)}.`;
  if (D.speed && D.speed !== 1) text += ` Enemies move ${Math.round((D.speed - 1) * 100)}% faster.`;
  if (D.meteors) text += ` Meteors fall on the arena about every ${D.meteors.every} s, each with a red warning circle first.`;
  return text;
}

/** "Win a run on Hard to unlock Extinction." (Danger levels 0 and 1 are always open.) */
export function dangerUnlockText(id) {
  const prev = DANGER[id - 1];
  return prev ? `Win a run on ${prev.name} to unlock ${DANGER[id].name}.` : '';
}

// ---- challenges and their rewards ----

export function challengesDone(progress = loadProgress()) {
  const done = progress.challenges || [];
  return CHALLENGES.filter((c) => done.includes(c.id)).length;
}

/** What a reward looks like: {kind: 'Item'|'Weapon', name, icon (sprite key), tier 1-4}. Tolerates an id with no data yet. */
export function rewardInfo(reward) {
  if (reward.kind === 'weapon') return { kind: 'Weapon', name: WEAPONS[reward.id]?.name || reward.id, icon: `w_${reward.id}`, tier: 1 };
  const d = ITEMS[reward.id];
  return { kind: 'Item', name: d?.name || reward.id, icon: d?.icon || `i_${reward.id}`, tier: Math.max(1, Math.min(4, d?.tier || 1)) };
}

/** The plain-text effect lines of a reward (for hovers and the "Unlocked!" card). Never throws. */
export function rewardLines(reward) {
  try {
    if (reward.kind === 'weapon') {
      const lines = weaponLines(reward.id, 1);
      const stats = lines.filter((l) => !l.note).slice(0, 3).map((l) => l.text);
      const note = lines.find((l) => l.note);
      const cls = CLASSES[WEAPONS[reward.id]?.cls]?.name;
      return [...(note ? [note.text] : []), ...stats, ...(cls ? [`${cls} class`] : [])];
    }
    return itemLines(reward.id).map((l) => l.text);
  } catch (e) { return []; }
}

/** Hover text of a reward: its name and effect, and whether it is earned or what earns it. First line is the title. */
export function rewardTip(c, done) {
  const r = rewardInfo(c.reward);
  const head = r.kind === 'Item' ? `${r.name} (item, ${TIER_NAMES[r.tier - 1]})` : `${r.name} (weapon)`;
  const status = done
    ? 'Unlocked: it can now show up in the shop and in crates.'
    : `Unlock it with the challenge ${c.name}: ${c.desc}. Until then it never shows up in the shop or in crates.`;
  return [head, ...rewardLines(c.reward), status].join('\n');
}

/** A reward as an icon + name + kind chip. Locked ones are greyed. `compact` drops the kind line. */
export function rewardChip(c, done, compact = false) {
  const r = rewardInfo(c.reward);
  const state = done ? 'earned' : 'locked';
  return `<span class="rwd ${state} ${compact ? 'compact' : ''} ${TIER_CLASS[r.tier - 1]}"${done ? '' : tip('locked')} data-tip-text="${esc(rewardTip(c, done))}">
      <span class="ricon"><img src="${SPR(r.icon)}" ${IMG_ERR} alt="">${done ? '' : LOCK_ICO}</span>
      <span class="rtxt"><b>${esc(r.name)}</b>${compact ? '' : `<small>${r.kind}${done ? ' · unlocked' : ' · locked'}</small>`}</span>
    </span>`;
}

/**
 * The unfinished challenges that are closest to done: [{c, state}] best first. Ties go to challenges you can start now (not
 * "win with a hero you have not unlocked yet"), then easier ones, then the order in the data file.
 */
export function nextGoals(progress = loadProgress(), n = 3) {
  const blocked = (c) => {
    const m = /^win_(.+)$/.exec(c.id);
    return m && CHARACTERS[m[1]] && !isUnlocked(m[1], progress) ? 1 : 0;
  };
  return CHALLENGES.map((c, i) => ({ c, i, state: challengeState(c.id, progress) }))
    .filter((x) => !x.state.done)
    .sort((a, b) => b.state.frac - a.state.frac || blocked(a.c) - blocked(b.c) || TIER_RANK[a.c.tier] - TIER_RANK[b.c.tier] || a.i - b.i)
    .slice(0, n)
    .map(({ c, state }) => ({ c, state }));
}

/** The progress bar of a goal: bar + "64 / 100". */
export function goalBar(state) {
  const w = state.frac > 0 ? Math.max(4, pct(state.frac)) : 0;
  return `<span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${state.target}" aria-valuenow="${state.have}"><i style="width:${w}%"></i></span><span class="have">${fmtN(state.have)} / ${fmtN(state.target)}</span>`;
}

/** The "Next goals" strip (end screen): up to `n` unfinished challenges with progress bars and the reward waiting. */
export function nextGoalsHtml(progress = loadProgress(), n = 3) {
  const goals = nextGoals(progress, n);
  if (!goals.length) return `<section class="goals alldone"><h3 class="ghead">Next goals</h3><p class="muted">All ${CHALLENGE_COUNT} challenges done. Every reward is unlocked.</p></section>`;
  return `<section class="goals"><h3 class="ghead"${tip('challenge')}>Next goals <small>${challengesDone(progress)}/${CHALLENGE_COUNT} challenges done</small></h3>
    <div class="glist">${goals.map(({ c, state }, i) => `<div class="grow ${c.tier}" style="--i:${i}">
      <div class="gmain"><b class="gname">${esc(c.name)}</b><span class="gdesc">${esc(c.desc)}</span></div>
      ${rewardChip(c, false, true)}
      <span class="gbar">${goalBar(state)}</span>
    </div>`).join('')}</div>
  </section>`;
}

// ---- the screen ----

const TABS = ['challenges', 'heroes', 'danger'];

function challengeRow(c, progress) {
  const s = challengeState(c.id, progress);
  return `<div class="crow ${s.done ? 'done' : 'todo'} ${c.tier}">
    <span class="cmark" aria-label="${s.done ? 'Done' : 'Not done yet'}">${s.done ? TICK : ''}</span>
    <div class="cmain">
      <b class="cname"${tip('challenge')}>${esc(c.name)}</b>
      <span class="cdesc">${esc(c.desc)}</span>
      ${s.done ? '<span class="cdone">Done</span>' : `<span class="gbar">${goalBar(s)}</span>`}
    </div>
    ${rewardChip(c, s.done)}
  </div>`;
}

function challengesTab(progress) {
  return TIERS.map(([tier, label]) => {
    const list = CHALLENGES.filter((c) => c.tier === tier);
    const done = list.filter((c) => challengeState(c.id, progress).done).length;
    return `<section class="csec ${tier}"><h3>${label} <small>${done}/${list.length} done</small></h3>
      <div class="cgrid">${list.map((c) => challengeRow(c, progress)).join('')}</div></section>`;
  }).join('');
}

function heroCard(id, progress) {
  const c = CHARACTERS[id];
  if (isUnlocked(id, progress)) {
    return `<div class="hcard open" style="--hc:${c.color}">
      <span class="hstage"><img src="${SPR(`h_${id}`)}" ${IMG_ERR} alt=""></span>
      <b class="nm">${esc(c.name)}</b><span class="role">${esc(c.role)}</span>
      ${starsHtml(heroStars(id, progress))}
      <span class="ttrait">${esc(c.trait?.name || '')}</span>
    </div>`;
  }
  const g = heroProgress(id, progress);
  const why = `${c.name} is locked. To unlock: ${g.text}. Progress: ${progressText(id, progress)}.`;
  return `<div class="hcard locked" style="--hc:${c.color}"${tip('locked')} data-tip-text="${esc(why)}">
    <span class="hstage"><img class="sil" src="${SPR(`h_${id}`)}" ${IMG_ERR} alt="">${LOCK_ICO}</span>
    <b class="nm">${esc(c.name)}</b><span class="role">${esc(c.role)}</span>
    <span class="need">${esc(g.text)}</span>
    <span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${g.target}" aria-valuenow="${g.have}"><i style="width:${pct(g.frac)}%"></i></span>
    <span class="have">${esc(progressText(id, progress))}</span>
  </div>`;
}

const heroesTab = (progress) => `<div class="hgrid">${CHARACTER_IDS.map((id) => heroCard(id, progress)).join('')}</div>`;

/** Facts of a Danger level as small chips (the ladder shows all of them). */
function dangerFacts(D) {
  const f = [`Enemy HP ${Math.round(D.hp * 100)}%`, `Enemy damage ${Math.round(D.dmg * 100)}%`];
  if (D.bossHp !== 1) f.push(`Boss HP +${Math.round((D.bossHp - 1) * 100)}%`);
  if (D.speed && D.speed !== 1) f.push(`Enemy speed +${Math.round((D.speed - 1) * 100)}%`);
  if (D.extraElites.length) f.push(`Extra elites: wave ${D.extraElites.join(', ')}`);
  if (D.meteors) f.push('Meteors');
  return f.map((x) => `<li>${esc(x)}</li>`).join('');
}

function dangerTab(progress) {
  const top = maxDangerUnlocked(progress);
  return `<div class="dladder">${DANGER.map((D) => {
    const open = isDangerUnlocked(D.id, progress);
    const isTop = D.id === top;
    const ch = CHALLENGES.find((c) => c.id === DANGER_CHALLENGE[D.id]);
    const state = open
      ? `<span class="dstate open">${isTop ? 'Your top level' : 'Open'}</span>`
      : `<span class="dstate"><span class="lk">${LOCK_ICO}Locked</span><small>Win a run on ${esc(DANGER[D.id - 1]?.name || '')} to unlock</small></span>`;
    return `<div class="drow d${D.id} ${open ? 'open' : 'locked'} ${isTop ? 'top' : ''}"${open ? '' : `${tip('locked')} data-tip-text="${esc(dangerUnlockText(D.id))}"`}>
      <span class="dbadge" data-tip-text="${esc(dangerTip(D))}">${D.id}</span>
      <div class="dinfo"><b class="dname">${esc(D.name)}</b><span class="ddesc">${esc(D.desc)}</span><ul class="dfacts">${dangerFacts(D)}</ul></div>
      <div class="dside">${state}${ch ? rewardChip(ch, challengeState(ch.id, progress).done, true) : ''}</div>
    </div>`;
  }).join('')}</div>`;
}

export function collectionScreen(ui) {
  const progress = loadProgress();
  const tab = TABS.includes(ui.collectionTab) ? ui.collectionTab : 'challenges';
  const heroesOpen = CHARACTER_IDS.filter((id) => isUnlocked(id, progress)).length;
  const counts = {
    challenges: `${challengesDone(progress)}/${CHALLENGE_COUNT}`,
    heroes: `${heroesOpen}/${CHARACTER_IDS.length}`,
    danger: `${maxDangerUnlocked(progress) + 1}/${DANGER.length}`,
  };
  const labels = { challenges: 'Challenges', heroes: 'Heroes', danger: 'Danger' };
  const intro = {
    challenges: 'Finish a challenge to unlock one new item or weapon. Locked rewards stay out of the shop and crates until then.',
    heroes: 'Four heroes are open from the start. The rest are earned by playing.',
    danger: 'Win a run on a Danger level to open the next one. Your mates in a lobby can use the highest level any of you has opened.',
  }[tab];
  const body = tab === 'heroes' ? heroesTab(progress) : tab === 'danger' ? dangerTab(progress) : challengesTab(progress);
  return `<div class="center"><div class="panel collection tab-${tab}">
    <header class="chead">
      <button class="ghost back" data-act="colBack">&larr; Back</button>
      <h2>Challenges</h2>
      <nav class="ctabs" role="tablist" aria-label="Collection">${TABS.map((t) => `<button role="tab" class="ctab ${t === tab ? 'sel' : ''}" aria-selected="${t === tab}" data-act="colTab" data-tab="${t}">${labels[t]} <b>${counts[t]}</b></button>`).join('')}</nav>
    </header>
    <p class="cintro muted">${esc(intro)}</p>
    <div class="cscroll">${body}</div>
  </div></div>`;
}

/** Click actions handled by this screen: act -> (ui, dataset) => void */
export const collectionActions = {
  collection: (ui, d) => { ui.collectionTab = TABS.includes(d.tab) ? d.tab : 'challenges'; },
  colTab: (ui, d) => { ui.collectionTab = TABS.includes(d.tab) ? d.tab : 'challenges'; },
  colBack: (ui) => { ui.collectionTab = ''; },
};
