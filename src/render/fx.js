// Effects driven by sim events: damage numbers, death puffs, weapon swipes, telegraph strikes, ability visuals,
// pickups, camera shake and zoom kicks, plus the sounds that go with them.
// Effects never read sim internals; everything comes from the event and the view.
//
// Performance rules: damage numbers are pooled BitmapText (no canvas redraw), particles come from capped
// Phaser emitters, one-shot shapes (rings, swipes, beams) live in a pool and are drawn into one Graphics,
// and every burst has a per-frame budget so 300 enemies dying at once stay cheap.
//
// Public API used elsewhere: new Fx(scene, layer), onEvent(ev, view, myId), update(deltaMs).
// GameScene also calls: dust/puff/spark/ember/trail/plus helpers, shake(), kick(), sfxAt(), reset().

import { CHARACTERS } from '../data/characters.js';
import { ENEMIES } from '../data/enemies.js';
import { SPRITES, PLAYER_COLORS } from './art.js';
import { sfx } from '../audio/sfx.js';

const FONT = 'Fredoka, "Trebuchet MS", sans-serif';
const TAU = Math.PI * 2;
const MAX_NUMBERS = 56;
const MAX_WORDS = 14;
const NUM_K = 0.0168;           // number "size" (old font px) -> bitmap scale
// Elites and bosses take fire from everyone at once, so their hits are merged into ONE counter that floats above
// the sprite (above the health bar) instead of a spray of numbers over it.
const BIG_MERGE = 0.35;         // s: hits on one elite/boss this close together add to the same number
const BIG_FADE = 0.45;          // s: how long the counter fades once the hits stop
const BIG_SIZE = 21;            // old font px (ordinary numbers are 17-24, crits 31); grows a little with the total
const BIG_LIFT = 30;            // px between the top of the health bar and the middle of the number
const BIG_RISE = 20;            // px the number climbs while the hits keep coming
const BIG_FADE_RISE = 22;       // px it climbs further while fading
const AMBER = 0xffb627, CREAM = 0xfff4dc, RED = 0xff3b3b, GREEN = 0x7dff6a, GOLD = 0xffd23a;

const hex = (s) => parseInt(String(s).replace('#', ''), 16) || 0xffffff;
const css = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');
const rr = (a, b) => a + (b - a) * Math.random();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const HERO_COL = {};
const ABILITY_OWNER = {};
const lighten = (c, k) => { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; return (Math.round(r + (255 - r) * k) << 16) | (Math.round(g + (255 - g) * k) << 8) | Math.round(b + (255 - b) * k); };
for (const k of Object.keys(CHARACTERS)) { HERO_COL[k] = lighten(hex(CHARACTERS[k].color), 0.3); ABILITY_OWNER[CHARACTERS[k].ability.id] = k; }

// Shape kinds
const K_RING = 0, K_DISC = 1, K_BEAM = 2, K_ARC = 3, K_STAB = 4, K_BURST = 5, K_CRACKS = 6, K_PILLAR = 7, K_SWEEP = 8;

const SHOOT_SFX = {
  slingshot: 'shoot_sling', spear_thrower: 'shoot_spear', bone_bow: 'shoot_bow', ember_staff: 'shoot_ember', lava_lobber: 'shoot_lob',
  egg_turret: 'shoot_egg', ptero_pal: 'shoot_ptero', coconut_bomb: 'shoot_coconut', amber_laser: 'laser',
};
const MUZZLE = { ember_staff: 0xffa040, lava_lobber: 0xff6a2a, amber_laser: AMBER, slingshot: 0xfff4dc, spear_thrower: 0xe8d8b0, bone_bow: 0xfff4dc, egg_turret: 0xfff4dc };

/** Extra procedural textures (the boot scene only makes the basics). Safe to call twice. */
export function makeFxTextures(scene) {
  const tx = scene.textures;
  const canvas = (key, w, h, draw) => {
    if (tx.exists(key)) return;
    const c = tx.createCanvas(key, w, h);
    draw(c.getContext('2d'), w, h);
    c.refresh();
  };
  const radial = (ctx, w, stops) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
  };
  canvas('fx_glow', 64, 64, (ctx) => radial(ctx, 64, [[0, 1], [0.3, 0.55], [0.65, 0.15], [1, 0]]));
  canvas('fx_smoke', 32, 32, (ctx) => radial(ctx, 32, [[0, 0.85], [0.55, 0.4], [1, 0]]));
  canvas('fx_meteor', 96, 96, (ctx) => {
    const g = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
    g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(0.28, 'rgba(255,214,90,1)'); g.addColorStop(0.55, 'rgba(255,120,30,0.9)');
    g.addColorStop(0.85, 'rgba(210,50,10,0.35)'); g.addColorStop(1, 'rgba(210,50,10,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 96, 96);
  });
  canvas('fx_spark', 16, 16, (ctx) => {
    ctx.fillStyle = '#fff'; ctx.beginPath();
    ctx.moveTo(8, 0); ctx.lineTo(10, 6); ctx.lineTo(16, 8); ctx.lineTo(10, 10); ctx.lineTo(8, 16); ctx.lineTo(6, 10); ctx.lineTo(0, 8); ctx.lineTo(6, 6);
    ctx.closePath(); ctx.fill();
  });
  canvas('fx_plus', 24, 24, (ctx) => {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = '#2b2118'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(12, 4); ctx.lineTo(12, 20); ctx.moveTo(4, 12); ctx.lineTo(20, 12); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(12, 4); ctx.lineTo(12, 20); ctx.moveTo(4, 12); ctx.lineTo(20, 12); ctx.stroke();
  });
  canvas('fx_bone', 28, 14, (ctx) => {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = '#2b2118'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(7, 7); ctx.lineTo(21, 7); ctx.stroke();
    for (const [x, y] of [[6, 4.5], [6, 9.5], [22, 4.5], [22, 9.5]]) { ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.stroke(); }
    ctx.fillStyle = '#fff4dc'; ctx.strokeStyle = '#fff4dc'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(7, 7); ctx.lineTo(21, 7); ctx.stroke();
    for (const [x, y] of [[6, 4.5], [6, 9.5], [22, 4.5], [22, 9.5]]) { ctx.beginPath(); ctx.arc(x, y, 2.8, 0, TAU); ctx.fill(); }
  });
  canvas('fx_star', 24, 24, (ctx) => {
    const pts = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 5 : 11; pts.push([12 + Math.cos(a) * r, 12 + Math.sin(a) * r]); }
    ctx.lineJoin = 'round';
    const path = () => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
    path(); ctx.strokeStyle = '#2b2118'; ctx.lineWidth = 4; ctx.stroke();
    path(); ctx.fillStyle = '#fff'; ctx.fill();
  });
  canvas('fx_excl', 32, 48, (ctx) => {
    ctx.font = `700 40px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = 9; ctx.strokeStyle = '#2b2118'; ctx.strokeText('!', 16, 26);
    ctx.fillStyle = '#fff'; ctx.fillText('!', 16, 26);
  });
  // Digits and a few symbols for damage numbers (white fill, dark outline; tinted per number).
  const NUM_CHARS = '0123456789+-!x.%?';
  canvas('fx_numfont', 520, 160, (ctx) => {
    ctx.font = `700 60px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = 12; ctx.strokeStyle = '#2b2118'; ctx.fillStyle = '#fff';
    for (let i = 0; i < NUM_CHARS.length; i++) {
      const cx = (i % 10) * 52 + 26, cy = Math.floor(i / 10) * 80 + 42;
      ctx.strokeText(NUM_CHARS[i], cx, cy); ctx.fillText(NUM_CHARS[i], cx, cy);
    }
  });
  if (!scene.cache.bitmapFont.exists('fx_num')) {
    scene.cache.bitmapFont.add('fx_num', Phaser.GameObjects.RetroFont.Parse(scene, {
      image: 'fx_numfont', width: 52, height: 80, chars: NUM_CHARS, charsPerRow: 10, spacing: { x: 0, y: 0 },
    }));
  }
}

