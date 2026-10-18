// In-game HUD (Phaser, screen space 1920x1080, drawn on its own camera).
// Reads only the view (`v`), the private view (`me`) and `app`; never touches the sim.
//
// Layout (all coordinates are screen pixels of the 1920x1080 HUD camera):
//   top-left      you: portrait, HP, mana, amber, level, XP bar
//   top-centre    wave and countdown (red in the last 5 s); on the boss wave the boss name and HP bar
//   top-right     allies: portrait, HP, DOWN and revive progress
//   bottom-centre ability button: icon, cooldown sweep, mana cost, SPACE key
//   screen edge   arrows to allies who are off screen (pulsing red when the ally is down); red skull arrows to an
//                 elite or the boss that is off screen
//   full screen   low-HP / hurt vignette, wave start and clear banners, red "elite / boss incoming" banner with a
//                 red edge pulse (events eliteSpawn / bossSpawn), debug overlay (?debug=1)

import { CHARACTERS } from '../data/characters.js';
import { ENEMIES } from '../data/enemies.js';
import { BALANCE } from '../data/balance.js';
import { eliteWaves } from '../data/danger.js';
import { PLAYER_COLORS } from './art.js';

const W = 1920, H = 1080;
const FONT = 'Fredoka, "Trebuchet MS", sans-serif';
const DARK = 0x2b2118, DARKER = 0x140e0a;
const CREAM = '#fff4dc', RED = '#ff7a6a', GREEN = '#7dff6a', AMBER = '#ffb627', BLUE = '#8cc0ff';
const ALLY_SLOTS = 3;
const THREAT_SLOTS = 2;   // off-screen arrows to elites / the boss

const PAD = { x: 20, y: 20, w: 384, h: 166 };      // my panel
const AB = { x: 960, y: 940, r: 58 };               // ability button
const ZONE = { mx: 86, my: 86 };                    // arrow inset from the screen edge

const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const hexNum = (css) => parseInt(String(css).replace('#', ''), 16) || 0xffffff;
const mix = (a, b, k) => {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(lerp(ar, br, k)) << 16) | (Math.round(lerp(ag, bg, k)) << 8) | Math.round(lerp(ab, bb, k));
};

/** Set text and colour only when they change (changing a Phaser text style redraws its canvas). */
function put(t, str, color) {
  if (color && t._col !== color) { t.setColor(color); t._col = color; }
  t.setText(str);
  return t;
}

function makeVignette(scene) {
  if (scene.textures.exists('hud_vignette')) return;
  const tex = scene.textures.createCanvas('hud_vignette', 320, 180);
  const ctx = tex.getContext();
  const grad = ctx.createRadialGradient(160, 90, 40, 160, 90, 200);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 320, 180);
  tex.refresh();
}

