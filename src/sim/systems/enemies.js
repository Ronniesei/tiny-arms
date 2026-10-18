// Enemy AI, movement, separation and contact damage.
// AI functions set e.vx/e.vy (desired velocity) and may set e.tele (a telegraph the renderer draws):
//   e.tele = { k:'flash'|'line'|'circle', a?:angle, len?:px, wd?:px, r?:px, dur:s, t:elapsed }
// Every enemy attack must show a telegraph before it lands.
//
// State machine conventions (the Roar ability resets 'windup' and 'charge' back to 'move' and clears the telegraph):
//   e.st   'move' (default) | 'windup' (telegraph showing, e.atk says which attack) | 'charge' | 'recover' | 'roar' | type-specific
//   e.t    seconds left in the current state       e.cd   seconds until the next attack may start
// Attack numbers (windup, speeds, damage ...) live in src/data/enemies.js.

import { BALANCE } from '../../data/balance.js';
import { ENEMIES } from '../../data/enemies.js';
import { dangerOf } from '../../data/danger.js';
import { clampToArena, emit, nearestPlayer, spawnHazard, spawnShot } from '../entities.js';
import { chance, int, range } from '../rng.js';
import { hitPlayer } from './damage.js';
import { coopMul, spawnPack } from './waves.js';

const TAU = Math.PI * 2;
const AW = BALANCE.arena.w, AH = BALANCE.arena.h;
/** How far past an enemy's own radius it can touch a player (matches the contact check). */
const HIT_PAD = BALANCE.player.radius * 0.85;
/** Circle hazards hit players within r + 0.6 * player radius. */
const HAZARD_PAD = BALANCE.player.radius * 0.6;

/**
 * An attack's damage for this wave and danger level: base + per * (wave - 1), rounded, times the danger level's
 * damage multiplier (like contact damage in entities.enemyScale: unrounded when danger changes it, since
 * hitPlayer rounds once, after armour). Every enemy attack damage in this file goes through here.
 */
const grow = (w, base, per = 0) => {
  const v = Math.max(0, Math.round(base + per * Math.max(0, w.wave - 1)));
  const m = dangerOf(w).dmg;
  return m === 1 ? v : Math.round(v * m * 100) / 100;
};

/** The player this enemy is after: a taunting player if set, else the nearest live player. */
export function targetFor(w, e) {
  if (e.target >= 0 && e.targetT > 0) {
    const t = w.players[e.target];
    if (t && !t.downed && !t.gone) return t;
  }
  return nearestPlayer(w, e.x, e.y);
}

export function moveToward(e, x, y, speed) {
  const dx = x - e.x, dy = y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  e.vx = (dx / d) * speed;
  e.vy = (dy / d) * speed;
}

export function startTele(e, tele) {
  e.tele = { t: 0, ...tele };
}

const idle = (e) => { e.vx = 0; e.vy = 0; };
const faceX = (e, dx) => { if (dx > 1) e.facing = 1; else if (dx < -1) e.facing = -1; };
const r0 = Math.round;

// ---- shared attack pieces ----

/** Start a telegraphed line charge toward t. The line is as long and as wide as the charge really is. */
function windupCharge(w, e, t, windup, lockFrac, speed, dur) {
  e.st = 'windup'; e.atk = 'charge';
  e.t = windup; e.wdur = windup; e.lock = lockFrac;
  e.cspeed = speed; e.cdur = dur;
  e.aim = Math.atan2(t.y - e.y, t.x - e.x);
  faceX(e, Math.cos(e.aim));
  startTele(e, { k: 'line', a: e.aim, len: speed * dur, wd: 2 * (e.r + HIT_PAD), dur: windup });
}

/** Charge windup tick: the line follows the target until the lock point, then the charge begins. */
function tickChargeWindup(w, e, t, dt) {
  idle(e);
  e.t -= dt;
  if (t && 1 - e.t / e.wdur < e.lock) {
    e.aim = Math.atan2(t.y - e.y, t.x - e.x);
    if (e.tele) e.tele.a = e.aim;
  }
  faceX(e, Math.cos(e.aim));
  if (e.t > 0) return;
  e.st = 'charge'; e.t = e.cdur; e.tele = null; e.hitWall = false;
  e.cvx = Math.cos(e.aim) * e.cspeed;
  e.cvy = Math.sin(e.aim) * e.cspeed;
  emit(w, { type: 'charge', id: e.id, x: r0(e.x), y: r0(e.y), a: Math.round(e.aim * 100) / 100 });
}

