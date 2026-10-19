// Title menu, "How to play" and the settings modal.

import { CHARACTER_IDS, CHARACTERS, STARTER_IDS } from '../data/characters.js';
import { PLAYER_COLORS_CSS } from '../render/art.js';
import { loadProgress, isUnlocked, heroProgress } from '../meta/unlocks.js';
import { esc } from './describe.js';
import { tip } from './tips.js';
import { nextGoals, challengesDone, CHALLENGE_COUNT, rewardInfo } from './collection.js';

const SPR = (key) => `assets/sprites/${key}.svg`;
const DEFAULT_NAMES = ['Rex', 'Chomp', 'Stompy', 'Nibbles', 'Rawr', 'Bonesy', 'Tiny', 'Mango', 'Pebble', 'Fangs'];
let pickedName = '';

/** A friendly name for players who have not typed one (same for the whole page load). */
export function defaultName() {
  if (!pickedName) pickedName = DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)];
  return pickedName;
}

/**
 * The small "Progress" panel on the menu: heroes unlocked, challenges done, lifetime stats, how close the nearest locked hero is
 * and the challenge that is closest to done. Reads this browser's progress (src/meta/unlocks.js); works with no storage.
 */
export function progressPanel(progress = loadProgress()) {
  const total = CHARACTER_IDS.length;
  const open = CHARACTER_IDS.filter((id) => isUnlocked(id, progress)).length;
  const t = progress.totals;
  const f = (v) => v.toLocaleString('en');
  // The locked hero that is closest to unlocking.
  let next = null;
  for (const id of CHARACTER_IDS) {
    if (isUnlocked(id, progress)) continue;
    const g = heroProgress(id, progress);
    if (!next || g.frac > next.g.frac) next = { id, g };
  }
  const chips = [
    ['Runs', t.runs, 'Runs you have finished in this browser, won or lost.'],
    ['Wins', t.wins, 'Runs you won by surviving all 20 waves. Winning a run unlocks Ash.'],
    ['Best wave', t.bestWave, 'The furthest wave you have reached in any run. Reaching wave 10 unlocks Pip.'],
    ['Kills', t.kills, 'Enemies you have defeated across all runs. Killing 2,000 unlocks Bolt.'],
    ['Amber', t.amber, 'Amber you have collected across all runs. Collecting 1,500 unlocks Goldie.'],
  ].map(([k, v, hint]) => `<span data-tip-text="${esc(hint)}"><b>${f(v)}</b> ${k}</span>`).join('');
  // The unfinished challenge that is closest to done, with the reward waiting.
  const goal = nextGoals(progress, 1)[0];
  const goalHtml = goal
    ? `<span class="pnext" data-tip-text="${esc(`${goal.c.name}: ${goal.c.desc}. Finishing it unlocks ${rewardInfo(goal.c.reward).name}.`)}">Next goal: <b>${esc(goal.c.name)}</b> · ${esc(goal.c.desc)} · ${f(goal.state.have)}/${f(goal.state.target)}</span>`
    : '<span class="pnext">Every challenge done</span>';
  const owned = Math.max(0, total - STARTER_IDS.length);
  return `<div class="progress" data-tip-text="Your progress is saved in this browser only. Heroes, items, weapons and Danger levels are unlocked by playing: no codes, no shop.">
    <div class="phead"><b data-tip-text="Heroes unlocked in this browser. The first ${STARTER_IDS.length} are always open; the other ${owned} are earned by playing.">Heroes ${open}/${total}</b>${next ? `<span class="pnext" data-tip-text="${esc(`${CHARACTERS[next.id].name} is the locked hero closest to unlocking: ${next.g.text} (${f(next.g.have)} of ${f(next.g.target)}).`)}">Next: <b>${esc(CHARACTERS[next.id].name)}</b> · ${esc(next.g.text)} (${f(next.g.have)}/${f(next.g.target)})</span>` : '<span class="pnext">Every hero unlocked</span>'}</div>
    <div class="phead pgoal"><b${tip('challenge')}>Challenges ${challengesDone(progress)}/${CHALLENGE_COUNT}</b>${goalHtml}</div>
    <div class="pstats">${chips}</div>
  </div>`;
}

