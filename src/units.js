import * as THREE from 'three';
import { Entity } from './entity.js';
import { UNITS } from './data.js';
import * as M from './models.js';
import { Missile } from './weapons.js';
import { R, G, clamp, damp, rand, pick, quatFromForwardUp, tangentOf, dirToward, randomTangent } from './util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const ZAXIS = new THREE.Vector3(0, 0, 1);
const _fb = new THREE.Vector3();

// Ballistic launch direction to hit `target` from `from` with muzzle speed v (local planar approximation).
export function ballisticDir(from, target, v, out = new THREE.Vector3()) {
  const up = _a.copy(from).normalize();
  const to = _b.subVectors(target, from);
  const h = to.dot(up);
  const horiz = _c.copy(to).addScaledVector(up, -h);
  const d = horiz.length();
  if (d < 1) return out.copy(to).normalize();
  horiz.divideScalar(d);
  const v2 = v * v, gx = G * d;
  const disc = v2 * v2 - G * (G * d * d + 2 * h * v2);
  let ang;
  if (disc < 0) ang = Math.PI / 4;
  else ang = Math.atan((v2 - Math.sqrt(disc)) / gx);
  return out.copy(horiz).multiplyScalar(Math.cos(ang)).addScaledVector(up, Math.sin(ang)).normalize();
}

