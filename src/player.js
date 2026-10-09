import * as THREE from 'three';
import { Entity } from './entity.js';
import { ROLES, MISSILES } from './data.js';
import * as M from './models.js';
import { Missile } from './weapons.js';
import { ballisticDir } from './units.js';
import { R, G, clamp, damp, rand, quatFromForwardUp, tangentOf, dirToward, angleBetween } from './util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e2 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _eu = new THREE.Euler();
const AX_X = new THREE.Vector3(1, 0, 0), AX_Y = new THREE.Vector3(0, 1, 0);
const MODEL = { jet: M.jetModel, striker: M.strikerModel, heli: M.heliModel, tank: M.tankModel, destroyer: M.destroyerModel, launcher: M.launcherModel };

export class PlayerVehicle extends Entity {
  constructor(game, roleKey, pos, heading) {
    const role = ROLES[roleKey];
    const cat = role.type === 'plane' || role.type === 'heli' ? 'air' : role.type === 'ship' ? 'naval' : 'ground';
    const radius = { plane: 2.2, heli: 2.4, ground: 2, ship: 6 }[role.type];
    super(game, { kind: roleKey, cat, faction: 0, hp: role.hp, radius, score: 0, name: role.name, mesh: MODEL[role.model](0) });
    this.isPlayer = true;
    this.role = role; this.roleKey = roleKey; this.type = role.type;
    this.secs = role.secondaries.map((s) => ({ ...s, name: s.name || MISSILES[s.spec].name, max: s.ammo }));
    this.secIdx = 0;
    this.gunHeat = 0; this.overheat = false; this.gunCd = 0; this.reload = 0; this.counterCd = 0;
    this.rates = new THREE.Vector3();
    this.speed = role.cruise || 0;
    this.assist = true;
    this.target = null; this.lockT = 0;
    this.pos.copy(pos);
    const up = this.up;
    this.hf = tangentOf(up, heading, new THREE.Vector3());
    this.nrm = up.clone();
    this.camF = this.hf.clone();   // camera / aim yaw direction (ground, ship, heli)
    this.camPitch = 0.05;
    this.apAlt = 300;
    this.pullUp = false; this.stall = false;
    this.throttleVis = 0;
    this.regenT = 0;
    if (this.type === 'plane') {
      quatFromForwardUp(this.hf, up, this.quat);
      this.vel.copy(this.hf).multiplyScalar(this.speed);
    } else {
      quatFromForwardUp(this.hf, up, this.quat);
    }
    if (this.type === 'plane' || this.type === 'heli') {
      this.shadow = M.shadowBlob();
      game.scene.add(this.shadow);
    }
    this.sync();
  }

  get sec() { return this.secs[this.secIdx]; }

  update(dt, I) {
    const g = this.game;
    if (this.dying) return;
    const active = g.controlled === this;
    const inp = active ? I : null;
    this.counterCd -= dt; this.gunCd -= dt; this.reload -= dt;
    this.gunHeat = Math.max(0, this.gunHeat - dt * 0.33);
    if (this.overheat && this.gunHeat < 0.35) this.overheat = false;
    if (this.type === 'plane') this.updatePlane(dt, inp, I);
    else if (this.type === 'heli') this.updateHeli(dt, inp, I);
    else if (this.type === 'ground') this.updateGround(dt, inp, I);
    else this.updateShip(dt, inp, I);
    if (active) this.weapons(dt, I);
    this.updateTarget(dt);
    // slow regeneration when out of combat
    if (g.time - this.lastHit > 10 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.012 * dt);
    this.sync();
    if (this.shadow) this.updateShadow();
  }