/** Charge tick. Returns true when the charge is over (time up, or it ran into a wall). */
function tickCharge(e, dt) {
  e.t -= dt;
  e.vx = e.cvx; e.vy = e.cvy;
  const wall = (e.cvx < 0 && e.x <= e.r + 1) || (e.cvx > 0 && e.x >= AW - e.r - 1)
    || (e.cvy < 0 && e.y <= e.r + 1) || (e.cvy > 0 && e.y >= AH - e.r - 1);
  if (e.t > 0 && !wall) return false;
  e.hitWall = wall;
  idle(e);
  return true;
}

/** After a charge: crashing into a wall dazes the enemy (shown stunned); otherwise a short recovery. */
function finishCharge(e, def, cd) {
  e.cd = cd;
  if (e.hitWall && def.wallDaze) {
    e.stun = Math.max(e.stun, def.wallDaze);
    e.st = 'move';
  } else {
    e.st = 'recover';
    e.t = def.recover;
  }
}

function tickRecover(e, dt) {
  idle(e);
  e.t -= dt;
  if (e.t > 0) return false;
  e.st = 'move';
  return true;
}

/** A ring of n enemy shots around e. */
function fireRing(w, e, def, n, offset) {
  const dmg = grow(w, def.shotDmg, def.shotDmgPerWave);
  for (let i = 0; i < n; i++) {
    const a = offset + (i / n) * TAU;
    const c = Math.cos(a), s = Math.sin(a);
    spawnShot(w, { x: e.x + c * e.r * 0.8, y: e.y + s * e.r * 0.8, vx: c * def.shotSpeed, vy: s * def.shotSpeed, dmg, r: def.shotRadius, life: def.shotLife });
  }
  emit(w, { type: 'eshoot', id: e.id, x: r0(e.x), y: r0(e.y) });
}

/** A fan of n shots centred on (tx, ty) as seen from e, `arc` radians wide in total. */
function fireFan(w, e, def, tx, ty, n, arc) {
  const dmg = grow(w, def.shotDmg, def.shotDmgPerWave);
  const a0 = Math.atan2(ty - e.y, tx - e.x);
  for (let i = 0; i < n; i++) {
    const a = a0 + (n > 1 ? (i / (n - 1) - 0.5) * arc : 0);
    const c = Math.cos(a), s = Math.sin(a);
    spawnShot(w, { x: e.x + c * e.r, y: e.y + s * e.r, vx: c * def.shotSpeed, vy: s * def.shotSpeed, dmg, r: def.shotRadius, life: def.shotLife });
  }
  emit(w, { type: 'eshoot', id: e.id, x: r0(e.x), y: r0(e.y) });
}

/**
 * Spino pounce, part 1: mark the landing spot (a red circle hazard that fires when the spino lands) and crouch.
 * The spot is the target's position now; the spino leaves the ground for the last `pounceFlight` seconds.
 */
function startPounce(w, e, def, t, windup) {
  e.lx = Math.min(AW - e.r, Math.max(e.r, t.x));
  e.ly = Math.min(AH - e.r, Math.max(e.r, t.y));
  e.st = 'windup'; e.atk = 'pounce'; e.t = windup; e.leaping = false;
  faceX(e, e.lx - e.x);
  startTele(e, { k: 'flash', dur: windup - def.pounceFlight });
  spawnHazard(w, { kind: 'circle', owner: 'enemy', x: e.lx, y: e.ly, r: def.pounceR, delay: windup, dur: 0.3, dmg: grow(w, def.pounceDmg, def.pounceDmgPerWave), ev: 'stomp' });
}