class Unit extends Entity {
  constructor(game, kind, faction, mesh, opts = {}) {
    const st = UNITS[kind];
    super(game, { kind, cat: st.cat, faction, hp: (opts.hpMul || 1) * st.hp, radius: st.radius, score: st.score, name: opts.name || st.name, mesh, tag: opts.tag });
    this.st = st;
    this.skill = opts.skill ?? 0.5;
    this.thinkT = rand(0, 0.6);
    this.target = null;
    this.dmgOut = faction === 0 ? 0.6 : 1;   // allies hit softer so the player stays the hero
  }
  aimError(dist, base = 0.02) { return (base + dist * 0.00002) * (1.4 - this.skill); }
  fireBullets(origin, dir, speed, dmg, spread, life = 1.5, color = 0xffb070) {
    const v = _fb.copy(dir);
    v.x += rand(-spread, spread); v.y += rand(-spread, spread); v.z += rand(-spread, spread);
    v.normalize().multiplyScalar(speed).add(this.vel);
    this.game.projectiles.spawn({ pos: origin, vel: v, owner: this, dmg: scaleDmg(dmg, this.dmgOut), life, color });
  }
  fireMissile(key, target, origin, dir) {
    const g = this.game;
    const m = new Missile(g, key, this, origin, dir, { target, mode: 'homing', speed: this.vel.length() });
    g.world.missiles.push(m);
    g.audio.launch();
    if (target && target.isPlayer) g.notifyLaunch(m);
    return m;
  }
  // nearest valid enemy
  findTarget(range, filter, preferPlayer = 0.5) {
    const g = this.game;
    let best = null, bd = range * range;
    const p = g.player;
    if (p && p.alive && !p.dying && p.faction !== this.faction && filter(p)) {
      const d = p.pos.distanceToSquared(this.pos);
      if (d < bd && Math.random() < preferPlayer + 0.3) return p;
    }
    for (const e of g.world.entities) {
      if (!e.alive || e.dying || e.faction === this.faction || !e.targetable || !filter(e)) continue;
      const d = e.pos.distanceToSquared(this.pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  findMissileTarget(range, minAlt = 20) {
    const g = this.game;
    let best = null, bd = range * range;
    for (const m of g.world.missiles) {
      if (!m.alive || m.faction === this.faction || m.spec.torpedo) continue;
      if (g.planet.altitude(m.pos) < minAlt) continue;
      const d = m.pos.distanceToSquared(this.pos);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }
}

function scaleDmg(d, k) {
  if (k === 1) return d;
  if (typeof d === 'number') return d * k;
  const o = {}; for (const key in d) o[key] = d[key] * k; return o;
}

// ------------------------------------------------------------------ aircraft
export class AirUnit extends Unit {
  constructor(game, kind, faction, pos, fwd, opts = {}) {
    const mesh = kind === 'bomber' ? M.bomberModel(faction) : kind === 'attacker' ? M.strikerModel(faction) : M.jetModel(faction);
    super(game, kind, faction, mesh, opts);
    this.pos.copy(pos);
    this.f = fwd.clone().normalize();
    this.speed = this.st.speed;
    this.role = opts.role || 'patrol';
    this.home = (opts.home || pos).clone().normalize();
    this.alt = opts.alt || 380;
    this.patrolR = opts.patrolR || 450;
    this.dest = opts.dest ? opts.dest.clone().normalize() : null;
    this.gunCd = rand(1, 2); this.burst = 0;
    this.missileCd = rand(5, 10);
    this.lock = 0; this.evadeT = 0; this.evadeSide = 1; this.bank = 0; this.flareCd = 0;
    this.extendT = 0;
    this.desired = new THREE.Vector3().copy(this.f);
    this.missiles = kind === 'bomber' ? 0 : kind === 'ace' ? 8 : 4;
    if (mesh.userData.burner) mesh.userData.burner.scale.z = 0.6;
    if (kind === 'ace') this.name = opts.name || 'ACE ' + pick(['"Viper"', '"Grimm"', '"Talon"', '"Specter"', '"Kestrel"']);
    this.sync();
  }

  think() {
    const g = this.game;
    if (this.role === 'bomb') return;
    if (this.guard && this.guard.alive && !this.guard.dying) this.home.copy(this.guard.pos).normalize();
    const p = g.player;
    if (this.role === 'escort' && p) {
      // wingman: engage hostiles near the player
      const t = this.findTarget(900, (e) => e.cat === 'air' && e.pos.distanceTo(p.pos) < 1000, 0);
      this.target = t;
      return;
    }
    if (this.kind === 'attacker') {
      this.target = this.findTarget(1600, (e) => e.cat !== 'air' || e.isPlayer, 0.6);
      return;
    }
    if (!this.target || !this.target.alive || this.target.dying || Math.random() < 0.15)
      this.target = this.findTarget(this.role === 'patrol' ? 1500 : 2200, (e) => e.cat === 'air', 0.55);
  }

  update(dt) {
    const g = this.game;
    if (this.dying) return this.updateDying(dt);
    const up = this.up;
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.5 + rand(0, 0.3); this.think(); }
    this.gunCd -= dt; this.missileCd -= dt; this.flareCd -= dt; this.evadeT -= dt; this.extendT -= dt;
    const D = this.desired;
    const alt = g.planet.altitude(this.pos);
    let targetSpeed = this.st.speed;
    const t = this.target && this.target.alive && !this.target.dying ? this.target : null;

    this.checkIncoming();

    if (this.role === 'bomb' && this.dest) {
      const goal = _a.copy(this.dest).multiplyScalar(R + this.alt);
      D.subVectors(goal, this.pos);
      D.addScaledVector(up, -D.dot(up)).normalize().addScaledVector(up, clamp((this.alt - alt) / 250, -0.3, 0.3));
      const dist = this.pos.distanceTo(goal);
      if (dist < 140 && !this.reached) { this.reached = true; this.dropBombs(); }
      if (this.reached) { this.dest = this.home; this.role = 'patrol'; }
      this.rearGunner(dt);
    } else if (this.evadeT > 0) {
      // break turn
      const r = _a.crossVectors(this.f, up).normalize();
      D.copy(this.f).addScaledVector(r, this.evadeSide * 1.6).addScaledVector(up, this.evadeUp);
      targetSpeed *= 1.15;
    } else if (this.role === 'escort' && !t && g.player && g.player.alive) {
      const p = g.player;
      const pf = p.forward(_b);
      const pr = p.right(_c);
      const slot = _a.copy(p.pos).addScaledVector(pr, this.slot * 14).addScaledVector(pf, -12).addScaledVector(p.up, 3);
      const to = _d.subVectors(slot, this.pos);
      const dist = to.length();
      D.copy(pf).multiplyScalar(2).addScaledVector(to, 1 / Math.max(dist, 1) * clamp(dist / 20, 0, 3)).normalize();
      targetSpeed = clamp((p.speed || 40) + clamp(-to.dot(pf) * -0.15, -12, 25), 22, 90);
      if (dist > 600) targetSpeed = 90;
    } else if (t) {
      const to = _a.subVectors(t.pos, this.pos);
      const dist = to.length();
      if (t.cat === 'air' || t.isPlayer && t.cat === 'air') {
        const tgo = dist / 380;
        const lead = _b.copy(t.pos).addScaledVector(t.vel, tgo);
        D.subVectors(lead, this.pos).normalize();
        // overshoot avoidance: if very close and head-on, extend
        if (dist < 60 && this.f.dot(t.forward ? t.forward(_c) : this.f) < -0.3) this.extendT = 2.5;
        if (this.extendT > 0) D.copy(this.f).addScaledVector(up, 0.15);
        const ang = this.f.angleTo(D);
        targetSpeed = dist > 700 ? this.st.speed * 1.3 : this.st.speed;
        this.guns(dt, t, dist, ang, lead);
        this.missileLogic(dt, t, dist, to);
      } else {
        // attacker: diving attack on surface target
        const flat = _b.copy(to).addScaledVector(up, -to.dot(up));
        const hd = flat.length();
        if (hd > 900 || this.pullOut > 0) {
          D.copy(flat).normalize().addScaledVector(up, clamp((260 - alt) / 200, -0.3, 0.4));
          this.pullOut = (this.pullOut || 0) - dt;
        } else {
          D.copy(to).normalize();
          if (alt < 90 || dist < 160) { this.pullOut = 4; this.attackRun(t); }
        }
      }
    } else {
      // patrol orbit around home
      const hp = _a.copy(this.home).multiplyScalar(R + this.alt);
      const to = _b.subVectors(hp, this.pos);
      const flat = to.addScaledVector(up, -to.dot(up));
      const d = flat.length();
      const tang = _c.crossVectors(up, flat).normalize();
      D.copy(tang).addScaledVector(flat.normalize(), clamp((d - this.patrolR) / this.patrolR, -0.5, 1.5) + 0.25).normalize();
      D.addScaledVector(up, clamp((this.alt - alt) / 250, -0.3, 0.3));
      targetSpeed *= 0.85;
    }

    // terrain avoidance
    const ahead = _a.copy(this.pos).addScaledVector(this.f, this.speed * 2.5);
    const altAhead = g.planet.altitude(ahead);
    const m = Math.min(alt, altAhead);
    if (m < 70) D.normalize().addScaledVector(up, 0.6 + (70 - m) / 25);
    D.normalize();

    // steer
    const before = _b.copy(this.f);
    const turn = this.st.turn * (this.evadeT > 0 ? 1.2 : 1);
    const ang = this.f.angleTo(D);
    if (ang > 1e-4) {
      const axis = _c.crossVectors(this.f, D);
      if (axis.lengthSq() > 1e-10) { axis.normalize(); this.f.applyAxisAngle(axis, Math.min(ang, turn * dt)).normalize(); }
    }
    // bank from yaw rate
    const yawRate = _c.crossVectors(before, this.f).dot(up) / Math.max(dt, 1e-4);
    this.bank = damp(this.bank, clamp(yawRate * 1.1, -1.3, 1.3), 4, dt);

    this.speed = damp(this.speed, targetSpeed, 0.8, dt);
    this.vel.copy(this.f).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);
    if (g.planet.altitude(this.pos) < 1) this.destroy(null);

    quatFromForwardUp(this.f, this.up, this.quat);
    _q.setFromAxisAngle(ZAXIS, this.bank);
    this.quat.multiply(_q);
    this.sync();
  }

  guns(dt, t, dist, ang, lead) {
    if (dist > 400 || ang > 0.09) { this.burst = 0; return; }
    if (this.burst <= 0 && this.gunCd <= 0) { this.burst = rand(0.5, 0.9); this.gunCd = rand(1.4, 2.6) / (0.6 + this.skill); }
    if (this.burst > 0) {
      this.burst -= dt;
      this._gunT = (this._gunT || 0) - dt;
      if (this._gunT <= 0 && this.game.planet.los(this.pos, t.pos, 6)) {
        this._gunT = 0.09;
        const dir = _d.subVectors(lead, this.pos).normalize();
        const origin = _c.copy(this.pos).addScaledVector(this.f, 2);
        this.fireBullets(origin, dir.clone(), 400, { air: 3.2, ground: 1.5, naval: 1, static: 1, missile: 3 }, this.aimError(dist, 0.018), 1.3);
        this.game.fx.muzzle(origin);
      }
    }
  }

  missileLogic(dt, t, dist, to) {
    const g = this.game;
    if (this.missiles <= 0 || dist > 1150 || dist < 140) { this.lock = Math.max(0, this.lock - dt); return; }
    const ang = this.f.angleTo(to);
    if (ang < 0.5 && g.planet.los(this.pos, t.pos, 6)) {
      this.lock += dt;
      g.registerLock(this, t, this.lock / 2.4);
      if (this.lock > 2.4 && this.missileCd <= 0 && g.missilesOn(t) < 2) {
        const key = this.kind === 'ace' && Math.random() < 0.5 ? 'e_radar' : 'e_ir';
        this.fireMissile(key, t, _c.copy(this.pos).addScaledVector(this.localUp(_d), -0.5), this.f);
        this.missiles--;
        this.missileCd = rand(9, 15) / (0.6 + this.skill * 0.7);
        this.lock = 0;
      }
    } else this.lock = Math.max(0, this.lock - dt * 1.5);
  }

  checkIncoming() {
    const g = this.game;
    if (this.evadeT > 0) return;
    for (const m of g.world.missiles) {
      if (!m.alive || m.target !== this || m.lost) continue;
      const d = m.pos.distanceTo(this.pos);
      if (d < 260) {
        if (m.mode === 'homing' && m.spec.flareable && this.flareCd <= 0 && Math.random() < 0.25 + this.skill * 0.45) {
          this.flareCd = 6;
          m.decoy = this.pos.clone().addScaledVector(this.f, -6); m.decoyT = 1.2;
          for (let i = 0; i < 6; i++) g.fx.flare(this.pos, _a.copy(this.vel).multiplyScalar(0.3).add(randomTangent(this.up, _b).multiplyScalar(8)));
        }
        this.evadeT = rand(1.5, 2.6); this.evadeSide = Math.random() < 0.5 ? -1 : 1; this.evadeUp = rand(-0.2, 0.5);
        return;
      }
    }
    // threatened from behind by a gun-armed enemy
    const p = this.target;
    if (p && p.cat === 'air' && p.forward && Math.random() < 0.02 * (0.5 + this.skill)) {
      const rel = _a.subVectors(this.pos, p.pos);
      const d = rel.length();
      if (d < 450 && p.forward(_b).angleTo(rel) < 0.35) { this.evadeT = rand(1.2, 2.4); this.evadeSide = Math.random() < 0.5 ? -1 : 1; this.evadeUp = rand(-0.3, 0.6); }
    }
  }

  rearGunner(dt) {
    this._rg = (this._rg || rand(0, 1)) - dt;
    if (this._rg > 0) return;
    this._rg = 0.15;
    const t = this.findTarget(260, (e) => e.cat === 'air', 0.7);
    if (!t) return;
    const origin = _c.copy(this.pos).addScaledVector(this.f, -2.8).addScaledVector(this.up, 0.8);
    const dir = _d.subVectors(t.pos, origin).normalize().clone();
    this.fireBullets(origin, dir, 360, { air: 2.4 }, 0.035, 1.2, 0xffc890);
  }

  dropBombs() {
    const g = this.game;
    const dest = this.dest ? this.dest.clone() : this.pos.clone().normalize();
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        if (g.state !== 'play') return;
        const d = dest.clone();
        const t = randomTangent(d, _a);
        const q = dirToward(d, t, rand(0, 50) / R, new THREE.Vector3());
        const h = g.planet.heightAt(q);
        g.fx.explosion(q.multiplyScalar(R + Math.max(0, h)), 2.4, { water: h < 0 });
      }, 400 + i * 250);
    }
  }

  attackRun(t) {
    const g = this.game;
    if ((this._atkCd || 0) > g.time) return;
    this._atkCd = g.time + 6;
    if (t.cat === 'naval') this.fireMissile('e_ashm', t, _c.copy(this.pos).addScaledVector(this.up, -0.5), this.f);
    else this.fireMissile('e_atgm', t, _c.copy(this.pos).addScaledVector(this.up, -0.5), this.f);
  }

  updateDying(dt) {
    const g = this.game;
    const up = this.up;
    this.f.addScaledVector(up, -dt * 0.6).normalize();
    this.speed = damp(this.speed, 60, 0.5, dt);
    this.vel.copy(this.f).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);
    this.spin = (this.spin || 0) + dt * 4;
    quatFromForwardUp(this.f, up, this.quat);
    _q.setFromAxisAngle(ZAXIS, this.spin);
    this.quat.multiply(_q);
    if (Math.random() < 0.8) g.fx.fireTrail(this.pos);
    this.sync();
    this.dyingT = (this.dyingT || 0) + dt;
    if (g.planet.altitude(this.pos) < 1 || this.dyingT > 9) {
      const h = g.planet.heightAt(this.pos);
      g.fx.explosion(this.pos, 1.6, { water: h < 0 });
      g.audio.explosion(g.camera.position.distanceTo(this.pos));
      this.remove();
    }
  }

  onDestroyed() {
    this.keepWreck = true;
    this.game.fx.explosion(this.pos, 1.3, { noDebris: false });
  }
}
AirUnit.prototype.keepWreck = true;