  // ---------------------------------------------------------------- aircraft
  updatePlane(dt, I, raw) {
    const g = this.game, r = this.role, q = this.quat;
    const up = _a.copy(this.pos).normalize();
    const f = this.forward(_b), rt = this.right(_c), lu = this.localUp(_d);
    const alt = g.planet.altitude(this.pos);
    let pitchIn = 0, rollIn = 0, yawIn = 0, thr = 0, brk = 0;
    const bankSin = rt.dot(up);              // + when right wing is up (banked left)
    const bank = Math.asin(clamp(bankSin, -1, 1));
    const upright = lu.dot(up);
    if (I) {
      pitchIn = I.moveY * I.pitchSign;
      rollIn = I.moveX;
      yawIn = (I.yawR || 0) - (I.yawL || 0);
      thr = I.throttle || 0; brk = I.brake || 0;
      // flight assist: gently level the wings when the stick is centred
      if (this.assist && Math.abs(rollIn) < 0.08 && upright > 0.2 && Math.abs(bank) < 1.25) rollIn += clamp(bank * 0.9, -0.45, 0.45);
    } else {
      // autopilot while you steer a missile: hold altitude, wings level
      const climb = f.dot(up);
      const want = clamp((this.apAlt - alt) / 350, -0.2, 0.25);
      rollIn = upright < 0 ? 1 : clamp(bank * 2.2, -1, 1);
      pitchIn = clamp((want - climb) * 4, -0.6, 0.8) * clamp(upright, 0, 1);
    }
    // speed model
    let target = r.cruise + (r.maxSpeed - r.cruise) * thr - (r.cruise - r.minSpeed) * brk;
    if (alt > 1600) target *= clamp(1 - (alt - 1600) / 1200, 0.4, 1);
    this.speed = damp(this.speed, target, thr > 0.1 ? 0.75 : 0.55, dt);
    this.speed -= f.dot(up) * G * 0.85 * dt;
    this.speed = clamp(this.speed, r.minSpeed * 0.55, r.maxSpeed * 1.3);
    this.throttleVis = damp(this.throttleVis, thr, 5, dt);
    const eff = clamp((this.speed - r.stall * 0.5) / (r.cruise - r.stall * 0.5), 0.35, 1.15);
    // ground proximity
    const predicted = alt + f.dot(up) * this.speed * 1.8;
    this.pullUp = predicted < 28 && f.dot(up) < 0.05 && alt < 250;
    if (this.pullUp && (this.assist || !I) && upright > 0.25) pitchIn = Math.max(pitchIn, clamp((30 - predicted) / 30, 0.35, 1));
    // angular rates (smoothed for fluid control)
    this.rates.x = damp(this.rates.x, pitchIn * r.pitchRate * eff, 9, dt);
    this.rates.y = damp(this.rates.y, yawIn * r.yawRate * eff, 6, dt);
    this.rates.z = damp(this.rates.z, rollIn * r.rollRate * eff, 11, dt);
    _eu.set(this.rates.x * dt, -this.rates.y * dt, -this.rates.z * dt, 'YXZ');
    q.multiply(_q.setFromEuler(_eu));
    // coordinated turn: banking swings the heading around the local vertical
    q.premultiply(_q.setFromAxisAngle(up, bankSin * 0.5 * eff * clamp(upright + 0.3, 0, 1) * dt));
    // stall: the nose falls through gently instead of a crash
    this.stall = this.speed < r.stall;
    if (this.stall) {
      const k = (r.stall - this.speed) / r.stall;
      q.premultiply(_q.setFromAxisAngle(this.right(_e2), -k * 0.9 * dt));
    }
    q.normalize();
    const f2 = this.forward(_b);
    this.vel.copy(f2).multiplyScalar(this.speed);
    if (this.stall) this.vel.addScaledVector(up, -(r.stall - this.speed) * 0.6);
    const oldUp = _c.copy(up);
    this.pos.addScaledVector(this.vel, dt);
    const newUp = _d.copy(this.pos).normalize();
    q.premultiply(_q.setFromUnitVectors(oldUp, newUp)).normalize();  // follow the curvature
    // terrain contact: shallow touches scrape, steep impacts crash
    const alt2 = g.planet.altitude(this.pos);
    if (alt2 < 0.9) {
      const sink = -this.vel.dot(newUp);
      if (sink > 16 || this.forward(_e2).dot(newUp) < -0.5) {
        this.damage(9999, null);
        return;
      }
      this.damage(5 + sink * 2.2, null);
      this.pos.multiplyScalar((g.planet.surfaceR(this.pos) + 1.2) / this.pos.length());
      q.premultiply(_q.setFromAxisAngle(this.right(_e2), 0.18));
      this.speed *= 0.85;
      g.message('SCRAPE! PULL UP', 'warn');
      g.input.rumble(1, 0.6, 250);
      g.fx.dust(this.pos, g.planet.isWater(this.pos));
    }
    if (this.mesh.userData.burner) this.mesh.userData.burner.scale.set(1, 1, 0.3 + this.throttleVis * 2.2);
    g.audio.engine('plane', clamp((this.speed - r.minSpeed) / (r.maxSpeed - r.minSpeed), 0, 1), true);
  }