/** Pounce, part 2: crouch, then fly to the landing spot so as to arrive exactly when the circle fires. True once landed. */
function tickPounce(w, e, def, dt) {
  e.t -= dt;
  if (e.t > def.pounceFlight) { idle(e); return false; }
  if (!e.leaping) {
    e.leaping = true; e.tele = null;
    emit(w, { type: 'elitePounce', id: e.id, x: r0(e.x), y: r0(e.y), tx: r0(e.lx), ty: r0(e.ly) });
  }
  if (e.t > dt) {
    const k = 1 / e.t;
    e.vx = (e.lx - e.x) * k; e.vy = (e.ly - e.y) * k;
    faceX(e, e.vx);
    return false;
  }
  e.x = e.lx; e.y = e.ly; e.leaping = false;
  idle(e);
  return true;
}

/** Boss: the phase (1..3) its HP puts it in. */
const bossPhaseOf = (e, def) => (e.hp > e.maxHp * def.phaseHp[0] ? 1 : e.hp > e.maxHp * def.phaseHp[1] ? 2 : 3);

/** Boss phase change: a ~1 s roar during which it cannot be hurt (see the HP restore in update()). */
function startPhaseRoar(w, e, def, phase) {
  if (e.st === 'windup' && e.atk === 'call') e.callCd = 0; // a cancelled raptor call is not lost
  e.phase = phase; e.n = 0; e.chainLeft = 0;
  e.st = 'roar'; e.t = def.phaseRoar;
  e.invHp = Math.max(1, e.hp);
  idle(e);
  startTele(e, { k: 'flash', dur: def.phaseRoar });
  emit(w, { type: 'bossPhase', id: e.id, phase, x: r0(e.x), y: r0(e.y) });
}

/** Boss: can attack `a` start from distance d? */
const bossInRange = (def, a, d) => d < (a === 'charge' ? def.chargeRange : a === 'stomp' ? def.stompRange : a === 'spit' ? def.spitRange : def.slamRange);

/** Boss: the next attack from this phase's list that is in range (the list rotates by e.n), or null. */
function pickBossAttack(e, def, d) {
  const list = def.phaseAttacks[e.phase - 1];
  const n = e.n || 0;
  for (let k = 0; k < list.length; k++) {
    const a = list[(n + k) % list.length];
    if (bossInRange(def, a, d)) { e.n = n + k + 1; return a; }
  }
  return null;
}

/**
 * Boss ground slam: red circles appear at once and all fire together when the windup ends. One sits on each of up
 * to `slamOnPlayers` live players; the rest ring the main target at slamRing px, evenly spaced, so a way out
 * (between two ring circles) always exists. Ring circles that would fall outside the arena are dropped.
 */
function startSlam(w, e, def, t, delay, en) {
  const dmg = grow(w, def.slamDmg, def.slamDmgPerWave);
  const n = w.players.length;
  const start = int(w.rng, 0, n - 1);
  let on = 0;
  for (let k = 0; k < n && on < def.slamOnPlayers; k++) {
    const p = w.players[(start + k) % n];
    if (p.gone || p.downed) continue;
    spawnHazard(w, { kind: 'circle', owner: 'enemy', x: p.x, y: p.y, r: def.slamR, delay, dur: 0.3, dmg, ev: 'slam' });
    on++;
  }
  const extras = Math.max(1, Math.min(4, def.slamCount + (en ? 1 : 0) - on));
  const a0 = range(w.rng, 0, TAU);
  for (let j = 0; j < extras; j++) {
    const a = a0 + (j / extras) * TAU;
    const x = t.x + Math.cos(a) * def.slamRing, y = t.y + Math.sin(a) * def.slamRing;
    if (x < 30 || y < 30 || x > AW - 30 || y > AH - 30) continue;
    spawnHazard(w, { kind: 'circle', owner: 'enemy', x, y, r: def.slamR, delay, dur: 0.3, dmg, ev: 'slam' });
  }
}

// ---- AI registry ----