// ------------------------------------------------------------------ helicopter gunship
export class HeliUnit extends Unit {
  constructor(game, faction, pos, opts = {}) {
    super(game, 'gunship', faction, M.heliModel(faction), opts);
    this.pos.copy(pos);
    this.home = (opts.home || pos).clone().normalize();
    this.hf = randomTangent(this.up, new THREE.Vector3());
    this.agl = opts.agl || rand(30, 50);
    this.strafe = Math.random() < 0.5 ? -1 : 1;
    this.gunCd = 0; this.missileCd = rand(4, 8); this.lock = 0; this.rocketCd = rand(3, 6);
    this.sync();
  }
  think() {
    this.target = this.findTarget(800, (e) => (e.cat !== 'air' || this.game.planet.altitude(e.pos) < 150) && e.cat !== 'static', 0.6);
    if (Math.random() < 0.1) this.strafe *= -1;
  }
  update(dt) {
    const g = this.game;
    const up = this.up;
    if (this.dying) {
      this.vel.addScaledVector(up, -G * dt);
      this.pos.addScaledVector(this.vel, dt);
      this.spinA = (this.spinA || 0) + dt * 6;
      _q.setFromAxisAngle(up, dt * 6); this.quat.premultiply(_q);
      g.fx.fireTrail(this.pos);
      this.mesh.position.copy(this.pos); this.mesh.quaternion.copy(this.quat);
      if (g.planet.altitude(this.pos) < 0.5) { g.fx.explosion(this.pos, 1.5); g.audio.explosion(g.camera.position.distanceTo(this.pos)); this.remove(); }
      return;
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.7; this.think(); }
    this.gunCd -= dt; this.missileCd -= dt; this.rocketCd -= dt;
    tangentOf(up, this.hf, this.hf);
    const right = _a.crossVectors(this.hf, up);
    const desiredVel = (this._dv || (this._dv = new THREE.Vector3())).set(0, 0, 0);
    const t = this.target && this.target.alive && !this.target.dying ? this.target : null;
    if (t) {
      const to = _c.subVectors(t.pos, this.pos);
      const flat = to.clone().addScaledVector(up, -to.dot(up));
      const d = flat.length();
      flat.normalize();
      // face target
      const yawErr = Math.atan2(_d.crossVectors(this.hf, flat).dot(up), this.hf.dot(flat));
      this.hf.applyAxisAngle(up, clamp(yawErr, -1.4 * dt, 1.4 * dt));
      desiredVel.addScaledVector(flat, clamp((d - 380) / 40, -10, 14)).addScaledVector(right, this.strafe * 6);
      this.weapons(dt, t, to.length(), to);
    } else {
      const hp = _c.copy(this.home).multiplyScalar(R);
      const to = hp.sub(this.pos);
      const flat = to.addScaledVector(up, -to.dot(up));
      const d = flat.length();
      if (d > 120) {
        flat.normalize();
        desiredVel.addScaledVector(flat, 12);
        const yawErr = Math.atan2(_d.crossVectors(this.hf, flat).dot(up), this.hf.dot(flat));
        this.hf.applyAxisAngle(up, clamp(yawErr, -dt, dt));
      } else desiredVel.addScaledVector(right, 4);
    }
    const alt = g.planet.altitude(this.pos);
    const hv = _c.copy(this.vel).addScaledVector(up, -this.vel.dot(up));
    hv.lerp(desiredVel, 1 - Math.exp(-dt * 1.2));
    const vv = damp(this.vel.dot(up), clamp((this.agl - alt) * 0.6, -6, 8), 2, dt);
    this.vel.copy(hv).addScaledVector(up, vv);
    this.pos.addScaledVector(this.vel, dt);
    if (g.planet.altitude(this.pos) < 2) this.pos.multiplyScalar((g.planet.surfaceR(this.pos) + 2) / this.pos.length());
    quatFromForwardUp(this.hf, this.up, this.quat);
    _e.set(-hv.dot(this.hf) * 0.02, 0, hv.dot(_a.crossVectors(this.hf, this.up)) * -0.02);
    _q.setFromEuler(_e); this.quat.multiply(_q);
    this.mesh.userData.rotor.rotation.y += dt * 25;
    this.mesh.userData.tailRotor.rotation.x += dt * 35;
    this.sync();
  }
  weapons(dt, t, dist, to) {
    const g = this.game;
    const dir = _d.copy(to).normalize();
    const facing = this.hf.dot(dir) > 0.8;
    if (!facing || !g.planet.los(this.pos, t.pos, 6)) { this.lock = Math.max(0, this.lock - dt); return; }
    if (dist < 420 && this.gunCd <= 0) {
      this.gunCd = 0.13;
      if (Math.random() < 0.7) {
        const lead = _c.copy(t.pos).addScaledVector(t.vel, dist / 320);
        const dd = lead.sub(this.pos).normalize().clone();
        this.fireBullets(_b.copy(this.pos).addScaledVector(this.hf, 1.2), dd, 320, { air: 2.5, ground: 2.2, naval: 1.2 }, this.aimError(dist, 0.02), 1.6);
      } else this.gunCd = 0.6;
    }
    if (t.cat !== 'air' && dist < 750) {
      this.lock += dt;
      g.registerLock(this, t, this.lock / 2.2);
      if (this.lock > 2.2 && this.missileCd <= 0 && g.missilesOn(t) < 2) {
        this.fireMissile(t.cat === 'naval' ? 'e_ashm' : 'e_atgm', t, _b.copy(this.pos).addScaledVector(this.up, -0.4), dir.clone());
        this.missileCd = rand(9, 14); this.lock = 0;
      }
    }
  }
  onDestroyed() { this.keepWreck = true; this.vel.multiplyScalar(0.3); }
}
HeliUnit.prototype.keepWreck = true;