  // ---------------------------------------------------------------- helicopter
  updateHeli(dt, I) {
    const g = this.game, r = this.role;
    const up = _a.copy(this.pos).normalize();
    tangentOf(up, this.hf, this.hf);
    tangentOf(up, this.camF, this.camF);
    const right = _b.crossVectors(this.hf, up);
    let fwd = 0, side = 0, climb = 0, yawIn = 0;
    if (I) {
      fwd = -I.moveY; side = I.moveX;
      climb = (I.throttle || 0) - (I.brake || 0);
      yawIn = (I.yawR || 0) - (I.yawL || 0);
    }
    // nose follows the camera yaw (aim with the right stick), rudder buttons add more
    if (I) {
      const err = Math.atan2(_c.crossVectors(this.hf, this.camF).dot(up), this.hf.dot(this.camF));
      this.hf.applyAxisAngle(up, clamp(err * 3, -1.9, 1.9) * dt - yawIn * 1.5 * dt);
      if (yawIn) this.camF.applyAxisAngle(up, -yawIn * 1.5 * dt);
    }
    const hv = _c.copy(this.vel).addScaledVector(up, -this.vel.dot(up));
    hv.addScaledVector(this.hf, fwd * 24 * dt).addScaledVector(right, side * 19 * dt);
    hv.multiplyScalar(Math.exp(-(I && (fwd || side) ? 0.7 : 1.6) * dt));
    if (hv.length() > r.maxSpeed) hv.setLength(r.maxSpeed);
    const alt = g.planet.altitude(this.pos);
    let vv = this.vel.dot(up);
    vv = damp(vv, climb * r.climb, 2.5, dt);
    if (alt > 1000 && vv > 0) vv *= 0.5;
    this.vel.copy(hv).addScaledVector(up, vv);
    this.pos.addScaledVector(this.vel, dt);
    const alt2 = g.planet.altitude(this.pos);
    this.landed = alt2 < 1.0;
    if (alt2 < 1.0) {
      const sink = -vv;
      if (sink > 12) this.damage(sink * 3, null);
      this.pos.multiplyScalar((g.planet.surfaceR(this.pos) + 1.0) / this.pos.length());
      this.vel.addScaledVector(up, -Math.min(0, this.vel.dot(up)));
    }
    this.pullUp = false;
    // body attitude (visual): pitch into the direction of travel
    const nu = _d.copy(this.pos).normalize();
    quatFromForwardUp(tangentOf(nu, this.hf, _e2), nu, this.quat);
    _eu.set(-hv.dot(this.hf) / r.maxSpeed * 0.32 - fwd * 0.08, 0, -hv.dot(right) / r.maxSpeed * 0.3 - side * 0.08);
    this.quat.multiply(_q.setFromEuler(_eu));
    this.mesh.userData.rotor.rotation.y += dt * 28;
    this.mesh.userData.tailRotor.rotation.x += dt * 40;
    this.speed = hv.length();
    g.audio.engine('heli', clamp(0.4 + climb * 0.3 + this.speed / r.maxSpeed * 0.3, 0, 1));
  }

