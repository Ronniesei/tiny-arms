// Lobby: room code and invite link, the four player slots, the danger picker (six levels; the ones nobody in the lobby has
// unlocked yet are greyed with a lock), the hero grid (10 tiles in two rows of 5: locked heroes are silhouettes with their
// unlock condition and progress) and a detail card for the hero you are looking at, ready / start.

import { CHARACTERS, CHARACTER_IDS } from '../data/characters.js';
import { DANGER, clampDanger } from '../data/danger.js';
import { WEAPONS } from '../data/weapons.js';
import { STAT_LABELS } from '../sim/stats.js';
import { PLAYER_COLORS_CSS } from '../render/art.js';
import { loadProgress, isUnlocked, heroProgress, heroStars } from '../meta/unlocks.js';
import { esc, statLine } from './describe.js';
import { tip } from './tips.js';
import { howToPlayModal, defaultName } from './menu.js';
import { SPR, LOCK_ICO, starsHtml, progressText, dangerChips, dangerTip, dangerUnlockText } from './collection.js';

export { progressText }; // moved to collection.js (the Challenges screen uses it too); still importable from here
const SLOTS = 4;

/** Keys 1-9 pick the first nine heroes, 0 the tenth. */
const keyLabel = (i) => (i === 9 ? '0' : String(i + 1));
const keyHint = () => (CHARACTER_IDS.length > 9 ? 'keys 1-9 and 0' : `keys 1-${CHARACTER_IDS.length}`);

export function lobbyScreen(ui) {
  watchKeys(ui);
  const s = ui.app.session;
  // Nobody typed a name yet: give the session a friendly one instead of "Host" or "Player".
  if (!s._namedOnce) { s._namedOnce = true; if (!ui.app.settings.name) s.setName?.(defaultName()); }
  // The host's remembered danger level (a ?danger= URL parameter, if given, has already set _dangerOnce).
  if (s.isHost && !s._dangerOnce) { s._dangerOnce = true; if (ui.app.settings.danger !== undefined) s.setDanger?.(clampDanger(ui.app.settings.danger)); }
  const L = s.lobby();
  const me = L.players.find((p) => p.id === L.myId) || {};
  const link = `${location.origin}${location.pathname}?join=${L.code}${L.local ? '&local=1' : ''}`;
  const mates = L.players.filter((p) => p.id !== 0);
  const readyMates = mates.filter((p) => p.ready).length;
  const allReady = readyMates === mates.length;

  // This browser's unlocks. The detail card shows your pick, or a locked hero you clicked to read about.
  if (ui._lookSession !== s) { ui._lookSession = s; ui.lookChar = null; }
  const progress = loadProgress();
  const lookId = ui.lookChar && CHARACTERS[ui.lookChar] ? ui.lookChar : CHARACTERS[me.char] ? me.char : CHARACTER_IDS[0];
  const picksOf = (id) => L.players.filter((p) => p.char === id && p.id !== L.myId);
  const lockedLeft = CHARACTER_IDS.filter((id) => !isUnlocked(id, progress)).length;

  let status;
  if (s.solo) status = 'Pick your T-Rex and go.';
  else if (L.isHost) status = !mates.length ? 'Share the code and wait for your mates, or start alone.' : allReady ? 'Everyone is ready.' : `${readyMates} of ${mates.length} mate${mates.length === 1 ? '' : 's'} ready`;
  else status = me.ready ? 'Waiting for the host to start...' : 'Pick your T-Rex, then press Ready.';

  const startLabel = s.solo ? 'Start run' : allReady ? 'Start run' : 'Start anyway';
  const action = L.isHost
    ? `<button class="big go" data-act="start">${startLabel}</button>`
    : `<button class="big go ${me.ready ? 'on' : ''}" data-act="ready">${me.ready ? 'Ready  ✓' : 'Ready'}</button>`;

  return `<div class="center"><div class="panel lobby ${s.solo ? 'solo' : ''}">
    <header class="lhead">
      <h2>${s.solo ? 'Solo run' : 'Lobby'}</h2>
      ${s.solo
        ? `<label class="field inline">Your name <input id="name" maxlength="16" value="${esc(me.name || ui.app.settings.name)}" placeholder="${esc(defaultName())}" autocomplete="off"></label>`
        : `<div class="code"><span>Room code</span><b>${esc(L.code)}</b><button data-act="copy" data-link="${esc(link)}">Copy invite link</button></div>`}
    </header>
    <div class="lscroll">
      ${s.solo ? '' : `<div class="players">${Array.from({ length: SLOTS }, (_, id) => slot(id, L.players.find((p) => p.id === id), L)).join('')}</div>`}
      ${dangerPicker(L)}
      <p class="pickhead">Pick your T-Rex <small>${esc(keyHint())}${lockedLeft ? ' · click a locked hero to see how to unlock it' : ' · all heroes unlocked'}</small></p>
      <div class="chars">${CHARACTER_IDS.map((id, i) => heroTile(id, i, me.char === id, lookId === id, picksOf(id), progress)).join('')}</div>
      ${charCard(lookId, me.char === lookId, CHARACTER_IDS.indexOf(lookId), picksOf(lookId), { progress })}
    </div>
    <footer class="lfoot">
      <p class="status">${esc(status)}</p>
      <div class="acts">${action}<button class="ghost" data-act="help">How to play</button><button data-act="menu">Leave</button></div>
    </footer>
  </div></div>${ui.helpOpen ? howToPlayModal() : ''}`;
}

