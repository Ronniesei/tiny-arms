// Renders the current view (from session.view()) and plays effects from events.
// Reads only the view format documented in src/net/protocol.js, never sim internals.
//
// Frame order: events first (so hit flashes and death ghosts land on the right frame), then the world is drawn
// from the view, then effects update, then the camera (follow, shake, zoom kick) and the HUD.
// Everything is pooled: sprite records are kept per entity id, shared Graphics draw telegraphs and bars,
// and small sprite pools serve the transient markers (stars, "!" icons, glows, meteors).

import { BALANCE } from '../data/balance.js';
import { ENEMIES } from '../data/enemies.js';
import { WEAPONS } from '../data/weapons.js';
import { CHARACTERS } from '../data/characters.js';
import { SPRITES, PLAYER_COLORS } from './art.js';
import { Fx } from './fx.js';
import { Hud } from './hud.js';
import { music } from '../audio/music.js';

const AW = BALANCE.arena.w, AH = BALANCE.arena.h;
const ZOOM = 1.25; // review round 1: show more of the arena (1536x864 world px)
const RED = 0xff3b3b;
const TAU = Math.PI * 2;
const AMBER = 0xffb627;
const RING_BAND = (ENEMIES.trike?.ringBand ?? 24) + BALANCE.player.radius * 0.5; // half-width of the danger band of a stomp ring
const FLYERS = { ptero: 16, mosquito: 8 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rr = (a, b) => a + (b - a) * Math.random();
const hexNum = (css) => parseInt(String(css || '#ffffff').replace('#', ''), 16) || 0xffffff;
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }

/** A pool of images that are handed out afresh each frame (begin/get/end), for short-lived markers. */
class SpritePool {
  constructor(scene, layer, key, depth, add = false) {
    this.scene = scene; this.layer = layer; this.key = key; this.depth = depth; this.add = add;
    this.items = []; this.n = 0;
  }
  begin() { this.n = 0; }
  get() {
    let s = this.items[this.n];
    if (!s) {
      s = this.scene.add.image(0, 0, this.key).setDepth(this.depth);
      if (this.add) s.setBlendMode(Phaser.BlendModes.ADD);
      this.layer.add(s);
      this.items.push(s);
    }
    this.n++;
    return s.setVisible(true);
  }
  end() { for (let i = this.n; i < this.items.length; i++) this.items[i].setVisible(false); }
  clear() { for (const s of this.items) s.destroy(); this.items.length = 0; this.n = 0; }
}

export class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  create() {
    this.app = this.registry.get('app');
    if (this.app.params.debug) window.__scene = this; // test hook (with ?debug=1)
    this.world = this.add.layer();
    this.hudLayer = this.add.layer();
    this.cameras.main.setZoom(ZOOM);
    this.cameras.main.setBounds(-300, -300, AW + 600, AH + 600);
    this.cameras.main.centerOn(AW / 2, AH / 2);
    this.cameras.main.ignore(this.hudLayer);
    this.hudCam = this.cameras.add(0, 0, 1920, 1080);
    this.hudCam.ignore(this.world);

    this.buildArena();
    this.groundG = this.add.graphics().setDepth(2);
    this.world.add(this.groundG);
    this.barG = this.add.graphics().setDepth(8000);
    this.world.add(this.barG);
    this.overG = this.add.graphics().setDepth(8300);
    this.world.add(this.overG);

    this.pools = { players: new Map(), enemies: new Map(), projectiles: new Map(), shots: new Map(), pickups: new Map(), summons: new Map() };
    this.weaponAnim = new Map();   // pid*16+slot -> {kind, a, t, reach, arc}
    this.weaponPos = new Map();    // pid*16+slot -> {x, y} (where the weapon sprite is this frame)
    this.hazState = new Map();     // hazard id -> {imp, seen}
    this.ghosts = [];              // death "pops"
    this.ghostFree = [];
    this.starPool = new SpritePool(this, this.world, 'fx_star', 8010);
    this.exclPool = new SpritePool(this, this.world, 'fx_excl', 8020);
    this.glowPool = new SpritePool(this, this.world, 'fx_glow', 4.5, true);
    this.shotGlowPool = new SpritePool(this, this.world, 'fx_glow', 7.4, true);
    this.metPool = new SpritePool(this, this.world, 'fx_meteor', 8350, true);
    this._destroyRec = (r) => this.destroyRec(r);
    this._destroySimple = (r) => r.body.destroy();
    this._destroyEnemy = (r) => this.destroyEnemy(r);
    this._hazSweep = (st, id) => { if (st.seen !== this.frameNo) this.hazState.delete(id); };