  // ---------------------------------------------------------------- tank / launcher truck
  updateGround(dt, I) {
    const g = this.game, r = this.role;
    const up = _a.copy(this.pos).normalize();
    tangentOf(up, this.hf, this.hf);
    tangentOf(up, this.camF, this.camF);
    let thr = 0, steer = 0;
    if (I) { thr = -I.moveY; steer = I.moveX; }
    const want = thr >= 0 ? thr * r.maxSpeed : thr * r.reverse;
    this.speed = damp(this.speed, want, Math.abs(want) > Math.abs(this.speed) ? 1.6 : 3, dt);
    const dir = this.speed < -0.3 ? -1 : 1;
    this.hf.applyAxisAngle(up, -steer * r.turnRate * dir * dt);
    const step = this.speed * dt;
    if (Math.abs(step) > 1e-4) {
      const nd = dirToward(up, this.hf, step / R, _b);
      const h = g.planet.heightAt(nd), h0 = g.planet.heightAt(up);
      if (h < 0.4) { this.speed = 0; if (I && Math.abs(thr) > 0.2) g.message('Cannot drive into water', 'info', 1); }
      else if ((h - h0) / Math.abs(step) > 1.5) { this.speed *= 0.3; }
      else {
        this.pos.copy(nd).multiplyScalar(R + h + 0.02);
        tangentOf(nd, this.hf, this.hf);
      }
    }
    this.vel.copy(this.hf).multiplyScalar(this.speed);
    this.pos.multiplyScalar((R + g.planet.heightAt(this.pos) + 0.02) / this.pos.length());
    const n = g.planet.normalAt(this.pos, _c);
    this.nrm.lerp(n, 1 - Math.exp(-dt * 6)).normalize();
    quatFromForwardUp(tangentOf(this.nrm, this.hf, _d), this.nrm, _q2);
    this.quat.slerp(_q2, 1 - Math.exp(-dt * 10));
    this.aimTurret(dt);
    this.pullUp = false;
    g.audio.engine('ground', clamp(Math.abs(this.speed) / r.maxSpeed, 0, 1));
  }

  // ---------------------------------------------------------------- ship
  updateShip(dt, I) {
    const g = this.game, r = this.role;
    const up = _a.copy(this.pos).normalize();
    tangentOf(up, this.hf, this.hf);
    tangentOf(up, this.camF, this.camF);
    let thr = 0, steer = 0;
    if (I) { thr = -I.moveY; steer = I.moveX; }
    // telegraph-style throttle: stick sets the target and it is kept
    if (I && Math.abs(thr) > 0.15) this.shipThr = clamp((this.shipThr ?? 0.4) + thr * dt * 0.6, -0.3, 1);
    const want = (this.shipThr ?? 0.4) >= 0 ? (this.shipThr ?? 0.4) * r.maxSpeed : (this.shipThr) * r.reverse / 0.3;
    this.speed = damp(this.speed, want, 0.35, dt);
    const eff = clamp(Math.abs(this.speed) / 5, 0.25, 1);
    this.yawRate = damp(this.yawRate || 0, -steer * r.turnRate * eff, 1.5, dt);
    this.hf.applyAxisAngle(up, this.yawRate * dt);
    const nd = dirToward(up, this.hf, this.speed * dt / R, _b);
    if (g.planet.heightAt(nd) < -1.2) {
      this.pos.copy(nd).multiplyScalar(R);
      tangentOf(nd, this.hf, this.hf);
    } else {
      this.speed *= 0.2; this.shipThr = 0;
      g.message('Running aground! Reverse or turn', 'warn', 1.5);
    }
    this.vel.copy(this.hf).multiplyScalar(this.speed);
    this.bob = (this.bob || 0) + dt;
    quatFromForwardUp(this.hf, _c.copy(this.pos).normalize(), this.quat);
    _eu.set(Math.sin(this.bob * 0.7) * 0.012, 0, Math.sin(this.bob * 0.9) * 0.02 - this.yawRate * 0.25);
    this.quat.multiply(_q.setFromEuler(_eu));
    this.aimTurret(dt);
    if (Math.abs(this.speed) > 2 && Math.random() < 0.4) g.fx.dust(_d.copy(this.pos).addScaledVector(this.hf, -5), true);
    this.pullUp = false;
    g.audio.engine('ship', clamp(Math.abs(this.speed) / r.maxSpeed, 0, 1));
  }

  aimTurret(dt) {
    const tr = this.mesh.userData.turret, rack = this.mesh.userData.rack;
    const g = this.game;
    if (tr) {
      const aimDir = this.aimDir(_e2);
      _q.copy(this.quat).invert();
      const local = aimDir.applyQuaternion(_q);
      const yaw = Math.atan2(-local.x, -local.z);
      let err = Math.atan2(Math.sin(yaw - tr.rotation.y), Math.cos(yaw - tr.rotation.y));
      tr.rotation.y += clamp(err, -1.4 * dt, 1.4 * dt);
      const pitch = Math.atan2(local.y, Math.hypot(local.x, local.z));
      const barrel = this.mesh.userData.barrel;
      if (barrel) barrel.rotation.x = damp(barrel.rotation.x, clamp(pitch, -0.12, 0.5), 6, dt);
      this.turretErr = Math.abs(err);
    }
    if (rack) {
      const want = this.sec && this.sec.spec === 'cruise' ? 0.6 : 0.15;
      rack.rotation.x = damp(rack.rotation.x, want, 2, dt);
    }
  }

