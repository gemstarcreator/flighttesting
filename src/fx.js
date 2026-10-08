import * as THREE from 'three';
import { rand, G } from './util.js';

// Pooled voxel particles: "glow" (unlit: fire, flashes, tracers-ish) and "smoke" (lit: smoke, debris, splashes).
class Pool {
  constructor(scene, cap, material) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.p = [];
    for (let i = 0; i < cap; i++) this.p.push({
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), spin: new THREE.Vector3(),
      life: 0, max: 1, s0: 1, s1: 1, col: new THREE.Color(), col1: new THREE.Color(), grav: 0, drag: 0,
    });
    this.n = 0;
    this._m = new THREE.Matrix4(); this._s = new THREE.Vector3(); this._c = new THREE.Color(); this._dq = new THREE.Quaternion(); this._e = new THREE.Euler();
    this._g = new THREE.Vector3();
  }
  emit(pos, vel, life, s0, s1, hex, opts = {}) {
    if (this.n >= this.cap) return;
    const p = this.p[this.n++];
    p.pos.copy(pos); p.vel.copy(vel); p.life = p.max = life; p.s0 = s0; p.s1 = s1;
    p.col.setHex(hex); p.col1.setHex(opts.to ?? hex);
    p.grav = opts.grav ?? 0; p.drag = opts.drag ?? 0.5;
    p.q.setFromEuler(this._e.set(rand(0, 6.3), rand(0, 6.3), rand(0, 6.3)));
    p.spin.set(rand(-3, 3), rand(-3, 3), rand(-3, 3)).multiplyScalar(opts.spin ?? 0.3);
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      const p = this.p[i];
      p.life -= dt;
      if (p.life <= 0) { // swap-remove
        const last = this.p[this.n - 1]; this.p[this.n - 1] = p; this.p[i] = last; this.n--; continue;
      }
      if (p.grav) p.vel.addScaledVector(this._g.copy(p.pos).normalize(), -p.grav * G * dt);
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.spin.x) { this._dq.setFromEuler(this._e.set(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt)); p.q.multiply(this._dq); }
      const t = 1 - p.life / p.max;
      const s = p.s0 + (p.s1 - p.s0) * t;
      this._s.set(s, s, s);
      this._m.compose(p.pos, p.q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      this._c.copy(p.col).lerp(p.col1, t);
      this.mesh.setColorAt(i, this._c);
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class FX {
  constructor(game) {
    this.game = game;
    this.glow = new Pool(game.scene, 2500, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.smoke = new Pool(game.scene, 4000, new THREE.MeshLambertMaterial({ color: 0xffffff }));
    this._v = new THREE.Vector3(); this._u = new THREE.Vector3();
  }
  update(dt) { this.glow.update(dt); this.smoke.update(dt); }

  rv(scale) { return this._v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(scale); }

  explosion(pos, size = 1, opts = {}) {
    const up = this._u.copy(pos).normalize();
    const n = Math.min(40, 10 + size * 6);
    for (let i = 0; i < n; i++) {
      this.glow.emit(pos, this.rv(6 * size).addScaledVector(up, 2 * size), rand(0.25, 0.6), size * rand(0.8, 1.6), 0.1,
        i % 3 ? 0xffb35c : 0xffe2a0, { to: 0x9a3a1a, drag: 3 });
    }
    for (let i = 0; i < n * 0.8; i++) {
      this.smoke.emit(pos, this.rv(3 * size).addScaledVector(up, 3 + size * 2), rand(1.2, 2.8), size * rand(0.8, 1.4), size * rand(2, 3.5),
        0x3b3835, { to: 0x8a8682, drag: 1.4 });
    }
    if (!opts.noDebris) for (let i = 0; i < 6 + size * 3; i++) {
      this.smoke.emit(pos, this.rv(9 * size).addScaledVector(up, 6 * size), rand(1.2, 2.4), size * rand(0.2, 0.45), size * 0.15,
        i % 2 ? 0x2d2b29 : 0x5a5249, { grav: 1, drag: 0.3, spin: 2 });
    }
    if (opts.water) this.splash(pos, size * 1.4);
  }
  splash(pos, size = 1) {
    const up = this._u.copy(pos).normalize();
    for (let i = 0; i < 12 + size * 6; i++)
      this.smoke.emit(pos, this.rv(2.5 * size).addScaledVector(up, rand(6, 14) * Math.sqrt(size)), rand(0.8, 1.6), size * rand(0.4, 0.8), size * 0.2,
        0xe8eef0, { to: 0xb8c8d0, grav: 1, drag: 0.6 });
  }
  dust(pos, water) {
    const up = this._u.copy(pos).normalize();
    for (let i = 0; i < 3; i++)
      this.smoke.emit(pos, this.rv(1.5).addScaledVector(up, rand(2, 5)), rand(0.4, 0.8), rand(0.3, 0.6), 0.9,
        water ? 0xdde6ea : 0x9b8b70, { grav: water ? 1 : 0.2, drag: 1.5 });
  }
  sparks(pos) {
    for (let i = 0; i < 5; i++) this.glow.emit(pos, this.rv(8), rand(0.1, 0.3), 0.2, 0.05, 0xffd37a, { drag: 2 });
  }
  flak(pos) {
    this.glow.emit(pos, this._v.set(0, 0, 0), 0.15, 2.5, 0.5, 0xffc070);
    for (let i = 0; i < 7; i++) this.smoke.emit(pos, this.rv(2), rand(1.5, 2.5), rand(1, 2), rand(3, 4.5), 0x2e2d2c, { to: 0x5e5c5a, drag: 2 });
  }
  trail(pos, hex = 0xcfcfcb, size = 0.5, life = 1.6) {
    this.smoke.emit(pos, this.rv(0.4), life * rand(0.8, 1.2), size, size * 3.5, hex, { to: 0xa8a8a4, drag: 1 });
  }
  fireTrail(pos) {
    this.glow.emit(pos, this.rv(1), rand(0.2, 0.4), rand(0.5, 1.0), 0.1, 0xff9c4a, { to: 0x802a10 });
    this.smoke.emit(pos, this.rv(1), rand(1.4, 2.4), 0.8, 3.5, 0x2c2a28, { to: 0x6e6a66, drag: 1 });
  }
  muzzle(pos, size = 0.35) {
    this.glow.emit(pos, this._v.set(0, 0, 0), 0.05, size, size * 0.5, 0xffe0a0);
  }
  flare(pos, vel) {
    this.glow.emit(pos, vel, 1.6, 0.7, 0.3, 0xfff1c9, { to: 0xff8a3a, drag: 0.6, grav: 0.3 });
    this.smoke.emit(pos, this._v.copy(vel).multiplyScalar(0.8), 2.2, 0.4, 2.2, 0xe5e2dc, { to: 0xb9b6b0, drag: 0.8 });
  }
  smokeScreen(pos) {
    const up = this._u.copy(pos).normalize();
    for (let i = 0; i < 30; i++)
      this.smoke.emit(pos, this.rv(6).addScaledVector(up, rand(1, 4)), rand(3, 5), rand(1.5, 2.5), rand(5, 7), 0xcdcbc6, { to: 0x9d9b96, drag: 1.2 });
  }
}