export function menuScreen(ui) {
  const st = ui.app.settings;
  const progress = loadProgress();
  const shown = CHARACTER_IDS.filter((id) => isUnlocked(id, progress));
  return `<div class="center"><div class="panel menu">
    <div class="logo">TINY <span>ARMS</span></div>
    <p class="tag">Co-op dino survival for 1-4 mates</p>
    <div class="heroes" style="--n:${shown.length}">${shown.map((c, i) => `<figure style="--pc:${PLAYER_COLORS_CSS[i % 4]};--hc:${CHARACTERS[c].color};--i:${i}"><img src="${SPR(`h_${c}`)}" alt="${CHARACTERS[c].name}"><figcaption>${CHARACTERS[c].name}</figcaption></figure>`).join('')}</div>
    <label class="field namefield">Your name <input id="name" maxlength="16" value="${esc(st.name)}" placeholder="${esc(defaultName())}" autocomplete="off"></label>
    <button class="big go play" data-act="solo">Play solo</button>
    ${globalThis.TINY_ARMS_SOLO_ONLY
      ? '<p class="muted note">This copy is solo only: online co-op needs the shared game link.</p>'
      : `<div class="row twin">
      <button class="big" data-act="host">Host a game</button>
      <div class="joinbox"><input id="code" maxlength="5" placeholder="CODE" autocomplete="off" spellcheck="false"><button class="big" data-act="join">Join</button></div>
    </div>`}
    <div class="row links"><button class="chalbtn" data-act="collection"${tip('challenge')}>Challenges <b>${challengesDone(progress)}/${CHALLENGE_COUNT}</b></button><button class="ghost" data-act="help">How to play</button><button class="ghost" data-act="settings">Settings</button></div>
    ${progressPanel(progress)}
  </div></div>${ui.helpOpen ? howToPlayModal() : ''}`;
}

/** The "How to play" card. Opened from the menu or the lobby (ui.helpOpen). */
export function howToPlayModal() {
  const key = (k) => `<kbd>${k}</kbd>`;
  return `<div class="modal"><div class="backdrop" data-act="closeHelp"></div><div class="panel help">
    <h2>How to play</h2>
    <p class="muted goal">Survive 20 timed waves as a team. Dinosaurs come from every side.</p>
    <ul class="tips">
      <li><span class="ico">${key('W')}${key('A')}${key('S')}${key('D')}</span><div><b>Move</b>WASD or the arrow keys. Keep moving, stay out of the red warnings.</div></li>
      <li><span class="ico"><i class="gun"></i></span><div><b>Weapons fire on their own</b>They aim at the nearest enemy. You only steer.</div></li>
      <li><span class="ico">${key('Space')}</span><div><b>Mana ability</b>Every T-Rex has one. It costs mana and needs a short cooldown.</div></li>
      <li><span class="ico">${key('Shift')}</span><div><b>Dodge roll</b>A quick dive the way you're moving, with a moment of invulnerability. 4 s cooldown.</div></li>
      <li><span class="ico">&#129413;</span><div><b>Stick together</b>Each mate within a short distance gives you +8% damage and +1 armor (up to 3). Green lines show who is linked.</div></li>
      <li><span class="ico"><i class="gem"></i></span><div><b>Collect amber</b>Walk over the drops, then spend it in the shop between waves.</div></li>
      <li><span class="ico"><i class="plus"></i></span><div><b>Revive your mates</b>Stand next to a downed T-Rex for about 3 seconds. The run ends only when everyone is down at once.</div></li>
      <li><span class="ico">${key('Esc')}</span><div><b>Settings</b>The game never pauses in co-op, so pick a quiet moment.</div></li>
    </ul>
    <div class="row"><button class="go" data-act="closeHelp">Got it</button></div>
  </div></div>`;
}

export function settingsModal(ui) {
  const st = ui.app.settings;
  const s = ui.app.session;
  const inRun = !!s && ['wave', 'shop'].includes(s.phase());
  return `<div class="modal"><div class="backdrop" data-act="closeSettings"></div><div class="panel small settings">
    <h2>Settings</h2>
    <label class="slider">Sound <span class="val">${Math.round(st.volume * 100)}%</span>
      <input id="volume" type="range" min="0" max="1" step="0.05" value="${st.volume}" oninput="this.previousElementSibling.textContent=Math.round(this.value*100)+'%'"></label>
    <label class="slider">Music <span class="val">${Math.round((st.music ?? 0.4) * 100)}%</span>
      <input id="music" type="range" min="0" max="1" step="0.05" value="${st.music ?? 0.4}" oninput="this.previousElementSibling.textContent=Math.round(this.value*100)+'%'"></label>
    <label class="check"><input id="shake" type="checkbox" ${st.shake ? 'checked' : ''}> <span>Screen shake</span></label>
    ${inRun ? `<p class="muted note">${s.solo ? 'Paused.' : 'The game keeps running while this is open.'}</p>` : ''}
    <div class="row"><button class="go" data-act="closeSettings">${s ? 'Resume' : 'Close'}</button>${s ? '<button data-act="menu">Leave game</button>' : ''}</div>
  </div></div>`;
}

/** Click actions handled by this screen: act -> (ui, dataset) => void */
export const menuActions = {
  settings: (ui) => { ui.settingsOpen = true; },
  help: (ui) => { ui.helpOpen = true; },
  closeHelp: (ui) => { ui.helpOpen = false; },
};