  // world-space aim direction for cannons (auto-ballistic toward the crosshair point)
  aimDir(out) {
    const g = this.game;
    const muzzle = this.muzzlePos(_d);
    if (this.role.primary.kind === 'cannon' && g.aimPoint) return ballisticDir(muzzle, g.aimPoint, this.role.primary.speed, out);
    if (g.aimPoint) return out.subVectors(g.aimPoint, muzzle).normalize();
    return out.copy(this.camF);
  }
  muzzlePos(out) {
    const up = _c.copy(this.pos).normalize();
    if (this.type === 'ship') return out.copy(this.pos).addScaledVector(up, 1.5).addScaledVector(this.hf, 2.7);
    if (this.type === 'ground') return out.copy(this.pos).addScaledVector(up, 1.1);
    if (this.type === 'heli') return out.copy(this.pos).addScaledVector(up, -0.4).addScaledVector(this.hf, 1.3);
    return out.copy(this.pos).addScaledVector(this.forward(_a), 1.8);
  }
  barrelDir(out) {
    const tr = this.mesh.userData.turret, br = this.mesh.userData.barrel;
    out.set(0, 0, -1);
    if (br) out.applyAxisAngle(AX_X, br.rotation.x);
    if (tr) out.applyAxisAngle(AX_Y, tr.rotation.y);
    return out.applyQuaternion(this.quat);
  }

  // ---------------------------------------------------------------- weapons
  weapons(dt, I) {
    const g = this.game, P = this.role.primary;
    // primary
    if (P.kind === 'gun') {
      if (I.primaryDown && this.gunCd <= 0 && !this.overheat) {
        this.gunCd = 1 / P.rate;
        this.gunHeat += P.heatPer;
        if (this.gunHeat >= 1) { this.overheat = true; g.message('GUN OVERHEAT', 'warn', 1.2); }
        const muzzle = this.muzzlePos(new THREE.Vector3());
        let dir;
        if (this.type === 'plane') dir = this.forward(new THREE.Vector3());
        else {
          dir = this.aimDir(new THREE.Vector3());
          if (this.type === 'heli') {
            // chin gun gimbal limit
            const fwd = _b.copy(this.hf);
            if (dir.angleTo(fwd) > 1.0) dir.copy(fwd).lerp(dir, 0.5).normalize();
          }
        }
        dir.x += rand(-P.spread, P.spread); dir.y += rand(-P.spread, P.spread); dir.z += rand(-P.spread, P.spread);
        dir.normalize();
        const vel = dir.multiplyScalar(P.speed).add(this.vel);
        g.projectiles.spawn({ pos: muzzle, vel, owner: this, dmg: P.dmg, life: 1.5, color: 0xfff0b0, size: P.heavy ? 1.3 : 1 });
        g.fx.muzzle(muzzle, P.heavy ? 0.6 : 0.4);
        g.audio.gun(P.heavy);
        if (Math.random() < 0.3) g.input.rumble(0.1, 0.25, 60);
      }
    } else if (P.kind === 'cannon') {
      if (I.primaryPressed) {
        if (this.reload > 0) g.message('Reloading…', 'info', 0.6);
        else {
          this.reload = P.reload;
          const muzzle = this.muzzlePos(new THREE.Vector3());
          const dir = this.barrelDir(new THREE.Vector3());
          // auto-ranging: use the ballistic solution if the turret is on target
          const want = this.aimDir(new THREE.Vector3());
          if (dir.angleTo(want) < 0.08) dir.copy(want);
          muzzle.addScaledVector(dir, this.type === 'ship' ? 1.2 : 1.6);
          g.projectiles.spawn({ pos: muzzle, vel: dir.clone().multiplyScalar(P.speed).add(this.vel), owner: this, type: 'shell', grav: 1, life: 9,
            dmg: P.dmg, splash: P.splash, size: 1.7, color: 0xffd28a });
          g.fx.muzzle(muzzle, 1.2);
          g.fx.trail(muzzle, 0xb8b2a6, 1, 1);
          g.audio.cannon();
          g.input.rumble(0.8, 0.4, 180);
          g.camCtl.shake(0.35);
        }
      }
    }
    // special weapon selection
    if (I.weaponNextPressed) { this.secIdx = (this.secIdx + 1) % this.secs.length; g.audio.ui(); }
    if (I.weaponPrevPressed) { this.secIdx = (this.secIdx + this.secs.length - 1) % this.secs.length; g.audio.ui(); }
    if (I.secondaryPressed) this.fireSecondary();
    if (I.targetPressed) this.cycleTarget();
    if (I.counterPressed) g.counter();
    if (I.assistPressed && this.type === 'plane') { this.assist = !this.assist; g.message('Flight assist ' + (this.assist ? 'ON' : 'OFF'), 'info', 1.2); }
  }

