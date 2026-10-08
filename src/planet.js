import * as THREE from 'three';
import { makeNoise, mulberry32 } from './noise.js';
import { R, clamp, smoothstep, lerp } from './util.js';

// Cube-sphere terrain. Each cube face is an N x N grid using equal-angle mapping.
// Gameplay height lookups interpolate the exact same triangles that are rendered.
export const N = 256;
const W = N + 1;
const CH = 8;            // chunks per face side
const CS = N / CH;       // cells per chunk side
const DECO_DIST = 2300;  // trees/buildings visible within this distance

const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

const C = (hex) => new THREE.Color(hex);
const COL = {
  deep: C(0x1f3d4c), shelf: C(0x8f8a68), sand: C(0xc8b88c), grass: C(0x6f8b4b), forest: C(0x4b6a3b),
  dry: C(0x9d9862), desert: C(0xc4aa78), rock: C(0x7b7369), rock2: C(0x645e57), snow: C(0xe2e6e5), tundra: C(0xa9ad9c),
};
const BOX_IDX = [1, 3, 7, 1, 7, 5, 0, 6, 2, 0, 4, 6, 2, 6, 7, 2, 7, 3, 0, 1, 5, 0, 5, 4, 4, 5, 7, 4, 7, 6, 0, 2, 3, 0, 3, 1];

export class Planet {
  constructor(seed = 7) {
    this.seed = seed;
    this.nCont = makeNoise(seed);
    this.nMount = makeNoise(seed + 11);
    this.nHill = makeNoise(seed + 23);
    this.nMoist = makeNoise(seed + 37);
    this.nMask = makeNoise(seed + 51);
    this.heights = FACES.map(() => new Float32Array(W * W));
    this.moist = FACES.map(() => new Float32Array(W * W));
    this.dirs = FACES.map(() => new Float32Array(W * W * 3));
    this.cities = [];
    this.chunks = [];
    this._v = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  fbm(noise, x, y, z, oct) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += noise(x * f, y * f, z * f) * a; n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }

  rawHeight(x, y, z) {
    const c = this.fbm(this.nCont, x * 1.25 + 3.1, y * 1.25, z * 1.25, 5);
    const e = c - 0.05;
    const hills = this.fbm(this.nHill, x * 14, y * 14, z * 14, 3);
    if (e < 0) return Math.max(-180, e * 650) + hills * 4 - 1.5;
    const k = smoothstep(0, 0.1, e);
    const mask = smoothstep(0.02, 0.38, this.fbm(this.nMask, x * 2.3, y * 2.3, z * 2.3, 2) + e * 0.7);
    let ridge = 0, amp = 1, f = 5, sum = 0;
    for (let i = 0; i < 3; i++) {
      const r = 1 - Math.abs(this.nMount(x * f, y * f, z * f));
      ridge += r * r * amp; sum += amp; amp *= 0.5; f *= 2.1;
    }
    ridge /= sum;
    return 1.2 + e * 150 + k * (hills * 15 + 7) + k * mask * ridge * 190;
  }

  rawMoist(x, y, z) {
    return this.fbm(this.nMoist, x * 2.4, y * 2.4, z * 2.4, 3) - Math.abs(y) * 0.05;
  }

  faceDir(f, s, t, out = new THREE.Vector3()) {
    const F = FACES[f];
    const ta = Math.tan((-1 + 2 * s / N) * Math.PI / 4), tb = Math.tan((-1 + 2 * t / N) * Math.PI / 4);
    return out.set(
      F.n[0] + F.u[0] * ta + F.v[0] * tb,
      F.n[1] + F.u[1] * ta + F.v[1] * tb,
      F.n[2] + F.u[2] * ta + F.v[2] * tb,
    ).normalize();
  }