export class Hud {
  constructor(scene, layer) {
    this.scene = scene;
    this.layer = layer;
    this.t = 0;
    this.isShown = null;
    this.bannerT = 0;
    this.bannerTone = 'gold';
    this.alertT = 0;      // red edge pulse after an elite / boss arrives
    this.alertDur = 1;
    this.hurtT = 0;
    this.lvUpT = 0;
    this.amberPop = 0;
    this.hpTrail = 1;
    this.bossTrail = 1;
    this.lastChar = '';
    this.shown = []; // objects that only exist during a wave
    const add = (o, always = false) => { layer.add(o); if (!always) this.shown.push(o); return o; };
    this.add = add;
    const txt = (x, y, size, color = CREAM, origin = [0.5, 0.5], always = false) => {
      const t = scene.add.text(x, y, '', {
        fontFamily: FONT, fontStyle: 'bold', fontSize: `${size}px`, color,
        stroke: '#2b2118', strokeThickness: Math.max(4, Math.round(size / 5)),
      }).setOrigin(...origin);
      t._col = color;
      return add(t, always);
    };
    const img = (key, size) => add(scene.add.image(0, 0, key).setDisplaySize(size, size));

    makeVignette(scene);
    this.vig = add(scene.add.image(W / 2, H / 2, 'hud_vignette').setDisplaySize(W, H).setAlpha(0).setTint(0xff2a1a));
    this.g = add(scene.add.graphics());
    // Images sit above the first Graphics (panels, bars) and below the second (overlays).
    this.portrait = img('h_spike', 104);
    this.amberIcon = img('amber', 36);
    this.allyPortraits = Array.from({ length: ALLY_SLOTS }, () => img('h_spike', 54));
    this.arrowPortraits = Array.from({ length: ALLY_SLOTS }, () => img('h_spike', 40));
    this.g2 = add(scene.add.graphics());

    this.hpText = txt(PAD.x + 144 + 114, 58, 25);
    this.manaText = txt(PAD.x + 144 + 114, 98, 19);
    this.amberText = txt(204, 136, 30, AMBER, [0, 0.5]);
    this.levelText = txt(392, 136, 24, CREAM, [1, 0.5]);
    this.herdText = txt(PAD.x + 6, PAD.y + PAD.h + 18, 19, '#7dff6a', [0, 0.5]);
    this.waveText = txt(960, 44, 26);
    this.timerText = txt(960, 100, 68);
    this.bossName = txt(960, 76, 30, '#ff9a8a');
    this.bossHpText = txt(960, 110, 20);
    this.abName = txt(AB.x, 1048, 22);
    this.abKey = txt(AB.x, AB.y + AB.r + 12, 16, '#2b2118');
    this.abKey.setStroke('#2b2118', 0);
    this.abCd = txt(AB.x, AB.y, 40);
    this.abCost = txt(AB.x + 42, AB.y + 42, 17);
    this.rollKey = txt(AB.x + 130, AB.y + 46, 15);
    this.downTitle = txt(960, 790, 44, RED);
    this.downSub = txt(960, 836, 24);
    this.allyNames = Array.from({ length: ALLY_SLOTS }, () => txt(0, 0, 22, CREAM, [0, 0]));
    this.allyTags = Array.from({ length: ALLY_SLOTS }, () => txt(0, 0, 18, CREAM, [1, 0.5]));
    this.arrowLabels = Array.from({ length: ALLY_SLOTS }, () => txt(0, 0, 18));
    this.threatLabels = Array.from({ length: THREAT_SLOTS }, () => txt(0, 0, 18, '#ff9a8a'));

    this.gBand = add(scene.add.graphics(), true);
    this.banner = txt(960, 330, 92, '#ffd23a', [0.5, 0.5], true).setAlpha(0);
    this.subBanner = txt(960, 414, 36, CREAM, [0.5, 0.5], true).setAlpha(0);
    this.debugText = add(scene.add.text(12, 1068, '', { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff', backgroundColor: '#00000099', padding: { x: 6, y: 4 } }).setOrigin(0, 1), true);
    if (new URLSearchParams(location.search).get('debug') === '1') window.__hud = this; // test hook: __hud.scene.game.renderer.snapshot(...)
  }

  // ---- events ----

  /** tone 'red' is the elite / boss alarm: red bars, red sub-line, a little longer on screen. */
  showBanner(text, sub = '', color = '#ffd23a', tone = 'gold') {
    put(this.banner, text, color);
    put(this.subBanner, sub, tone === 'red' ? RED : CREAM);
    this.bannerTone = tone;
    this.bannerT = tone === 'red' ? 3 : 2.4;
    this.bannerAge = 0;
  }

  onEvent(ev, v, myId) {
    if (ev.type === 'waveStart') {
      const last = ev.wave === BALANCE.waves.count;
      const elite = eliteWaves(this.scene.app?.session?.danger).includes(ev.wave);
      this.showBanner(`WAVE ${ev.wave}`, last ? 'The boss is coming!' : elite ? 'An elite is on the way. Survive!' : 'Survive!', last ? '#ff7a6a' : '#ffd23a');
      this.hpTrail = 1;
      this.alertT = 0;
    } else if (ev.type === 'eliteSpawn' || ev.type === 'bossSpawn') {
      const boss = ev.type === 'bossSpawn';
      const name = (ENEMIES[ev.et]?.name || (boss ? 'Boss' : 'Elite')).toUpperCase();
      this.showBanner(boss ? `THE ${name}!` : `${name} INCOMING!`, boss ? 'BOSS FIGHT! Keep moving and stay out of the red.' : 'ELITE! Keep moving and stay out of the red.', '#ff5a4a', 'red');
      this.alertDur = this.alertT = boss ? 2.4 : 1.8;
    } else if (ev.type === 'bossPhase') {
      this.showBanner(ev.phase >= 3 ? 'LAST STAND!' : "IT'S ANGRY NOW!", ev.phase >= 3 ? 'Ground slams incoming: watch the red circles' : 'Spit fans and double charges', '#ff5a4a', 'red');
      this.alertDur = this.alertT = 1.6;
    } else if (ev.type === 'elitePhase') {
      this.showBanner('ENRAGED!', 'It pounces now: watch for the red circle', '#ff5a4a', 'red');
      this.alertDur = this.alertT = 1.4;
    } else if (ev.type === 'left') {
      this.showBanner(`${ev.name} LEFT`, 'Their T-Rex leaves the herd in a few seconds', '#ffd23a');
    } else if (ev.type === 'waveEnd') {
      this.showBanner('WAVE CLEARED!', 'On to the shop', GREEN);
    } else if (ev.type === 'phit' && ev.pid === myId) {
      this.hurtT = 0.32;
    } else if (ev.type === 'levelUp' && ev.pid === myId) {
      this.lvUpT = 0.9;
    } else if (ev.type === 'pickup' && ev.pid === myId && ev.kind === 'amber') {
      this.amberPop = 1;
    }
  }

  // ---- frame ----

  update(v, me, app, dms) {
    this.updateBanner(Math.min(0.1, dms / 1000));
    // Redrawing every panel and bar is the HUD's main cost at peak load, so do it at most 30 times
    // a second (bars and arrows look the same); banners above still animate every frame.
    this.pending = (this.pending || 0) + dms;
    const showNow = !!v && v.phase === 'wave';
    if (this.pending < 33 && showNow === this.isShown) return;
    const dt = Math.min(0.1, this.pending / 1000);
    this.pending = 0;
    this.t += dt;
    this.g.clear();
    this.g2.clear();
    this.debug(v, app);

    const show = !!v && v.phase === 'wave';
    if (show !== this.isShown) {
      this.isShown = show;
      for (const o of this.shown) o.setVisible(show);
    }
    if (!show) return;

    const myId = app.session.myId;
    const p = v.players.find((q) => q.id === myId);
    if (!p) return;
    const col = PLAYER_COLORS[p.id % 4];

    this.drawVignette(p, dt);
    this.drawMine(p, me, col, dt);
    this.drawWave(v);
    this.drawAbility(p);
    this.drawRoll(p);
    this.drawAllies(v, myId);
    this.drawArrows(v, myId);
    this.drawThreats(v, myId);
    this.drawDown(v, p, myId);
  }

  // ---- pieces ----

  drawVignette(p, dt) {
    this.hurtT = Math.max(0, this.hurtT - dt);
    const frac = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    let a = 0;
    if (p.downed) a = 0.5;
    else if (frac < 0.3) {
      const k = 1 - frac / 0.3;
      const beat = 0.5 + 0.5 * Math.sin(this.t * (5 + 4 * k));
      a = (0.3 + 0.5 * k) * (0.35 + 0.65 * beat);
    }
    a = Math.max(a, (this.hurtT / 0.32) * 0.5);
    if (this.alertT > 0) {
      // Elite / boss arrival: a fast red pulse round the screen edge that fades out.
      this.alertT = Math.max(0, this.alertT - dt);
      const beat = 0.5 + 0.5 * Math.sin(this.t * 13);
      a = Math.max(a, 0.8 * clamp01(this.alertT / this.alertDur) * (0.35 + 0.65 * beat));
    }
    this.vig.setAlpha(clamp01(a));
  }

  drawMine(p, me, col, dt) {
    this.herdText.setText(p.herd > 0 ? `HERD x${p.herd}: +${Math.round(p.herd * BALANCE.coop.herdDamage * 100)}% dmg, +${p.herd * BALANCE.coop.herdArmor} armor` : '');
    const g = this.g;
    panel(g, PAD.x, PAD.y, PAD.w, PAD.h);
    // Portrait on a ring in my player colour.
    g.fillStyle(DARKER, 1).fillCircle(90, 104, 58);
    g.lineStyle(7, col, 1).strokeCircle(90, 104, 58);
    if (p.char !== this.lastChar) { this.lastChar = p.char; this.portrait.setTexture(`h_${p.char}`).setDisplaySize(104, 104); }
    this.portrait.setPosition(90, 108).setAlpha(p.downed ? 0.5 : 1);

    // HP with a damage trail.
    const frac = p.maxHp > 0 ? clamp01(p.hp / p.maxHp) : 0;
    this.hpTrail = frac >= this.hpTrail ? frac : Math.max(frac, this.hpTrail - dt * 0.4);
    const low = frac <= 0.25 && !p.downed;
    const hpCol = frac > 0.5 ? 0x5fcf3a : frac > 0.25 ? 0xf5b335 : mix(0xff4a3a, 0xff8a7a, low ? 0.5 + 0.5 * Math.sin(this.t * 10) : 0);
    bar(g, 164, 38, 228, 40, frac, hpCol, this.hpTrail);
    put(this.hpText, `${Math.max(0, Math.ceil(p.hp))} / ${p.maxHp}`);

    // Mana.
    bar(g, 164, 84, 228, 30, p.maxMana > 0 ? clamp01(p.mana / p.maxMana) : 0, 0x4a8cff);
    put(this.manaText, `${Math.floor(p.mana)} / ${p.maxMana}`);

    // Amber, level, XP.
    this.amberPop = Math.max(0, this.amberPop - dt * 3.5);
    this.amberIcon.setPosition(180, 138).setScale(this.amberIcon.scaleX > 0 ? 36 / this.amberIcon.width * (1 + 0.3 * this.amberPop) : 1);
    put(this.amberText, `${p.amber}`).setScale(1 + 0.25 * this.amberPop);
    put(this.levelText, `LV ${p.level}`);
    const xpK = me && me.xpNext ? clamp01(me.xp / me.xpNext) : 0;
    g.fillStyle(DARKER, 1).fillRoundedRect(164, 158, 228, 14, 7);
    if (xpK > 0) g.fillStyle(0xffd23a, 1).fillRoundedRect(166, 160, Math.max(10, 224 * xpK), 10, 5);

    // The world shows "LEVEL UP!" over the T-Rex; here the level number just pops.
    this.lvUpT = Math.max(0, this.lvUpT - dt);
    this.levelText.setScale(1 + 0.35 * clamp01(this.lvUpT / 0.6) * (this.lvUpT > 0 ? 1 : 0));
  }

  drawWave(v) {
    const g = this.g;
    const bossWave = v.waveDur <= 0;
    const count = BALANCE.waves.count;
    if (!bossWave) {
      const tl = Math.max(0, Math.ceil(v.timeLeft));
      const urgent = v.timeLeft <= 5 && v.timeLeft > 0;
      const frac = v.timeLeft - Math.floor(v.timeLeft);
      panel(g, 800, 20, 320, 128, urgent ? (0.5 + 0.5 * Math.sin(this.t * 12) > 0.5 ? 0xff4a3a : 0xb83a2e) : DARKER);
      put(this.waveText, `WAVE ${v.wave} / ${count}`, CREAM).setPosition(960, 46);
      put(this.timerText, String(tl), urgent ? RED : CREAM).setPosition(960, 100).setScale(urgent ? 1 + 0.22 * frac * frac * frac : 1);
      this.timerText.setVisible(true); this.bossName.setVisible(false); this.bossHpText.setVisible(false);
      return;
    }
    // Boss wave: no timer, a boss bar with its name instead.
    const boss = v.enemies.find((e) => e.boss);
    panel(g, 520, 20, 880, 118, DARKER);
    put(this.waveText, `WAVE ${v.wave} / ${count}`, CREAM).setPosition(960, 44);
    this.timerText.setVisible(false);
    this.bossName.setVisible(true);
    if (boss) {
      const k = clamp01(boss.hpP);
      this.bossTrail = k >= this.bossTrail ? k : Math.max(k, this.bossTrail - 0.25 / 60);
      put(this.bossName, (ENEMIES[boss.type]?.name || 'Boss').toUpperCase(), '#ff9a8a').setPosition(960, 76);
      bar(g, 548, 92, 824, 36, k, 0xff3b3b, this.bossTrail);
      this.bossHpText.setVisible(true);
      put(this.bossHpText, `${Math.ceil(k * 100)}%`).setPosition(960, 110);
    } else {
      put(this.bossName, 'BOSS WAVE', '#ff9a8a').setPosition(960, 84);
      this.bossHpText.setVisible(false);
    }
  }

  /** Dodge-roll pip next to the ability button: cooldown sweep, bright when ready. */
  drawRoll(p) {
    const g = this.g, x = AB.x + 130, y = AB.y + 8, r = 30;
    const cd = Math.max(0, p.rollCd || 0);
    const ready = cd <= 0 && !p.downed;
    g.fillStyle(0x2b2118, 0.9).fillCircle(x, y, r + 5);
    g.fillStyle(ready ? 0x3ee0e8 : 0x4a3a2b, 1).fillCircle(x, y, r);
    if (!ready && !p.downed) {
      const k = 1 - cd / BALANCE.roll.cooldown;
      g.fillStyle(0x3ee0e8, 0.45).slice(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k, false).fillPath();
    }
    // A curled "roll" arrow.
    g.lineStyle(5, 0x2b2118, 1).beginPath().arc(x, y, r * 0.5, -0.4, Math.PI * 1.4, false).strokePath();
    const a = Math.PI * 1.4, tx = x + Math.cos(a) * r * 0.5, ty = y + Math.sin(a) * r * 0.5;
    g.fillStyle(0x2b2118, 1).fillTriangle(tx - 7, ty - 2, tx + 5, ty - 8, tx + 3, ty + 6);
    this.rollKey.setText(ready ? 'SHIFT' : cd.toFixed(1));
  }

  drawAbility(p) {
    const g = this.g, g2 = this.g2;
    const c = CHARACTERS[p.char];
    if (!c) return;
    const ab = c.ability;
    const cost = p.abCost ?? ab.cost; // after item discounts (the host sends it in the view)
    const x = AB.x, y = AB.y, r = AB.r;
    const cd = Math.max(0, p.abCd || 0);
    const affordable = p.mana >= cost;
    const ready = affordable && cd <= 0 && !p.downed;
    const heroCol = mix(hexNum(c.color), 0xffffff, 0.35);

    // Button: dark disc, ring, icon.
    g.fillStyle(0x000000, 0.28).fillCircle(x + 3, y + 7, r + 4);
    if (ready) g.lineStyle(10, 0xffd23a, 0.22 + 0.2 * Math.sin(this.t * 6)).strokeCircle(x, y, r + 9);
    g.fillStyle(DARK, 0.92).fillCircle(x, y, r);
    g.lineStyle(8, ready ? 0xffd23a : 0x6a5a48, 1).strokeCircle(x, y, r);
    abilityIcon(g, ab.id, x, y, heroCol, ready ? 1 : 0.5);

    // Sweep: dark wedge over the part that is still unavailable.
    let remain = 0;
    if (cd > 0) remain = clamp01(cd / Math.max(ab.cooldown, cd));
    else if (!affordable) remain = clamp01(1 - p.mana / cost);
    if (remain > 0.001) {
      g2.fillStyle(0x000000, 0.6);
      g2.slice(x, y, r - 3, -Math.PI / 2 + Math.PI * 2 * (1 - remain), Math.PI * 1.5, false);
      g2.fillPath();
    }

    // Mana cost chip and the SPACE keycap.
    const cx = x + 42, cy = y + 42;
    g2.fillStyle(affordable ? 0x2f6fe0 : 0xb83a2e, 1).fillCircle(cx, cy, 20);
    g2.lineStyle(4, DARKER, 1).strokeCircle(cx, cy, 20);
    put(this.abCost, String(cost), affordable ? CREAM : '#ffd0c8').setPosition(cx, cy + 1);
    g2.fillStyle(ready ? 0xfff4dc : 0xa89880, 1).fillRoundedRect(x - 42, y + r - 6, 84, 28, 8);
    g2.lineStyle(4, DARKER, 1).strokeRoundedRect(x - 42, y + r - 6, 84, 28, 8);
    put(this.abKey, 'SPACE').setPosition(x, y + r + 8);
    put(this.abName, ab.name, ready ? CREAM : '#c9b89a');
    if (cd > 0) put(this.abCd, cd >= 10 ? String(Math.ceil(cd)) : cd.toFixed(1), CREAM).setVisible(true);
    else this.abCd.setVisible(false);
  }

  drawAllies(v, myId) {
    const g = this.g, g2 = this.g2;
    const allies = v.players.filter((q) => q.id !== myId && !q.gone).slice(0, ALLY_SLOTS);
    for (let i = 0; i < ALLY_SLOTS; i++) {
      const q = allies[i];
      const portrait = this.allyPortraits[i], name = this.allyNames[i], tag = this.allyTags[i];
      portrait.setVisible(!!q); name.setVisible(!!q); tag.setVisible(!!q);
      if (!q) continue;
      const x = 1496, y = 20 + i * 88, w = 404, h = 76;
      const col = PLAYER_COLORS[q.id % 4];
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 9);
      panel(g, x, y, w, h, q.downed ? mix(0x8a1f18, 0xff4a3a, pulse) : col, q.downed ? 5 : 4);
      g.fillStyle(DARKER, 1).fillCircle(x + 44, y + 38, 30);
      g.lineStyle(5, col, 1).strokeCircle(x + 44, y + 38, 30);
      const key = `h_${q.char}`;
      if (portrait._key !== key) { portrait._key = key; portrait.setTexture(key).setDisplaySize(54, 54); }
      portrait.setPosition(x + 44, y + 41);
      if (q.downed) portrait.setTint(0x7a7a7a); else portrait.clearTint();
      name.setPosition(x + 88, y + 6);
      put(name, q.name, q.downed ? '#c9b89a' : CREAM);
      const hpK = q.maxHp > 0 ? clamp01(q.hp / q.maxHp) : 0;
      if (q.downed) {
        // Revive progress replaces the HP bar.
        bar(g, x + 88, y + 42, 300, 22, clamp01(q.reviveP || 0), 0x7dd957);
        tag.setPosition(x + 392, y + 16);
        put(tag, q.reviveP > 0.02 ? `REVIVING ${Math.round(q.reviveP * 100)}%` : 'DOWN', q.reviveP > 0.02 ? GREEN : RED);
      } else {
        bar(g, x + 88, y + 42, 300, 22, hpK, hpK > 0.5 ? 0x5fcf3a : hpK > 0.25 ? 0xf5b335 : 0xff4a3a);
        tag.setPosition(x + 392, y + 16);
        put(tag, `${Math.max(0, Math.ceil(q.hp))}`, '#d8c8a8');
      }
      if (q.downed) { g2.fillStyle(0x000000, 0.18).fillRoundedRect(x, y, w, h, 16); }
    }
  }

  drawArrows(v, myId) {
    const g = this.g;
    const cam = this.scene.cameras.main;
    const wv = cam.worldView;
    for (let i = 0; i < ALLY_SLOTS; i++) { this.arrowPortraits[i].setVisible(false); this.arrowLabels[i].setVisible(false); }
    if (!wv || !wv.width) return;
    const sx = W / wv.width, sy = H / wv.height;
    const keep = this.keepout(v, myId);
    let slot = 0;
    for (const q of v.players) {
      if (q.id === myId || q.gone || slot >= ALLY_SLOTS) continue;
      const px = (q.x - wv.x) * sx, py = (q.y - wv.y) * sy;
      if (px > 30 && px < W - 30 && py > 30 && py < H - 30) continue; // on screen: no arrow
      const dx = px - W / 2, dy = py - H / 2;
      const len = Math.hypot(dx, dy) || 1;
      const k0 = Math.min((W / 2 - ZONE.mx) / Math.max(1e-6, Math.abs(dx / len)), (H / 2 - ZONE.my) / Math.max(1e-6, Math.abs(dy / len)));
      // Where the line from the screen centre to the ally meets the inset screen edge, nudged clear of the HUD panels.
      const [bx, by] = avoid(W / 2 + (dx / len) * k0, H / 2 + (dy / len) * k0, keep);
      const dl = Math.hypot(px - bx, py - by) || 1;
      const ux = (px - bx) / dl, uy = (py - by) / dl;
      const col = PLAYER_COLORS[q.id % 4];
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 9);
      const tone = q.downed ? mix(0xff3b3b, 0xffffff, pulse * 0.45) : col;
      const grow = q.downed ? 1 + 0.12 * pulse : 1;
      const rad = 30 * grow;
      // Pointer triangle, then the badge.
      const nx = -uy, ny = ux;
      const tip = rad + 20 * grow, base = rad - 2, half = 15 * grow;
      g.fillStyle(DARKER, 1).fillTriangle(bx + ux * (tip + 5), by + uy * (tip + 5), bx + ux * (base - 3) + nx * (half + 5), by + uy * (base - 3) + ny * (half + 5), bx + ux * (base - 3) - nx * (half + 5), by + uy * (base - 3) - ny * (half + 5));
      g.fillStyle(tone, 1).fillTriangle(bx + ux * tip, by + uy * tip, bx + ux * base + nx * half, by + uy * base + ny * half, bx + ux * base - nx * half, by + uy * base - ny * half);
      if (q.downed) g.lineStyle(6, 0xff3b3b, 0.25 + 0.4 * pulse).strokeCircle(bx, by, rad + 10 + 6 * pulse);
      g.fillStyle(DARKER, 1).fillCircle(bx, by, rad + 4);
      g.fillStyle(0x3a2d21, 1).fillCircle(bx, by, rad);
      g.lineStyle(6, tone, 1).strokeCircle(bx, by, rad);
      const pi = this.arrowPortraits[slot];
      const key = `h_${q.char}`;
      if (pi._key !== key) { pi._key = key; pi.setTexture(key).setDisplaySize(44, 44); }
      pi.setPosition(bx, by + 3).setVisible(true);
      if (q.downed) pi.setTint(0x8a8a8a); else pi.clearTint();
      const lab = this.arrowLabels[slot];
      lab.setPosition(bx - ux * (rad + 26), by - uy * (rad + 26)).setVisible(true);
      put(lab, q.downed ? `${q.name}  DOWN!` : q.name, q.downed ? RED : CREAM);
      slot++;
    }
  }

  /** Red skull arrows at the screen edge pointing to an elite or the boss that is off screen. */
  drawThreats(v, myId) {
    const g = this.g2;
    for (const l of this.threatLabels) l.setVisible(false);
    const wv = this.scene.cameras.main.worldView;
    if (!wv || !wv.width) return;
    const sx = W / wv.width, sy = H / wv.height;
    const keep = this.keepout(v, myId);
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 8);
    let slot = 0;
    for (const e of v.enemies) {
      if (!(e.elite || e.boss) || slot >= THREAT_SLOTS) continue;
      const px = (e.x - wv.x) * sx, py = (e.y - wv.y) * sy;
      if (px > 30 && px < W - 30 && py > 30 && py < H - 30) continue; // on screen: no arrow
      const dx = px - W / 2, dy = py - H / 2;
      const len = Math.hypot(dx, dy) || 1;
      const k0 = Math.min((W / 2 - ZONE.mx) / Math.max(1e-6, Math.abs(dx / len)), (H / 2 - ZONE.my) / Math.max(1e-6, Math.abs(dy / len)));
      const [bx, by] = avoid(W / 2 + (dx / len) * k0, H / 2 + (dy / len) * k0, keep);
      const dl = Math.hypot(px - bx, py - by) || 1;
      const ux = (px - bx) / dl, uy = (py - by) / dl, nx = -uy, ny = ux;
      const rad = 28 * (1 + 0.1 * pulse), tip = rad + 22, base = rad - 2, half = 16;
      g.fillStyle(DARKER, 1).fillTriangle(bx + ux * (tip + 5), by + uy * (tip + 5), bx + ux * (base - 3) + nx * (half + 5), by + uy * (base - 3) + ny * (half + 5), bx + ux * (base - 3) - nx * (half + 5), by + uy * (base - 3) - ny * (half + 5));
      g.fillStyle(0xff3b2e, 1).fillTriangle(bx + ux * tip, by + uy * tip, bx + ux * base + nx * half, by + uy * base + ny * half, bx + ux * base - nx * half, by + uy * base - ny * half);
      g.lineStyle(6, 0xff3b2e, 0.25 + 0.4 * pulse).strokeCircle(bx, by, rad + 9 + 5 * pulse);
      g.fillStyle(DARKER, 1).fillCircle(bx, by, rad + 4);
      g.fillStyle(0x4a1410, 1).fillCircle(bx, by, rad);
      g.lineStyle(6, 0xff3b2e, 1).strokeCircle(bx, by, rad);
      skull(g, bx, by + 1, e.boss ? 1.1 : 0.95);
      const lab = this.threatLabels[slot];
      lab.setPosition(bx - ux * (rad + 28), by - uy * (rad + 28)).setVisible(true);
      put(lab, e.boss ? 'BOSS' : 'ELITE', '#ff9a8a');
      slot++;
    }
  }