  fireSecondary() {
    const g = this.game, s = this.sec;
    if (s.ammo <= 0) { g.message(s.name + ' — out of ammo', 'warn', 1.2); g.audio.beep(300, 0.15); return; }
    const up = _a.copy(this.pos).normalize();
    if (s.rocket) {
      this.rocketSide = -(this.rocketSide || 1);
      for (let i = 0; i < 2; i++) {
        let dir;
        if (this.type === 'plane') dir = this.forward(new THREE.Vector3());
        else dir = this.aimDir(new THREE.Vector3());
        dir.x += rand(-0.008, 0.008); dir.y += rand(-0.008, 0.008); dir.z += rand(-0.008, 0.008);
        dir.normalize();
        const side = this.type === 'plane' ? this.right(new THREE.Vector3()) : _b.crossVectors(this.hf, up);
        const origin = this.pos.clone().addScaledVector(side, (i ? 1 : -1) * 1.0).addScaledVector(up, -0.4);
        g.projectiles.spawn({ pos: origin, vel: dir.multiplyScalar(190).add(this.vel), owner: this, type: 'rocket', life: 5, grav: 0.15,
          dmg: { ground: 55, naval: 35, static: 45, air: 40 }, splash: 4, size: 1.3, color: 0xffb070, trail: true });
      }
      s.ammo -= 2;
      g.audio.launch();
      return;
    }
    const spec = MISSILES[s.spec];
    let origin, dir, speed = 0;
    if (this.type === 'plane') {
      const f = this.forward(new THREE.Vector3());
      origin = this.pos.clone().addScaledVector(this.localUp(_b), -0.6).addScaledVector(f, 0.4);
      dir = f; speed = this.speed;
      if (spec.unpowered) dir.addScaledVector(up, -0.05).normalize();
    } else if (this.type === 'heli') {
      origin = this.pos.clone().addScaledVector(up, -0.3).addScaledVector(_b.crossVectors(this.hf, up), (this.mslSide = -(this.mslSide || 1)) * 1.0);
      dir = this.aimDir(new THREE.Vector3());
      speed = this.speed;
    } else if (this.type === 'ship') {
      origin = this.pos.clone().addScaledVector(up, 2.5).addScaledVector(this.hf, 1.5);
      const toward = g.aimPoint ? _b.subVectors(g.aimPoint, origin).normalize() : this.camF;
      dir = up.clone().multiplyScalar(spec === MISSILES.sam ? 0.5 : 0.35).add(tangentOf(up, toward, _c)).normalize();
      if (spec === MISSILES.sam && g.aimPoint) dir.copy(toward).addScaledVector(up, 0.3).normalize();
    } else {
      if (this.roleKey === 'launcher') {
        origin = this.pos.clone().addScaledVector(up, 2.2).addScaledVector(this.hf, -1);
        const toward = g.aimPoint ? _b.subVectors(g.aimPoint, origin).normalize() : this.camF;
        dir = tangentOf(up, toward, new THREE.Vector3()).addScaledVector(up, spec === MISSILES.sam ? 0.9 : 0.55).normalize();
        if (spec === MISSILES.sam && g.aimPoint) dir.copy(toward).addScaledVector(up, 0.25).normalize();
      } else {
        origin = this.muzzlePos(new THREE.Vector3()).addScaledVector(up, 0.4);
        dir = this.camViewDir ? this.camViewDir.clone() : this.barrelDir(new THREE.Vector3());
        dir.addScaledVector(up, 0.04).normalize();
      }
    }
    const tgt = this.target && this.target.alive && !this.target.dying ? this.target : null;
    const m = new Missile(g, s.spec, this, origin, dir, { mode: 'manual', target: tgt, speed, arm: 0.6 });
    g.world.missiles.push(m);
    s.ammo--;
    g.audio.launch();
    g.input.rumble(0.5, 0.5, 200);
    this.apAlt = Math.max(this.game.planet.altitude(this.pos), 150);
    g.takeControl(m);
  }