// ------------------------------------------------------------------ ground units
const GROUND_MODELS = { tank: M.tankModel, apc: M.apcModel, truck: M.truckModel, aa: M.aaModel, sam: M.samModel, artillery: M.artilleryModel, tel: M.launcherModel };

export class GroundUnit extends Unit {
  constructor(game, kind, faction, dir, opts = {}) {
    super(game, kind, faction, GROUND_MODELS[kind](faction), opts);
    const d = dir.clone().normalize();
    this.pos.copy(d).multiplyScalar(R + game.planet.heightAt(d));
    this.hf = opts.heading ? tangentOf(d, opts.heading, new THREE.Vector3()) : randomTangent(d, new THREE.Vector3());
    this.path = opts.path || null; this.pathI = 0;
    this.speed = 0;
    this.maxSpeed = { tank: 5, apc: 6, truck: 6.5, tel: 4 }[kind] || 0;
    this.turretYaw = 0; this.cd = rand(1, 4); this.lock = 0; this.reload = rand(2, 5);
    this.nrm = d.clone();
    this.arrived = false;
    this.missilesOut = [];
    this.updateOrientation(1);
    this.sync();
  }
  get turret() { return this.mesh.userData.turret; }
  think() {
    const g = this.game, k = this.kind;
    if (k === 'tank') this.target = this.findTarget(560, (e) => e.cat === 'ground' || e.cat === 'naval' || e.cat === 'static' && e.faction === 0 || (e.cat === 'air' && g.planet.altitude(e.pos) < 40), 0.6);
    else if (k === 'aa') this.target = this.findTarget(680, (e) => e.cat === 'air' && g.planet.altitude(e.pos) < 750, 0.6) || this.findMissileTarget(380, 8);
    else if (k === 'sam') this.target = this.findTarget(1300, (e) => e.cat === 'air' && g.planet.altitude(e.pos) > 35, 0.6) || this.findMissileTarget(1100, 28);
    else if (k === 'artillery') this.target = this.findTarget(1600, (e) => e.cat === 'ground' || e.cat === 'naval' || (e.cat === 'static' && e.faction === 0), 0.7);
    else if (k === 'apc') this.target = this.findTarget(260, (e) => e.cat === 'ground' || (e.cat === 'air' && g.planet.altitude(e.pos) < 60), 0.5);
    else this.target = null;
  }
  update(dt) {
    const g = this.game;
    if (this.dying) return;
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.6 + rand(0, 0.4); this.think(); }
    this.cd -= dt; this.reload -= dt;
    const t = this.target && this.target.alive && !this.target.dying ? this.target : null;
    // movement
    if (this.maxSpeed > 0) this.move(dt, t);
    // weapons
    if (t) this.engage(dt, t);
    else this.lock = Math.max(0, this.lock - dt);
    if (this.mesh.userData.dish) this.mesh.userData.dish.rotation.y += dt * 1.5;
  }
  move(dt, t) {
    const g = this.game;
    let want = 0;
    const up = this.up;
    let goal = null;
    if (this.path && this.pathI < this.path.length) {
      goal = this.path[this.pathI];
      if (goal.dot(up) > Math.cos(14 / R)) { this.pathI++; if (this.pathI >= this.path.length) this.arrived = true; }
      want = this.maxSpeed;
    } else if (this.kind === 'tank' && t && t.cat !== 'air') {
      const d = t.pos.distanceTo(this.pos);
      if (d > 260) { goal = t.pos.clone().normalize(); want = this.maxSpeed * 0.8; }
    }
    if (this.kind === 'tank' && t && this.path) want *= 0.5;
    if (goal) {
      const to = _a.subVectors(goal, up);
      const flat = to.addScaledVector(up, -to.dot(up));
      if (flat.lengthSq() > 1e-12) {
        flat.normalize();
        const err = Math.atan2(_b.crossVectors(this.hf, flat).dot(up), this.hf.dot(flat));
        this.hf.applyAxisAngle(up, clamp(err, -0.9 * dt, 0.9 * dt));
        if (Math.abs(err) > 1.2) want *= 0.3;
      }
    }
    this.speed = damp(this.speed, want, 1.5, dt);
    if (this.speed < 0.05) return;
    const nd = dirToward(up, this.hf, this.speed * dt / R, _c);
    const h = g.planet.heightAt(nd);
    const h0 = g.planet.heightAt(up);
    if (h < 0.6 || (h - h0) / (this.speed * dt) > 1.3) {
      this.hf.applyAxisAngle(up, 1.2 * dt * (this.id % 2 ? 1 : -1));
      this.speed *= 0.5;
      return;
    }
    this.pos.copy(nd).multiplyScalar(R + h);
    tangentOf(nd, this.hf, this.hf);
    this.vel.copy(this.hf).multiplyScalar(this.speed);
    this.updateOrientation(dt);
    this.sync();
  }
  updateOrientation(dt) {
    const n = this.game.planet.normalAt(this.pos, _d);
    this.nrm.lerp(n, 1 - Math.exp(-dt * 6)).normalize();
    const f = tangentOf(this.nrm, this.hf, _a);
    quatFromForwardUp(f, this.nrm, _q2);
    if (dt >= 1) this.quat.copy(_q2); else this.quat.slerp(_q2, 1 - Math.exp(-dt * 8));
  }
  aimTurret(dt, worldDir, rate) {
    const tr = this.turret;
    if (!tr) return 0;
    _q.copy(this.quat).invert();
    const local = _b.copy(worldDir).applyQuaternion(_q);
    const yaw = Math.atan2(-local.x, -local.z);
    let err = yaw - tr.rotation.y;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    tr.rotation.y += clamp(err, -rate * dt, rate * dt);
    const pitch = Math.atan2(local.y, Math.hypot(local.x, local.z));
    if (this.kind === 'sam' || this.kind === 'aa' || this.kind === 'artillery') tr.rotation.x = damp(tr.rotation.x, clamp(pitch, 0.1, 1.2), 3, dt);
    else if (this.mesh.userData.barrel) this.mesh.userData.barrel.rotation.x = damp(this.mesh.userData.barrel.rotation.x, clamp(pitch, -0.1, 0.4), 3, dt);
    return Math.abs(err);
  }
  turretDir(out) {
    const tr = this.turret;
    out.set(0, 0, -1);
    if (this.mesh.userData.barrel) out.applyAxisAngle(_a.set(1, 0, 0), this.mesh.userData.barrel.rotation.x);
    if (tr) out.applyAxisAngle(_a.set(0, 1, 0), tr.rotation.y);
    return out.applyQuaternion(this.quat);
  }
  engage(dt, t) {
    const g = this.game, k = this.kind;
    const to = _c.subVectors(t.pos, this.pos);
    const dist = to.length();
    const muzzle = _d.copy(this.pos).addScaledVector(this.up, 1.4);
    if (k === 'tank') {
      const shellV = 150;
      const aimPt = t.pos.clone().addScaledVector(t.vel, dist / shellV);
      const bd = ballisticDir(muzzle, aimPt, shellV, new THREE.Vector3());
      const err = this.aimTurret(dt, bd, 0.9);
      if (err < 0.06 && this.reload <= 0 && dist < 560 && g.planet.los(muzzle, t.pos, 8)) {
        this.reload = rand(4.5, 6.5);
        const e = this.aimError(dist, 0.008);
        bd.x += rand(-e, e); bd.y += rand(-e, e); bd.z += rand(-e, e);
        bd.normalize();
        g.projectiles.spawn({ pos: muzzle.clone().addScaledVector(bd, 1.6), vel: bd.multiplyScalar(shellV), owner: this, type: 'shell', grav: 1, life: 6,
          dmg: scaleDmg({ ground: 40, naval: 30, air: 30, static: 30 }, this.dmgOut), splash: 3, size: 1.6, color: 0xffc070 });
        g.fx.muzzle(muzzle.clone().addScaledVector(bd.normalize(), 2), 1);
        g.audio.cannon();
      }
    } else if (k === 'aa') {
      const sp = 300;
      const lead = _b.copy(t.pos).addScaledVector(t.vel, dist / sp);
      const dir = lead.sub(muzzle).normalize().clone();
      this.aimTurret(dt, dir, 2);
      if (this.cd <= 0 && g.planet.los(muzzle, t.pos, 6)) {
        this.cd = t.cat === 'missile' ? 0.15 : 0.32;
        const e = (0.012 + t.vel.length() * 0.0002) * (1.4 - this.skill);
        dir.x += rand(-e, e); dir.y += rand(-e, e); dir.z += rand(-e, e);
        dir.normalize();
        const fuse = dist / sp * rand(0.92, 1.08);
        g.projectiles.spawn({ pos: muzzle, vel: dir.multiplyScalar(sp), owner: this, type: 'flak', life: fuse + 0.1, fuse,
          dmg: scaleDmg({ air: 7, missile: 14 }, this.dmgOut), splash: 7, size: 0.8, color: 0xffd090 });
      }
    } else if (k === 'sam') {
      this.aimTurret(dt, to.clone().normalize(), 1.2);
      this.missilesOut = this.missilesOut.filter((m) => m.alive);
      if (dist < 1300 && g.planet.los(muzzle, t.pos, 10)) {
        this.lock += dt;
        if (t.isPlayer || t.cat === 'missile') g.registerLock(this, t, this.lock / 3);
        if (this.lock > 3 && this.cd <= 0 && this.missilesOut.length < 2 && g.missilesOn(t) < 2) {
          const dir = _b.copy(this.up).multiplyScalar(0.8).addScaledVector(to.normalize(), 0.6).normalize();
          this.missilesOut.push(this.fireMissile('e_radar', t, muzzle.clone().addScaledVector(this.up, 1), dir.clone()));
          this.cd = rand(9, 12); this.lock = 0;
        }
      } else this.lock = Math.max(0, this.lock - dt);
    } else if (k === 'artillery') {
      this.aimTurret(dt, ballisticDir(muzzle, t.pos, 200, _b).clone(), 0.6);
      if (this.cd <= 0) {
        this.cd = rand(9, 13);
        if (t.isPlayer) {
          const pred = t.pos.clone().addScaledVector(t.vel, 3.2);
          g.addZone(pred, 24, 3.6, scaleDmg({ ground: 34, naval: 40, static: 30 }, this.dmgOut), this);
        } else {
          g.addZone(t.pos.clone().addScaledVector(t.vel, 2), 20, 3.6, scaleDmg({ ground: 20, naval: 25, static: 20 }, this.dmgOut), this, true);
        }
        g.fx.muzzle(muzzle, 1.5);
        g.audio.cannon();
      }
    } else if (k === 'apc') {
      if (this.cd <= 0 && dist < 260) {
        this.cd = 0.18;
        const dir = to.normalize().clone();
        this.fireBullets(muzzle, dir, 300, { ground: 1.5, air: 2, naval: 1 }, this.aimError(dist, 0.03), 1.2);
      }
    }
  }
  onDestroyed() {
    this.game.fx.explosion(this.pos, 1.4);
    this.game.addWreck(this.pos, this.quat, 1.4);
  }
}