  generate() {
    const d = new THREE.Vector3();
    for (let f = 0; f < 6; f++) {
      const H = this.heights[f], M = this.moist[f], D = this.dirs[f];
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        this.faceDir(f, i, j, d);
        const idx = j * W + i;
        D[idx * 3] = d.x; D[idx * 3 + 1] = d.y; D[idx * 3 + 2] = d.z;
        H[idx] = this.rawHeight(d.x, d.y, d.z);
        M[idx] = this.rawMoist(d.x, d.y, d.z);
      }
    }
    this.placeCities();
  }

  // Grid sample with the exact triangle split used by the mesh.
  _sample(grids, x, y, z) {
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    let f, m, a, b;
    if (ax >= ay && ax >= az) { if (x > 0) { f = 0; m = x; a = -z; b = y; } else { f = 1; m = -x; a = z; b = y; } }
    else if (ay >= az) { if (y > 0) { f = 2; m = y; a = x; b = -z; } else { f = 3; m = -y; a = x; b = z; } }
    else { if (z > 0) { f = 4; m = z; a = x; b = y; } else { f = 5; m = -z; a = -x; b = y; } }
    const s = (Math.atan(a / m) * 4 / Math.PI + 1) * 0.5 * N;
    const t = (Math.atan(b / m) * 4 / Math.PI + 1) * 0.5 * N;
    let i = Math.floor(s), j = Math.floor(t);
    if (i > N - 1) i = N - 1; if (i < 0) i = 0;
    if (j > N - 1) j = N - 1; if (j < 0) j = 0;
    const fx = s - i, fy = t - j;
    const H = grids[f];
    const h00 = H[j * W + i], h10 = H[j * W + i + 1], h01 = H[(j + 1) * W + i], h11 = H[(j + 1) * W + i + 1];
    return (fx + fy < 1) ? h00 + (h10 - h00) * fx + (h01 - h00) * fy
      : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fy);
  }

  // Height above sea level for a direction (any length vector).
  heightAt(v) {
    const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
    return this._sample(this.heights, v.x / l, v.y / l, v.z / l);
  }
  moistAt(v) {
    const l = v.length() || 1;
    return this._sample(this.moist, v.x / l, v.y / l, v.z / l);
  }
  // Radius of the solid/water surface below a point.
  surfaceR(v) { return R + Math.max(0, this.heightAt(v)); }
  altitude(pos) { return pos.length() - this.surfaceR(pos); }
  isWater(v, depth = 0) { return this.heightAt(v) < -depth; }

  normalAt(dir, out = new THREE.Vector3()) {
    const up = this._v.copy(dir).normalize();
    const t1 = new THREE.Vector3(up.y, -up.x, 0);
    if (t1.lengthSq() < 0.01) t1.set(0, up.z, -up.y);
    t1.normalize();
    const t2 = new THREE.Vector3().crossVectors(up, t1);
    const e = 3 / R;
    const p0 = up.clone().multiplyScalar(R + Math.max(0, this.heightAt(up)));
    const d1 = up.clone().addScaledVector(t1, e).normalize();
    const d2 = up.clone().addScaledVector(t2, e).normalize();
    const p1 = d1.multiplyScalar(R + Math.max(0, this.heightAt(d1)));
    const p2 = d2.multiplyScalar(R + Math.max(0, this.heightAt(d2)));
    out.crossVectors(p1.sub(p0), p2.sub(p0)).normalize();
    if (out.dot(up) < 0) out.negate();
    return out;
  }

  // Line of sight between two world points (terrain occlusion only).
  los(a, b, steps = 12) {
    const p = this._v;
    for (let i = 1; i < steps; i++) {
      p.lerpVectors(a, b, i / steps);
      if (p.length() < this.surfaceR(p) + 1) return false;
    }
    return true;
  }

  colorFor(h, m, lat, j, out) {
    if (h < 0) {
      out.copy(COL.shelf).lerp(COL.deep, clamp(-h / 70, 0, 1));
    } else if (h < 2.2) {
      out.copy(COL.sand);
    } else {
      const c = this._c;
      if (m > 0.12) c.copy(COL.forest);
      else if (m > -0.08) c.copy(COL.grass).lerp(COL.forest, smoothstep(-0.08, 0.12, m));
      else if (m > -0.3) c.copy(COL.dry).lerp(COL.grass, smoothstep(-0.3, -0.08, m));
      else c.copy(COL.desert).lerp(COL.dry, smoothstep(-0.45, -0.3, m));
      if (h < 5) c.lerp(COL.sand, 1 - (h - 2.2) / 2.8);
      out.copy(c);
      const rock = smoothstep(95, 160, h);
      if (rock > 0) out.lerp(h > 190 ? COL.rock2 : COL.rock, rock);
      const tundra = smoothstep(0.78, 0.9, lat);
      if (tundra > 0) out.lerp(COL.tundra, tundra);
      const snowLine = 215 - smoothstep(0.55, 0.92, lat) * 210;
      if (h > snowLine) out.lerp(COL.snow, smoothstep(snowLine, snowLine + 25, h));
    }
    out.multiplyScalar(1 + j * 0.045);
    return out;
  }

  placeCities() {
    const rng = mulberry32(this.seed * 31 + 5);
    const d = new THREE.Vector3();
    const names = ['Arden', 'Belmor', 'Castra', 'Dunvale', 'Eskar', 'Ferro', 'Galen', 'Hollow', 'Istra', 'Jorvik', 'Kaldor',
      'Lumen', 'Marrow', 'Norvik', 'Orlen', 'Pyre', 'Quarry', 'Rook', 'Sable', 'Tamsin', 'Ulmar', 'Vesk', 'Wren', 'Yarrow',
      'Zeal', 'Ashby', 'Brine', 'Corin', 'Delta', 'Ember', 'Fallow', 'Gorse', 'Harrow', 'Ivel', 'Juno', 'Keld', 'Lark', 'Moor'];
    let tries = 0;
    while (this.cities.length < 38 && tries++ < 6000) {
      d.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
      if (d.lengthSq() > 1 || d.lengthSq() < 0.01) continue;
      d.normalize();
      if (Math.abs(d.y) > 0.8) continue;
      const h = this.heightAt(d);
      if (h < 3 || h > 55) continue;
      if (this.cities.some(c => c.dir.dot(d) > Math.cos(500 / R))) continue;
      this.cities.push({ dir: d.clone(), radius: 90 + rng() * 110, name: names[this.cities.length % names.length] });
    }
  }

  build(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.decoMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.waterMat = new THREE.MeshPhongMaterial({
      color: 0x2c5b72, specular: 0x6a8796, shininess: 70, transparent: true, opacity: 0.86, depthWrite: false,
    });
    // assign each city to the chunk that contains its centre
    this.cityByChunk = new Map();
    for (const c of this.cities) {
      const key = this.chunkKeyOf(c.dir);
      if (!this.cityByChunk.has(key)) this.cityByChunk.set(key, []);
      this.cityByChunk.get(key).push(c);
    }
    for (let f = 0; f < 6; f++) for (let cj = 0; cj < CH; cj++) for (let ci = 0; ci < CH; ci++) this.buildChunk(f, ci, cj);
    this.buildClouds(scene);
  }

  chunkKeyOf(dir) {
    const { x, y, z } = dir;
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    let f, m, a, b;
    if (ax >= ay && ax >= az) { if (x > 0) { f = 0; m = x; a = -z; b = y; } else { f = 1; m = -x; a = z; b = y; } }
    else if (ay >= az) { if (y > 0) { f = 2; m = y; a = x; b = -z; } else { f = 3; m = -y; a = x; b = z; } }
    else { if (z > 0) { f = 4; m = z; a = x; b = y; } else { f = 5; m = -z; a = -x; b = y; } }
    const s = (Math.atan(a / m) * 4 / Math.PI + 1) * 0.5 * N, t = (Math.atan(b / m) * 4 / Math.PI + 1) * 0.5 * N;
    const ci = clamp(Math.floor(s / CS), 0, CH - 1), cj = clamp(Math.floor(t / CS), 0, CH - 1);
    return f * 100 + cj * 10 + ci;
  }

  buildChunk(f, ci, cj) {
    const V = CS + 1;
    const center = this.faceDir(f, (ci + 0.5) * CS, (cj + 0.5) * CS).multiplyScalar(R);
    const pos = new Float32Array(V * V * 3), col = new Float32Array(V * V * 3);
    const H = this.heights[f], M = this.moist[f], D = this.dirs[f];
    const c = new THREE.Color();
    let minH = 1e9;
    for (let jj = 0; jj < V; jj++) for (let ii = 0; ii < V; ii++) {
      const gi = ci * CS + ii, gj = cj * CS + jj, idx = gj * W + gi, k = (jj * V + ii) * 3;
      const h = H[idx], r = R + h;
      const dx = D[idx * 3], dy = D[idx * 3 + 1], dz = D[idx * 3 + 2];
      pos[k] = dx * r - center.x; pos[k + 1] = dy * r - center.y; pos[k + 2] = dz * r - center.z;
      const jit = Math.sin(gi * 12.9898 + gj * 78.233 + f * 3.1) * 43758.5453;
      this.colorFor(h, M[idx], Math.abs(dy), (jit - Math.floor(jit)) * 2 - 1, c);
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      if (h < minH) minH = h;
    }
    const index = new Uint16Array(CS * CS * 6);
    let n = 0;
    for (let jj = 0; jj < CS; jj++) for (let ii = 0; ii < CS; ii++) {
      const a = jj * V + ii, b = a + 1, cc = a + V, d = cc + 1;
      index[n++] = a; index[n++] = b; index[n++] = cc;
      index[n++] = b; index[n++] = d; index[n++] = cc;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.position.copy(center);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    this.group.add(mesh);
    const chunk = { center, mesh, deco: null };

    if (minH < 0.5) {
      const wp = new Float32Array(V * V * 3), wn = new Float32Array(V * V * 3);
      for (let jj = 0; jj < V; jj++) for (let ii = 0; ii < V; ii++) {
        const gi = ci * CS + ii, gj = cj * CS + jj, idx = gj * W + gi, k = (jj * V + ii) * 3;
        const dx = D[idx * 3], dy = D[idx * 3 + 1], dz = D[idx * 3 + 2];
        wp[k] = dx * R - center.x; wp[k + 1] = dy * R - center.y; wp[k + 2] = dz * R - center.z;
        wn[k] = dx; wn[k + 1] = dy; wn[k + 2] = dz;
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(wp, 3));
      wg.setAttribute('normal', new THREE.BufferAttribute(wn, 3));
      wg.setIndex(new THREE.BufferAttribute(index, 1));
      wg.computeBoundingSphere();
      const wm = new THREE.Mesh(wg, this.waterMat);
      wm.position.copy(center); wm.matrixAutoUpdate = false; wm.updateMatrix();
      wm.renderOrder = 1;
      this.group.add(wm);
    }

    const deco = this.buildDeco(f, ci, cj, center);
    if (deco) { chunk.deco = deco; deco.visible = false; this.group.add(deco); }
    this.chunks.push(chunk);
  }

  buildDeco(f, ci, cj, center) {
    const rng = mulberry32(this.seed * 1000 + f * 97 + cj * 13 + ci * 7 + 1);
    const P = [], Cc = [], I = [];
    const d = new THREE.Vector3(), up = new THREE.Vector3(), fw = new THREE.Vector3(), rt = new THREE.Vector3(), base = new THREE.Vector3();
    const col = new THREE.Color();
    const addBox = (w, h, dd, lift, hex, shade = 1) => {
      const start = P.length / 3;
      col.setHex(hex).multiplyScalar(shade);
      for (let k = 0; k < 8; k++) {
        const x = (k & 1) - 0.5, y = ((k >> 1) & 1), z = ((k >> 2) & 1) - 0.5;
        P.push(
          base.x + rt.x * x * w + up.x * (y * h + lift) - fw.x * z * dd - center.x,
          base.y + rt.y * x * w + up.y * (y * h + lift) - fw.y * z * dd - center.y,
          base.z + rt.z * x * w + up.z * (y * h + lift) - fw.z * z * dd - center.z,
        );
        Cc.push(col.r, col.g, col.b);
      }
      for (const i of BOX_IDX) I.push(start + i);
    };
    const frameAt = (dir, yaw) => {
      up.copy(dir);
      rt.set(up.y, -up.x, 0); if (rt.lengthSq() < 0.01) rt.set(0, up.z, -up.y); rt.normalize();
      fw.crossVectors(up, rt);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const r2 = rt.clone().multiplyScalar(c).addScaledVector(fw, s);
      fw.crossVectors(up, r2).normalize(); rt.copy(r2).normalize();
    };
    const TREE = [0x3e5c33, 0x48683a, 0x557241, 0x3a5530, 0x6b6a3a];
    for (let jj = 0; jj < CS; jj++) for (let ii = 0; ii < CS; ii++) {
      const gi = ci * CS + ii, gj = cj * CS + jj;
      this.faceDir(f, gi + 0.5, gj + 0.5, d);
      const h = this.heightAt(d), m = this.moistAt(d);
      if (h < 3.5 || h > 150 || Math.abs(d.y) > 0.86) continue;
      const p = smoothstep(-0.05, 0.3, m) * 0.55 + 0.02;
      let n = rng() < p ? (rng() < 0.55 ? 1 : rng() < 0.7 ? 2 : 3) : 0;
      for (let k = 0; k < n; k++) {
        this.faceDir(f, gi + rng(), gj + rng(), d);
        const hh = this.heightAt(d);
        if (hh < 3) continue;
        base.copy(d).multiplyScalar(R + hh);
        frameAt(d, rng() * 6.28);
        const sz = 2.6 + rng() * 2.6, shade = 0.85 + rng() * 0.3;
        const tc = TREE[Math.floor(rng() * (m < 0 ? 5 : 4))];
        addBox(0.7, 2.2, 0.7, -0.5, 0x5b4633, shade);
        if (rng() < 0.5) { // conifer
          addBox(sz, sz * 0.8, sz, 1.5, tc, shade);
          addBox(sz * 0.6, sz * 0.8, sz * 0.6, 1.5 + sz * 0.8, tc, shade * 1.05);
        } else {
          addBox(sz * 1.2, sz, sz * 1.2, 1.5, tc, shade);
        }
      }
    }
    const cities = this.cityByChunk.get(f * 100 + cj * 10 + ci) || [];
    const BLD = [0x9a958c, 0x8a857c, 0xb1a690, 0x7e7a74, 0xa08b78, 0x8f8f8a, 0xb7b1a3];
    for (const city of cities) {
      const count = Math.floor(city.radius * 1.1);
      const cu = city.dir;
      const t1 = new THREE.Vector3(cu.y, -cu.x, 0); if (t1.lengthSq() < 0.01) t1.set(0, cu.z, -cu.y); t1.normalize();
      const t2 = new THREE.Vector3().crossVectors(cu, t1);
      for (let k = 0; k < count; k++) {
        // street grid
        const gx = Math.round((rng() * 2 - 1) * city.radius / 16) * 16, gy = Math.round((rng() * 2 - 1) * city.radius / 16) * 16;
        const rr = Math.hypot(gx, gy);
        if (rr > city.radius) continue;
        d.copy(cu).addScaledVector(t1, gx / R).addScaledVector(t2, gy / R).normalize();
        const hh = this.heightAt(d);
        if (hh < 2) continue;
        base.copy(d).multiplyScalar(R + hh);
        up.copy(d); rt.copy(t1).addScaledVector(up, -t1.dot(up)).normalize(); fw.crossVectors(up, rt);
        const core = 1 - rr / city.radius;
        const bh = 5 + rng() * 10 + core * core * (20 + rng() * 45);
        const w = 7 + rng() * 6, dd = 7 + rng() * 6;
        const hex = BLD[Math.floor(rng() * BLD.length)];
        addBox(w, bh, dd, -2, hex, 0.9 + rng() * 0.2);
        if (bh > 25 && rng() < 0.5) addBox(w * 0.6, 5, dd * 0.6, bh - 2, hex, 1.1);
      }
    }
    if (!P.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    geo.setIndex(I);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.decoMat);
    mesh.position.copy(center); mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    return mesh;
  }

  buildClouds(scene) {
    const rng = mulberry32(this.seed + 999);
    const count = 340, per = 6;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xf1f2ef, emissive: 0x5d6368 });
    const im = new THREE.InstancedMesh(geo, mat, count * per);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const d = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), zf = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < count; i++) {
      d.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      const alt = 380 + rng() * 260;
      t1.set(d.y, -d.x, 0); if (t1.lengthSq() < 0.01) t1.set(0, d.z, -d.y); t1.normalize();
      t2.crossVectors(d, t1);
      const size = 30 + rng() * 50;
      for (let k = 0; k < per; k++) {
        p.copy(d).multiplyScalar(R + alt + (rng() - 0.3) * size * 0.3)
          .addScaledVector(t1, (rng() - 0.5) * size * 2.2).addScaledVector(t2, (rng() - 0.5) * size * 1.4);
        zf.copy(t2).negate();
        const mm = new THREE.Matrix4().makeBasis(t1, d, zf);
        q.setFromRotationMatrix(mm);
        s.set(size * (0.6 + rng() * 0.8), size * (0.25 + rng() * 0.25), size * (0.5 + rng() * 0.6));
        m.compose(p, q, s);
        im.setMatrixAt(n++, m);
      }
    }
    im.count = n;
    im.frustumCulled = false;
    this.clouds = im;
    scene.add(im);
  }

  update(camPos, dt) {
    const d2 = DECO_DIST * DECO_DIST;
    for (const c of this.chunks) if (c.deco) c.deco.visible = c.center.distanceToSquared(camPos) < d2 + 600 * 600;
    if (this.clouds) this.clouds.rotation.y += dt * 0.0006;
  }

  // Equirectangular map image (used by the war map and mission screens).
  renderMap(w = 720, h = 360) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = new THREE.Vector3(), c = new THREE.Color();
    for (let y = 0; y < h; y++) {
      const lat = (0.5 - (y + 0.5) / h) * Math.PI;
      for (let x = 0; x < w; x++) {
        const lon = ((x + 0.5) / w) * Math.PI * 2 - Math.PI;
        d.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
        const hh = this.heightAt(d);
        if (hh < 0) c.setHex(0x2c5b72).lerp(COL.deep, clamp(-hh / 120, 0, 1));
        else this.colorFor(hh, this.moistAt(d), Math.abs(d.y), 0, c);
        // shade by slope (cheap hillshade)
        const k = (y * w + x) * 4;
        const cs = c.clone().convertLinearToSRGB();
        img.data[k] = cs.r * 255; img.data[k + 1] = cs.g * 255; img.data[k + 2] = cs.b * 255; img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}

export { lerp };
