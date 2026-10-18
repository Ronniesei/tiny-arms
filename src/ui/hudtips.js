// Invisible hover areas over the in-game HUD (which is drawn on the canvas), so the HUD explains itself
// too. Positions follow src/render/hud.js layout (1920x1080 design space) and are mapped onto the canvas.

import { CHARACTERS } from '../data/characters.js';

// Design-space boxes [x, y, w, h] (keep in step with PAD / AB in src/render/hud.js).
const SPOTS = [
  { box: [20, 20, 384, 56], gloss: 'maxHp', text: 'Your HP bar. At 0 you go down (in co-op a mate can revive you).' },
  { box: [20, 76, 384, 40], gloss: 'mana' },
  { box: [20, 116, 200, 50], gloss: 'amber' },
  { box: [220, 116, 184, 50], gloss: 'xp' },
  { box: [20, 186, 420, 32], gloss: 'herd' },
  { box: [810, 20, 300, 130], text: 'Wave and time left. Survive until the timer hits 0; each wave builds to a rush at the end. Wave 20 is the boss.' },
  { box: [960 - 66, 940 - 66, 132, 150], ability: true },
  { box: [1090 - 38, 948 - 38, 76, 100], gloss: 'roll' },
];

export class HudTips {
  constructor(app) {
    this.app = app;
    this.layer = null;
    this.rectKey = '';
  }

  ensure() {
    if (this.layer) return;
    const layer = document.createElement('div');
    layer.id = 'hudtips';
    for (const s of SPOTS) {
      const d = document.createElement('div');
      if (s.gloss) d.setAttribute('data-gloss', s.gloss);
      if (s.text) d.setAttribute('data-tip-text', s.text);
      if (s.ability) d.className = 'ability';
      d.dataset.box = s.box.join(',');
      layer.appendChild(d);
    }
    document.body.appendChild(layer);
    this.layer = layer;
  }

  /** Call every frame: shows the spots only during a wave and keeps them on top of the canvas. */
  update(show) {
    if (!show) { if (this.layer) this.layer.style.display = 'none'; return; }
    this.ensure();
    this.layer.style.display = '';
    const canvas = document.querySelector('#game canvas');
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const key = `${r.left},${r.top},${r.width},${r.height}`;
    if (key !== this.rectKey) {
      this.rectKey = key;
      const k = r.width / 1920;
      for (const d of this.layer.children) {
        const [x, y, w, h] = d.dataset.box.split(',').map(Number);
        Object.assign(d.style, { left: `${r.left + x * k}px`, top: `${r.top + y * k}px`, width: `${w * k}px`, height: `${h * k}px` });
      }
    }
    // The ability spot describes this player's own ability.
    const s = this.app.session;
    const me = s?.view?.()?.players.find((p) => p.id === s.myId);
    const c = me && CHARACTERS[me.char];
    const ab = this.layer.querySelector('.ability');
    if (c && ab && ab.dataset.char !== c.id) {
      ab.dataset.char = c.id;
      ab.setAttribute('data-tip-text', `${c.ability.name} (Space): ${c.ability.desc} Costs ${c.ability.cost} mana, ${c.ability.cooldown} s cooldown.${c.trait ? `\nTrait, ${c.trait.name}: ${c.trait.desc}` : ''}`);
    }
  }
}