  // ---------------------------------------------------------------- targeting
  aimForward(out) {
    if (this.type === 'plane') return this.forward(out);
    return out.copy(this.camViewDir || this.camF);
  }
  targetScore(e, fwd) {
    const to = _b.subVectors(e.pos, this.pos);
    const d = to.length();
    const ang = fwd.angleTo(to);
    return ang * 900 + d * 0.25 - (e.tag === 'objective' ? 250 : 0);
  }
  candidates() {
    const g = this.game;
    const range = this.type === 'plane' ? 3500 : 2600;
    return g.world.entities.filter((e) => e.alive && !e.dying && e.faction !== this.faction && e.targetable &&
      e.pos.distanceToSquared(this.pos) < range * range);
  }
  updateTarget(dt) {
    const g = this.game;
    const t = this.target;
    if (t && (!t.alive || t.dying || t.pos.distanceTo(this.pos) > 4500)) this.target = null;
    this.retargetT = (this.retargetT || 0) - dt;
    if (!this.target && this.retargetT <= 0) {
      this.retargetT = 0.5;
      const fwd = this.aimForward(_c);
      let best = null, bs = 1e9;
      for (const e of this.candidates()) {
        const s = this.targetScore(e, fwd);
        if (s < bs) { bs = s; best = e; }
      }
      this.target = best;
      this.lockT = 0;
    }
    // missile lock tone when the target is in the seeker cone
    if (this.target) {
      const to = _b.subVectors(this.target.pos, this.pos);
      const inCone = this.aimForward(_c).angleTo(to) < 0.45 && to.length() < 2000;
      this.lockT = inCone ? this.lockT + dt : Math.max(0, this.lockT - dt * 2);
    }
  }
  cycleTarget() {
    const fwd = this.aimForward(_c);
    const list = this.candidates().map((e) => [this.targetScore(e, fwd), e]).sort((a, b) => a[0] - b[0]).slice(0, 8).map((x) => x[1]);
    if (!list.length) { this.target = null; return; }
    const i = list.indexOf(this.target);
    this.target = list[(i + 1) % list.length];
    this.lockT = 0;
    this.game.audio.beep(1200, 0.04, 0.08);
  }

  updateShadow() {
    const g = this.game;
    const up = _a.copy(this.pos).normalize();
    const alt = g.planet.altitude(this.pos);
    const s = this.shadow;
    s.visible = alt < 160;
    if (!s.visible) return;
    s.position.copy(up).multiplyScalar(g.planet.surfaceR(this.pos) + 0.25);
    quatFromForwardUp(tangentOf(up, this.forward(_b), _c), up, s.quaternion);
    const sz = (this.type === 'heli' ? 2 : 2.2) * (1 + alt / 120);
    s.scale.set(sz, 1, sz);
    s.material.opacity = 0.32 * (1 - alt / 160);
  }

  onDamage(amount, src) {
    const g = this.game;
    const sp = src ? (src.owner && src.owner.pos ? src.owner.pos : src.pos) : null;
    g.hud.damageFrom(sp);
    g.input.rumble(0.6, 0.35, 140);
    if (amount > 20) g.camCtl.shake(0.6);
  }

  onDestroyed() {
    const g = this.game;
    g.fx.explosion(this.pos, 2.2);
    g.audio.explosion(0, true);
    g.input.rumble(1, 1, 600);
    this.mesh.visible = false;
    if (this.shadow) g.scene.remove(this.shadow);
    this.keepWreck = true;
    g.onPlayerDown();
  }
  dispose() {
    this.remove();
    if (this.shadow) this.game.scene.remove(this.shadow);
  }
}