export class Fx {
  constructor(scene, layer) {
    this.scene = scene;
    this.layer = layer;
    makeFxTextures(scene);

    this.nums = [];
    this.numFree = [];
    this.recent = new Map();     // enemy id -> its newest damage number (hits within 160 ms merge into it)
    this.bigRecent = new Map();  // elite/boss id -> its running counter (hits within BIG_MERGE merge into it)
    this.words = [];
    this.wordFree = [];
    this.shapes = [];
    this.shapePool = [];
    this.burn = new Map();       // enemy id -> {x, y, sum, t}: burn ticks are summed into one number
    this._burnCb = (b, id) => this.flushBurn(b, id);
    this.dt = 0.016;
    this.trauma = 0;
    this.zoomKick = 0;
    this.sparkBudget = 14; this.numBudget = 5; this.deathBudget = 10; this.puffBudget = 60;
    this.pickT = 0;

    const em = (tex, depth, cfg, add = false) => {
      const e = scene.add.particles(0, 0, tex, { emitting: false, ...cfg }).setDepth(depth);
      if (add) e.setBlendMode(Phaser.BlendModes.ADD);
      layer.add(e);
      return e;
    };
    this.puffs = em('dot', 8500, { lifespan: { min: 250, max: 520 }, speed: { min: 60, max: 230 }, scale: { start: 0.85, end: 0 }, alpha: { start: 1, end: 0 }, angle: { min: 0, max: 360 }, maxAliveParticles: 420 });
    this.sparks = em('fx_spark', 8600, { lifespan: { min: 220, max: 460 }, speed: { min: 70, max: 240 }, scale: { start: 1.15, end: 0 }, angle: { min: 0, max: 360 }, rotate: { min: 0, max: 90 }, maxAliveParticles: 260 }, true);
    this.bones = em('fx_bone', 8550, { lifespan: { min: 450, max: 800 }, speed: { min: 90, max: 250 }, angle: { min: -150, max: -30 }, gravityY: 700, scale: { start: 0.8, end: 0.55 }, alpha: { start: 1, end: 0 }, rotate: { start: 0, end: 540 }, maxAliveParticles: 90 });
    this.dusts = em('fx_smoke', 3.5, { lifespan: { min: 320, max: 620 }, speed: { min: 18, max: 70 }, scale: { start: 0.55, end: 1.5 }, alpha: { start: 0.4, end: 0 }, angle: { min: 0, max: 360 }, maxAliveParticles: 220 });
    this.plusses = em('fx_plus', 8650, { lifespan: { min: 650, max: 1000 }, speed: { min: 14, max: 40 }, angle: { min: -115, max: -65 }, gravityY: -40, scale: { start: 0.9, end: 0.5 }, alpha: { start: 1, end: 0 }, maxAliveParticles: 60 });
    this.embers = em('fx_spark', 8560, { lifespan: { min: 380, max: 850 }, speed: { min: 8, max: 40 }, angle: { min: -120, max: -60 }, gravityY: -70, scale: { start: 0.75, end: 0 }, maxAliveParticles: 120 }, true);
    this.glints = em('fx_glow', 8570, { lifespan: { min: 90, max: 150 }, speed: 0, scale: { start: 0.5, end: 0.1 }, alpha: { start: 0.95, end: 0 }, maxAliveParticles: 60 }, true);
    this.trails = em('fx_glow', 8490, { lifespan: { min: 180, max: 300 }, speed: { min: 0, max: 16 }, scale: { start: 0.2, end: 0 }, alpha: { start: 0.9, end: 0 }, maxAliveParticles: 160 }, true);

    this.g = scene.add.graphics().setDepth(8400);
    layer.add(this.g);
    this.gl = scene.add.graphics().setDepth(8450).setBlendMode(Phaser.BlendModes.ADD);
    layer.add(this.gl);
  }

  // ---- small helpers ----

  /** Play a sound at a world position: quieter and panned the further it is from the camera centre. */
  sfxAt(name, x, y, vol = 1, floor = 0, rate = 1) {
    const sc = this.scene;
    const dx = x - sc.camX, dy = y - sc.camY;
    const d = Math.sqrt(dx * dx + dy * dy);
    const v = Math.max(floor, d < 380 ? 1 : 1 - (d - 380) / 760) * vol;
    if (v < 0.05) return;
    sfx.play(name, { vol: v, pan: clamp(dx / 640, -1, 1) * 0.7, rate });
  }