/** AI registry: key = ENEMIES[type].ai. (w, e, def, dt) => void */
export const AI = {
  none(w, e) { idle(e); },

  // Raptor: run straight at the nearest player.
  chase(w, e, def) {
    const t = targetFor(w, e);
    if (!t) { idle(e); return; }
    moveToward(e, t.x, t.y, e.speed);
  },

  // Mosquito: drifts toward the player on a wobbly path (smooth noise, a little shared with its cloud).
  swarm(w, e, def) {
    const t = targetFor(w, e);
    if (!t) { idle(e); return; }
    const dx = t.x - e.x, dy = t.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const T = w.time * def.wobbleFreq;
    const own = e.ph, cloud = (e.cloud || 0) * 1.7;
    const side = 0.35 * (Math.sin(T + own) + Math.sin(T * 1.7 + own * 2.3)) + 0.3 * Math.sin(T * 0.6 + cloud);
    const surge = 0.65 + 0.35 * Math.sin(T * 0.55 + own * 1.3);
    const k = def.wobble;
    e.vx = (ux * surge - uy * side * k) * e.speed;
    e.vy = (uy * surge + ux * side * k) * e.speed;
  },

  // Caveman: walks up; within triggerRange it stops, raises its club (line telegraph), charges, recovers.
  caveman(w, e, def, dt) {
    const t = targetFor(w, e);
    e.cd -= dt;
    if (e.st === 'windup') { tickChargeWindup(w, e, t, dt); return; }
    if (e.st === 'charge') { if (tickCharge(e, dt)) finishCharge(e, def, def.attackCd); return; }
    if (e.st === 'recover') { tickRecover(e, dt); return; }
    if (!t) { idle(e); return; }
    moveToward(e, t.x, t.y, e.speed);
    if (e.cd <= 0 && Math.hypot(t.x - e.x, t.y - e.y) < def.triggerRange) {
      windupCharge(w, e, t, def.windup, def.lockFrac, def.chargeSpeed, def.chargeDur);
    }
  },

  // Spitter: keeps its distance, flares, spits a slow shot.
  spitter(w, e, def, dt) {
    const t = targetFor(w, e);
    if (!t) { idle(e); return; }
    const dx = t.x - e.x, dy = t.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    e.cd -= dt;
    faceX(e, dx);
    if (e.st === 'windup') {
      idle(e);
      e.t -= dt;
      if (e.t <= 0) {
        // From wave 8 spitters aim partly where the player is heading, so steady kiting isn't free.
        const lead = w.wave >= 8 ? Math.min(0.7, 0.1 * (w.wave - 7)) : 0;
        let ax = t.x, ay = t.y;
        if (lead > 0 && t.input) {
          const spd = 300, tt = d / def.shotSpeed;
          ax += (t.input.mx || 0) * spd * tt * lead;
          ay += (t.input.my || 0) * spd * tt * lead;
        }
        const a = Math.atan2(ay - e.y, ax - e.x);
        const dmg = grow(w, def.shotDmg, def.shotDmgPerWave);
        spawnShot(w, { x: e.x + Math.cos(a) * e.r, y: e.y + Math.sin(a) * e.r, vx: Math.cos(a) * def.shotSpeed, vy: Math.sin(a) * def.shotSpeed, dmg, r: def.shotRadius });
        emit(w, { type: 'eshoot', id: e.id, x: r0(e.x), y: r0(e.y) });
        e.st = 'move';
        e.cd = def.attackCd;
        e.tele = null;
      }
      return;
    }
    if (d > def.keepDist + 50) moveToward(e, t.x, t.y, e.speed);
    else if (d < def.keepDist - 50) moveToward(e, e.x - dx, e.y - dy, e.speed * 0.8);
    else { e.vx = (-dy / d) * e.speed * 0.35; e.vy = (dx / d) * e.speed * 0.35; }
    if (e.cd <= 0 && d < def.attackRange) {
      e.st = 'windup';
      e.t = def.windup;
      startTele(e, { k: 'flash', dur: def.windup });
    }
  },

  // Ptero: circles the player, then (line telegraph) dive-bombs along the line, flies off, circles again.
  // The orbit point is always kept inside the arena (it switches direction instead of pressing into a wall).
  ptero(w, e, def, dt) {
    const t = targetFor(w, e);
    e.cd -= dt;
    e.flipT -= dt;
    if (e.st === 'windup') { tickChargeWindup(w, e, t, dt); return; }
    if (e.st === 'charge') {
      if (tickCharge(e, dt)) { e.cd = def.attackCd; e.st = 'away'; e.t = def.awayTime; }
      return;
    }
    if (!t) { idle(e); return; }
    const dx = t.x - e.x, dy = t.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    faceX(e, dx);
    if (e.st === 'away') {
      // Fly off to a point beyond orbit distance on the far side of the player. If the arena edge is in the
      // way (it just dived into a corner), head for the middle instead, so it can never be pinned at a wall.
      const m = e.r + 24, far = def.orbitR * 1.5;
      let px = Math.min(AW - m, Math.max(m, t.x - (dx / d) * far));
      let py = Math.min(AH - m, Math.max(m, t.y - (dy / d) * far));
      if (Math.hypot(px - e.x, py - e.y) < 80) { px = AW / 2; py = AH / 2; }
      moveToward(e, px, py, e.speed * 1.25);
      e.t -= dt;
      if (e.t <= 0) e.st = 'move';
      return;
    }
    // Orbit: aim at a point a little further round the circle (radius corrected for the lead angle).
    const m = e.r + 24;
    const a = Math.atan2(e.y - t.y, e.x - t.x);
    const R = def.orbitR / Math.cos(def.orbitLead);
    let px = 0, py = 0, ok = false;
    for (let k = 0; k < 2 && !ok; k++) {
      const s = k === 0 ? e.dir : -e.dir;
      px = t.x + Math.cos(a + s * def.orbitLead) * R;
      py = t.y + Math.sin(a + s * def.orbitLead) * R;
      ok = px >= m && px <= AW - m && py >= m && py <= AH - m;
      if (ok && k === 1 && e.flipT <= 0) { e.dir = -e.dir; e.flipT = 0.8; }
    }
    if (!ok) { px = AW / 2; py = AH / 2; } // boxed in by the player's position: head for the middle
    moveToward(e, px, py, e.speed);
    if (e.cd <= 0 && d < def.triggerRange) {
      windupCharge(w, e, t, def.windup, def.lockFrac, def.chargeSpeed, def.chargeDur);
    }
  },

  // Ankylo: plods after the player; when one is close it winds up (circle telegraph) and tail-swings.
  ankylo(w, e, def, dt) {
    const t = targetFor(w, e);
    e.cd -= dt;
    if (e.st === 'windup') {
      idle(e);
      e.t -= dt;
      if (e.t <= 0) {
        e.tele = null;
        // The circle hazard fires at once (delay 0): it hits everyone inside and flashes red. Its radius is
        // trimmed so that "r + the hazard's player padding" equals the telegraphed radius.
        spawnHazard(w, { kind: 'circle', owner: 'enemy', x: e.x, y: e.y, r: def.swingR - HAZARD_PAD, delay: 0, dur: 0.25, dmg: grow(w, def.swingDmg, def.swingDmgPerWave) });
        emit(w, { type: 'tail', id: e.id, x: r0(e.x), y: r0(e.y), r: def.swingR });
        e.st = 'recover'; e.t = def.recover; e.cd = def.attackCd;
      }
      return;
    }
    if (e.st === 'recover') { tickRecover(e, dt); return; }
    if (!t) { idle(e); return; }
    moveToward(e, t.x, t.y, e.speed);
    if (e.cd <= 0 && Math.hypot(t.x - e.x, t.y - e.y) < def.triggerRange) {
      e.st = 'windup'; e.t = def.windup;
      startTele(e, { k: 'circle', r: def.swingR, dur: def.windup });
    }
  },

  // Elite Spinosaurus: alternates a telegraphed charge and a telegraphed ring of spit (def.pattern). Below rageHp it
  // roars once (flash, event elitePhase), moves faster, attacks more often, fires its ring twice (the second ring
  // fills the first one's gaps) and adds the POUNCE (def.patternRage): it crouches (flash) while a red circle
  // marks where it will land (a player's position), leaps there and the circle hits on landing; the pounce chains
  // twice, the second landing spot being wherever the player ran to.
  spino(w, e, def, dt) {
    const t = targetFor(w, e);
    const rage = e.hp <= e.maxHp * def.rageHp;
    e.cd -= dt;
    if (rage && !e.roared && e.st === 'move') { // roars once, as soon as it is between attacks
      e.roared = true;
      e.st = 'roar'; e.t = def.rageRoar;
      startTele(e, { k: 'flash', dur: def.rageRoar });
      emit(w, { type: 'elitePhase', id: e.id, x: r0(e.x), y: r0(e.y) });
    }
    switch (e.st) {
      case 'roar':
        idle(e); e.t -= dt;
        if (e.t <= 0) { e.st = 'move'; e.tele = null; }
        return;
      case 'windup':
        if (e.atk === 'charge') { tickChargeWindup(w, e, t, dt); return; }
        if (e.atk === 'pounce') {
          if (!tickPounce(w, e, def, dt)) return;
          if (e.pounceLeft > 0 && t) { e.pounceLeft--; startPounce(w, e, def, t, def.pounceWindup2); return; }
          e.st = 'recover'; e.t = def.pounceRecover; e.cd = def.attackCdRage;
          return;
        }
        idle(e); e.t -= dt;
        if (e.t <= 0) {
          e.tele = null;
          e.off = (e.off || 0) + 0.31;
          fireRing(w, e, def, rage ? def.ringShotsRage : def.ringShots, e.off);
          if (rage) { e.st = 'ring2'; e.t = def.ringGap; } else { e.st = 'recover'; e.t = def.recover; e.cd = def.attackCd; }
        }
        return;
      case 'ring2':
        idle(e); e.t -= dt;
        if (e.t <= 0) {
          fireRing(w, e, def, def.ringShotsRage, e.off + TAU / def.ringShotsRage / 2);
          e.st = 'recover'; e.t = def.recover; e.cd = def.attackCdRage;
        }
        return;
      case 'charge':
        if (tickCharge(e, dt)) finishCharge(e, def, rage ? def.attackCdRage : def.attackCd);
        return;
      case 'recover':
        tickRecover(e, dt);
        return;
      default: break;
    }
    if (!t) { idle(e); return; }
    moveToward(e, t.x, t.y, e.speed * (rage ? def.rageSpeed : 1));
    if (e.cd > 0) return;
    const d = Math.hypot(t.x - e.x, t.y - e.y);
    e.n = e.n || 0;
    const pat = rage ? def.patternRage : def.pattern;
    const a = pat[e.n % pat.length];
    if (a === 'charge') {
      if (d > def.chargeRange) return; // too far for a charge: keep closing in
      windupCharge(w, e, t, def.windup, def.lockFrac, def.chargeSpeed, def.chargeDur);
    } else if (a === 'pounce') {
      if (d > def.pounceRange) return;
      e.pounceLeft = def.pounceChain - 1;
      startPounce(w, e, def, t, def.pounceWindup);
    } else {
      e.st = 'windup'; e.atk = 'ring'; e.t = def.ringWindup;
      startTele(e, { k: 'circle', r: def.ringR, dur: def.ringWindup });
    }
    e.n++;
  },

  // Boss Triceratops, 3 phases by HP (def.phaseHp). Phase 1: horn charge, stomp shockwave, raptor calls.
  // Phase 2 (below 66%): adds the SPIT FAN (flash, then a fan of slow magenta shots at the target) and every charge
  // chains twice. Phase 3 (below 33%): adds the GROUND SLAM (a ring of red circles that all fire together) and
  // shorter cooldowns. Each change is a ~1 s invulnerable roar (event bossPhase) that restarts the attack list, so the
  // new attack comes first. Enrages after def.enrageAfter seconds: faster, shorter windups (never under minWindup).
  trike(w, e, def, dt) {
    const t = targetFor(w, e);
    e.age += dt;
    if (!e.enraged && e.age >= (def.enrageAfter ?? BALANCE.waves.bossEnrageAfter)) {
      e.enraged = true;
      e.callCd = 0; // roars and calls a pack at the next opening
      emit(w, { type: 'bossCall', x: r0(e.x), y: r0(e.y), enrage: 1 });
    }
    const en = !!e.enraged;
    e.cd -= dt;
    e.callCd -= dt;
    const ph = bossPhaseOf(e, def);
    if (ph > e.phase && e.st !== 'charge' && e.st !== 'roar') startPhaseRoar(w, e, def, ph);
    const wm = en ? def.enrageWindup : 1;
    const cdMul = def.phaseCd[e.phase - 1] * (en ? def.enrageCd : 1);
    switch (e.st) {
      case 'roar':
        idle(e); e.t -= dt;
        if (!e.tele) e.tele = { k: 'flash', dur: def.phaseRoar, t: def.phaseRoar - Math.max(0, e.t) }; // a player's Roar wipes it
        if (e.t <= 0) { e.st = 'move'; e.tele = null; e.invHp = 0; e.cd = Math.max(e.cd, def.phaseRoarCd); }
        return;
      case 'windup':
        if (e.atk === 'charge') { tickChargeWindup(w, e, t, dt); return; }
        idle(e); e.t -= dt;
        if (e.t > 0) return;
        e.tele = null;
        if (e.atk === 'stomp') {
          // The telegraphed circle is the whole danger zone: a ring sweeps out through it at ringReach/ringDur px/s,
          // slower than a player, so it can be outrun.
          const reach = def.stompR - (def.ringBand + BALANCE.player.radius * 0.5);
          spawnHazard(w, { kind: 'ring', owner: 'enemy', x: e.x, y: e.y, r0: def.stompR0, r: reach, delay: 0, dur: def.ringDur, band: def.ringBand, dmg: grow(w, def.stompDmg, def.stompDmgPerWave) });
          emit(w, { type: 'stomp', x: r0(e.x), y: r0(e.y), r: def.stompR });
          e.st = 'recover'; e.t = def.stompRecover;
        } else if (e.atk === 'spit') {
          if (t) fireFan(w, e, def, t.x, t.y, def.spitShots[e.phase - 1], def.spitArc[e.phase - 1]);
          e.st = 'recover'; e.t = def.spitRecover;
        } else if (e.atk === 'slam') {
          // The circles were placed when the windup began and fire now (their delay equals the windup).
          e.st = 'recover'; e.t = def.slamRecover;
        } else {
          const bonus = en || e.hp <= e.maxHp * 0.5 ? def.callBonusMul : 1;
          const per = Math.round(def.callCount * bonus * coopMul(w));
          for (let i = 0; i < def.callPacks; i++) spawnPack(w, 'raptor', per, def.callSpread);
          emit(w, { type: 'bossCall', x: r0(e.x), y: r0(e.y) });
          e.st = 'recover'; e.t = def.callRecover;
        }
        e.cd = def.attackCd * cdMul;
        return;
      case 'charge':
        if (tickCharge(e, dt)) {
          if (e.chainLeft > 0 && t && !(e.hitWall && def.wallDaze)) { // the next charge of the chain, aimed anew
            e.chainLeft--;
            windupCharge(w, e, t, Math.max(def.minWindup, def.chainWindup * wm), def.chainLock, e.cspeed, def.chargeDur);
          } else finishCharge(e, def, def.attackCd * cdMul);
        }
        return;
      case 'recover':
        tickRecover(e, dt);
        return;
      default: break;
    }
    if (!t) { idle(e); return; }
    moveToward(e, t.x, t.y, e.speed * def.phaseSpeed[e.phase - 1] * (en ? def.enrageSpeed : 1));
    faceX(e, t.x - e.x);
    if (e.cd > 0) return;
    if (e.callCd <= 0) {
      e.st = 'windup'; e.atk = 'call'; e.t = Math.max(def.minWindup, def.callWindup * wm);
      startTele(e, { k: 'flash', dur: e.t });
      e.callCd = en ? def.enrageCallEvery : def.callEvery;
      return;
    }
    const a = pickBossAttack(e, def, Math.hypot(t.x - e.x, t.y - e.y));
    if (a === 'stomp') {
      e.st = 'windup'; e.atk = 'stomp'; e.t = Math.max(def.minWindup, def.stompWindup * wm);
      startTele(e, { k: 'circle', r: def.stompR, dur: e.t });
    } else if (a === 'charge') {
      e.chainLeft = def.phaseChain[e.phase - 1] - 1;
      windupCharge(w, e, t, Math.max(def.minWindup, def.windup * wm), def.lockFrac, def.chargeSpeed * (en ? def.enrageChargeSpeed : 1), def.chargeDur);
    } else if (a === 'spit') {
      e.st = 'windup'; e.atk = 'spit'; e.t = Math.max(def.minWindup, def.spitWindup * wm);
      startTele(e, { k: 'flash', dur: e.t });
    } else if (a === 'slam') {
      e.st = 'windup'; e.atk = 'slam'; e.t = Math.max(def.minWindup, def.slamWindup * wm);
      startTele(e, { k: 'flash', dur: e.t });
      startSlam(w, e, def, t, e.t, en);
    }
  },
};

