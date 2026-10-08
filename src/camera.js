import * as THREE from 'three';
import { R, clamp, damp, rand, quatFromForwardUp, tangentOf } from './util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class CamCtl {
  constructor(game) {
    this.game = game;
    this.cam = game.camera;
    this.q = new THREE.Quaternion();
    this.mode = 0;
    this.lookYaw = 0; this.lookPitch = 0; this.mYaw = 0; this.mPitch = 0; this.mIdle = 0;
    this.shakeAmt = 0;
    this.init = false;
    this.deathT = 0;
    this.holdPos = new THREE.Vector3(); this.holdQ = new THREE.Quaternion();
  }
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }
  reset() { this.init = false; }

  update(dt, I) {
    const g = this.game, p = g.player, ctl = g.controlled;
    if (!p) return;
    if (I.cameraPressed) { this.mode = (this.mode + 1) % (p.type === 'plane' ? 3 : 2); }
    let fov = 64;
    if (g.holdCam > 0) {
      this.cam.position.copy(this.holdPos); this.cam.quaternion.copy(this.holdQ);
    } else if (ctl && ctl.cat === 'missile') {
      fov = this.missileCam(dt, ctl);
    } else if (p.dying || !p.alive) {
      this.deathCam(dt, p);
    } else if (p.type === 'plane') {
      fov = this.chaseCam(dt, p, I);
    } else {
      this.orbitCam(dt, p, I);
    }
    this.init = true;
    this.holdPos.copy(this.cam.position); this.holdQ.copy(this.cam.quaternion);
    if (this.shakeAmt > 0.001) {
      this.cam.position.x += rand(-1, 1) * this.shakeAmt * 0.3;
      this.cam.position.y += rand(-1, 1) * this.shakeAmt * 0.3;
      this.cam.position.z += rand(-1, 1) * this.shakeAmt * 0.3;
      this.shakeAmt = damp(this.shakeAmt, 0, 6, dt);
    }
    this.cam.fov = damp(this.cam.fov, fov, 4, dt);
    this.cam.updateProjectionMatrix();
    // never let the camera dip under terrain / water
    const alt = g.planet.altitude(this.cam.position);
    if (alt < 0.6 && !(ctl && ctl.cat === 'missile' && ctl.spec.torpedo)) this.cam.position.multiplyScalar((g.planet.surfaceR(this.cam.position) + 0.6) / this.cam.position.length());
  }

  freeLook(dt, I) {
    // right stick: spring-loaded look; mouse: free look that drifts back after a moment
    this.lookYaw = damp(this.lookYaw, -I.lookX * 2.7, 9, dt);
    this.lookPitch = damp(this.lookPitch, -I.lookY * 1.1, 9, dt);
    if (I.mouseX || I.mouseY) { this.mYaw -= I.mouseX; this.mPitch = clamp(this.mPitch - I.mouseY, -1.2, 1.2); this.mIdle = 0; }
    else { this.mIdle += dt; if (this.mIdle > 1.2) { this.mYaw = damp(this.mYaw, 0, 2.5, dt); this.mPitch = damp(this.mPitch, 0, 2.5, dt); } }
    return _e.set(this.lookPitch + this.mPitch, this.lookYaw + this.mYaw, 0, 'YXZ');
  }

  chaseCam(dt, p, I) {
    const r = p.role;
    if (!this.init) this.q.copy(p.quat);
    const cockpit = this.mode === 2;
    this.q.slerp(p.quat, 1 - Math.exp(-dt * (cockpit ? 40 : 6.5)));
    const look = _q.setFromEuler(this.freeLook(dt, I));
    const cq = this.q.clone().multiply(look);
    const far = this.mode === 1 ? 1.9 : 1;
    if (cockpit) {
      this.cam.position.copy(p.pos).add(_a.set(0, 0.36, -0.55).applyQuaternion(p.quat));
      this.cam.quaternion.copy(p.quat).multiply(look);
    } else {
      this.cam.position.copy(p.pos).add(_a.set(0, r.camHeight * far, r.camDist * far).applyQuaternion(cq));
      this.cam.quaternion.copy(cq).multiply(_q.setFromAxisAngle(_c.set(1, 0, 0), -0.07));
    }
    const sp = clamp((p.speed - r.cruise) / (r.maxSpeed - r.cruise), 0, 1);
    return 64 + sp * 10;
  }

  orbitCam(dt, p, I) {
    const g = this.game, r = p.role;
    const up = _a.copy(p.pos).normalize();
    tangentOf(up, p.camF, p.camF);
    const ys = p.type === 'ship' ? 1.6 : 2.4;
    p.camF.applyAxisAngle(up, -(I.lookX * ys * dt + I.mouseX)).normalize();
    p.camPitch = clamp(p.camPitch - (I.lookY * 1.4 * dt + I.mouseY), -0.65, 0.9);
    const far = this.mode === 1 ? 1.8 : 1;
    const view = _b.copy(p.camF).multiplyScalar(Math.cos(p.camPitch)).addScaledVector(up, Math.sin(p.camPitch)).normalize();
    p.camViewDir = (p.camViewDir || new THREE.Vector3()).copy(view);
    const pivot = _c.copy(p.pos).addScaledVector(up, r.camHeight * far * 0.6);
    this.cam.position.copy(pivot).addScaledVector(view, -r.camDist * far).addScaledVector(up, r.camHeight * 0.4 * far);
    quatFromForwardUp(view, up, this.cam.quaternion);
    // aim ray from the pivot through the screen centre
    const origin = pivot.clone().addScaledVector(up, r.camHeight * 0.4 * far);
    g.aimPoint = this.raycast(origin.addScaledVector(view, r.camDist * far + 1), view, p);
    return 62;
  }

  missileCam(dt, m) {
    const up = _a.copy(m.pos).normalize();
    const tq = quatFromForwardUp(m.dir, up, new THREE.Quaternion());
    if (!this.init || this.lastCtl !== m) this.q.copy(tq);
    this.lastCtl = m;
    this.q.slerp(tq, 1 - Math.exp(-dt * 12));
    const big = m.spec.model === 'big';
    this.cam.position.copy(m.pos).add(_b.set(0, big ? 1.1 : 0.7, big ? 4.6 : 3.4).applyQuaternion(this.q));
    this.cam.quaternion.copy(this.q).multiply(_q.setFromAxisAngle(_c.set(1, 0, 0), -0.05));
    return 66 + (m.boost ? 10 : 0);
  }

  deathCam(dt, p) {
    this.deathT += dt;
    const up = _a.copy(p.pos).normalize();
    const t = tangentOf(up, _b.set(0.3, 1, 0.2), new THREE.Vector3()).applyAxisAngle(up, this.deathT * 0.25);
    this.cam.position.copy(p.pos).addScaledVector(t, 30).addScaledVector(up, 14);
    const look = _c.subVectors(p.pos, this.cam.position).normalize();
    quatFromForwardUp(look, up, this.cam.quaternion);
  }

  // March along a ray against terrain + hostile bounding spheres.
  raycast(o, d, p) {
    const g = this.game;
    let best = 1800, hitEnt = null;
    for (const e of g.world.entities) {
      if (!e.alive || e.dying || e === p) continue;
      const tc = _a.subVectors(e.pos, o).dot(d);
      if (tc < 0 || tc > best) continue;
      const cx = o.x + d.x * tc - e.pos.x, cy = o.y + d.y * tc - e.pos.y, cz = o.z + d.z * tc - e.pos.z;
      const rr = e.radius * (e.faction === p.faction ? 1 : 1.6);
      if (cx * cx + cy * cy + cz * cz < rr * rr) { best = tc; hitEnt = e; }
    }
    const pt = new THREE.Vector3();
    let t = 1, prev = 0;
    while (t < best) {
      pt.copy(o).addScaledVector(d, t);
      if (pt.length() < g.planet.surfaceR(pt)) {
        // refine
        let lo = prev, hi = t;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          pt.copy(o).addScaledVector(d, mid);
          if (pt.length() < g.planet.surfaceR(pt)) hi = mid; else lo = mid;
        }
        g.aimEntity = null;
        return pt.copy(o).addScaledVector(d, hi);
      }
      prev = t;
      t += 1.5 + t * 0.02;
    }
    g.aimEntity = hitEnt && hitEnt.faction !== p.faction ? hitEnt : null;
    return pt.copy(o).addScaledVector(d, best);
  }
}

export { R };