  shake(amount) {
    if (this.scene.app.settings.shake === false) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  kick(z) {
    if (this.scene.app.settings.shake === false) return;
    this.zoomKick = Math.min(0.09, this.zoomKick + z);
  }

  puff(x, y, color, n = 8) {
    if (this.puffBudget <= 0) return;
    this.puffBudget -= n * 0.5;
    this.puffs.setParticleTint(color);
    this.puffs.emitParticleAt(x, y, n);
  }

  spark(x, y, color, n = 4) {
    this.sparks.setParticleTint(color);
    this.sparks.emitParticleAt(x, y, n);
  }

  dust(x, y, n = 3, color = 0xd8c8a0) {
    this.dusts.setParticleTint(color);
    this.dusts.emitParticleAt(x, y, n);
  }

  ember(x, y, color = 0xff9a3a) {
    this.embers.setParticleTint(color);
    this.embers.emitParticleAt(x, y, 1);
  }

  trail(x, y, color = AMBER) {
    this.trails.setParticleTint(color);
    this.trails.emitParticleAt(x, y, 1);
  }

  plus(x, y, n = 3, color = GREEN) {
    this.plusses.setParticleTint(color);
    for (let i = 0; i < n; i++) this.plusses.emitParticleAt(x + rr(-16, 16), y + rr(-6, 20), 1);
  }

  glint(x, y, color, n = 1) {
    this.glints.setParticleTint(color);
    this.glints.emitParticleAt(x, y, n);
  }

  // ---- numbers and words ----

  makeNum() {
    const t = this.scene.add.bitmapText(0, 0, 'fx_num', '').setOrigin(0.5).setDepth(9000).setLetterSpacing(-9);
    this.layer.add(t);
    return t;
  }

  /** A pooled damage number. `merge` = enemy id: a hit on the same enemy within 160 ms adds to its number. */
  number(x, y, text, tint, size = 20, life = 0.7, o = 0, merge = -1) {
    let t = this.numFree.pop();
    if (!t) {
      if (this.nums.length >= MAX_NUMBERS) {
        t = this.nums.shift();
        this.forget(t);
      } else t = this.makeNum();
    }
    t.setText(text).setTint(tint).setPosition(x + rr(-9, 9), y).setAlpha(1).setVisible(true);
    t.base = size * NUM_K; t.pop = 0.45 + o; t.life = life; t.age = 0; t.vy = -90 - o * 40; t.jit = o > 0.3 ? 2.2 : 0; t.sum = 0; t.eid = merge; t.big = false;
    t.setScale(t.base * (1 + t.pop));
    this.nums.push(t);
    if (merge >= 0) this.recent.set(merge, t);
    return t;
  }

  /** Drop a number's entries from the merge tables (it is being recycled). */
  forget(t) {
    if (this.recent.get(t.eid) === t) this.recent.delete(t.eid);
    if (t.big && this.bigRecent.get(t.eid) === t) this.bigRecent.delete(t.eid);
  }

  /** The scene's sprite record for an elite or boss (it knows the sprite), or null for an ordinary enemy. */
  bigRec(id) {
    const r = this.scene.pools?.enemies?.get(id);
    return r && (r.boss || r.elite) ? r : null;
  }

  /**
   * Damage on an elite or boss: add to its running counter, or start one. The counter hangs above the health bar,
   * follows the sprite, counts up to the new total, and fades BIG_MERGE s after the last hit. A crit makes it
   * gold and pops it bigger. Burn ticks go into the same counter.
   */
  bigNumber(ev, r, crit) {
    let t = this.bigRecent.get(ev.id);
    if (t && t.since < BIG_MERGE && t.visible) {
      t.sum += ev.a;
    } else {
      t = this.number(r.body.x, r.body.y, String(ev.a), 0xffffff, BIG_SIZE, 1, 0, -1);
      t.big = true; t.eid = ev.id; t.sum = ev.a; t.shown = ev.a; t.txt = ev.a; t.rise = 0; t.critT = 0;
      t.lift = (SPRITES[r.key]?.[0] || 64) * 0.55 + BIG_LIFT;
      t.ox = rr(-8, 8);
      t.ax = r.body.x; t.ay = r.body.y;
      this.bigRecent.set(ev.id, t);
    }
    t.since = 0;
    t.age = 0;
    t.pop = crit ? 0.9 : 0.22;
    if (crit) { t.critT = 0.45; t.setTint(0xffe14a); }
  }

  word(x, y, text, color, size = 26, life = 1.1) {
    let t = this.wordFree.pop();
    if (!t) {
      if (this.words.length >= MAX_WORDS) t = this.words.shift();
      else {
        t = this.scene.add.text(0, 0, '', { fontFamily: FONT, fontStyle: 'bold', fontSize: '26px', color: '#fff', stroke: '#2b2118', strokeThickness: 6 }).setOrigin(0.5).setDepth(9050);
        this.layer.add(t);
      }
    }
    t.setText(text).setColor(css(color)).setFontSize(size).setPosition(x, y).setAlpha(1).setVisible(true).setScale(1.5);
    t.life = life; t.age = 0; t.vy = -34;
    this.words.push(t);
  }

  flushBurn(b, id) {
    b.t -= this.dt;
    if (b.t > 0) return;
    this.number(b.x, b.y, String(b.sum), 0xffa040, 14, 0.55, -0.2);
    this.burn.delete(id);
  }

  // ---- one-shot shapes ----

  shape(kind, x, y, dur, color, delay = 0) {
    const s = this.shapePool.pop() || {};
    s.kind = kind; s.x = x; s.y = y; s.dur = dur; s.color = color; s.t = -delay;
    s.r0 = 0; s.r1 = 0; s.w = 6; s.a = 0; s.arc = 0; s.x2 = 0; s.y2 = 0; s.alpha = 0.9; s.n = 8;
    this.shapes.push(s);
    return s;
  }

  ring(x, y, color, r0, r1, dur, width = 6, delay = 0, alpha = 0.9) {
    const s = this.shape(K_RING, x, y, dur, color, delay);
    s.r0 = r0; s.r1 = r1; s.w = width; s.alpha = alpha;
  }

  disc(x, y, color, r0, r1, dur, alpha = 0.5, delay = 0) {
    const s = this.shape(K_DISC, x, y, dur, color, delay);
    s.r0 = r0; s.r1 = r1; s.alpha = alpha;
  }

  burst(x, y, color, r0, r1, dur, n = 8, width = 4, a0 = 0) {
    const s = this.shape(K_BURST, x, y, dur, color);
    s.r0 = r0; s.r1 = r1; s.n = n; s.w = width; s.a = a0;
  }

  // ---- events ----

  onEvent(ev, v, myId) {
    switch (ev.type) {
      case 'hit': this.onHit(ev); break;
      case 'kill': this.onKill(ev); break;
      case 'phit': this.onPlayerHit(ev, myId); break;
      case 'dodge':
        this.word(ev.x, ev.y - 6, 'DODGE', 0xb8f0ff, 20, 0.7);
        this.ring(ev.x, ev.y + 14, 0xb8f0ff, 8, 44, 0.25, 4);
        if (ev.pid === myId) sfx.play('dodge'); else this.sfxAt('dodge', ev.x, ev.y, 0.5);
        break;
      case 'heal': this.onHeal(ev); break;
      case 'pickup': this.onPickup(ev, myId); break;
      case 'swing': this.onSwing(ev, v, myId); break;
      case 'shoot': this.onShoot(ev, v, myId); break;
      case 'beam': this.onBeam(ev, myId); break;
      case 'eshoot':
        this.puff(ev.x, ev.y, 0xff2fd1, 6);
        this.ring(ev.x, ev.y, 0xff2fd1, 12, 52, 0.3, 5);
        this.sfxAt('spit', ev.x, ev.y, 0.9);
        break;
      case 'explode': this.onExplode(ev); break;
      case 'charge':
        this.dust(ev.x, ev.y + 8, 7);
        this.burst(ev.x, ev.y, CREAM, 14, 70, 0.22, 6, 3, ev.a + Math.PI);
        this.sfxAt('charge', ev.x, ev.y, 1);
        break;
      case 'stomp': this.onStomp(ev); break;
      case 'bossCall': this.onBossCall(ev); break;
      case 'tail': this.onTail(ev); break;
      case 'cast': this.onCast(ev, v, myId); break;
      case 'castFail':
        if (ev.pid === myId) sfx.play('nope');
        break;
      case 'downed':
        this.ring(ev.x, ev.y, RED, 10, 130, 0.5, 8);
        this.ring(ev.x, ev.y, CREAM, 6, 70, 0.4, 4, 0.05);
        this.dust(ev.x, ev.y + 10, 8, 0x9a8a72);
        this.word(ev.x, ev.y - 54, 'DOWN!', 0xff5a4a, 32, 1.4);
        if (ev.pid === myId) { this.shake(0.3); this.kick(0.02); sfx.play('downed'); } else this.sfxAt('downed', ev.x, ev.y, 0.9, 0.3);
        break;
      case 'bossPhase':
      case 'elitePhase':
        this.ring(ev.x, ev.y, 0xff3b3b, 30, 260, 0.6, 12);
        this.ring(ev.x, ev.y, 0xffffff, 20, 180, 0.45, 6, 0.08);
        this.dust(ev.x, ev.y + 30, 14, 0x9a8a72);
        this.shake(0.7);
        sfx.play('roar'); sfx.play('bossCall');
        break;
      case 'elitePounce':
        this.dust(ev.x, ev.y + 20, 10, 0x9a8a72);
        sfx.play('charge');
        break;
      case 'slam':
        this.ring(ev.x, ev.y, 0xff3b3b, ev.r * 0.3, ev.r, 0.35, 10);
        this.dust(ev.x, ev.y, 10, 0x9a8a72);
        this.shake(0.35);
        this.sfxAt('stomp', ev.x, ev.y, 0.9, 0.2);
        break;
      case 'eliteSpawn':
        sfx.play('bossCall'); this.shake(0.4);
        break;
      case 'bossSpawn':
        sfx.play('stomp'); sfx.play('bossCall'); this.shake(0.6);
        break;
      case 'roll':
        this.dust(ev.x, ev.y + 12, 7, 0x9a8a72);
        if (ev.pid === myId) sfx.play('roll'); else this.sfxAt('roll', ev.x, ev.y, 0.8, 0.3);
        break;
      case 'revive':
        this.ring(ev.x, ev.y, GREEN, 10, 150, 0.55, 8);
        this.ring(ev.x, ev.y, CREAM, 6, 90, 0.45, 4, 0.06);
        this.plus(ev.x, ev.y - 10, 8);
        this.spark(ev.x, ev.y, GREEN, 10);
        this.word(ev.x, ev.y - 54, 'REVIVED!', GREEN, 28, 1.3);
        if (ev.pid === myId || ev.by === myId) sfx.play('revive'); else this.sfxAt('revive', ev.x, ev.y, 0.9, 0.3);
        break;
      case 'levelUp': this.onLevelUp(ev, myId); break;
      case 'waveStart': this.onWaveStart(v); break;
      case 'waveEnd': this.onWaveEnd(v); break;
      case 'runEnd': this.onRunEnd(ev, v); break;
      default:
    }
  }

  onHit(ev) {
    const crit = ev.c === 1;
    const sc = this.scene;
    sc.enemyHit(ev.id, crit);
    const big = this.bigRec(ev.id);
    if (ev.s === 'burn') {
      if (big) { this.bigNumber(ev, big, false); return; }
      const b = this.burn.get(ev.id);
      if (b) { b.sum += ev.a; b.x = ev.x; b.y = ev.y; } else this.burn.set(ev.id, { x: ev.x, y: ev.y, sum: ev.a, t: 0.5 });
      return;
    }
    // Number: merge fast repeat hits on one enemy, thin out when the screen is crowded (crits always show).
    const old = this.recent.get(ev.id);
    if (big) {
      this.bigNumber(ev, big, crit);
    } else if (old && old.eid === ev.id && old.age < 0.16 && !crit && old.visible) {
      old.sum = (old.sum || 0) + ev.a;
      old.setText(String(old.sum || ev.a));
      old.age = Math.min(old.age, 0.04);
      old.pop = 0.3;
    } else if (crit || this.numBudget > 0) {
      if (!crit) this.numBudget--;
      const size = crit ? 31 : 17 + Math.min(7, Math.sqrt(ev.a) * 0.9);
      const t = this.number(ev.x, ev.y - 4, String(ev.a), crit ? 0xffe14a : 0xffffff, size, crit ? 0.95 : 0.62, crit ? 0.55 : 0, ev.id);
      t.sum = ev.a;
    }
    if (crit) {
      this.burst(ev.x, ev.y + 8, 0xffe14a, 6, 34, 0.2, 6, 4, rr(0, 1));
      this.shake(0.05);
    }
    if (this.sparkBudget > 0) {
      this.sparkBudget--;
      this.spark(ev.x, ev.y + 8, crit ? 0xffe14a : 0xffffff, crit ? 4 : 2);
    }
    this.sfxAt(crit ? 'crit' : 'hit', ev.x, ev.y, crit ? 1 : 0.8);
  }

  onKill(ev) {
    const def = ENEMIES[ev.et];
    const sp = SPRITES[def?.sprite];
    const col = sp ? sp[1] : 0xa8432a;
    const size = sp ? sp[0] : 60;
    const boss = ev.et === 'trike', elite = ev.et === 'spino';
    this.scene.enemyKilled(ev, boss || elite ? 1 : 0);
    this.burn.delete(ev.id);
    if (ev.et === 'bush') {
      this.puff(ev.x, ev.y, 0x6fae48, 10);
      this.puff(ev.x, ev.y, 0x4f8f3a, 6);
      this.spark(ev.x, ev.y, 0xb8f08a, 4);
      this.sfxAt('leaf', ev.x, ev.y, 1);
      return;
    }
    if (boss) { this.onBossDeath(ev, col); return; }
    const big = size > 90;
    const n = this.deathBudget > 0 ? (big ? 22 : 8) : 3;
    this.deathBudget--;
    this.puff(ev.x, ev.y, col, n);
    this.puff(ev.x, ev.y, CREAM, big ? 8 : 3);
    if (ev.et !== 'mosquito' && this.deathBudget > 0) {
      this.bones.emitParticleAt(ev.x, ev.y - 4, big ? 6 : 2);
    }
    if (big) {
      this.ring(ev.x, ev.y, CREAM, 18, size * 1.15, 0.45, 9);
      this.ring(ev.x, ev.y, col, 10, size * 0.8, 0.35, 6, 0.05);
      this.disc(ev.x, ev.y, 0xffffff, 10, size * 0.7, 0.2, 0.55);
      this.shake(elite ? 0.45 : 0.2);
      this.kick(elite ? 0.03 : 0.012);
      this.sfxAt('bigdeath', ev.x, ev.y, 1, 0.4);
    } else {
      this.sfxAt('death', ev.x, ev.y, 0.9);
    }
  }

  onBossDeath(ev, col) {
    this.puff(ev.x, ev.y, col, 40);
    this.puff(ev.x, ev.y, CREAM, 24);
    this.bones.emitParticleAt(ev.x, ev.y - 20, 22);
    this.spark(ev.x, ev.y, AMBER, 24);
    for (let i = 0; i < 4; i++) this.ring(ev.x, ev.y, i % 2 ? col : CREAM, 20, 230 + i * 70, 0.7, 12 - i * 2, i * 0.14);
    this.disc(ev.x, ev.y, 0xffffff, 20, 160, 0.35, 0.8);
    this.shake(1);
    this.kick(0.07);
    const cam = this.scene.cameras.main;
    if (this.scene.app.settings.shake !== false) cam.flash(260, 255, 255, 255, true);
    this.word(ev.x, ev.y - 90, 'VICTORY!', GOLD, 40, 2);
    sfx.play('bossdeath');
  }

  onPlayerHit(ev, myId) {
    this.number(ev.x, ev.y - 10, `-${ev.a}`, 0xff5a4a, 25, 0.85, 0.3);
    this.scene.playerHit(ev.pid);
    this.puff(ev.x, ev.y + 12, 0xff5a4a, 5);
    this.spark(ev.x, ev.y + 12, 0xff8a7a, 4);
    if (ev.pid === myId) { this.shake(0.26); this.kick(0.012); sfx.play('hurt'); }
    else this.sfxAt('hurt', ev.x, ev.y, 0.6);
  }

  onHeal(ev) {
    if (ev.a >= 1) this.number(ev.x, ev.y - 10, `+${ev.a}`, GREEN, 21, 0.9, 0.1);
    this.plus(ev.x, ev.y + 4, 4);
    this.ring(ev.x, ev.y + 16, GREEN, 8, 40, 0.4, 4);
    // No sound here: Healing Pulse has its own cast sound and a berry has its pickup sound.
  }

  onPickup(ev, myId) {
    const mine = ev.pid === myId;
    if (ev.kind === 'amber') {
      this.spark(ev.x, ev.y, AMBER, mine ? 3 : 2);
      if (mine) {
        sfx.play('amber', { rate: sfx.amberRate(), vol: 0.9 });
        if (ev.v >= 5 && this.pickT <= 0) { this.pickT = 0.2; this.number(ev.x, ev.y - 22, `+${ev.v}`, AMBER, 19, 0.7, 0.1); }
      } else this.sfxAt('amber', ev.x, ev.y, 0.3, 0, 1.2);
    } else if (ev.kind === 'crate') {
      this.ring(ev.x, ev.y, AMBER, 10, 90, 0.45, 8);
      this.spark(ev.x, ev.y, AMBER, 12);
      this.word(ev.x, ev.y - 50, 'CRATE!', AMBER, 26, 1.1);
      if (mine) { sfx.play('levelup'); sfx.play('buy'); } else this.sfxAt('buy', ev.x, ev.y, 0.6);
    } else {
      this.puff(ev.x, ev.y, GREEN, 8);
      this.plus(ev.x, ev.y, 3);
      if (mine) sfx.play('berry'); else this.sfxAt('berry', ev.x, ev.y, 0.5);
    }
  }

  onSwing(ev, v, myId) {
    const p = v.players.find((q) => q.id === ev.pid);
    if (!p) return;
    const mine = ev.pid === myId;
    const arc = ((ev.arc || 90) * Math.PI) / 180;
    if (ev.thrust) {
      const s = this.shape(K_STAB, p.x, p.y, 0.2, CREAM);
      s.a = ev.a; s.r1 = ev.r || 120; s.w = 13;
    } else {
      const s = this.shape(K_ARC, p.x, p.y, 0.2, CREAM);
      s.a = ev.a; s.arc = arc; s.r1 = ev.r || 100; s.w = 26;
    }
    const name = ev.thrust ? 'thrust' : 'swing';
    if (mine) sfx.play(name); else this.sfxAt(name, p.x, p.y, 0.5);
  }

  onShoot(ev, v, myId) {
    const p = v.players.find((q) => q.id === ev.pid);
    const pos = this.scene.weaponPos.get(ev.pid * 16 + ev.slot);
    const x = pos ? pos.x : p ? p.x : 0, y = pos ? pos.y : p ? p.y : 0;
    const col = MUZZLE[ev.wid] || CREAM;
    this.glint(x + Math.cos(ev.a) * 16, y + Math.sin(ev.a) * 16, col, 1);
    if (ev.wid === 'ember_staff' || ev.wid === 'lava_lobber') this.ember(x + Math.cos(ev.a) * 14, y + Math.sin(ev.a) * 14, col);
    const name = SHOOT_SFX[ev.wid] || 'shoot';
    if (ev.pid === myId) sfx.play(name, { vol: 0.9 }); else if (p) this.sfxAt(name, p.x, p.y, 0.45);
  }

  onBeam(ev, myId) {
    const s = this.shape(K_BEAM, ev.x, ev.y, 0.18, AMBER);
    s.x2 = ev.x2; s.y2 = ev.y2;
    this.glint(ev.x, ev.y, AMBER, 2);
    if (ev.pid === myId) sfx.play('laser'); else this.sfxAt('laser', ev.x, ev.y, 0.45);
  }

  onExplode(ev) {
    const r = ev.r || 70;
    this.ring(ev.x, ev.y, 0xffa040, r * 0.3, r, 0.32, 11);
    this.ring(ev.x, ev.y, 0xfff4dc, r * 0.15, r * 0.7, 0.22, 5, 0.02);
    this.disc(ev.x, ev.y, 0xffc060, r * 0.2, r * 0.85, 0.2, 0.55);
    this.puff(ev.x, ev.y, 0xff8a3a, 14);
    this.puff(ev.x, ev.y, 0x5a4636, 7);
    this.spark(ev.x, ev.y, 0xffd36b, 8);
    this.shake(0.1 + r / 900);
    this.sfxAt('boom', ev.x, ev.y, 1, 0.2);
  }

  onStomp(ev) {
    const r = ev.r || 400;
    this.ring(ev.x, ev.y, CREAM, 30, r * 0.62, 0.5, 14);
    this.ring(ev.x, ev.y, 0xc8b078, 20, r * 0.45, 0.45, 8, 0.05);
    this.disc(ev.x, ev.y, 0xffffff, 30, 140, 0.18, 0.6);
    const s = this.shape(K_CRACKS, ev.x, ev.y, 0.9, 0x3a2d21);
    s.r1 = Math.min(r * 0.6, 260); s.a = ev.x * 0.013 + ev.y * 0.007; s.n = 11;
    for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; this.dusts.setParticleTint(0xd8c8a0); this.dusts.emitParticleAt(ev.x + Math.cos(a) * 60, ev.y + Math.sin(a) * 50, 2); }
    this.shake(0.6);
    this.kick(0.035);
    this.sfxAt('stomp', ev.x, ev.y, 1, 0.5);
  }