/**
 * The highest Danger the lobby may pick: anyone in it having unlocked a level opens it for the whole team (L.maxDanger from the
 * session). A lobby object without one (older callers, tests) has every level open.
 */
export function lobbyMaxDanger(L) {
  return L.maxDanger === undefined ? DANGER.length - 1 : clampDanger(L.maxDanger);
}

/** The danger selector (six levels): clickable for the host, read-only for mates. Levels nobody has unlocked yet are locked. */
function dangerPicker(L) {
  const maxD = lobbyMaxDanger(L);
  const cur = Math.min(clampDanger(L.danger), maxD); // a locked level is never shown as the chosen one
  const cards = DANGER.map((D) => {
    const locked = D.id > maxD;
    const sel = D.id === cur;
    const inner = `<span class="dtop"><b>${esc(D.name)}</b>${locked ? LOCK_ICO : `<em>${esc(dangerChips(D))}</em>`}</span><span class="ddesc">${esc(D.desc)}</span>`;
    if (locked) {
      // No data-act: a locked level cannot be clicked, by the host or anyone else.
      const why = `${dangerUnlockText(D.id)}
Anyone in the lobby can unlock it for the whole team.
${dangerTip(D)}`;
      return `<div class="dg d${D.id} locked" role="radio" aria-checked="false" aria-disabled="true"${tip('danger')} data-tip-text="${esc(why)}">${inner}</div>`;
    }
    const hover = `${tip('danger')} data-tip-text="${esc(dangerTip(D))}"`;
    return L.isHost
      ? `<button class="dg d${D.id} ${sel ? 'sel' : ''}" data-act="danger" data-d="${D.id}" role="radio" aria-checked="${sel}"${hover}>${inner}</button>`
      : `<div class="dg d${D.id} ro ${sel ? 'sel' : ''}" role="radio" aria-checked="${sel}"${hover}>${inner}</div>`;
  }).join('');
  return `<div class="danger" role="radiogroup" aria-label="Danger level">
    <p class="dlabel"${tip('danger')}>Danger <small>${L.isHost ? 'you choose for the whole team' : 'chosen by the host'}${maxD < DANGER.length - 1 ? ' · win a run to open the next level' : ''}</small></p>
    <div class="dgs">${cards}</div>
  </div>`;
}

function slot(id, p, L) {
  const color = PLAYER_COLORS_CSS[id];
  if (!p) return `<div class="pl empty" style="--pc:${color}"><span class="face">P${id + 1}</span><div class="who"><b>Open slot</b><small>Waiting for a mate</small></div></div>`;
  const you = p.id === L.myId;
  const host = p.id === 0;
  const state = host ? '<em class="st host">Host</em>' : p.ready ? '<em class="st on">Ready ✓</em>' : '<em class="st">Choosing...</em>';
  const name = you
    ? `<input id="name" class="inline" maxlength="16" value="${esc(p.name)}" autocomplete="off" aria-label="Your name">`
    : `<b>${esc(p.name)}</b>`;
  return `<div class="pl ${you ? 'you' : ''} ${p.ready || host ? 'ok' : ''}" style="--pc:${color}">
    <span class="face"><img src="${SPR(`h_${p.char}`)}" alt=""></span>
    <div class="who">${name}<small>${CHARACTERS[p.char]?.name || ''}${you ? ' · you' : ''}</small></div>${state}
  </div>`;
}

