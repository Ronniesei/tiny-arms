// Lobby: room code and invite link, the four player slots, character cards, ready / start.

import { CHARACTERS, CHARACTER_IDS } from '../data/characters.js';
import { DANGER, clampDanger } from '../data/danger.js';
import { WEAPONS } from '../data/weapons.js';
import { STAT_LABELS } from '../sim/stats.js';
import { PLAYER_COLORS_CSS } from '../render/art.js';
import { esc, statLine } from './describe.js';
import { howToPlayModal, defaultName } from './menu.js';

const SPR = (key) => `assets/sprites/${key}.svg`;
const SLOTS = 4;

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
      <p class="pickhead">Pick your T-Rex <small>keys 1-4</small></p>
      <div class="chars">${CHARACTER_IDS.map((id, i) => charCard(id, me.char === id, i, L.players.filter((p) => p.char === id && p.id !== L.myId))).join('')}</div>
    </div>
    <footer class="lfoot">
      <p class="status">${esc(status)}</p>
      <div class="acts">${action}<button class="ghost" data-act="help">How to play</button><button data-act="menu">Leave</button></div>
    </footer>
  </div></div>${ui.helpOpen ? howToPlayModal() : ''}`;
}

const pctText = (m) => `${m >= 1 ? '+' : '-'}${Math.round(Math.abs(m - 1) * 100)}%`;

/** Chips for a danger level, built from its numbers so a data edit shows up here. */
function dangerChips(D) {
  if (D.hp === 1 && D.dmg === 1 && D.bossHp === 1 && !D.extraElites.length) return 'Base game';
  return `HP ${pctText(D.hp)} · DMG ${pctText(D.dmg)}`;
}

/** The 4-button danger selector: clickable for the host, read-only for mates. */
function dangerPicker(L) {
  const cur = clampDanger(L.danger);
  const cards = DANGER.map((D) => {
    const sel = D.id === cur;
    const inner = `<span class="dtop"><b>${esc(D.name)}</b><em>${esc(dangerChips(D))}</em></span><span class="ddesc">${esc(D.desc)}</span>`;
    return L.isHost
      ? `<button class="dg d${D.id} ${sel ? 'sel' : ''}" data-act="danger" data-d="${D.id}" role="radio" aria-checked="${sel}">${inner}</button>`
      : `<div class="dg d${D.id} ro ${sel ? 'sel' : ''}" role="radio" aria-checked="${sel}">${inner}</div>`;
  }).join('');
  return `<div class="danger" role="radiogroup" aria-label="Danger level">
    <p class="dlabel">Danger <small>${L.isHost ? 'you choose for the whole team' : 'chosen by the host'}</small></p>
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

export function charCard(id, selected, index = 0, picks = []) {
  const c = CHARACTERS[id];
  const mods = [
    ...Object.entries(c.stats).map(([k, v]) => statLine(k, v)),
    ...Object.entries(c.mult).map(([k, v]) => ({ text: `${v > 1 ? '+' : ''}${Math.round((v - 1) * 100)}% ${(STAT_LABELS[k] || k).replace(' %', '')}`, good: v > 1 })),
  ];
  const wp = WEAPONS[c.weapon];
  return `<button class="char ${selected ? 'sel' : ''}" data-act="pick" data-char="${id}" aria-pressed="${selected}" style="--hc:${c.color}">
    <kbd class="num">${index + 1}</kbd>
    <span class="chosen">${selected ? 'Your pick' : ''}</span>
    <span class="stage"><img src="${SPR(`h_${id}`)}" alt=""></span>
    <b class="nm">${c.name}</b><span class="role">${c.role}</span>
    <p class="blurb">${esc(c.blurb)}</p>
    <div class="abil"><div class="ahead"><kbd>Space</kbd><b>${esc(c.ability.name)}</b></div>
      <div class="meta"><span class="mana">${c.ability.cost} mana</span><span>${c.ability.cooldown}s cooldown</span></div>
      <p>${esc(c.ability.desc)}</p></div>
    ${c.trait ? `<div class="abil trait"><div class="ahead"><kbd>Trait</kbd><b>${esc(c.trait.name)}</b></div><p>${esc(c.trait.desc)}</p></div>` : ''}
    <ul class="mods">${mods.map((m) => `<li class="${m.good ? 'good' : 'bad'}">${esc(m.text)}</li>`).join('')}</ul>
    <div class="startw"><img src="assets/sprites/w_${c.weapon}.svg" alt="" onerror="this.remove()"><span>Starts with <b>${esc(wp?.name || c.weapon)}</b></span></div>
    ${picks.length ? `<div class="mates">${picks.map((p) => `<span style="--pc:${PLAYER_COLORS_CSS[p.id % 4]}">${esc(p.name)}</span>`).join('')}</div>` : ''}
  </button>`;
}

/** Keyboard shortcuts while the lobby is open: 1-4 pick a T-Rex, Enter starts (host) or readies (mate). */
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
    if (/^[1-4]$/.test(e.key)) {
      const id = CHARACTER_IDS[+e.key - 1];
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
  // Host only. The choice is remembered for next time (app.settings.danger).
  danger: (ui, d) => {
    const s = ui.app.session;
    if (!s || !s.isHost) return;
    const level = clampDanger(+d.d);
    s.setDanger(level);
    ui.app.settings.danger = level;
    ui.app.saveSettings();
  },
};