  onBossCall(ev) {
    const en = !!ev.enrage;
    const col = en ? RED : 0xffb08a;
    for (let i = 0; i < (en ? 3 : 2); i++) this.ring(ev.x, ev.y, col, 40 + i * 20, (en ? 340 : 240) + i * 60, 0.7, 12 - i * 3, i * 0.16, 0.8);
    this.disc(ev.x, ev.y, col, 40, en ? 220 : 140, 0.3, 0.4);
    this.puff(ev.x, ev.y - 40, col, 14);
    this.word(ev.x, ev.y - 120, en ? 'ENRAGED!' : 'RAPTORS!', en ? 0xff5a4a : 0xffd0a0, en ? 40 : 30, 1.4);
    this.shake(en ? 0.7 : 0.35);
    this.kick(en ? 0.04 : 0.02);
    if (en) {
      this.scene.enraged = true;
      if (this.scene.app.settings.shake !== false) this.scene.cameras.main.flash(300, 255, 70, 50, true);
    }
    this.sfxAt(en ? 'bossEnrage' : 'bossCall', ev.x, ev.y, 1, 0.55);
  }

  onTail(ev) {
    const r = ev.r || 130;
    const s = this.shape(K_SWEEP, ev.x, ev.y, 0.28, CREAM);
    s.r1 = r; s.w = 22; s.a = rr(0, TAU);
    this.ring(ev.x, ev.y, 0xffffff, r * 0.7, r, 0.22, 8);
    this.dust(ev.x, ev.y + 12, 10);
    this.shake(0.14);
    this.sfxAt('tail', ev.x, ev.y, 1, 0.1);
  }