/** One-time setup of AI fields the first time an enemy is processed (random phases, first-attack delay ...). */
function initEnemy(w, e, def) {
  e.ready = true;
  e.baseDmg = e.dmg;
  e.mass = def.mass ?? 1;
  if (def.noSep) e.noSep = true;
  if (def.speedJitter) e.speed *= 1 + range(w.rng, -def.speedJitter, def.speedJitter);
  if (def.initCd) e.cd = range(w.rng, def.initCd[0], def.initCd[1]);
  if (def.callFirst !== undefined) e.callCd = def.callFirst;
  e.ph = range(w.rng, 0, TAU);
  e.dir = chance(w.rng, 0.5) ? 1 : -1;
  e.age = 0;
  e.flipT = 0;
  if (def.phaseHp) e.phase = 1;
}

/**
 * Who can hurt whom by touching: nobody mid-windup or recovering (so a telegraph always comes before damage);
 * 'attack' contact enemies (pteros) only hurt while charging; chargers hit harder while charging.
 */
function contactRules(w, e, def) {
  const charging = e.st === 'charge';
  e.noContact = e.st === 'windup' || e.st === 'recover' || e.st === 'roar' || (def.contact === 'attack' && !charging);
  e.dmg = charging && def.chargeDmg !== undefined ? grow(w, def.chargeDmg, def.chargeDmgPerWave) : e.baseDmg;
}