// ------------------------------------------------------------------ ships
const SHIP_MODELS = { destroyer: M.destroyerModel, patrol: M.patrolModel, cargo: M.cargoModel };
export class ShipUnit extends Unit {
  constructor(game, kind, faction, dir, opts = {}) {
    super(game, kind, faction, SHIP_MODELS[kind](faction), opts);
    const d = dir.clone().normalize();
    this.pos.copy(d).multiplyScalar(R);
    this.hf = opts.heading ? tangentOf(d, opts.heading, new THREE.Vector3()) : randomTangent(d, new THREE.Vector3());
    this.path = opts.path || null; this.pathI = 0;
    this.maxSpeed = { destroyer: 6, patrol: 10, cargo: 5 }[kind];
    this.speed = this.maxSpeed * 0.5;
    this.gunCd = rand(1, 3); this.flakCd = 0; this.samCd = rand(5, 9); this.ashmCd = rand(6, 10); this.torpCd = rand(8, 14); this.lock = 0; this.lockA = 0;
    this.bob = rand(0, 6);
    this.airTarget = null;
    this.sync();
  }
  think() {
    const g = this.game;
    this.target = this.findTarget(1500, (e) => e.cat === 'naval' || (e.cat === 'ground' && e.isPlayer), 0.7);
    this.airTarget = this.findTarget(1100, (e) => e.cat === 'air', 0.6) || this.findMissileTarget(500, 1);
  }
  update(dt) {
    const g = this.game;
    if (this.dying) {
      this.sinkT = (this.sinkT || 0) + dt;
      this.pos.multiplyScalar((this.pos.length() - dt * 0.8) / this.pos.length());
      _q.setFromAxisAngle(this.hf, dt * 0.05); this.quat.premultiply(_q);
      if (Math.random() < 0.3) g.fx.fireTrail(this.pos.clone().addScaledVector(this.up, 1));
      this.sync();
      if (this.sinkT > 8) this.remove();
      return;
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.8; this.think(); }
    this.gunCd -= dt; this.flakCd -= dt; this.samCd -= dt; this.ashmCd -= dt; this.torpCd -= dt;
    const up = this.up;
    // waypoints or loiter circle
    let goal = null;
    if (this.path && this.pathI < this.path.length) {
      goal = this.path[this.pathI];
      if (goal.dot(up) > Math.cos(30 / R)) { this.pathI++; if (this.pathI >= this.path.length) { this.arrived = true; if (this.loop) this.pathI = 0; } }
    }
    if (goal) {
      const flat = _a.subVectors(goal, up).addScaledVector(up, -_a.dot(up));
      if (flat.lengthSq() > 1e-12) {
        flat.normalize();
        const err = Math.atan2(_b.crossVectors(this.hf, flat).dot(up), this.hf.dot(flat));
        this.hf.applyAxisAngle(up, clamp(err, -0.25 * dt, 0.25 * dt));
      }
      this.speed = damp(this.speed, this.maxSpeed, 0.4, dt);
    } else {
      this.hf.applyAxisAngle(up, 0.05 * dt);
      this.speed = damp(this.speed, this.maxSpeed * 0.4, 0.4, dt);
    }
    // stay in deep water: probe ahead
    const probe = dirToward(up, this.hf, 40 / R, _c);
    if (g.planet.heightAt(probe) > -3) { this.hf.applyAxisAngle(up, 0.5 * dt); this.speed *= Math.exp(-dt); }
    const nd = dirToward(up, this.hf, this.speed * dt / R, _c);
    if (g.planet.heightAt(nd) < -1.5) {
      this.pos.copy(nd).multiplyScalar(R);
      tangentOf(nd, this.hf, this.hf);
    } else this.speed = 0;
    this.vel.copy(this.hf).multiplyScalar(this.speed);
    this.bob += dt;
    quatFromForwardUp(this.hf, this.up, this.quat);
    _e.set(Math.sin(this.bob * 0.7) * 0.015, 0, Math.sin(this.bob * 0.9) * 0.03);
    _q.setFromEuler(_e); this.quat.multiply(_q);
    if (this.mesh.userData.turret && this.target) {
      _q.copy(this.quat).invert();
      const local = _b.subVectors(this.target.pos, this.pos).applyQuaternion(_q);
      this.mesh.userData.turret.rotation.y = damp(this.mesh.userData.turret.rotation.y, Math.atan2(-local.x, -local.z), 2, dt);
    }
    this.sync();
    this.weapons(dt);
    if (this.speed > 2 && Math.random() < 0.3) g.fx.dust(_a.copy(this.pos).addScaledVector(this.hf, -this.radius), true);
  }
  weapons(dt) {
    const g = this.game, k = this.kind;
    const t = this.target && this.target.alive && !this.target.dying ? this.target : null;
    const a = this.airTarget && this.airTarget.alive && !this.airTarget.dying ? this.airTarget : null;
    const muzzle = _d.copy(this.pos).addScaledVector(this.up, 1.5);
    if (k === 'destroyer') {
      if (t) {
        const dist = t.pos.distanceTo(this.pos);
        if (dist < 950 && this.gunCd <= 0) {
          this.gunCd = rand(3, 4.5);
          const aim = t.pos.clone().addScaledVector(t.vel, dist / 190);
          const bd = ballisticDir(muzzle, aim, 190, new THREE.Vector3());
          const e = this.aimError(dist, 0.006);
          bd.x += rand(-e, e); bd.y += rand(-e, e); bd.z += rand(-e, e);
          g.projectiles.spawn({ pos: muzzle.clone(), vel: bd.normalize().multiplyScalar(190), owner: this, type: 'shell', grav: 1, life: 9,
            dmg: scaleDmg({ naval: 30, ground: 25, static: 20 }, this.dmgOut), splash: 4, size: 1.6, color: 0xffc070 });
          g.audio.cannon();
        }
        if (dist < 1400) {
          this.lock += dt;
          g.registerLock(this, t, this.lock / 2.5);
          if (this.lock > 2.5 && this.ashmCd <= 0 && g.missilesOn(t) < 2) {
            this.fireMissile('e_ashm', t, muzzle.clone().addScaledVector(this.up, 1), _a.copy(this.up).addScaledVector(this.hf, 0.4).normalize().clone());
            this.ashmCd = rand(14, 20); this.lock = 0;
          }
        } else this.lock = 0;
        if (dist < 420 && this.torpCd <= 0 && t.cat === 'naval') {
          this.torpCd = rand(18, 24);
          this.fireMissile('e_torp', t, this.pos.clone(), this.hf.clone());
        }
      }
      if (a) this.flakAndSam(dt, a, muzzle, true);
    } else if (k === 'patrol') {
      const tt = a || t;
      if (tt) {
        const dist = tt.pos.distanceTo(this.pos);
        if (dist < 360 && this.gunCd <= 0) {
          this.gunCd = 0.14;
          const lead = _b.copy(tt.pos).addScaledVector(tt.vel, dist / 330).sub(muzzle).normalize().clone();
          this.fireBullets(muzzle, lead, 330, { air: 2.2, naval: 1.6, ground: 1.2 }, this.aimError(dist, 0.025), 1.3);
          if (Math.random() < 0.08) this.gunCd = 1.2;
        }
        if (a && dist < 750 && dist > 120) {
          this.lockA += dt; g.registerLock(this, a, this.lockA / 2.4);
          if (this.lockA > 2.4 && this.samCd <= 0 && g.missilesOn(a) < 2) {
            this.fireMissile('e_ir', a, muzzle.clone().addScaledVector(this.up, 1), _a.copy(this.up).addScaledVector(_b.subVectors(a.pos, this.pos).normalize(), 1).normalize().clone());
            this.samCd = rand(14, 20); this.lockA = 0;
          }
        }
      }
    }
  }
  flakAndSam(dt, a, muzzle, sam) {
    const g = this.game;
    const dist = a.pos.distanceTo(this.pos);
    if (dist < 620 && this.flakCd <= 0 && g.planet.los(muzzle, a.pos, 6)) {
      this.flakCd = a.cat === 'missile' ? 0.15 : 0.45;
      const sp = 300;
      const dir = _b.copy(a.pos).addScaledVector(a.vel, dist / sp).sub(muzzle).normalize();
      const e = (0.012 + a.vel.length() * 0.0002) * (1.4 - this.skill);
      dir.x += rand(-e, e); dir.y += rand(-e, e); dir.z += rand(-e, e);
      const fuse = dist / sp * rand(0.92, 1.08);
      g.projectiles.spawn({ pos: muzzle.clone(), vel: dir.normalize().multiplyScalar(sp), owner: this, type: 'flak', life: fuse + 0.1, fuse,
        dmg: scaleDmg({ air: 7, missile: 14 }, this.dmgOut), splash: 7, size: 0.8, color: 0xffd090 });
    }
    if (sam && a.cat !== 'missile' && dist < 1100 && dist > 150 && g.planet.altitude(a.pos) > 25) {
      this.lockA += dt; if (a.isPlayer) g.registerLock(this, a, this.lockA / 3);
      if (this.lockA > 3 && this.samCd <= 0 && g.missilesOn(a) < 2) {
        this.fireMissile('e_radar', a, muzzle.clone().addScaledVector(this.up, 1.5), this.up.clone());
        this.samCd = rand(12, 17); this.lockA = 0;
      }
    } else this.lockA = Math.max(0, this.lockA - dt);
  }
  onDestroyed() {
    this.keepWreck = true;
    this.game.fx.explosion(this.pos.clone().addScaledVector(this.up, 1), 3, { water: true });
  }
}
ShipUnit.prototype.keepWreck = true;

// ------------------------------------------------------------------ static structures
export class Structure extends Unit {
  constructor(game, kind, faction, dir, opts = {}) {
    super(game, kind, faction, M.structureModel(kind, faction), opts);
    const d = dir.clone().normalize();
    this.pos.copy(d).multiplyScalar(R + game.planet.heightAt(d) - 0.3);
    quatFromForwardUp(randomTangent(d, _a), d, this.quat);
    this.sync();
    this.mesh.updateMatrixWorld();
  }
  update(dt) {
    if (this.mesh.userData.dish) this.mesh.userData.dish.rotation.y += dt * 0.8;
  }
  onDestroyed() {
    this.game.fx.explosion(this.pos.clone().addScaledVector(this.up, 2), 3);
    this.game.addWreck(this.pos, this.quat, this.radius * 0.7, true);
  }
}