  /** Screen rectangles the arrows keep clear of: [x0, y0, x1, y1], already inflated by the badge size. */
  keepout(v, myId) {
    const n = Math.min(ALLY_SLOTS, v.players.filter((q) => q.id !== myId && !q.gone).length);
    const boss = v.waveDur <= 0;
    const r = [
      [PAD.x - 56, PAD.y - 56, PAD.x + PAD.w + 56, 250],
      boss ? [520 - 56, 0, 1400 + 56, 138 + 56] : [800 - 56, 0, 1120 + 56, 148 + 56],
      [AB.x - 100 - 56, AB.y - AB.r - 56, AB.x + 100 + 56, H],
    ];
    if (n) r.push([1496 - 56, 0, W, 20 + n * 88 + 56]);
    return r;
  }

  drawDown(v, p, myId) {
    const others = v.players.filter((q) => q.id !== myId && !q.gone).length;
    if (!p.downed || !others) { this.downTitle.setVisible(false); this.downSub.setVisible(false); return; }
    const g = this.g;
    panel(g, 560, 744, 800, 142, DARKER, 5);
    this.downTitle.setVisible(true); this.downSub.setVisible(true);
    put(this.downTitle, "YOU'RE DOWN", RED).setPosition(960, 782);
    put(this.downSub, p.reviveP > 0.02 ? `Being revived ${Math.round(p.reviveP * 100)}%` : 'A mate can revive you by standing next to you.', p.reviveP > 0.02 ? GREEN : CREAM).setPosition(960, 828);
    bar(g, 640, 856, 640, 20, clamp01(p.reviveP || 0), 0x7dd957);
  }

