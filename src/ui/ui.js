// DOM UI router over the Phaser canvas. Picks the screen from the session phase, re-renders a
// screen only when its data changes, and routes clicks (data-act) to the screen modules.
// Screens: menu.js (menu + settings), collection.js (Challenges / Heroes / Danger, opened from the menu), lobby.js,
// shop.js (level-ups + shop), end.js.

import { sfx } from '../audio/sfx.js';
import { esc } from './describe.js';
import { installTips } from './tips.js';
import { HudTips } from './hudtips.js';
import { menuScreen, settingsModal, menuActions } from './menu.js';
import { lobbyScreen, lobbyActions } from './lobby.js';
import { shopScreen, shopActions } from './shop.js';
import { endScreen, endActions } from './end.js';
import { collectionScreen, collectionActions } from './collection.js';

export class UI {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.screen = '';
    this.key = '';
    this.settingsOpen = false;
    this.collectionTab = '';   // '' = closed; 'challenges' | 'heroes' | 'danger' = the Challenges screen is open (no session)
    this.toastT = null;
    this.actions = { ...this.coreActions(), ...menuActions, ...collectionActions, ...lobbyActions, ...shopActions, ...endActions };
    // Buttons act on mouse-down, so a re-render between press and release (a mate readying up,
    // a network update) can never swallow a click. Keyboard "clicks" (detail 0) still work.
    root.addEventListener('pointerdown', (e) => { if (e.button === 0) this.onClick(e); });
    root.addEventListener('click', (e) => { if (e.detail === 0) this.onClick(e); });
    root.addEventListener('input', (e) => this.onInput(e));
    root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'code') this.act('join'); });
    app.keys.onEscape = () => {
      // On the Challenges screen Esc goes back to the menu (settings are one click away there); anywhere else it toggles settings.
      if (this.screen === 'collection' && !this.settingsOpen) this.collectionTab = '';
      else this.settingsOpen = !this.settingsOpen;
      this.key = '';
    };
    this.hudTips = new HudTips(app);
    app.onFrame(() => { this.update(); this.hudTips.update(this.screen === 'game'); });
    installTips();
    sfx.setVolume(app.settings.volume);
  }

  screenFor() {
    const s = this.app.session;
    if (!s) return this.collectionTab ? 'collection' : 'menu';
    const ph = s.phase();
    if (ph === 'connecting') return 'connecting';
    if (ph === 'error') return 'error';
    if (ph === 'lobby') return 'lobby';
    if (ph === 'wave') return 'game';
    if (ph === 'shop') return 'shop';
    if (ph === 'end') return 'end';
    return 'menu';
  }

  update() {
    const screen = this.screenFor();
    const s = this.app.session;
    let data = '';
    if (screen === 'lobby') data = JSON.stringify(s.lobby());
    else if (screen === 'shop') {
      // Re-render only when the shop data changes. The countdown changes every frame, so it is left out
      // of the key and updated in place below (re-rendering destroys buttons mid-click).
      const me = s.me();
      data = JSON.stringify(me ? { ...me, shopTime: 0 } : null);
      const t = this.root.querySelector('[data-shop-timer]');
      if (t) {
        const txt = String(Math.max(0, Math.ceil(s.view()?.shopTime ?? me?.shopTime ?? 0)));
        if (t.textContent !== txt) t.textContent = txt;
      }
    }
    else if (screen === 'end') data = JSON.stringify(s.me()?.result || s.world?.result || null);
    else if (screen === 'error') data = s.error;
    else if (screen === 'collection') data = this.collectionTab;
    this.netWarning(screen === 'game' || screen === 'shop' ? !!s?.stalled : false);
    const key = `${screen}|${data}|${this.settingsOpen}`;
    if (key === this.key) return;
    this.screen = screen;
    this.key = key;
    this.render(screen);
  }

  /** A small banner while the host has gone quiet (client.js watchdog); kept outside the screen so re-renders keep it. */
  netWarning(on) {
    let el = document.getElementById('netwarn');
    if (!on) { if (el) el.hidden = true; return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'netwarn';
      el.textContent = 'Connection trouble: waiting for the host…';
      document.body.appendChild(el);
    }
    el.hidden = false;
  }

  render(screen) {
    const active = document.activeElement;
    const focusId = active && this.root.contains(active) ? active.id : null;
    const caret = focusId && active.selectionStart;
    let html = '';
    if (screen === 'menu') html = menuScreen(this);
    else if (screen === 'collection') html = collectionScreen(this);
    else if (screen === 'connecting') html = `<div class="center"><div class="panel small"><h2>Connecting…</h2><p>Finding the herd.</p><button data-act="menu">Cancel</button></div></div>`;
    else if (screen === 'error') {
      const s = this.app.session;
      html = `<div class="center"><div class="panel small"><h2>${s.canRejoin ? 'Connection lost' : 'Oops'}</h2><p>${esc(s.error || 'Something went wrong')}</p><div class="row">${s.canRejoin ? '<button class="go" data-act="rejoin">Rejoin</button>' : ''}<button data-act="menu">Back to menu</button></div></div></div>`;
    }
    else if (screen === 'lobby') html = lobbyScreen(this);
    else if (screen === 'shop') html = shopScreen(this);
    else if (screen === 'end') html = endScreen(this);
    if (this.settingsOpen) html += settingsModal(this);
    this.root.innerHTML = html;
    this.root.className = `screen-${screen}`;
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) { el.focus(); if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret); }
    }
  }

  onInput(e) {
    const t = e.target;
    const st = this.app.settings;
    if (t.id === 'name') {
      st.name = t.value.slice(0, 16);
      this.app.saveSettings();
      this.app.session?.setName?.(st.name || 'Rex');
    } else if (t.id === 'volume') {
      st.volume = +t.value; sfx.setVolume(st.volume); this.app.saveSettings();
    } else if (t.id === 'music') {
      st.music = +t.value; this.app.saveSettings();
    } else if (t.id === 'shake') {
      st.shake = t.checked; this.app.saveSettings();
    } else if (t.id === 'code') {
      t.value = t.value.toUpperCase();
    }
  }

  onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    sfx.ensure();
    this.act(b.dataset.act, b.dataset);
  }

  async act(act, d = {}) {
    sfx.play('click');
    const fn = this.actions[act];
    if (fn) await fn(this, d);
    this.key = '';
  }

  /** Actions shared by several screens (sessions, navigation, settings). */
  coreActions() {
    return {
      solo: (ui) => ui.app.startSolo({}),
      host: (ui) => ui.app.host(),
      join: (ui) => {
        const code = (document.getElementById('code')?.value || '').trim();
        if (code.length < 4) { ui.toast('Enter the room code first'); return null; }
        return ui.app.join(code);
      },
      copy: async (ui, d) => {
        try { await navigator.clipboard.writeText(d.link); ui.toast('Invite link copied'); } catch (err) { ui.toast(d.link); }
      },
      pick: (ui, d) => { ui.app.settings.char = d.char; ui.app.saveSettings(); ui.app.session.pick(d.char); },
      ready: (ui) => ui.app.session.setReady(!ui.app.session.ready),
      start: (ui) => ui.app.session.startRun(),
      menu: (ui) => { ui.app.endSession(); ui.settingsOpen = false; ui.collectionTab = ''; history.replaceState(null, '', location.pathname); },
      again: (ui) => ui.app.session.playAgain(),
      rejoin: (ui) => ui.app.join(ui.app.session.code), // the host gives a dropped mate their slot back
      closeSettings: (ui) => { ui.settingsOpen = false; },
    };
  }

  /** Send a shop op; toast the reason if it fails. */
  shopOp(op, sound) {
    const res = this.app.session.shopOp(op);
    if (res && res.ok === false) { this.toast(res.msg || 'Not possible'); sfx.play('nope'); }
    else if (sound) sfx.play(sound);
  }

  toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'show';
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => { t.className = ''; }, 1800);
  }
}