    this.fx = new Fx(this, this.world);
    this.hud = new Hud(this, this.hudLayer);
    this.camX = AW / 2; this.camY = AH / 2;
    this.frameNo = 0;
    this.lastTick = -1;
    this.enraged = false;
    this.cleared = true;
    this.musicVol = -1;
  }

  addWorld(obj, depth) {
    if (depth !== undefined) obj.setDepth(depth);
    this.world.add(obj);
    return obj;
  }

  buildArena() {
    const rnd = new Phaser.Math.RandomDataGenerator(['tiny-arms']);
    this.decor = []; // static props: hidden while they are off screen
    // Outside the arena: darker ground.
    const outside = this.add.tileSprite(AW / 2, AH / 2, AW + 1400, AH + 1400, 'ground').setTint(0x9a8a62);
    this.addWorld(outside, -20);
    const ground = this.add.tileSprite(AW / 2, AH / 2, AW, AH, 'ground');
    this.addWorld(ground, -10);
    // Sparse decorations inside.
    for (let i = 0; i < 36; i++) {
      const key = rnd.frac() < 0.6 ? 'pebbles' : 'fern';
      const d = this.add.image(rnd.between(80, AW - 80), rnd.between(80, AH - 80), key).setScale(0.5).setAlpha(key === 'fern' ? 0.55 : 0.5);
      this.addWorld(d, -5);
      this.decor.push(d);
    }
    // Rock ring around the edge.
    const rocks = ['rock1', 'rock2', 'rock3'];
    const step = 54;
    const place = (x, y) => {
      const r = this.add.image(x + rnd.between(-10, 10), y + rnd.between(-10, 10), rnd.pick(rocks)).setScale(0.5 * rnd.realInRange(0.85, 1.25));
      r.setFlipX(rnd.frac() < 0.5);
      this.addWorld(r, 1 + y / 100000);
      this.decor.push(r);
    };
    for (let x = -30; x <= AW + 30; x += step) { place(x, -34); place(x, AH + 34); }
    for (let y = 20; y <= AH - 20; y += step) { place(-34, y); place(AW + 34, y); }
  }

  // ---- records ----

  getPlayer(p) {
    let r = this.pools.players.get(p.id);
    if (!r) {
      const col = PLAYER_COLORS[p.id % 4];
      r = {
        shadow: this.addWorld(this.add.image(0, 0, 'shadow').setScale(0.5), 3),
        ring: this.addWorld(this.add.image(0, 0, 'ring').setScale(0.55).setTint(col).setAlpha(0.9), 3),
        body: this.addWorld(this.add.image(0, 0, `h_${p.char}`).setScale(0.5), 5),
        name: this.addWorld(this.add.text(0, 0, p.name, { fontFamily: 'Fredoka, "Trebuchet MS", sans-serif', fontSize: '15px', color: '#fff4dc', stroke: '#2b2118', strokeThickness: 4 }).setOrigin(0.5, 1), 8000),
        weapons: [],
        char: p.char, seen: 0,
        px: p.x, py: p.y, vx: 0, at: 0, hit: 0, spin: 0, dustT: 0, wa: p.facing < 0 ? Math.PI : 0, tint: 0, nameTxt: null, sparkT: 0,
      };
      this.pools.players.set(p.id, r);
    }
    if (r.char !== p.char) { r.body.setTexture(`h_${p.char}`); r.char = p.char; }
    return r;
  }

  newEnemy(e, def, key, t) {
    const r = {
      shadow: this.addWorld(this.add.image(0, 0, 'shadow'), 3),
      body: this.addWorld(this.add.image(e.x, e.y, key).setScale(0.5), 5),
      type: e.type, seen: 0, boss: e.boss, elite: e.elite,
      phase: Math.random() * 6, born: t, at: Math.random() * 3,
      px: e.x, py: e.y, spd: 0, hitT: 0, sq: 0, freeze: 0, tint: 0, hadTele: false, dustT: 0, emberT: 0,
      killed: false, key,
    };
    this.pools.enemies.set(e.id, r);
    return r;
  }

  sweep(pool, destroy) {
    for (const [id, r] of this.pools[pool]) {
      if (r.seen !== this.frameNo) { destroy(r); this.pools[pool].delete(id); }
    }
  }

  destroyRec(r) {
    for (const k of ['shadow', 'ring', 'body', 'name', 'spr']) r[k]?.destroy();
    if (r.weapons) r.weapons.forEach((w) => w.destroy());
  }

  destroyEnemy(r) {
    // Swept without a kill event (the wave ended and the rest vanished): a soft little poof.
    if (!r.killed) this.fx.puff(r.body.x, r.body.y, SPRITES[ENEMIES[r.type]?.sprite]?.[1] || 0xa8432a, 3);
    r.shadow.destroy();
    r.body.destroy();
  }

  clearAll() {
    for (const pool of Object.keys(this.pools)) {
      for (const [, r] of this.pools[pool]) {
        if (pool === 'players') this.destroyRec(r);
        else if (pool === 'enemies') { r.shadow.destroy(); r.body.destroy(); }
        else { r.body.destroy(); r.shadow?.destroy(); }
      }
      this.pools[pool].clear();
    }
    for (const g of this.ghosts) { g.setVisible(false); this.ghostFree.push(g); }
    this.ghosts.length = 0;
    this.weaponAnim.clear();
    this.weaponPos.clear();
    this.hazState.clear();
  }

  // ---- hooks called by Fx on events ----

  enemyHit(id, crit) {
    const r = this.pools.enemies.get(id);
    if (!r) return;
    // Under constant fire (bosses, elites) a flash on every hit turns the sprite solid white, so
    // re-trigger the flash/squash at most ~4 times a second (crits a bit more often).
    const now = performance.now() / 1000;
    if (now - (r.lastHit || 0) < (crit ? 0.12 : 0.24)) return;
    r.lastHit = now;
    r.hitT = 0.07;
    r.sq = 1;
    r.freeze = crit ? 0.075 : 0.035;
  }

  /** A death "pop": the sprite flashes white, swells and fades while the particles fly. */
  enemyKilled(ev, big) {
    const r = this.pools.enemies.get(ev.id);
    if (r) r.killed = true;
    const def = ENEMIES[ev.et];
    const key = r ? r.key : def?.sprite || 'e_raptor';
    if (!this.textures.exists(key) || this.ghosts.length >= 48) return;
    let g = this.ghostFree.pop();
    if (!g) g = this.addWorld(this.add.image(0, 0, key), 5.5);
    g.setTexture(key).setVisible(true).setAlpha(1).setTintFill(0xffffff);
    g.setPosition(r ? r.body.x : ev.x, r ? r.body.y : ev.y);
    const sc = r ? Math.max(0.2, Math.abs(r.body.scaleX)) : 0.5;
    g.setScale(sc, sc);
    g.setFlipX(r ? r.body.flipX : false);
    g.setRotation(r ? r.body.rotation : 0);
    g.sc0 = sc; g.age = 0; g.dur = big ? 0.42 : 0.2; g.grow = big ? 0.28 : 0.4; g.vy = big ? -10 : -30; g.vr = rr(-2, 2);
    this.ghosts.push(g);
  }

  playerHit(pid) {
    const r = this.pools.players.get(pid);
    if (r) r.hit = 1;
  }

  // ---- frame ----

  update(time, delta) {
    this.frameNo++;
    const dt = Math.max(0.004, Math.min(0.1, delta / 1000));
    const s = this.app.session;
    const v = s?.view();
    const t = time / 1000;
    this.t = t;
    this.groundG.clear();
    this.overG.clear();
    this.barG.clear();
    this.updateAudio(v);
    if (!v) {
      if (!this.cleared) { this.clearAll(); this.fx.reset(); this.cleared = true; }
      this.drawGhosts(dt);
      this.hud.update(null, null, this.app, delta);
      this.cameras.main.centerOn(AW / 2 + Math.sin(t * 0.1) * 200, AH / 2 + Math.cos(t * 0.13) * 150);
      return;
    }
    this.cleared = false;
    if (v.tick < this.lastTick) { this.clearAll(); this.fx.reset(); this.enraged = false; } // a new run started
    this.lastTick = v.tick;
    const myId = s.myId;

    for (const ev of s.takeEvents()) this.onEvent(ev, v, myId);

    this.starPool.begin(); this.exclPool.begin(); this.glowPool.begin(); this.shotGlowPool.begin(); this.metPool.begin();
    const wv = this.cameras.main.worldView;
    this.vx0 = wv.x - 90; this.vx1 = wv.right + 90; this.vy0 = wv.y - 90; this.vy1 = wv.bottom + 90;
    for (const d of this.decor) d.setVisible(d.x > this.vx0 - 60 && d.x < this.vx1 + 60 && d.y > this.vy0 - 60 && d.y < this.vy1 + 60);
    this.drawHazards(v, t, dt);
    this.drawMarks(v, t);
    this.drawPlayers(v, t, dt, myId);
    this.drawEnemies(v, t, dt);
    this.drawProjectiles(v, t, dt);
    this.drawPickups(v, t, dt);
    this.drawSummons(v, t);
    this.drawGhosts(dt);
    this.starPool.end(); this.exclPool.end(); this.glowPool.end(); this.shotGlowPool.end(); this.metPool.end();
    this.fx.update(delta);

    const cam = this.cameras.main;
    const me = v.players.find((p) => p.id === myId);
    if (me) {
      const k = 1 - Math.pow(0.0001, dt);
      this.camX += (me.x - this.camX) * Math.min(1, k * 1.2);
      this.camY += (me.y - this.camY) * Math.min(1, k * 1.2);
    }
    const tr = this.fx.trauma, mag = tr * tr * 16;
    cam.setZoom(ZOOM * (1 + this.fx.zoomKick));
    cam.centerOn(
      this.camX + (Math.sin(t * 83.1) + Math.sin(t * 47.3 + 1.3)) * 0.5 * mag,
      this.camY + (Math.sin(t * 61.7 + 2.1) + Math.sin(t * 39.9)) * 0.5 * mag,
    );
    this.hud.update(v, s.me(), this.app, delta);
  }

  updateAudio(v) {
    const mode = !v ? 'menu' : v.phase === 'wave' ? (v.wave >= BALANCE.waves.count ? 'boss' : 'wave') : v.phase === 'shop' ? 'shop' : 'menu';
    music.setMode(mode, v ? v.wave : 1);
    const mv = this.app.settings.music ?? 0.4;
    if (mv !== this.musicVol) { this.musicVol = mv; music.setVolume(mv); }
  }

  onEvent(ev, v, myId) {
    if (ev.type === 'swing' || ev.type === 'shoot' || ev.type === 'beam') {
      const key = ev.pid * 16 + ev.slot;
      let an = this.weaponAnim.get(key);
      if (!an) { an = {}; this.weaponAnim.set(key, an); }
      an.kind = ev.type === 'swing' ? (ev.thrust ? 'thrust' : 'swing') : 'shoot';
      an.a = ev.a; an.t = 0; an.reach = ev.r || 80; an.arc = ((ev.arc || 90) * Math.PI) / 180;
    }
    this.fx.onEvent(ev, v, myId);
    this.hud.onEvent(ev, v, myId);
  }

  // ---- players ----

  drawPlayers(v, t, dt, myId) {
    const bg = this.barG;
    for (const p of v.players) {
      if (p.gone) continue;
      const r = this.getPlayer(p);
      r.seen = this.frameNo;
      const size = SPRITES[`h_${p.char}`][0];
      // Smoothed velocity (for the lean) from the position change.
      r.vx += ((p.x - r.px) / dt - r.vx) * Math.min(1, dt * 14);
      r.px = p.x; r.py = p.y;
      const moving = p.moving && !p.downed;
      r.at += dt * (moving ? 1 + clamp(Math.abs(r.vx) / 300, 0, 1) * 0.3 : 0.18);
      const bob = moving ? Math.abs(Math.sin(r.at * 13)) : 0;
      const breathe = Math.sin(t * 2.4 + p.id) * 0.025;
      r.hit = Math.max(0, r.hit - dt / 0.22);
      const hs = r.hit * r.hit;
      const whirl = p.casting && p.char === 'spike';
      if (whirl) r.spin += dt * 26; else r.spin = 0;
      const col = PLAYER_COLORS[p.id % 4];
      const heroCol = hexNum(CHARACTERS[p.char]?.color);

      r.shadow.setPosition(p.x, p.y + size * 0.42).setScale(0.5 * (1 - bob * 0.06), 0.5 * (1 - bob * 0.06)).setDepth(3);
      const pulse = 1 + 0.025 * Math.sin(t * 4 + p.id);
      r.ring.setPosition(p.x, p.y + size * 0.42).setScale(0.55 * pulse).setDepth(3).setAlpha(p.downed ? 0.4 : p.id === myId ? 1 : 0.85);
      r.body.setPosition(p.x, p.y - bob * 6 + (p.downed ? 8 : 0));
      r.body.setFlipX(p.facing < 0);
      const sy = 1 - breathe * 0.5 - bob * 0.05 + bob * 0.02 - hs * 0.2;
      const sx = 1 + breathe + bob * 0.04 + hs * 0.24;
      r.body.setScale(0.5 * sx, 0.5 * sy);
      r.body.setDepth(5 + p.y / 10000);
      let rot;
      if (p.downed) rot = p.facing < 0 ? -1.4 : 1.4;
      else if (whirl) rot = r.spin * (p.facing < 0 ? -1 : 1);
      else if (p.rolling) rot = ((t * 19) % (Math.PI * 2)) * (p.facing < 0 ? -1 : 1);
      else rot = clamp(r.vx / 300, -1, 1) * 0.12 + Math.sin(r.at * 13) * (moving ? 0.05 : 0);
      r.body.setRotation(rot);
      const tint = p.flash || r.hit > 0.7 ? 1 : p.downed ? 2 : 0;
      if (tint !== r.tint) {
        r.tint = tint;
        if (tint === 1) r.body.setTintFill(0xffffff); else if (tint === 2) r.body.setTint(0x9a9a9a); else r.body.clearTint();
      }
      r.body.setAlpha(p.iframes && !p.downed ? 0.55 + 0.45 * Math.abs(Math.sin(t * 30)) : 1);

      // Dust at the feet while running.
      r.dustT -= dt;
      if (moving && r.dustT <= 0 && !whirl) {
        r.dustT = 0.15;
        this.fx.dust(p.x - Math.sign(r.vx || p.facing) * 6, p.y + size * 0.42, 1);
      }

      const nameTxt = p.id === myId ? '' : p.name;
      if (r.nameTxt !== nameTxt) { r.nameTxt = nameTxt; r.name.setText(nameTxt); r.name.setColor('#' + col.toString(16).padStart(6, '0')); }
      r.name.setPosition(p.x, p.y - size * 0.62);
      if (p.id !== myId || p.hp < p.maxHp) {
        const bw = 46, bx = p.x - bw / 2, by = p.y - size * 0.6;
        bg.fillStyle(0x2b2118, 1).fillRoundedRect(bx - 2, by - 2, bw + 4, 9, 3);
        bg.fillStyle(p.hp / p.maxHp > 0.35 ? 0x6fd14a : 0xff4a3a, 1).fillRoundedRect(bx, by, Math.max(0, bw * (p.hp / p.maxHp)), 5, 2);
      }
      const g = this.groundG;
      if (p.downed) {
        // Revive progress ring and a pulsing red warning ring.
        g.lineStyle(5, 0xffffff, 0.35).strokeCircle(p.x, p.y, BALANCE.revive.radius);
        g.lineStyle(4, RED, 0.35 + 0.3 * Math.sin(t * 8)).strokeCircle(p.x, p.y, 40 + 4 * Math.sin(t * 8));
        g.lineStyle(7, col, 1).beginPath();
        g.arc(p.x, p.y, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.reviveP, false).strokePath();
      }
      if (whirl) this.drawWhirl(p, r, heroCol, dt);
      this.drawWeapons(p, r, t, dt);
    }
    this.sweep('players', this._destroyRec);
    // Herd spirit: faint links between mates close enough to buff each other.
    const HR = BALANCE.coop.herdRadius;
    for (let i = 0; i < v.players.length; i++) {
      const a = v.players[i];
      if (a.gone || a.downed) continue;
      for (let j = i + 1; j < v.players.length; j++) {
        const b = v.players[j];
        if (b.gone || b.downed || (a.x - b.x) ** 2 + (a.y - b.y) ** 2 > HR * HR) continue;
        this.groundG.lineStyle(4, 0x7dff6a, 0.22).lineBetween(a.x, a.y + 20, b.x, b.y + 20);
      }
    }
  }

  /** Tail Whirl: spinning trails around Spike for as long as the sim says the ability is running. */
  drawWhirl(p, r, col, dt) {
    const R = CHARACTERS.spike.ability.radius || 120;
    const g = this.overG, gg = this.groundG;
    gg.lineStyle(4, col, 0.3).strokeCircle(p.x, p.y, R);
    gg.fillStyle(col, 0.1).fillCircle(p.x, p.y, R);
    const dir = p.facing < 0 ? -1 : 1;
    for (let j = 0; j < 3; j++) {
      const a = dir * r.spin * 0.9 + (j * TAU) / 3;
      const a0 = dir > 0 ? a - 1.15 : a, a1 = dir > 0 ? a : a + 1.15;
      g.lineStyle(11, col, 0.5).beginPath(); g.arc(p.x, p.y, R * 0.82, a0, a1, false); g.strokePath();
      g.lineStyle(4, 0xffffff, 0.85).beginPath(); g.arc(p.x, p.y, R * 0.82, dir > 0 ? a - 0.4 : a, dir > 0 ? a : a + 0.4, false); g.strokePath();
    }
    r.sparkT -= dt;
    if (r.sparkT <= 0) {
      r.sparkT = 0.05;
      const a = dir * r.spin * 0.9;
      this.fx.spark(p.x + Math.cos(a) * R * 0.85, p.y + Math.sin(a) * R * 0.85, col, 1);
      this.fx.dust(p.x + Math.cos(a + 2) * R * 0.7, p.y + 20 + Math.sin(a + 2) * R * 0.3, 1);
    }
  }

  drawWeapons(p, r, t, dt) {
    const n = p.weapons.length;
    while (r.weapons.length < n) r.weapons.push(this.addWorld(this.add.image(0, 0, 'w_stone_axe').setScale(0.5), 6));
    while (r.weapons.length > n) r.weapons.pop().destroy();
    const R = BALANCE.player.weaponOrbit;
    // The weapon ring turns toward the way the T-Rex faces, with a little drift.
    r.wa += angDiff(r.wa, p.facing < 0 ? Math.PI : 0) * Math.min(1, dt * 9);
    for (let i = 0; i < n; i++) {
      const wp = p.weapons[i];
      const def = WEAPONS[wp.wid];
      const spr = r.weapons[i];
      const key = def ? `w_${def.id}` : 'w_stone_axe';
      if (spr.texture.key !== key) spr.setTexture(key);
      const a = r.wa + (n <= 1 ? 0 : (i * TAU) / n) + Math.sin(t * 1.3 + i * 1.7) * 0.06;
      const baseX = p.x + Math.cos(a) * R, baseY = p.y + Math.sin(a) * R * 0.8 - (p.downed ? -10 : 4) + Math.sin(t * 3 + i) * 1.5;
      let x = baseX, y = baseY;
      let rot = a;
      const ak = p.id * 16 + i;
      const an = this.weaponAnim.get(ak);
      if (an) {
        an.t += dt;
        if (an.kind === 'swing') {
          // Sweep along the arc the crescent shows.
          const k = Math.min(1, an.t / 0.17), e = 1 - (1 - k) * (1 - k);
          const ang = an.a - an.arc / 2 + an.arc * e;
          const reach = an.reach * 0.55;
          const w = an.t < 0.17 ? 1 : 1 - Math.min(1, (an.t - 0.17) / 0.16);
          x = baseX + (p.x + Math.cos(ang) * reach - baseX) * w;
          y = baseY + (p.y + Math.sin(ang) * reach * 0.85 - baseY) * w;
          rot = rot + angDiff(rot, ang) * w;
        } else if (an.kind === 'thrust') {
          const k = Math.min(1, an.t / 0.2);
          const out = Math.sin(k * Math.PI);
          x += Math.cos(an.a) * an.reach * 0.65 * out;
          y += Math.sin(an.a) * an.reach * 0.65 * out;
          rot = rot + angDiff(rot, an.a) * Math.min(1, out * 2);
        } else {
          const k = Math.min(1, an.t / 0.15);
          x -= Math.cos(an.a) * 6 * (1 - k);
          y -= Math.sin(an.a) * 6 * (1 - k);
          const w = an.t < 0.22 ? 1 : 1 - Math.min(1, (an.t - 0.22) / 0.15);
          rot = rot + angDiff(rot, an.a) * w;
        }
        if (an.t > 0.45) this.weaponAnim.delete(ak);
      }
      let wpos = this.weaponPos.get(ak);
      if (!wpos) { wpos = { x: 0, y: 0 }; this.weaponPos.set(ak, wpos); }
      wpos.x = x; wpos.y = y;
      spr.setPosition(x, y).setRotation(rot + Math.PI / 4).setScale(0.5 * (1 + (wp.tier - 1) * 0.08)).setDepth(6 + p.y / 10000);
      spr.setAlpha(p.downed ? 0.3 : 1);
      if (wp.tier >= 3) spr.setTint(wp.tier === 4 ? 0xffd0d0 : 0xf0d8ff); else spr.clearTint();
    }
  }

  // ---- enemies ----

  drawEnemies(v, t, dt) {
    const g = this.groundG;
    const bg = this.barG;
    const x0 = this.vx0, x1 = this.vx1, y0 = this.vy0, y1 = this.vy1;
    const list = v.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const def = ENEMIES[e.type];
      const key = def?.sprite || 'e_raptor';
      let r = this.pools.enemies.get(e.id);
      if (!r) r = this.newEnemy(e, def, key, t);
      r.seen = this.frameNo;
      const size = SPRITES[key]?.[0] || 64;
      const fly = FLYERS[e.type] || 0;
      // Speed from the position change; used for the walk bob, the lean and dust trails.
      const dx = e.x - r.px, dy = e.y - r.py;
      r.px = e.x; r.py = e.y;
      r.spd += (Math.sqrt(dx * dx + dy * dy) / dt - r.spd) * 0.22;
      r.hitT = Math.max(0, r.hitT - dt);
      r.sq = Math.max(0, r.sq - dt / 0.16);
      r.freeze = Math.max(0, r.freeze - dt);
      const tl = e.tele;
      const inView = e.x > x0 && e.x < x1 && e.y > y0 && e.y < y1;
      const idleAi = def?.ai === 'none';
      r.at += r.freeze > 0 ? 0 : dt;
      const moveK = idleAi ? 0 : clamp(r.spd / 110, 0, 1);
      const wob = Math.sin(r.at * 10 + r.phase);
      const breathe = Math.sin(r.at * 2.6 + r.phase) * 0.02;
      const age = t - r.born;
      const pop = age < 0.2 ? 1 - Math.pow(1 - age / 0.2, 3) * 0.85 : 1;
      const sqh = r.sq * r.sq;
      let sx = 1 + wob * 0.03 * moveK + breathe + sqh * 0.26;
      let sy = 1 - wob * 0.03 * moveK - breathe * 0.6 - sqh * 0.2;
      if (tl) {
        // Anticipation: crouch for a line/circle attack, rear up and pulse for a flare.
        if (tl.k === 'flash') { const pl = 1 + 0.1 * Math.sin(tl.p * Math.PI * 6) + 0.1 * tl.p; sx *= pl; sy *= pl; }
        else { sy *= 1 - 0.1 * tl.p; sx *= 1 + 0.06 * tl.p; }
      }
      const feetY = e.y + size * 0.38;
      r.shadow.setPosition(e.x, feetY).setScale((size / 128) * (fly ? 0.75 : 1), (size / 140) * (fly ? 0.75 : 1));
      r.body.setPosition(e.x, e.y - fly - Math.abs(wob) * 3 * moveK);
      r.body.setScale(0.5 * pop * sx, 0.5 * pop * sy);
      const lean = (r.spd > 380 ? 0.22 : clamp(r.spd / 240, 0, 1) * 0.08) * e.facing;
      r.body.setRotation(lean + wob * 0.04 * moveK);
      r.body.setFlipX(e.facing < 0);
      const dep = 5 + e.y / 10000;
      if (dep !== r.dep) { r.dep = dep; r.body.setDepth(dep); }

      // Tint: hit flash > telegraph blink > burn > stun > enraged.
      let ts;
      if (r.hitT > 0) ts = 1;
      else if (tl && tl.k === 'flash' && Math.sin(tl.p * Math.PI * 6) > 0) ts = 2;
      else if (tl && tl.p > 0.82 && (e.elite || e.boss) && Math.sin(t * 36) > 0) ts = 2;
      else if (e.burn) ts = Math.sin(t * 20) > 0 ? 3 : 4;
      else if (e.stun) ts = 5;
      else if (e.boss && this.enraged) ts = 6;
      else ts = 0;
      if (ts !== r.tint) {
        r.tint = ts;
        if (ts === 1 || ts === 2) r.body.setTintFill(0xffffff);
        else if (ts === 3) r.body.setTint(0xffa060);
        else if (ts === 4) r.body.setTint(0xffffff);
        else if (ts === 5) r.body.setTint(0xb0b0ff);
        else if (ts === 6) r.body.setTint(0xff9a88);
        else r.body.clearTint();
      }

      if (inView) {
        // Elite and boss: a glowing ring at the feet and a health bar.
        if (e.elite || e.boss) {
          const pr = 0.5 + 0.3 * Math.sin(t * 5);
          g.lineStyle(5, e.boss ? 0xff5a4a : 0xffd23a, pr).strokeEllipse(e.x, feetY, size * 0.95, size * 0.34);
          const bw = size * 0.8, bx = e.x - bw / 2, by = e.y - size * 0.55 - fly;
          bg.fillStyle(0x2b2118, 1).fillRoundedRect(bx - 2, by - 2, bw + 4, 10, 3);
          bg.fillStyle(0xff4a3a, 1).fillRoundedRect(bx, by, Math.max(0, bw * e.hpP), 6, 2);
        }
        if (tl) {
          this.drawTele(e, tl, t);
          if (!r.hadTele) this.teleStart(e, tl);
          if (tl.k === 'flash' || e.elite || e.boss) {
            const ex = this.exclPool.get();
            ex.setPosition(e.x, e.y - size * 0.6 - fly - 8 - Math.abs(Math.sin(t * 12)) * 5).setScale(0.62 + 0.16 * Math.sin(t * 16)).setTint(tl.p > 0.8 ? 0xffffff : 0xff3b3b);
          }
        }
        if (e.stun) {
          const a = t * 6 + r.phase, top = e.y - size * 0.5 - fly;
          for (let k = 0; k < 2; k++) {
            const st = this.starPool.get();
            st.setPosition(e.x + Math.cos(a + k * Math.PI) * (size * 0.22), top + Math.sin(a + k * Math.PI) * 5).setScale(0.55).setTint(0xffe14a).setRotation(a * 2);
          }
        }
        // Dust behind a charging enemy; embers off a burning one.
        r.dustT -= dt;
        if (r.spd > 380 && r.dustT <= 0) { r.dustT = 0.035; this.fx.dust(e.x - Math.sign(e.facing) * size * 0.2, feetY - 4, 1); }
        if (e.burn) { r.emberT -= dt; if (r.emberT <= 0) { r.emberT = 0.12; this.fx.ember(e.x + rr(-size * 0.25, size * 0.25), e.y - size * 0.1); } }
      }
      r.hadTele = !!tl;
    }
    this.sweep('enemies', this._destroyEnemy);
  }

  /** The moment a telegraph first appears: a warning sound that matches the attack. */
  teleStart(e, tl) {
    const name = tl.k === 'flash' ? 'windup_flare' : tl.k === 'circle' ? 'windup_slam' : 'windup_charge';
    this.fx.sfxAt(name, e.x, e.y, e.boss || e.elite ? 1 : 0.75);
  }

  /** Telegraphs: red area at ~35% fill with a solid outline that fills up toward the strike. */
  drawTele(e, tl, t) {
    const g = this.groundG;
    const p = tl.p;
    const hot = p > 0.82 && Math.sin(t * 40) > 0;       // last moment: the outline flashes white
    const edge = hot ? 0xffffff : RED;
    if (tl.k === 'line') {
      const len = tl.len, wd = tl.wd || 40;
      const c = Math.cos(tl.a), s = Math.sin(tl.a);
      const nx = -s * wd / 2, ny = c * wd / 2;
      const ax = e.x + nx, ay = e.y + ny, bx = e.x + c * len + nx, by = e.y + s * len + ny;
      const cx = e.x + c * len - nx, cy = e.y + s * len - ny, dx = e.x - nx, dy = e.y - ny;
      g.fillStyle(RED, 0.2);
      g.fillTriangle(ax, ay, bx, by, cx, cy); g.fillTriangle(ax, ay, cx, cy, dx, dy);
      const fl = len * p;
      const fbx = e.x + c * fl + nx, fby = e.y + s * fl + ny, fcx = e.x + c * fl - nx, fcy = e.y + s * fl - ny;
      g.fillStyle(RED, 0.3);
      g.fillTriangle(ax, ay, fbx, fby, fcx, fcy); g.fillTriangle(ax, ay, fcx, fcy, dx, dy);
      g.lineStyle(4, edge, 0.95).beginPath();
      g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx, cy); g.lineTo(dx, dy); g.closePath(); g.strokePath();
      // Chevrons run along the lane inside the filled part (the direction of the strike), and an end mark.
      g.lineStyle(5, 0xffffff, 0.6);
      const step = 64, off = (t * 140) % step;
      for (let d = off; d < fl - 10; d += step) {
        const px = e.x + c * d, py = e.y + s * d;
        g.lineBetween(px - c * 14 + nx * 0.5, py - s * 14 + ny * 0.5, px, py);
        g.lineBetween(px - c * 14 - nx * 0.5, py - s * 14 - ny * 0.5, px, py);
      }
      g.lineStyle(5, edge, 0.95).strokeCircle(e.x + c * len, e.y + s * len, wd * 0.28 + 4 * p);
    } else if (tl.k === 'circle') {
      g.fillStyle(RED, 0.2).fillCircle(e.x, e.y, tl.r);
      g.fillStyle(RED, 0.32).fillCircle(e.x, e.y, tl.r * p);
      g.lineStyle(4, edge, 0.95).strokeCircle(e.x, e.y, tl.r);
      g.lineStyle(3, 0xffffff, 0.55).strokeCircle(e.x, e.y, tl.r * p);
    } else {
      // Flash: a pulsing warning ring around the enemy (the "!" and the blinking body do the rest).
      const rad = e.r * (1.35 + 0.5 * p);
      g.fillStyle(RED, 0.2 + 0.2 * (0.5 + 0.5 * Math.sin(t * 22))).fillCircle(e.x, e.y + e.r * 0.4, rad);
      g.lineStyle(4, edge, 0.95).strokeCircle(e.x, e.y + e.r * 0.4, rad);
    }
  }

  // ---- ground effects ----

  drawHazards(v, t, dt) {
    const g = this.groundG;
    for (const h of v.hazards) {
      let st = this.hazState.get(h.id);
      if (!st) { st = { imp: false, seen: 0, emberT: 0 }; this.hazState.set(h.id, st); }
      st.seen = this.frameNo;
      if (h.owner === 'enemy') {
        if (h.p < 1) {
          const hot = h.p > 0.82 && Math.sin(t * 40) > 0;
          g.fillStyle(RED, 0.2).fillCircle(h.x, h.y, h.r);
          g.fillStyle(RED, 0.3).fillCircle(h.x, h.y, h.r * h.p);
          g.lineStyle(4, hot ? 0xffffff : RED, 0.95).strokeCircle(h.x, h.y, h.r);
        } else if (h.kind === 'ring') {
          // The stomp shockwave: a thick red band with a white core, plus the outer limit of the danger zone.
          const cur = Math.max(h.cur || 0, 24);
          g.lineStyle(3, RED, 0.4).strokeCircle(h.x, h.y, h.r + RING_BAND);
          // The band is a stack of thin rings (one fat stroke leaves seams); the middle is brighter.
          for (let d = -RING_BAND + 5; d < RING_BAND; d += 9) {
            g.lineStyle(10, Math.abs(d) < RING_BAND * 0.45 ? 0xff6a4a : RED, 0.34).strokeCircle(h.x, h.y, cur + d);
          }
          g.lineStyle(5, 0xffffff, 0.9).strokeCircle(h.x, h.y, cur);
        } else {
          g.fillStyle(0xffffff, 0.3 * Math.max(0, 2 - h.p)).fillCircle(h.x, h.y, h.r);
          g.fillStyle(RED, 0.4 * Math.max(0, 2 - h.p)).fillCircle(h.x, h.y, h.r);
        }
      } else if (h.kind === 'meteor') {
        this.drawMeteor(h, st, t, dt);
      } else if (h.kind === 'fire') {
        const f = 0.24 + 0.07 * Math.sin(t * 18 + h.id);
        g.fillStyle(0xff6a1a, f).fillCircle(h.x, h.y, h.r);
        g.fillStyle(0xffc040, f * 0.8).fillCircle(h.x, h.y, h.r * 0.6);
        g.lineStyle(3, 0xff8a2a, 0.5 + 0.2 * Math.sin(t * 12 + h.id)).strokeCircle(h.x, h.y, h.r);
        st.emberT -= dt;
        if (st.emberT <= 0) {
          st.emberT = 0.07;
          const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * h.r;
          this.fx.ember(h.x + Math.cos(a) * d, h.y + Math.sin(a) * d * 0.8);
        }
      } else if (h.kind === 'bomb') {
        // Boom Boots: a ring that blinks faster as the fuse runs down, with a little lit bomb in the middle.
        if (h.p < 1) {
          const hot = Math.sin(t * (10 + 34 * h.p)) > 0;
          g.fillStyle(AMBER, 0.1 + 0.2 * h.p).fillCircle(h.x, h.y, h.r * (0.25 + 0.75 * h.p));
          g.lineStyle(4, hot ? 0xffffff : AMBER, 0.9).strokeCircle(h.x, h.y, h.r);
          g.fillStyle(0x2b2118, 1).fillCircle(h.x, h.y, 9);
          g.fillStyle(hot ? 0xffe14a : 0xff7a2a, 1).fillCircle(h.x + 4, h.y - 9, 3.5);
        }
      } else if (h.p < 1) {
        g.lineStyle(3, AMBER, 0.6).strokeCircle(h.x, h.y, h.r);
      }
    }
    this.hazState.forEach(this._hazSweep);
  }

  /** Sparky's meteor: a marker while it is called, a fireball falling from the sky, then the impact. */
  drawMeteor(h, st, t, dt) {
    const g = this.groundG, o = this.overG;
    if (h.p < 1) {
      const p = h.p;
      g.lineStyle(4, AMBER, 0.9).strokeCircle(h.x, h.y, h.r);
      g.fillStyle(AMBER, 0.15 + 0.2 * p).fillCircle(h.x, h.y, h.r * p);
      // Spinning crosshair that tightens as the meteor nears.
      const sp = t * 3, cr = h.r * (0.35 + 0.25 * (1 - p));
      g.lineStyle(4, 0xffffff, 0.8);
      for (let k = 0; k < 4; k++) {
        const a = sp + (k * Math.PI) / 2;
        g.lineBetween(h.x + Math.cos(a) * cr, h.y + Math.sin(a) * cr, h.x + Math.cos(a) * (cr + 18), h.y + Math.sin(a) * (cr + 18));
      }
      g.fillStyle(0x000000, 0.28 * p * p).fillEllipse(h.x, h.y + 4, h.r * 0.9 * p, h.r * 0.4 * p);
      // The fireball falls from the upper left, speeding up as it goes.
      const f = Math.pow(1 - p, 1.8);
      const mx = h.x - 190 * f, my = h.y - 780 * f;
      const sc = 0.55 + 0.45 * p;
      const gl = this.metPool.get();
      gl.setPosition(mx, my).setScale(sc * 1.4).setAlpha(0.95).setRotation(t * 6);
      // Tail: three tapering strokes back up the path it came down.
      const L = 90 + 170 * f, tx = mx - 0.237 * L, ty = my - 0.972 * L;
      o.lineStyle(26 * sc, 0xff6a1a, 0.35).lineBetween(mx, my, tx, ty);
      o.lineStyle(14 * sc, 0xffb040, 0.6).lineBetween(mx, my, mx + (tx - mx) * 0.7, my + (ty - my) * 0.7);
      o.lineStyle(6 * sc, 0xffffff, 0.8).lineBetween(mx, my, mx + (tx - mx) * 0.4, my + (ty - my) * 0.4);
      this.fx.trail(mx + rr(-8, 8), my + rr(-8, 8), 0xff8a2a);
    } else if (!st.imp) {
      st.imp = true;
      this.fx.meteorImpact(h.x, h.y, h.r);
    }
  }

  drawMarks(v, t) {
    const g = this.groundG;
    for (const m of v.marks) {
      const a = 0.35 + 0.45 * Math.abs(Math.sin(t * 10 + m.x));
      const s = 10 + 4 * m.p;
      const col = m.type === 'bush' ? 0x4f8f3a : RED;
      g.lineStyle(5, col, a);
      g.lineBetween(m.x - s, m.y - s, m.x + s, m.y + s);
      g.lineBetween(m.x - s, m.y + s, m.x + s, m.y - s);
      g.lineStyle(3, col, 0.5 * (1 - m.p)).strokeCircle(m.x, m.y, 14 + 26 * (1 - m.p));
    }
  }

  // ---- projectiles, pickups, summons ----

  drawProjectiles(v, t, dt) {
    const list = v.projectiles;
    for (let i = 0; i < list.length; i++) {
      const pr = list[i];
      let r = this.pools.projectiles.get(pr.id);
      if (!r) {
        const key = this.textures.exists(pr.kind) ? pr.kind : 'p_pebble';
        r = { body: this.addWorld(this.add.image(pr.x, pr.y, key).setScale(0.5), 7), tt: 0, fire: pr.kind === 'p_lava' || pr.kind === 'p_ember', seen: 0 };
        this.pools.projectiles.set(pr.id, r);
      }
      r.seen = this.frameNo;
      r.body.setPosition(pr.x, pr.y).setRotation(pr.a);
      if (r.fire) {
        r.tt -= dt;
        if (r.tt <= 0 && pr.x > this.vx0 && pr.x < this.vx1 && pr.y > this.vy0 && pr.y < this.vy1) { r.tt = 0.04; this.fx.ember(pr.x, pr.y, pr.kind === 'p_lava' ? 0xff6a2a : 0xffa040); }
      }
    }
    this.sweep('projectiles', this._destroySimple);
    // Enemy shots: magenta, pulsing, with a pink glow so they are the most visible thing on screen.
    const shots = v.shots;
    for (let i = 0; i < shots.length; i++) {
      const sh = shots[i];
      let r = this.pools.shots.get(sh.id);
      if (!r) { r = { body: this.addWorld(this.add.image(0, 0, 'shot'), 7.5), tt: 0, seen: 0 }; this.pools.shots.set(sh.id, r); }
      r.seen = this.frameNo;
      const pulse = 1 + 0.1 * Math.sin(t * 16 + sh.id);
      const sc = ((sh.r * 2.4) / 64) * pulse;
      r.body.setPosition(sh.x, sh.y).setScale(sc);
      this.shotGlowPool.get().setPosition(sh.x, sh.y).setScale((sh.r * 6.5) / 64).setTint(0xff2fd1).setAlpha(0.65 + 0.2 * Math.sin(t * 16 + sh.id));
      r.tt -= dt;
      if (r.tt <= 0 && sh.x > this.vx0 && sh.x < this.vx1 && sh.y > this.vy0 && sh.y < this.vy1) { r.tt = 0.06; this.fx.trail(sh.x, sh.y, 0xff2fd1); }
    }
    this.sweep('shots', this._destroySimple);
  }

  drawPickups(v, t, dt) {
    const list = v.pickups;
    for (let i = 0; i < list.length; i++) {
      const pk = list[i];
      const berry = pk.kind === 'berry';
      const crate = pk.kind === 'crate'; // loot crate: a chunky wooden box with an amber glow (gold from an elite)
      let r = this.pools.pickups.get(pk.id);
      if (!r) {
        r = { body: this.addWorld(this.add.image(pk.x, pk.y, crate ? 'crate' : berry ? 'berry' : 'amber').setScale(0.5), 4), ph: Math.random() * 6, born: t, px: pk.x, py: pk.y, tt: 0, seen: 0 };
        this.pools.pickups.set(pk.id, r);
        if (crate) this.fx.ring(pk.x, pk.y, pk.gold ? 0xffd24a : AMBER, 10, 70, 0.45, 6); // a crate pops in with a ring so you notice it
      }
      r.seen = this.frameNo;
      const dx = pk.x - r.px, dy = pk.y - r.py;
      const spd = Math.sqrt(dx * dx + dy * dy) / dt;
      r.px = pk.x; r.py = pk.y;
      const flying = spd > 170;
      const age = t - r.born;
      const popK = age < 0.25 ? 1 + 0.5 * Math.sin((age / 0.25) * Math.PI) : 1;
      const pulse = (1 + Math.sin(t * 6 + r.ph) * 0.1) * popK;
      const by = flying ? 0 : Math.sin(t * 4 + r.ph) * 2 - (age < 0.25 ? Math.sin((age / 0.25) * Math.PI) * 10 : 0);
      r.body.setPosition(pk.x, pk.y + by).setScale(0.5 * pulse);
      if (pk.x > this.vx0 && pk.x < this.vx1 && pk.y > this.vy0 && pk.y < this.vy1) {
        const gl = this.glowPool.get();
        const glowCol = berry ? 0x7dff6a : crate && pk.gold ? 0xffe27a : AMBER;
        gl.setPosition(pk.x, pk.y + by).setScale((berry ? 0.45 : crate ? 0.95 + 0.12 * Math.sin(t * 5 + r.ph) : 0.5 + 0.08 * Math.sin(t * 6 + r.ph)) * (flying ? 1.3 : 1)).setTint(glowCol).setAlpha(berry ? 0.4 : crate ? 0.75 : 0.55);
        if (flying) {
          r.tt -= dt;
          if (r.tt <= 0) { r.tt = 0.03; this.fx.trail(pk.x, pk.y, glowCol); }
        } else if (crate) {
          r.tt -= dt;
          if (r.tt <= 0) { r.tt = 0.35; this.fx.spark(pk.x + (Math.random() - 0.5) * 30, pk.y - 14, glowCol, 1); } // twinkle
        }
      }
    }
    this.sweep('pickups', this._destroySimple);
  }

  drawSummons(v, t) {
    for (const sm of v.summons) {
      const key = sm.kind === 'turret' ? 's_turret' : sm.kind === 'ptero' ? 's_ptero' : sm.kind;
      let r = this.pools.summons.get(sm.id);
      if (!r) {
        r = {
          body: this.addWorld(this.add.image(sm.x, sm.y, this.textures.exists(key) ? key : 's_turret').setScale(0.5), 6),
          shadow: this.addWorld(this.add.image(sm.x, sm.y, 'shadow').setScale(0.3), 3), seen: 0, ph: Math.random() * 6,
        };
        this.pools.summons.set(sm.id, r);
      }
      r.seen = this.frameNo;
      const fly = sm.kind === 'ptero' ? 14 + Math.sin(t * 8 + r.ph) * 3 : 0;
      r.body.setPosition(sm.x, sm.y - fly).setDepth(6 + sm.y / 10000);
      r.shadow.setPosition(sm.x, sm.y + 16).setScale(fly ? 0.26 : 0.34);
      if (sm.kind === 'ptero') r.body.setFlipX(Math.cos(sm.a) < 0);
    }
    for (const [id, r] of this.pools.summons) {
      if (r.seen !== this.frameNo) { r.body.destroy(); r.shadow.destroy(); this.pools.summons.delete(id); }
    }
  }

  /** Death pops: white, swelling and fading. */
  drawGhosts(dt) {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.age += dt;
      const k = g.age / g.dur;
      if (k >= 1) {
        g.setVisible(false);
        this.ghosts[i] = this.ghosts[this.ghosts.length - 1]; this.ghosts.pop();
        this.ghostFree.push(g);
        continue;
      }
      const s = g.sc0 * (1 + g.grow * k);
      g.setScale(s * (1 + 0.15 * k), s * (1 - 0.1 * k)).setAlpha(1 - k * k);
      g.y += g.vy * dt;
      g.rotation += g.vr * dt;
    }
  }

  heroColor(char) {
    return Phaser.Display.Color.HexStringToColor(CHARACTERS[char]?.color || '#ffffff').color;
  }
}