  updateBanner() {
    // Wall-clock time, so the banner always clears on schedule even when frames are sparse.
    const now = performance.now() / 1000;
    const dt = this.bannerNow ? now - this.bannerNow : 0;
    this.bannerNow = now;
    const gb = this.gBand;
    gb.clear();
    if (this.bannerT <= 0) { this.banner.setAlpha(0); this.subBanner.setAlpha(0); return; }
    this.bannerT -= dt;
    this.bannerAge = (this.bannerAge || 0) + dt;
    const age = this.bannerAge, left = this.bannerT;
    const inK = clamp01(age / 0.28);
    const out = clamp01(left / 0.6);
    const a = Math.min(inK, out);
    const ease = 1 - Math.pow(1 - inK, 3);
    const red = this.bannerTone === 'red';
    gb.fillStyle(red ? 0x2a0806 : 0x140e0a, (red ? 0.7 : 0.55) * a).fillRect(0, 268, W, 190);
    gb.fillStyle(red ? 0xff3b2e : 0xffd23a, 0.5 * a).fillRect(0, 268, W, 4).fillRect(0, 454, W, 4);
    const thump = red ? 1 + 0.04 * Math.max(0, Math.sin(age * 16)) * clamp01(1 - age / 1.2) : 1;
    this.banner.setAlpha(a).setScale(lerp(1.8, 1, ease) * thump).setPosition(960 + (1 - ease) * -80, 330);
    this.subBanner.setAlpha(a * clamp01((age - 0.15) / 0.25)).setPosition(960, 414);
  }