  onLevelUp(ev, myId) {
    this.ring(ev.x, ev.y, GOLD, 12, 120, 0.55, 8);
    this.ring(ev.x, ev.y, CREAM, 6, 80, 0.4, 4, 0.06);
    const s = this.shape(K_PILLAR, ev.x, ev.y + 20, 0.7, GOLD);
    s.w = 48; s.r1 = 260;
    this.spark(ev.x, ev.y, GOLD, 12);
    this.word(ev.x, ev.y - 62, 'LEVEL UP!', GOLD, 28, 1.3);
    if (ev.pid === myId) sfx.play('levelup'); else this.sfxAt('levelup', ev.x, ev.y, 0.4);
  }

  onWaveStart(v) {
    this.reset(); // no damage numbers or words left over from the last wave
    this.scene.enraged = false;
    sfx.play('waveStart');
    this.kick(0.02);
    for (const p of v.players) {
      if (p.gone) continue;
      this.ring(p.x, p.y, GOLD, 14, 260, 0.7, 8);
      this.ring(p.x, p.y, CREAM, 8, 180, 0.55, 4, 0.08);
    }
  }

  onWaveEnd(v) {
    this.scene.enraged = false;
    sfx.play('waveEnd');
    for (const p of v.players) {
      if (p.gone) continue;
      this.ring(p.x, p.y, GREEN, 14, 220, 0.7, 8);
      this.ring(p.x, p.y, GOLD, 8, 150, 0.55, 5, 0.08);
      this.spark(p.x, p.y - 10, GOLD, 14);
      this.plus(p.x, p.y - 8, 3, GOLD);
    }
  }

