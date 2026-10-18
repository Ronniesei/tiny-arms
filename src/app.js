// App controller: owns the session (host/client/solo), the main loop, input, bots and settings.
// The loop runs on requestAnimationFrame, and on a worker timer while the tab is hidden so a
// host keeps simulating in a background tab.

import { HostSession } from './net/host.js';
import { ClientSession } from './net/client.js';
import { makeRoomCode } from './net/transport.js';
import { Keyboard } from './input.js';
import { botInput, botShopOp, createBotState } from './sim/bot.js';

const SETTINGS_KEY = 'tinyarms.settings';

export class App {
  constructor(params) {
    this.params = params;
    this.keys = new Keyboard();
    this.session = null;
    this.errors = [];
    this.fpsVal = 60;
    this.last = performance.now();
    this.listeners = [];
    this.bot = params.bot ? createBotState() : null;
    this.botShopT = 0;
    this.settings = loadSettings();
  }

  onFrame(fn) { this.listeners.push(fn); }

  // ---- sessions ----

  async startSolo({ char, autoStart = false } = {}) {
    this.endSession();
    const s = new HostSession({
      code: 'SOLO', name: this.settings.name, char: char || this.params.char || this.settings.char,
      solo: true, speed: this.params.speed, seed: this.params.seed, startWave: this.params.wave,
    });
    this.session = s;
    await s.open();
    if (autoStart) s.startRun();
    return s;
  }

  async host(code) {
    this.endSession();
    const s = new HostSession({
      code: code || makeRoomCode(), name: this.settings.name, char: this.params.char || this.settings.char,
      local: this.params.local, speed: this.params.speed, seed: this.params.seed, startWave: this.params.wave,
    });
    this.session = s;
    await s.open();
    return s;
  }

  async join(code) {
    this.endSession();
    const s = new ClientSession({ code: code.toUpperCase().trim(), name: this.settings.name, char: this.params.char || this.settings.char, local: this.params.local });
    this.session = s;
    await s.open();
    return s;
  }

  endSession() {
    if (this.session) this.session.leave();
    this.session = null;
  }

  // ---- loop ----

  start() {
    this.lastRaf = performance.now();
    const frame = (now) => { this.lastRaf = performance.now(); this.tick(now, true); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    try {
      // Browsers stop animation frames for background tabs; a worker timer keeps the host simulating.
      const src = 'setInterval(() => postMessage(0), 16);';
      this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this.worker.onmessage = () => {
        const now = performance.now();
        if (now - this.lastRaf > 100) this.tick(now);
      };
    } catch (e) { /* no worker: background tabs just pause */ }
  }

  tick(now, fromFrame = false) {
    const dt = Math.min(250, now - this.last);
    if (dt <= 0) return;
    this.last = now;
    if (fromFrame && dt >= 4) this.fpsVal = this.fpsVal * 0.95 + (1000 / dt) * 0.05;
    const s = this.session;
    if (s) {
      try {
        s.setInput(this.readInput(s));
        // Solo runs pause while the settings panel is open (co-op can't pause for everyone).
        if (!(s.solo && this.ui?.settingsOpen)) s.update(dt);
        if (this.bot) this.botShop(s, dt);
      } catch (e) {
        this.recordError(e);
      }
    }
    for (const fn of this.listeners) {
      try { fn(dt); } catch (e) { this.recordError(e); }
    }
  }

  readInput(s) {
    if (!this.bot) return this.keys.read();
    const v = s.view();
    if (!v || v.phase !== 'wave') return { mx: 0, my: 0, ab: this.bot.ab };
    return botInput(v, s.myId, this.bot, performance.now() / 1000);
  }

  botShop(s, dt) {
    if (s.phase() !== 'shop') return;
    this.botShopT -= dt;
    if (this.botShopT > 0) return;
    this.botShopT = 300;
    const me = s.me();
    if (!me || me.phase !== 'shop') return;
    const op = botShopOp(me);
    if (op) s.shopOp(op);
    else if (!me.ready) s.shopOp({ op: 'ready', value: true });
  }

  recordError(e) {
    const msg = String(e && (e.stack || e.message || e));
    if (this.errors.length < 50) this.errors.push(msg);
    console.error(e);
  }

  saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (e) { /* private mode */ }
  }
}

function loadSettings() {
  const d = { name: '', char: 'spike', volume: 0.7, music: 0.4, shake: true };
  try { return { ...d, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (e) { return d; }
}