  debug(v, app) {
    if (!app.params.debug) { this.debugText.setText(''); return; }
    const n = app.session?.netStats?.() || {};
    const lines = [`fps ${Math.round(app.fpsVal)}`];
    if (v) lines.push(`wave ${v.wave} ${v.phase}  enemies ${v.enemies.length}  proj ${v.projectiles.length}  shots ${v.shots.length}  pickups ${v.pickups.length}`);
    const net = Object.entries(n).map(([k, val]) => `${k} ${val}`).join('  ');
    if (net) lines.push(net);
    if (app.errors.length) lines.push(`ERRORS ${app.errors.length}`);
    this.debugText.setText(lines.join('\n'));
  }
}

// ---- drawing helpers ----

/** Slide a point along the screen edge until it is outside every keep-out rectangle. */
function avoid(bx, by, keep) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const [x0, y0, x1, y1] of keep) {
      if (bx <= x0 || bx >= x1 || by <= y0 || by >= y1) continue;
      const onSide = bx <= ZONE.mx + 1 || bx >= W - ZONE.mx - 1;
      const onTopBottom = by <= ZONE.my + 1 || by >= H - ZONE.my - 1;
      if (onSide && !onTopBottom) by = Math.abs(by - y0) < Math.abs(y1 - by) && y0 > ZONE.my ? y0 : Math.min(y1, H - ZONE.my);
      else bx = Math.abs(bx - x0) < Math.abs(x1 - bx) && x0 > ZONE.mx ? x0 : Math.min(x1, W - ZONE.mx);
      moved = true;
    }
    if (!moved) break;
  }
  return [bx, by];
}