export function update(w, dt) {
  const kbDecay = Math.max(0, 1 - BALANCE.enemy.knockbackDecay * dt);
  for (const e of w.enemies) {
    if (e.dead) continue;
    const def = ENEMIES[e.type];
    if (!e.ready) initEnemy(w, e, def);
    e.flash = Math.max(0, e.flash - dt);
    if (e.targetT > 0) e.targetT -= dt;
    // A boss phase-change roar is invulnerable: damage dealt since last tick is undone (damage.js is shared and
    // has no invulnerability flag). The boss has thousands of HP, so one tick of hits can never kill it here.
    if (e.invHp > 0) { if (e.st === 'roar') { if (e.hp < e.invHp) e.hp = e.invHp; } else e.invHp = 0; }
    if (e.stun > 0) {
      e.stun -= dt;
      e.vx = e.vy = 0;
    } else {
      if (e.tele) e.tele.t += dt;
      (AI[def.ai] || AI.chase)(w, e, def, dt);
    }
    contactRules(w, e, def);
    const slowMul = e.slow > 0 ? 0.5 : 1;
    e.x += (e.vx * slowMul + e.kbx) * dt;
    e.y += (e.vy * slowMul + e.kby) * dt;
    e.kbx *= kbDecay;
    e.kby *= kbDecay;
    if (e.vx > 5) e.facing = 1; else if (e.vx < -5) e.facing = -1;
    clampToArena(e);
  }

  // Soft separation so crowds spread out instead of stacking. Heavier enemies are pushed less
  // (a boss is not shoved around by raptors); fliers (noSep) ignore it.
  const sep = BALANCE.enemy.separation;
  const near = [];
  for (const e of w.enemies) {
    if (e.dead || e.noSep) continue;
    near.length = 0;
    w.grid.query(e.x, e.y, e.r, near);
    for (const o of near) {
      if (o === e || o.dead || o.noSep) continue;
      const dx = e.x - o.x, dy = e.y - o.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const overlap = e.r + o.r - d;
      if (overlap > 0) {
        const push = overlap * sep * ((o.mass ?? 1) / ((e.mass ?? 1) + (o.mass ?? 1)));
        e.x += (dx / d) * push;
        e.y += (dy / d) * push;
      }
    }
    clampToArena(e);
  }

  // Contact damage.
  for (const p of w.players) {
    if (p.gone || p.downed || p.iframes > 0) continue;
    near.length = 0;
    w.grid.query(p.x, p.y, p.r * 0.85, near);
    for (const e of near) {
      if (e.dead || e.dmg <= 0 || e.stun > 0 || e.noContact) continue;
      hitPlayer(w, p, e.dmg, { source: e.type });
      break;
    }
  }
}
