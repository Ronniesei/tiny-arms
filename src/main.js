// Boot: read URL parameters, create the App, the Phaser game and the DOM UI, expose window.__game.
//
// URL parameters (test hooks):
//   ?solo=1  ?char=spike  ?bot=1  ?seed=123  ?wave=10  ?speed=3  ?debug=1  ?danger=0..3
//   (?solo=1, ?bot=1 and ?wave=N each skip the menu and lobby and start a solo run; ?danger=N picks the danger level,
//    default 1 Normal for those auto-started runs and the lobby's remembered choice otherwise)
//   ?host=1&room=TEST1   ?join=TEST1   &local=1 (BroadcastChannel instead of PeerJS, same browser only)
//   ?unlockall=1  every hero is pickable (progress is still recorded; heroes are normally unlocked in src/meta/unlocks.js)

import { App } from './app.js';
import { BootScene } from './render/BootScene.js';
import { GameScene } from './render/GameScene.js';
import { UI } from './ui/ui.js';
import { clampDanger, DEFAULT_DANGER } from './data/danger.js';
import * as unlocks from './meta/unlocks.js';

const q = new URLSearchParams(location.search);
const params = {
  solo: q.has('solo'),
  char: q.get('char') || null,
  bot: q.get('bot') === '1',
  seed: q.has('seed') ? +q.get('seed') : undefined,
  wave: q.has('wave') ? Math.max(1, Math.min(20, Math.round(+q.get('wave')) || 1)) : 1,
  danger: q.has('danger') ? clampDanger(+q.get('danger')) : undefined,
  speed: q.has('speed') ? Math.max(0.25, Math.min(8, +q.get('speed'))) : 1,
  debug: q.get('debug') === '1',
  host: q.has('host'),
  room: q.get('room') || null,
  join: q.get('join') || null,
  local: q.get('local') === '1',
};

if (q.get('unlockall') === '1') unlocks.setUnlockAll(true);
const app = new App(params);

addEventListener('error', (e) => app.recordError(e.error || e.message));
addEventListener('unhandledrejection', (e) => app.recordError(e.reason));

// Phaser text is drawn once into a canvas, so load the font before any text exists.
await Promise.race([
  Promise.all([document.fonts.load('600 20px Fredoka'), document.fonts.load('700 20px Fredoka')]),
  new Promise((r) => setTimeout(r, 1500)),
]).catch(() => {});

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1920,
  height: 1080,
  backgroundColor: '#b8a676',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, roundPixels: false },
  fps: { target: 60 },
  disableContextMenu: true,
  scene: [BootScene, GameScene],
});
game.registry.set('app', app);

const ui = new UI(app, document.getElementById('ui'));
app.ui = ui;
app.start();

// Auto-start from URL.
(async () => {
  if (params.join) { await app.join(params.join); }
  else if (params.host) {
    const s = await app.host(params.room || undefined);
    // An explicit ?danger= beats the lobby's remembered choice.
    if (params.danger !== undefined) { s.setDanger(params.danger); s._dangerOnce = true; }
  } else if (params.solo || params.bot || q.has('wave')) {
    // No lobby on this path: start straight away at ?danger= (Normal by default, so test runs are repeatable).
    const s = await app.startSolo({});
    s.setDanger(params.danger ?? DEFAULT_DANGER);
    s.startRun();
  }
})().catch((e) => app.recordError(e));

window.__game = {
  app,
  state: () => {
    const s = app.session;
    if (!s) return { screen: ui.screen };
    const v = s.view();
    const me = s.me();
    return {
      screen: ui.screen, phase: s.phase(), role: s.isHost ? 'host' : 'client', myId: s.myId,
      wave: v?.wave, timeLeft: v?.timeLeft, players: v?.players.map((p) => ({ id: p.id, char: p.char, hp: p.hp, maxHp: p.maxHp, x: Math.round(p.x), y: Math.round(p.y), downed: p.downed, amber: p.amber, level: p.level })),
      enemies: v?.enemies.length, projectiles: v?.projectiles.length, pickups: v?.pickups.length,
      amber: me?.amber, weapons: me?.weapons, items: me?.items?.length, result: me?.result || s.world?.result || null,
    };
  },
  fps: () => Math.round(app.fpsVal),
  errors: app.errors,
  net: () => app.session?.netStats() || null,
  shop: (op) => app.session?.shopOp(op),
  skipToShop: () => app.session?.skipToShop(),
  skipWave: () => app.session?.skipWave(),
  world: () => app.session?.world || null,
  unlocks,
};