/** A small cartoon skull (centre x, y; scale 1 = about 40 px tall). */
function skull(g, x, y, k = 1) {
  g.fillStyle(0xfff4dc, 1).fillCircle(x, y - 4 * k, 14 * k).fillRoundedRect(x - 8 * k, y + 5 * k, 16 * k, 11 * k, 3 * k);
  g.fillStyle(DARKER, 1).fillCircle(x - 5.5 * k, y - 4 * k, 4.2 * k).fillCircle(x + 5.5 * k, y - 4 * k, 4.2 * k)
    .fillTriangle(x, y + k, x - 2.5 * k, y + 5 * k, x + 2.5 * k, y + 5 * k);
  g.lineStyle(2 * k, DARKER, 1).lineBetween(x - 3 * k, y + 10 * k, x - 3 * k, y + 16 * k).lineBetween(x + 3 * k, y + 10 * k, x + 3 * k, y + 16 * k);
}

function panel(g, x, y, w, h, border = DARKER, bw = 4) {
  g.fillStyle(0x000000, 0.22).fillRoundedRect(x + 2, y + 5, w, h, 16);
  g.fillStyle(DARK, 0.86).fillRoundedRect(x, y, w, h, 16);
  g.lineStyle(bw, border, 1).strokeRoundedRect(x, y, w, h, 16);
}

