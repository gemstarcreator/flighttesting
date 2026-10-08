import * as THREE from 'three';
import { R, G, clamp, damp, dmgFor, quatFromForwardUp, tangentOf, rand } from './util.js';
import { MISSILES } from './data.js';
import { missileModel } from './models.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const _c = new THREE.Color();
const Z = new THREE.Vector3(0, 0, 1);
const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _t3 = new THREE.Vector3();

// ---------------------------------------------------------------- unguided projectiles
export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.free = [];
    this.cap = 1600;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, this.cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    game.scene.add(this.mesh);
  }
  clear() { while (this.list.length) this.free.push(this.list.pop()); }

  spawn(o) {
    if (this.list.length >= this.cap) return null;
    const p = this.free.pop() || { pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3() };
    p.pos.copy(o.pos); p.prev.copy(o.pos); p.vel.copy(o.vel);
    p.owner = o.owner; p.faction = o.owner.faction;
    p.dmg = o.dmg; p.life = o.life ?? 1.6; p.age = 0;
    p.type = o.type || 'bullet'; p.grav = o.grav ?? 0; p.splash = o.splash || 0; p.fuse = o.fuse || 0;
    p.size = o.size || 1; p.color = o.color ?? 0xffd38a; p.trail = !!o.trail;
    this.list.push(p);
    return p;
  }

  update(dt) {
    const g = this.game, ents = g.world.entities, planet = g.planet;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.prev.copy(p.pos);
      if (p.grav) p.vel.addScaledVector(_u.copy(p.pos).normalize(), -G * p.grav * dt);
      p.pos.addScaledVector(p.vel, dt);
      p.age += dt; p.life -= dt;
      let dead = false;
      if (p.trail && Math.random() < 0.7) g.fx.trail(p.pos, 0xbdb8ae, 0.3, 0.9);
      if (p.fuse && p.age >= p.fuse) { this.burst(p); dead = true; }
      if (!dead) {
        const hit = this.hitTest(p, ents);
        if (hit) { this.impact(p, hit); dead = true; }
      }
      if (!dead) {
        const r = p.pos.length();
        if (r < R + 320) {
          const h = planet.heightAt(p.pos), sr = R + Math.max(0, h);
          if (r < sr) {
            p.pos.multiplyScalar(sr / r);
            if (p.splash) this.explode(p, null, h < 0);
            else g.fx.dust(p.pos, h < 0);
            dead = true;
          }
        }
      }
      if (p.life <= 0) dead = true;
      if (dead) { this.list[i] = this.list[this.list.length - 1]; this.list.pop(); this.free.push(p); }
    }
    this.render();
  }

  hitTest(p, ents) {
    const seg = _v.subVectors(p.pos, p.prev), len2 = seg.lengthSq();
    const len = Math.sqrt(len2);
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      if (!e.alive || e.dying || e.faction === p.faction || !e.targetable) continue;
      const rr = e.radius * 1.25;
      if (Math.abs(e.pos.x - p.pos.x) > len + rr || Math.abs(e.pos.y - p.pos.y) > len + rr || Math.abs(e.pos.z - p.pos.z) > len + rr) continue;
      _w.subVectors(e.pos, p.prev);
      const t = len2 > 0 ? clamp(_w.dot(seg) / len2, 0, 1) : 0;
      const dx = p.prev.x + seg.x * t - e.pos.x, dy = p.prev.y + seg.y * t - e.pos.y, dz = p.prev.z + seg.z * t - e.pos.z;
      if (dx * dx + dy * dy + dz * dz < rr * rr) { p.pos.set(p.prev.x + seg.x * t, p.prev.y + seg.y * t, p.prev.z + seg.z * t); return e; }
    }
    return null;
  }

  impact(p, e) {
    const g = this.game;
    if (p.splash) { this.explode(p, e, false); return; }
    e.damage(dmgFor(p.dmg, e.cat), p);
    g.fx.sparks(p.pos);
    if (p.owner && p.owner.isPlayer) g.hitMarker();
  }

  explode(p, direct, water) {
    const g = this.game;
    g.fx.explosion(p.pos, clamp(p.splash / 4, 0.5, 2), { water, noDebris: p.splash < 4 });
    if (direct) direct.damage(dmgFor(p.dmg, direct.cat), p);
    g.splash(p.pos, p.splash, p.dmg, p, p.faction, direct, false);
    g.audio.explosion(g.camera.position.distanceTo(p.pos), false);
    if (direct && p.owner && p.owner.isPlayer) g.hitMarker();
  }

  burst(p) {
    const g = this.game;
    g.fx.flak(p.pos);
    g.splash(p.pos, p.splash || 7, p.dmg, p, p.faction, null, true);
    if (g.camera.position.distanceToSquared(p.pos) < 600 * 600) g.audio.explosion(g.camera.position.distanceTo(p.pos) * 2, false);
  }

  render() {
    const n = this.list.length;
    for (let i = 0; i < n; i++) {
      const p = this.list[i];
      const sp = p.vel.length();
      _v.copy(p.vel).divideScalar(sp || 1);
      _q.setFromUnitVectors(Z, _v);
      const len = Math.min(sp * 0.022, 9) * p.size;
      _s.set(0.07 * p.size, 0.07 * p.size, Math.max(len, 0.4));
      _w.copy(p.pos).addScaledVector(_v, -len * 0.5);
      _m.compose(_w, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      _c.setHex(p.color);
      this.mesh.setColorAt(i, _c);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- guided munitions
export class Missile {
  constructor(game, key, owner, pos, dir, opts = {}) {
    const spec = this.spec = MISSILES[key];
    this.key = key; this.game = game; this.owner = owner; this.faction = owner.faction;
    this.cat = 'missile'; this.radius = spec.model === 'big' ? 1.4 : 0.9;
    this.hp = spec.hp || 1; this.alive = true; this.targetable = true;
    this.pos = pos.clone(); this.dir = dir.clone().normalize();
    this.speed = spec.unpowered ? Math.max(opts.speed || 30, 20) : Math.max(spec.speed * 0.45, opts.speed || 0);
    this.vel = this.dir.clone().multiplyScalar(this.speed);
    this.target = opts.target || null;
    this.mode = opts.mode || (this.target ? 'homing' : 'dumb');
    this.fuel = spec.fuel; this.age = 0; this.arm = opts.arm ?? 0.4;
    this.decoy = null; this.decoyT = 0; this.lost = false; this.losT = 0; this.boost = false;
    this.quat = new THREE.Quaternion();
    this.mesh = missileModel(spec.model, this.faction);
    this.mesh.scale.setScalar(opts.scale || 1);
    game.scene.add(this.mesh);
    this.trailT = 0;
    this.name = spec.name;
    if (spec.torpedo) this.initTorpedo();
    this.sync();
  }

  get up() { return _u.copy(this.pos).normalize(); }
  forward(out) { return out.copy(this.dir); }

  initTorpedo() {
    const t = this.target;
    const up = _u.copy(this.pos).normalize();
    let aim = this.pos.clone();
    if (t) {
      const d = this.pos.distanceTo(t.pos);
      aim.copy(t.pos).addScaledVector(t.vel, d / this.spec.speed);
    }
    this.dir = tangentOf(up, aim.sub(this.pos), new THREE.Vector3());
    this.pos.copy(up).multiplyScalar(R - 0.35);
  }

  damage(amount, src) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) { this.shotDown = true; this.explode(null); }
  }

  steerTo(desired, rate, dt) {
    const ang = this.dir.angleTo(desired);
    if (ang < 1e-5) return ang;
    _w.crossVectors(this.dir, desired);
    if (_w.lengthSq() < 1e-12) return ang;
    _w.normalize();
    this.dir.applyAxisAngle(_w, Math.min(ang, rate * dt)).normalize();
    return ang;
  }

  update(dt, ctrl) {
    if (!this.alive) return;
    const g = this.game, spec = this.spec, planet = g.planet;
    this.age += dt;
    const up = _u.copy(this.pos).normalize();
    const alt = planet.altitude(this.pos);

    if (spec.torpedo) return this.updateTorpedo(dt, up);

    // propulsion
    this.boost = !!(ctrl && ctrl.boost);
    if (spec.unpowered) {
      this.speed += -this.dir.dot(up) * G * 0.8 * dt - this.speed * 0.015 * dt;
      this.dir.addScaledVector(up, -G * 0.3 * dt / Math.max(this.speed, 12)).normalize();
      this.fuel -= dt;
    } else if (this.fuel > 0) {
      this.fuel -= dt * (this.boost ? 2.2 : 1);
      this.speed = damp(this.speed, this.boost ? spec.boost : spec.speed, 1.6, dt);
    } else {
      this.speed *= Math.exp(-0.25 * dt);
      this.dir.addScaledVector(up, -G * dt / Math.max(this.speed, 10)).normalize();
    }

    // guidance
    if (this.mode === 'manual' && ctrl) {
      const tr = spec.ctrlTurn * (ctrl.fine ? 0.45 : 1);
      const right = _v.crossVectors(this.dir, up);
      if (right.lengthSq() > 1e-8) {
        right.normalize();
        this.dir.applyAxisAngle(right, ctrl.pitch * tr * dt);
      }
      this.dir.applyAxisAngle(up, -ctrl.yaw * tr * dt).normalize();
      // gentle aim assist toward the locked target
      const t = this.target;
      if (t && t.alive && !t.dying) {
        const to = _w.subVectors(t.pos, this.pos);
        const d = to.length();
        to.divideScalar(d);
        const ang = this.dir.angleTo(to);
        if (ang < 0.16 && d < 1500) this.steerTo(to.clone(), spec.ctrlTurn * 0.55, dt);
      }
    } else if (this.decoy) {
      this.decoyT -= dt;
      this.decoy.addScaledVector(up, -4 * dt);
      this.steerTo(_w.subVectors(this.decoy, this.pos).normalize().clone(), spec.turn, dt);
      if (this.decoyT <= 0) { this.decoy = null; this.lost = true; this.mode = 'dumb'; }
    } else if (this.mode === 'homing' && this.target && !this.lost) {
      const t = this.target;
      if (!t.alive || t.dying) { this.mode = 'dumb'; }
      else {
        const to = _t1.subVectors(t.pos, this.pos);
        const d = to.length() || 1;
        const tv = t.vel || _t3.set(0, 0, 0);
        const closing = Math.max(20, this.speed - tv.dot(to) / d);
        const tgo = clamp(d / closing, 0, 4);
        const desired = _t2.copy(t.pos).addScaledVector(tv, tgo * 0.9).sub(this.pos).normalize();
        if (spec.seaSkim && d > 90) {
          desired.addScaledVector(up, clamp((4 - alt) / 25, -0.4, 0.4) - desired.dot(up) * 0.8).normalize();
        }
        const ang = this.steerTo(desired.clone(), spec.turn, dt);
        // overshoot: once a missile is badly out-turned it cannot recover
        if (ang > 1.05 && d < 350 && this.age > 1) this.loseLock();
        if (spec.losLock) {
          const notch = t.isPlayer && planet.altitude(t.pos) < 22 && tv.lengthSq() > 1 &&
            Math.abs(_t3.copy(tv).normalize().dot(to.normalize())) < 0.35;
          if (notch || !planet.los(this.pos, t.pos, 8)) { this.losT += dt; if (this.losT > 0.9) this.loseLock(); }
          else this.losT = Math.max(0, this.losT - dt);
        }
      }
    }

    this.vel.copy(this.dir).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);

    // trail
    this.trailT -= dt;
    if (spec.trail && this.fuel > 0 && this.trailT <= 0) {
      this.trailT = 0.03;
      g.fx.trail(_v.copy(this.pos).addScaledVector(this.dir, -0.8), spec.trail, spec.model === 'big' ? 0.7 : 0.45, this.owner.isPlayer ? 1.4 : 2.2);
    }

    // collisions
    if (this.age > this.arm) {
      const ents = g.world.entities;
      for (let k = 0; k < ents.length; k++) {
        const e = ents[k];
        if (!e.alive || e.dying || e.faction === this.faction || !e.targetable) continue;
        const fuse = e.cat === 'air' ? spec.fuse : spec.fuse * 0.5;
        const rr = e.radius + fuse;
        if (this.pos.distanceToSquared(e.pos) < rr * rr) { this.explode(e); return; }
      }
      // missiles can intercept missiles they target
      const t = this.target;
      if (t && t.cat === 'missile' && t.alive && this.pos.distanceToSquared(t.pos) < (spec.fuse + 1.5) ** 2) {
        t.damage(dmgFor(spec.dmg, 'missile'), this); this.explode(null); return;
      }
    }
    const nalt = planet.altitude(this.pos);
    if (nalt < 0) {
      const h = planet.heightAt(this.pos);
      this.pos.multiplyScalar(planet.surfaceR(this.pos) / this.pos.length());
      this.explode(null, h < 0);
      return;
    }
    if (this.fuel < -6 || (this.fuel <= 0 && this.speed < 18 && !spec.unpowered)) { this.explode(null); return; }
    this.sync();
  }

  updateTorpedo(dt, up) {
    const g = this.game;
    this.fuel -= dt;
    this.pos.addScaledVector(this.dir, this.spec.speed * dt);
    const nu = _w.copy(this.pos).normalize();
    this.pos.copy(nu).multiplyScalar(R - 0.35);
    tangentOf(nu, this.dir, this.dir);
    this.vel.copy(this.dir).multiplyScalar(this.spec.speed);
    if (Math.random() < 0.5) g.fx.dust(_v.copy(this.pos).addScaledVector(nu, 0.4), true);
    if (g.planet.heightAt(this.pos) > -0.4 || this.fuel <= 0) { this.explode(null, true); return; }
    const ents = g.world.entities;
    for (const e of ents) {
      if (!e.alive || e.dying || e.faction === this.faction || e.cat !== 'naval') continue;
      if (this.pos.distanceToSquared(e.pos) < (e.radius + 1.5) ** 2) { this.explode(e, true); return; }
    }
    this.sync();
  }

  loseLock() {
    if (this.lost) return;
    this.lost = true; this.mode = 'dumb';
    this.game.onMissileEvaded(this);
  }

  sync() {
    quatFromForwardUp(this.dir, _v.copy(this.pos).normalize(), this.quat);
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.quat);
  }

  explode(hit, water = false) {
    if (!this.alive) return;
    this.alive = false;
    const g = this.game, spec = this.spec;
    g.scene.remove(this.mesh);
    const size = clamp(spec.splash / 6, 0.6, 3.2);
    g.fx.explosion(this.pos, size, { water });
    if (hit) hit.damage(dmgFor(spec.dmg, hit.cat), this);
    g.splash(this.pos, spec.splash, spec.dmg, this, this.faction, hit, false);
    g.audio.explosion(g.camera.position.distanceTo(this.pos), spec.splash > 10);
    if (this.owner.isPlayer && hit) g.hitMarker(true);
    g.onMissileEnd(this, hit);
  }
}

export function newMissileId() { return rand(); }