/** One hero in the grid: a compact tile. Locked heroes are a dark silhouette with a lock, the condition and a progress bar. */
function heroTile(id, index, picked, looking, picks, progress) {
  const c = CHARACTERS[id];
  const mates = picks.length ? `<span class="mates">${picks.map((p) => `<span style="--pc:${PLAYER_COLORS_CSS[p.id % 4]}">${esc(p.name)}</span>`).join('')}</span>` : '';
  if (!isUnlocked(id, progress)) {
    const g = heroProgress(id, progress);
    const why = `${c.name} is locked. To unlock: ${g.text}. Progress: ${progressText(id, progress)}.\nClick to read about ${c.name}.`;
    return `<button class="char tile locked ${looking ? 'look' : ''}" data-act="look" data-char="${id}" aria-label="${esc(`${c.name}: locked. ${g.text}`)}" data-tip-text="${esc(why)}" style="--hc:${c.color}">
      <kbd class="num">${keyLabel(index)}</kbd>
      <span class="stage"><img class="sil" src="${SPR(`h_${id}`)}" alt="">${LOCK_ICO}</span>
      <span class="tinfo">
        <b class="nm">${esc(c.name)}</b><span class="role">${esc(c.role)}</span>
        <span class="need">${esc(g.text)}</span>
        <span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${g.target}" aria-valuenow="${g.have}"><i style="width:${Math.round(g.frac * 100)}%"></i></span>
        <span class="have">${esc(progressText(id, progress))}</span>
      </span>${mates}
    </button>`;
  }
  return `<button class="char tile ${picked ? 'sel' : ''} ${looking && !picked ? 'look' : ''}" data-act="pick" data-char="${id}" aria-pressed="${picked}" style="--hc:${c.color}">
    <kbd class="num">${keyLabel(index)}</kbd>
    <span class="chosen">${picked ? 'Your pick' : ''}</span>
    <span class="stage"><img src="${SPR(`h_${id}`)}" alt=""></span>
    <span class="tinfo">
      <b class="nm">${esc(c.name)}</b><span class="role">${esc(c.role)}</span>
      ${starsHtml(heroStars(id, progress))}
      <span class="ttrait">${esc(c.trait?.name || '')}</span>
    </span>${mates}
  </button>`;
}

/**
 * The detail card of one hero (the one picked, or a locked one being looked at): blurb, ability, trait, stat chips and the
 * starting weapon. `opts.progress` is this browser's progress; a locked hero also shows its unlock condition and progress.
 */