/** A rounded bar. `trail` (optional) is a paler bar showing where the value just was. */
function bar(g, x, y, w, h, k, color, trail) {
  g.fillStyle(DARKER, 1).fillRoundedRect(x, y, w, h, h / 2);
  const inner = (v) => Math.max(h - 6, (w - 6) * clamp01(v));
  if (trail !== undefined && trail > k + 0.004) g.fillStyle(0xfff1c0, 0.9).fillRoundedRect(x + 3, y + 3, inner(trail), h - 6, (h - 6) / 2);
  if (k > 0.002) {
    const fw = inner(k);
    g.fillStyle(color, 1).fillRoundedRect(x + 3, y + 3, fw, h - 6, (h - 6) / 2);
    g.fillStyle(0xffffff, 0.22).fillRoundedRect(x + 8, y + 5, Math.max(0, fw - 10), Math.max(3, (h - 6) * 0.3), 3);
  }
}

/** Ability glyphs in the hero's colour with a dark outline. Unknown abilities get a star. */
function abilityIcon(g, id, x, y, color, alpha) {
  const line = (w, c, a0, a1, rx, ry, rad) => { g.lineStyle(w, c, alpha).beginPath().arc(rx, ry, rad, a0, a1, false).strokePath(); };
  const both = (draw) => { draw(DARKER, 12, 0); draw(color, 6, 1); };
  if (id === 'roar') {
    // Sound waves coming out of a mouth.
    both((c, w) => { for (const rad of [16, 28, 40]) line(w, c, -0.8, 0.8, x - 26, y, rad); });
    g.fillStyle(color, alpha).fillCircle(x - 26, y, 8); g.lineStyle(4, DARKER, alpha).strokeCircle(x - 26, y, 8);
  } else if (id === 'healing_pulse') {
    const cross = (c, grow) => { g.fillStyle(c, alpha).fillRoundedRect(x - 9 - grow, y - 30 - grow, 18 + grow * 2, 60 + grow * 2, 6).fillRoundedRect(x - 30 - grow, y - 9 - grow, 60 + grow * 2, 18 + grow * 2, 6); };
    cross(DARKER, 4); cross(0x7dff6a, 0);
  } else if (id === 'tail_whirl') {
    both((c, w) => { line(w, c, -2.4, 2.6, x, y, 26); });
    const tx = x + Math.cos(2.6) * 26, ty = y + Math.sin(2.6) * 26;
    g.fillStyle(DARKER, alpha).fillTriangle(tx - 15, ty + 4, tx + 13, ty - 4, tx + 2, ty + 22);
    g.fillStyle(color, alpha).fillTriangle(tx - 11, ty + 4, tx + 9, ty - 2, tx + 1, ty + 17);
  } else if (id === 'meteor_call') {
    g.fillStyle(DARKER, alpha).fillTriangle(x - 34, y - 34, x + 2, y - 20, x - 20, y + 2);
    g.fillStyle(0xffb627, alpha).fillTriangle(x - 30, y - 30, x, y - 17, x - 17, y);
    g.fillStyle(DARKER, alpha).fillCircle(x + 8, y + 8, 22);
    g.fillStyle(color, alpha).fillCircle(x + 8, y + 8, 17);
    g.fillStyle(0xffffff, alpha * 0.6).fillCircle(x + 2, y + 2, 5);
  } else {
    const pts = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 13 : 30; pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r }); }
    g.fillStyle(color, alpha).fillPoints(pts, true); g.lineStyle(5, DARKER, alpha).strokePoints(pts, true);
  }
}