  onRunEnd(ev, v) {
    if (ev.win) {
      sfx.play('win');
      const cols = [GOLD, 0xff6fb5, 0x3ee0e8, 0x9be33c, 0xffffff];
      for (const p of v.players) {
        if (p.gone) continue;
        for (let i = 0; i < 5; i++) this.spark(p.x + rr(-30, 30), p.y - 20 + rr(-20, 20), cols[i], 8);
        this.ring(p.x, p.y, GOLD, 14, 300, 0.9, 10);
      }
      this.kick(0.03);
    } else {
      sfx.play('lose');
      this.shake(0.4);
      if (this.scene.app.settings.shake !== false) this.scene.cameras.main.flash(500, 120, 20, 20, true);
    }
  }

  // ---- abilities ----

  onCast(ev, v, myId) {
    const char = ABILITY_OWNER[ev.ab];
    const col = HERO_COL[char] || 0xffffff;
    const ab = CHARACTERS[char]?.ability || {};
    const mine = ev.pid === myId;
    const x = ev.x, y = ev.y;
    const snd = (name, vol = 1) => { if (mine) sfx.play(name); else this.sfxAt(name, x, y, vol, 0.25); };
    switch (ev.ab) {
      case 'roar': {
        const R = ab.radius || 180;
        this.ring(x, y, col, 24, R, 0.38, 14);
        this.ring(x, y, 0xffffff, 12, R * 0.82, 0.32, 6, 0.06);
        this.ring(x, y, col, 8, R * 0.6, 0.3, 8, 0.12);
        this.disc(x, y, col, 20, R, 0.3, 0.35);
        this.burst(x, y, 0xffffff, 30, R * 0.9, 0.3, 12, 4);
        this.dust(x, y + 14, 12);
        this.word(x, y - 64, 'ROAR!', 0xb8f08a, 30, 0.9);
        this.shake(0.38);
        this.kick(0.025);
        snd('roar');
        break;
      }
      case 'healing_pulse': {
        const R = ab.radius || 220;
        this.ring(x, y, GREEN, 20, R, 0.55, 10);
        this.ring(x, y, 0xffffff, 10, R * 0.7, 0.45, 5, 0.08);
        this.disc(x, y, GREEN, 20, R, 0.5, 0.3);
        this.plus(x, y - 6, 8);
        for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; this.plusses.setParticleTint(GREEN); this.plusses.emitParticleAt(x + Math.cos(a) * R * 0.5, y + Math.sin(a) * R * 0.42, 1); }
        this.spark(x, y, 0xd8ffc8, 10);
        snd('healing_pulse');
        break;
      }
      case 'tail_whirl': {
        const R = ab.radius || 120;
        this.ring(x, y, col, R * 0.5, R, 0.25, 12);
        this.burst(x, y, col, R * 0.4, R * 1.1, 0.25, 8, 5);
        this.dust(x, y + 14, 8);
        this.spark(x, y, col, 6);
        snd('tail_whirl');
        break;
      }
      case 'meteor_call': {
        this.ring(x, y, col, 10, 80, 0.35, 7);
        this.ring(x, y, 0xffffff, 6, 50, 0.3, 4, 0.05);
        this.spark(x, y - 20, col, 8);
        this.spark(x, y - 20, 0xffb627, 6);
        // The marker comes from the view; time the whistle so it ends when the meteor lands (delay ~1 s).
        let mx = x, my = y;
        for (const h of v.hazards) if (h.kind === 'meteor' && h.owner === 'player' && h.p < 0.3) { mx = h.x; my = h.y; }
        snd('meteor_call');
        const dx = mx - this.scene.camX;
        sfx.play('meteor_fall', { delay: Math.max(0, (ab.delay || 1) - 0.62), vol: mine ? 0.9 : 0.5, pan: mine ? 0 : clamp(dx / 640, -1, 1) * 0.7 });
        this.shake(0.05);
        break;
      }
      default:
        this.ring(x, y, col, 10, 100, 0.4, 8);
        sfx.play(ev.ab);
    }
  }

  /** Called by the scene when a meteor lands (it sees the hazard pass from delay to impact). */
  meteorImpact(x, y, r) {
    this.disc(x, y, 0xffffff, r * 0.2, r * 0.9, 0.22, 0.85);
    this.disc(x, y, 0xffa040, r * 0.3, r * 1.15, 0.4, 0.55);
    this.ring(x, y, 0xffb627, r * 0.3, r * 1.25, 0.45, 14);
    this.ring(x, y, 0xfff4dc, r * 0.2, r * 0.95, 0.3, 6, 0.04);
    this.puff(x, y, 0xff8a3a, 22);
    this.puff(x, y, 0x5a4636, 12);
    this.spark(x, y, 0xffd36b, 16);
    this.burst(x, y, 0xffe0a0, r * 0.3, r * 1.2, 0.3, 12, 5);
    const s = this.shape(K_CRACKS, x, y, 1.1, 0x3a2d21);
    s.r1 = r * 0.9; s.a = x * 0.011 + y * 0.017; s.n = 9;
    this.shake(0.5);
    this.kick(0.03);
    this.sfxAt('meteor_hit', x, y, 1, 0.4);
  }

  // ---- frame ----

  /** Clear everything (new run / back at the menu). */
  reset() {
    for (const n of this.nums) { n.setVisible(false); this.numFree.push(n); }
    this.nums.length = 0;
    this.recent.clear();
    this.bigRecent.clear();
    for (const w of this.words) { w.setVisible(false); this.wordFree.push(w); }
    this.words.length = 0;
    while (this.shapes.length) this.shapePool.push(this.shapes.pop());
    this.burn.clear();
    for (const e of [this.puffs, this.sparks, this.bones, this.dusts, this.plusses, this.embers, this.glints, this.trails]) e.killAll();
    this.trauma = 0; this.zoomKick = 0;
    this.g.clear(); this.gl.clear();
  }

  update(dms) {
    const dt = Math.min(0.1, dms / 1000);
    this.dt = dt;
    this.pickT -= dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    this.zoomKick = Math.max(0, this.zoomKick - dt * 0.22 - this.zoomKick * dt * 6);
    this.burn.forEach(this._burnCb);

    // Floating numbers.
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const t = this.nums[i];
      if (t.big) {
        // Elite / boss counter: follows the sprite, counts up, fades after the hits stop.
        t.since += dt;
        t.age += dt;
        const fade = (t.since - BIG_MERGE) / BIG_FADE;
        if (fade >= 1) {
          t.setVisible(false);
          this.nums.splice(i, 1);
          this.numFree.push(t);
          this.forget(t);
          continue;
        }
        const f = fade > 0 ? fade : 0;
        const r = this.scene.pools?.enemies?.get(t.eid);
        if (r) { t.ax = r.body.x; t.ay = r.body.y; }
        t.rise += (BIG_RISE + BIG_FADE_RISE * f - t.rise) * Math.min(1, dt * 7);
        if (t.shown < t.sum) t.shown = Math.min(t.sum, t.shown + Math.max(2, (t.sum - t.shown) * Math.min(1, dt * 14)));
        const shown = Math.round(t.shown);
        if (shown !== t.txt) { t.txt = shown; t.setText(String(shown)); }
        if (t.critT > 0) { t.critT -= dt; if (t.critT <= 0) t.setTint(0xffffff); }
        const pk = t.age < 0.14 ? 1 - t.age / 0.14 : 0;
        const size = BIG_SIZE + Math.min(6, Math.sqrt(t.sum) * 0.09) + (t.critT > 0 ? 7 : 0);
        t.setScale(size * NUM_K * (1 + t.pop * pk));
        t.setPosition(t.ax + t.ox, t.ay - t.lift - t.rise);
        t.setAlpha(1 - f);
        continue;
      }
      t.age += dt;
      t.y += t.vy * dt;
      t.vy *= Math.pow(0.04, dt);
      const k = t.age / t.life;
      if (k >= 1) {
        t.setVisible(false);
        this.nums.splice(i, 1);
        this.numFree.push(t);
        this.forget(t);
        continue;
      }
      const pk = t.age < 0.14 ? 1 - t.age / 0.14 : 0;
      t.setScale(t.base * (1 + t.pop * pk));
      if (t.jit && k < 0.3) t.x += Math.sin(t.age * 90) * t.jit * 0.5;
      t.setAlpha(k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1);
    }
    for (let i = this.words.length - 1; i >= 0; i--) {
      const t = this.words[i];
      t.age += dt;
      t.y += t.vy * dt;
      const k = t.age / t.life;
      if (k >= 1) { t.setVisible(false); this.words.splice(i, 1); this.wordFree.push(t); continue; }
      t.setScale(t.age < 0.15 ? 1.5 - (t.age / 0.15) * 0.5 : 1);
      t.setAlpha(k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1);
    }

    // Shapes.
    const g = this.g, gl = this.gl;
    g.clear(); gl.clear();
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const s = this.shapes[i];
      s.t += dt;
      if (s.t < 0) continue;
      const k = s.t / s.dur;
      if (k >= 1) { this.shapePool.push(s); this.shapes[i] = this.shapes[this.shapes.length - 1]; this.shapes.pop(); continue; }
      this.drawShape(s, k, g, gl);
    }

    this.sparkBudget = 14; this.numBudget = 5; this.deathBudget = 10; this.puffBudget = 60;
  }

  drawShape(s, k, g, gl) {
    const e = 1 - (1 - k) * (1 - k);
    const inv = 1 - k;
    switch (s.kind) {
      case K_RING:
        g.lineStyle(s.w * inv + 1.5, s.color, s.alpha * inv);
        g.strokeCircle(s.x, s.y, s.r0 + (s.r1 - s.r0) * e);
        break;
      case K_DISC:
        gl.fillStyle(s.color, s.alpha * inv * inv);
        gl.fillCircle(s.x, s.y, s.r0 + (s.r1 - s.r0) * e);
        break;
      case K_BEAM:
        gl.lineStyle(22 * inv + 3, s.color, 0.5 * inv).lineBetween(s.x, s.y, s.x2, s.y2);
        g.lineStyle(9 * inv + 1.5, s.color, 0.85 * inv).lineBetween(s.x, s.y, s.x2, s.y2);
        g.lineStyle(3.5 * inv + 0.5, 0xffffff, inv).lineBetween(s.x, s.y, s.x2, s.y2);
        break;
      case K_ARC: {
        // A crescent that sweeps across the arc: bright leading edge, fading tail.
        const rad = s.r1 * (0.72 + 0.28 * e), th = s.w * (1 - k * 0.6);
        const a0 = s.a - s.arc / 2, span = s.arc;
        const head = a0 + span * Math.min(1, k * 2.6);
        const tail = a0 + span * Math.max(0, (k - 0.12) * 1.5);
        if (head > tail + 0.02) {
          // Dark edge for contrast on the light ground, white body, bright leading edge.
          g.lineStyle(7, 0x2b2118, 0.35 * inv);
          g.beginPath(); g.arc(s.x, s.y, rad + 2, tail, head, false); g.strokePath();
          g.fillStyle(0xffffff, 0.7 * inv + 0.15);
          g.beginPath(); g.arc(s.x, s.y, rad, tail, head, false); g.arc(s.x, s.y, rad - th, head, tail, true); g.closePath(); g.fillPath();
          g.lineStyle(3, 0xffffff, inv);
          g.beginPath(); g.arc(s.x, s.y, rad, tail, head, false); g.strokePath();
        }
        break;
      }
      case K_STAB: {
        const c = Math.cos(s.a), sn = Math.sin(s.a);
        const len = s.r1 * (1 - Math.pow(1 - Math.min(1, k * 3), 2));
        const hw = s.w * (1 - k * 0.5);
        const bx = s.x + c * 16, by = s.y + sn * 16, tx = s.x + c * len, ty = s.y + sn * len;
        g.lineStyle(5, 0x2b2118, 0.4 * inv);
        g.lineBetween(bx - sn * hw, by + c * hw, tx, ty); g.lineBetween(bx + sn * hw, by - c * hw, tx, ty);
        g.fillStyle(0xffffff, 0.85 * inv + 0.1);
        g.fillTriangle(bx - sn * hw, by + c * hw, bx + sn * hw, by - c * hw, tx, ty);
        g.lineStyle(3, 0xffffff, inv).lineBetween(bx, by, tx, ty);
        gl.fillStyle(0xffffff, 0.6 * inv).fillCircle(tx, ty, 10 * inv + 2);
        break;
      }
      case K_BURST: {
        const ri = s.r0 + (s.r1 - s.r0) * e * 0.5, ro = s.r0 + (s.r1 - s.r0) * e;
        g.lineStyle(s.w * inv + 1, s.color, inv);
        for (let j = 0; j < s.n; j++) {
          const a = s.a + (j * TAU) / s.n, c = Math.cos(a), sn = Math.sin(a);
          g.lineBetween(s.x + c * ri, s.y + sn * ri, s.x + c * ro, s.y + sn * ro);
        }
        break;
      }
      case K_CRACKS: {
        // Jagged cracks radiating from an impact, drawn from a fixed pseudo-random pattern.
        const grow = Math.min(1, k * 6), fade = k < 0.5 ? 1 : 1 - (k - 0.5) * 2;
        g.lineStyle(3, s.color, 0.6 * fade);
        for (let j = 0; j < s.n; j++) {
          const base = s.a + (j * TAU) / s.n + Math.sin(j * 12.9 + s.a) * 0.2;
          let px = s.x, py = s.y;
          for (let sg = 1; sg <= 4; sg++) {
            const a = base + Math.sin(j * 7.3 + sg * 3.1 + s.a) * 0.35;
            const d = (s.r1 / 4) * grow * (0.8 + 0.4 * Math.abs(Math.sin(j * 3.7 + sg)));
            const nx = px + Math.cos(a) * d, ny = py + Math.sin(a) * d * 0.85;
            g.lineBetween(px, py, nx, ny);
            px = nx; py = ny;
          }
        }
        break;
      }
      case K_PILLAR: {
        const hw = (s.w / 2) * (1 - k * 0.7), h = s.r1 * Math.min(1, k * 4);
        gl.fillGradientStyle(s.color, s.color, s.color, s.color, 0, 0, 0.55 * inv, 0.55 * inv);
        gl.fillRect(s.x - hw, s.y - h, hw * 2, h);
        break;
      }
      case K_SWEEP: {
        // A thick arc spinning once around its centre (the ankylosaurus tail).
        const rad = s.r1 * 0.92;
        const head = s.a + TAU * e, len = Math.PI * 1.2 * inv + 0.3;
        g.lineStyle(s.w * inv + 4, s.color, 0.85 * inv);
        g.beginPath(); g.arc(s.x, s.y, rad, head - len, head, false); g.strokePath();
        g.lineStyle(3, 0xffffff, inv);
        g.beginPath(); g.arc(s.x, s.y, rad, head - len * 0.5, head, false); g.strokePath();
        break;
      }
      default:
    }
  }
}

export { PLAYER_COLORS };