export function charCard(id, selected, index = 0, picks = [], opts = {}) {
  const c = CHARACTERS[id];
  const progress = opts.progress || loadProgress();
  const locked = !isUnlocked(id, progress);
  const mods = [
    ...Object.entries(c.stats).map(([k, v]) => ({ ...statLine(k, v), key: k })),
    ...Object.entries(c.mult).map(([k, v]) => ({ text: `${v > 1 ? '+' : ''}${Math.round((v - 1) * 100)}% ${(STAT_LABELS[k] || k).replace(' %', '')}`, good: v > 1, key: k })),
  ];
  const wp = WEAPONS[c.weapon];
  const g = heroProgress(id, progress);
  const lock = locked
    ? `<div class="lockbar" data-tip-text="${esc(`To unlock ${c.name}: ${g.text}. Progress so far: ${progressText(id, progress)}. Progress is saved in this browser.`)}"><span class="lk">${LOCK_ICO}<b>Locked</b></span><span class="need">${esc(g.text)}</span>
        <span class="bar"><i style="width:${Math.round(g.frac * 100)}%"></i></span><span class="have">${esc(progressText(id, progress))}</span></div>`
    : '';
  return `<section class="detail ${locked ? 'is-locked' : ''} ${selected ? 'sel' : ''}" style="--hc:${c.color}" data-char="${id}">
    <div class="dstage"><img class="${locked ? 'sil' : ''}" src="${SPR(`h_${id}`)}" alt=""></div>
    <div class="dmain">
      <div class="dtitle"><b class="nm">${esc(c.name)}</b><span class="role">${esc(c.role)}</span>${locked ? '' : starsHtml(heroStars(id, progress))}${selected ? '<em class="yours">Your pick</em>' : ''}</div>
      <p class="blurb">${esc(c.blurb)}</p>
      <ul class="mods">${mods.map((m) => `<li class="${m.good ? 'good' : 'bad'}"${tip(m.key)}>${esc(m.text)}</li>`).join('')}</ul>
      <div class="startw" data-tip-text="${esc(`${c.name}'s first weapon. Weapons fire on their own at the nearest enemy; you can buy more in the shop between waves.`)}"><img src="assets/sprites/w_${c.weapon}.svg" alt="" onerror="this.remove()"><span>Starts with <b>${esc(wp?.name || c.weapon)}</b></span></div>
      ${picks.length ? `<div class="mates">${picks.map((p) => `<span style="--pc:${PLAYER_COLORS_CSS[p.id % 4]}">${esc(p.name)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="abil"${tip('ability')} data-tip-text="${esc(`${c.ability.name}: costs ${c.ability.cost} mana, ${c.ability.cooldown} second cooldown. ${c.ability.desc}`)}"><div class="ahead"><kbd>Space</kbd><b>${esc(c.ability.name)}</b></div>
      <div class="meta"><span class="mana">${c.ability.cost} mana</span><span>${c.ability.cooldown}s cooldown</span></div>
      <p>${esc(c.ability.desc)}</p></div>
    ${c.trait ? `<div class="abil trait"${tip('trait')}><div class="ahead"><kbd>Trait</kbd><b>${esc(c.trait.name)}</b></div><p>${esc(c.trait.desc)}</p></div>` : ''}
    ${lock}
  </section>`;
}

/** Keyboard shortcuts while the lobby is open: 1-9 and 0 pick a T-Rex (a locked one just shows its card), Enter starts (host) or readies (mate). */
function watchKeys(ui) {
  if (ui._lobbyKeys) return;
  ui._lobbyKeys = true;
  document.addEventListener('keydown', (e) => {
    if (ui.screen !== 'lobby' || ui.settingsOpen || ui.helpOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') { if (e.key === 'Enter' && e.target.id === 'name') e.target.blur(); return; }
    if (tag === 'BUTTON') return; // a focused button handles Enter itself
    const s = ui.app.session;
    if (!s) return;
    if (/^[0-9]$/.test(e.key)) {
      const id = CHARACTER_IDS[e.key === '0' ? 9 : +e.key - 1];
      if (id) ui.act('pick', { char: id });
    } else if (e.key === 'Enter' && !e.repeat) {
      const L = s.lobby();
      if (L.isHost) {
        const mates = L.players.filter((p) => p.id !== 0);
        if (s.solo || mates.every((p) => p.ready)) ui.act('start');
      } else if (!s.ready) ui.act('ready');
    }
  });
}

export const lobbyActions = {
  // Overrides the core `pick`: a hero this browser has not unlocked cannot be picked, its card is shown instead.
  pick: (ui, d) => {
    const s = ui.app.session;
    if (!s || !CHARACTERS[d.char]) return;
    if (!isUnlocked(d.char)) { ui.lookChar = d.char; return; }
    ui.lookChar = null;
    ui.app.settings.char = d.char;
    ui.app.saveSettings();
    s.pick(d.char);
  },
  look: (ui, d) => { if (CHARACTERS[d.char]) ui.lookChar = d.char; },
  // Host only. The choice is remembered for next time (app.settings.danger). A level nobody in the lobby has unlocked is refused.
  danger: (ui, d) => {
    const s = ui.app.session;
    if (!s || !s.isHost) return;
    const level = clampDanger(+d.d);
    if (level > lobbyMaxDanger(s.lobby())) { ui.toast?.(dangerUnlockText(level)); return; }
    s.setDanger(level);
    ui.app.settings.danger = level;
    ui.app.saveSettings();
  },
};
