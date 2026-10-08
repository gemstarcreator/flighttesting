import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Voxel-style models assembled from coloured boxes. Forward is -Z, up is +Y.
export const voxMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const glowMats = {};
export function glowMat(hex) {
  if (!glowMats[hex]) glowMats[hex] = new THREE.MeshBasicMaterial({ color: hex });
  return glowMats[hex];
}

export const PAL = [
  { body: 0x5f7389, dark: 0x3e4b5a, light: 0xbac5cf, accent: 0x8098ad, mark: 0x9cc3e6 }, // allied (blue-grey)
  { body: 0x8e5f4f, dark: 0x5a3c33, light: 0xd3baa1, accent: 0xa97765, mark: 0xe0a07a }, // hostile (rust)
];
const GLASS = 0x26323e, METAL = 0x4b4e52, BLACK = 0x2a2b2d, OLIVE = 0x5f6644, CONCRETE = 0x8d8a83;

const _c = new THREE.Color();
function part(p) {
  const g = p.cyl ? new THREE.CylinderGeometry(p.s[0] / 2, (p.s[2] ?? p.s[0]) / 2, p.s[1], p.seg || 8)
    : new THREE.BoxGeometry(p.s[0], p.s[1], p.s[2]);
  if (p.r) { g.rotateX(p.r[0] || 0); g.rotateY(p.r[1] || 0); g.rotateZ(p.r[2] || 0); }
  g.translate(p.p[0], p.p[1], p.p[2]);
  _c.setHex(p.c);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
// Builds a geometry; parts with `m:1` are mirrored across X.
export function vox(parts) {
  const list = [];
  for (const p of parts) {
    list.push(part(p));
    if (p.m) list.push(part({ ...p, p: [-p.p[0], p.p[1], p.p[2]], r: p.r ? [p.r[0], -(p.r[1] || 0), -(p.r[2] || 0)] : undefined }));
  }
  return mergeGeometries(list);
}

const cache = new Map();
function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}
const mesh = (geo) => new THREE.Mesh(geo, voxMat);

function glowBox(w, h, d, hex, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(cached('gb' + w + h + d, () => new THREE.BoxGeometry(w, h, d)), glowMat(hex));
  m.position.set(x, y, z);
  return m;
}

// ---------- aircraft ----------
export function jetModel(f) {
  const P = PAL[f];
  const g = new THREE.Group();
  g.add(mesh(cached('jet' + f, () => vox([
    { s: [0.44, 0.38, 2.5], p: [0, 0, 0], c: P.body },
    { s: [0.32, 0.28, 0.55], p: [0, -0.02, -1.5], c: P.light },
    { s: [0.18, 0.18, 0.3], p: [0, -0.03, -1.88], c: P.dark },
    { s: [0.28, 0.2, 0.7], p: [0, 0.25, -0.75], c: GLASS },
    { s: [1.05, 0.07, 0.95], p: [0.66, -0.03, 0.25], c: P.body, m: 1 },
    { s: [0.55, 0.06, 0.55], p: [1.35, -0.03, 0.45], c: P.accent, m: 1 },
    { s: [0.1, 0.06, 0.5], p: [1.66, -0.02, 0.5], c: P.mark, m: 1 },
    { s: [0.5, 0.06, 0.4], p: [0.45, 0, 1.12], c: P.body, m: 1 },
    { s: [0.06, 0.55, 0.48], p: [0.2, 0.42, 1.0], c: P.accent, r: [0, 0, -0.18], m: 1 },
    { s: [0.22, 0.24, 0.8], p: [0.3, -0.12, -0.1], c: P.dark, m: 1 },
    { s: [0.42, 0.3, 0.14], p: [0, 0, 1.3], c: BLACK },
  ]))));
  const burner = glowBox(0.26, 0.2, 0.5, 0xffa05a, 0, 0, 1.6);
  g.add(burner);
  g.userData.burner = burner;
  g.userData.size = 2.6;
  return g;
}

export function strikerModel(f) {
  const P = PAL[f];
  const g = new THREE.Group();
  g.add(mesh(cached('striker' + f, () => vox([
    { s: [0.55, 0.52, 2.8], p: [0, 0, 0], c: P.body },
    { s: [0.42, 0.4, 0.5], p: [0, -0.04, -1.6], c: P.light },
    { s: [0.1, 0.1, 0.5], p: [0, -0.12, -2.0], c: BLACK },
    { s: [0.34, 0.24, 0.6], p: [0, 0.34, -1.0], c: GLASS },
    { s: [1.7, 0.1, 0.75], p: [1.0, -0.1, -0.05], c: P.body, m: 1 },
    { s: [0.12, 0.08, 0.6], p: [1.86, -0.08, -0.05], c: P.mark, m: 1 },
    { s: [0.36, 0.36, 0.8], p: [0.45, 0.42, 0.75], c: P.dark, m: 1 },
    { s: [0.3, 0.3, 0.1], p: [0.45, 0.42, 1.18], c: BLACK, m: 1 },
    { s: [0.75, 0.07, 0.42], p: [0.45, 0.05, 1.35], c: P.body, m: 1 },
    { s: [0.07, 0.6, 0.45], p: [0.82, 0.3, 1.35], c: P.accent, m: 1 },
    { s: [0.16, 0.16, 0.5], p: [0.7, -0.24, -0.2], c: OLIVE, m: 1 },
  ]))));
  g.userData.size = 2.9;
  return g;
}

export function bomberModel(f) {
  const P = PAL[f];
  const g = new THREE.Group();
  g.add(mesh(cached('bomber' + f, () => vox([
    { s: [0.9, 0.8, 5.2], p: [0, 0, 0], c: P.body },
    { s: [0.7, 0.6, 0.8], p: [0, 0, -2.9], c: P.light },
    { s: [0.5, 0.25, 0.7], p: [0, 0.45, -2.3], c: GLASS },
    { s: [3.2, 0.14, 1.4], p: [1.9, 0, -0.3], c: P.body, m: 1 },
    { s: [0.36, 0.36, 1.0], p: [1.2, -0.2, -0.7], c: P.dark, m: 1 },
    { s: [0.36, 0.36, 1.0], p: [2.4, -0.2, -0.5], c: P.dark, m: 1 },
    { s: [1.0, 0.1, 0.6], p: [0.8, 0.1, 2.3], c: P.body, m: 1 },
    { s: [0.1, 1.1, 0.8], p: [0, 0.8, 2.3], c: P.accent },
    { s: [0.2, 0.08, 1.0], p: [3.4, 0.03, -0.3], c: P.mark, m: 1 },
  ]))));
  g.userData.size = 5.5;
  return g;
}

export function heliModel(f) {
  const P = PAL[f];
  const g = new THREE.Group();
  g.add(mesh(cached('heli' + f, () => vox([
    { s: [0.8, 0.8, 1.9], p: [0, 0, 0], c: P.body },
    { s: [0.62, 0.5, 0.6], p: [0, 0.05, -1.15], c: GLASS },
    { s: [0.5, 0.3, 0.5], p: [0, -0.3, -1.1], c: P.dark },
    { s: [0.22, 0.24, 2.2], p: [0, 0.18, 2.0], c: P.body },
    { s: [0.08, 0.7, 0.45], p: [0, 0.5, 3.0], c: P.accent },
    { s: [0.8, 0.06, 0.3], p: [0, 0.2, 2.6], c: P.accent },
    { s: [0.06, 0.06, 1.8], p: [0.42, -0.62, 0], c: BLACK, m: 1 },
    { s: [0.06, 0.24, 0.06], p: [0.42, -0.5, -0.5], c: BLACK, m: 1 },
    { s: [0.06, 0.24, 0.06], p: [0.42, -0.5, 0.5], c: BLACK, m: 1 },
    { s: [0.9, 0.08, 0.3], p: [0.6, -0.1, 0.1], c: P.dark, m: 1 },
    { s: [0.22, 0.22, 0.7], p: [1.0, -0.2, 0.1], c: OLIVE, m: 1 },
    { s: [0.3, 0.3, 0.3], p: [0, 0.5, 0], c: METAL },
  ]))));
  const rotor = mesh(cached('rotor', () => vox([
    { s: [4.6, 0.04, 0.22], p: [0, 0, 0], c: 0x3a3c3e },
    { s: [0.22, 0.04, 4.6], p: [0, 0, 0], c: 0x3a3c3e },
  ])));
  rotor.position.set(0, 0.7, 0);
  const tail = mesh(cached('trotor', () => vox([{ s: [0.04, 1.0, 0.12], p: [0, 0, 0], c: 0x3a3c3e }])));
  tail.position.set(0.1, 0.5, 3.0);
  g.add(rotor, tail);
  g.userData.rotor = rotor; g.userData.tailRotor = tail;
  g.userData.size = 3;
  return g;
}

// ---------- ground ----------
export function tankModel(f) {
  const P = PAL[f];
  const g = new THREE.Group();
  g.add(mesh(cached('tank' + f, () => vox([
    { s: [1.3, 0.42, 2.1], p: [0, 0.32, 0], c: P.body },
    { s: [1.1, 0.2, 0.5], p: [0, 0.38, -1.15], c: P.dark },
    { s: [0.32, 0.42, 2.2], p: [0.6, 0.2, 0], c: BLACK, m: 1 },
    { s: [0.34, 0.1, 2.25], p: [0.6, 0.45, 0], c: P.dark, m: 1 },
  ]))));
  const turret = new THREE.Group();
  turret.position.set(0, 0.62, 0.1);
  turret.add(mesh(cached('tankT' + f, () => vox([
    { s: [0.9, 0.34, 1.0], p: [0, 0.1, 0], c: P.accent },
    { s: [0.3, 0.14, 0.3], p: [0.25, 0.33, 0.2], c: P.dark },
    { s: [0.12, 0.25, 0.12], p: [-0.3, 0.4, 0.3], c: BLACK },
  ]))));
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.1, -0.45);
  barrel.add(mesh(cached('tankB' + f, () => vox([
    { s: [0.12, 0.12, 1.4], p: [0, 0, -0.7], c: P.dark },
    { s: [0.18, 0.18, 0.2], p: [0, 0, -1.4], c: BLACK },
  ]))));
  turret.add(barrel);
  g.add(turret);
  g.userData.turret = turret; g.userData.barrel = barrel;
  g.userData.size = 2.2;
  return g;
}

export function apcModel(f) {
  const P = PAL[f];
  const g = new THREE.Group();
  g.add(mesh(cached('apc' + f, () => vox([
    { s: [1.1, 0.6, 2.0], p: [0, 0.5, 0], c: P.body },
    { s: [1.0, 0.3, 0.5], p: [0, 0.45, -1.1], c: P.dark },
    { s: [0.3, 0.2, 0.4], p: [0, 0.9, -0.2], c: P.dark },
    { s: [0.2, 0.36, 0.36], p: [0.58, 0.2, -0.65], c: BLACK, m: 1 },
    { s: [0.2, 0.36, 0.36], p: [0.58, 0.2, 0.0], c: BLACK, m: 1 },
    { s: [0.2, 0.36, 0.36], p: [0.58, 0.2, 0.65], c: BLACK, m: 1 },
  ]))));
  g.userData.size = 2;
  return g;
}

export function truckModel(f, cargo = 0xb3a27e) {
  const P = PAL[f];
  const g = new THREE.Group();
  g.add(mesh(cached('truck' + f + cargo, () => vox([
    { s: [1.0, 0.8, 0.8], p: [0, 0.6, -1.0], c: P.body },
    { s: [0.9, 0.3, 0.1], p: [0, 0.8, -1.42], c: GLASS },
    { s: [1.05, 0.25, 2.8], p: [0, 0.3, 0.1], c: P.dark },
    { s: [1.0, 0.9, 1.9], p: [0, 0.85, 0.5], c: cargo },
    { s: [0.18, 0.34, 0.34], p: [0.52, 0.18, -1.0], c: BLACK, m: 1 },
    { s: [0.18, 0.34, 0.34], p: [0.52, 0.18, 0.4], c: BLACK, m: 1 },
    { s: [0.18, 0.34, 0.34], p: [0.52, 0.18, 1.1], c: BLACK, m: 1 },
  ]))));
  g.userData.size = 3;
  return g;
}

export function launcherModel(f) {
  const P = PAL[f];
  const g = new THREE.Group();
  g.add(mesh(cached('tel' + f, () => vox([
    { s: [1.2, 0.9, 1.0], p: [0, 0.7, -1.6], c: P.body },
    { s: [1.1, 0.3, 0.1], p: [0, 0.9, -2.12], c: GLASS },
    { s: [1.25, 0.3, 4.0], p: [0, 0.35, 0.2], c: P.dark },
    { s: [0.2, 0.4, 0.4], p: [0.62, 0.2, -1.6], c: BLACK, m: 1 },
    { s: [0.2, 0.4, 0.4], p: [0.62, 0.2, -0.3], c: BLACK, m: 1 },
    { s: [0.2, 0.4, 0.4], p: [0.62, 0.2, 0.6], c: BLACK, m: 1 },
    { s: [0.2, 0.4, 0.4], p: [0.62, 0.2, 1.5], c: BLACK, m: 1 },
  ]))));
  const rack = new THREE.Group();
  rack.position.set(0, 0.75, 1.6);
  rack.add(mesh(cached('telR' + f, () => vox([
    { s: [1.0, 0.55, 3.0], p: [0, 0.3, -1.3], c: P.accent },
    { s: [0.3, 0.3, 0.06], p: [-0.25, 0.3, -2.82], c: BLACK },
    { s: [0.3, 0.3, 0.06], p: [0.25, 0.3, -2.82], c: BLACK },
  ]))));
  g.add(rack);
  g.userData.rack = rack;
  g.userData.size = 4.2;
  return g;
}

export function aaModel(f) {
  const P = PAL[f];
  const g = new THREE.Group();
  g.add(mesh(cached('aa' + f, () => vox([
    { s: [2.4, 0.4, 2.4], p: [0, 0.2, 0], c: 0x8b8160 },
    { s: [0.9, 0.5, 0.9], p: [0, 0.6, 0], c: P.dark },
  ]))));
  const turret = new THREE.Group();
  turret.position.set(0, 0.9, 0);
  turret.add(mesh(cached('aaT' + f, () => vox([
    { s: [0.8, 0.4, 0.7], p: [0, 0.1, 0], c: P.body },
    { s: [0.08, 0.08, 1.4], p: [0.18, 0.3, -0.7], c: BLACK, m: 1 },
  ]))));
  g.add(turret);
  g.userData.turret = turret;
  g.userData.size = 2.4;
  return g;
}

export function samModel(f) {
  const P = PAL[f];
  const g = new THREE.Group();
  g.add(mesh(cached('sam' + f, () => vox([
    { s: [3, 0.3, 3], p: [0, 0.15, 0], c: 0x8b8160 },
    { s: [1.0, 0.5, 1.0], p: [0, 0.5, 0], c: P.dark },
    { s: [0.8, 0.6, 1.2], p: [1.8, 0.5, 1.2], c: P.body },
    { s: [0.1, 1.3, 0.1], p: [1.8, 1.4, 1.2], c: METAL },
  ]))));
  const rack = new THREE.Group();
  rack.position.set(0, 0.9, 0);
  rack.add(mesh(cached('samR' + f, () => vox([
    { s: [1.3, 0.2, 1.5], p: [0, 0, 0], c: P.body },
    { s: [0.26, 0.26, 1.7], p: [0.22, 0.25, -0.1], c: P.light, m: 1 },
    { s: [0.26, 0.26, 1.7], p: [0.22, 0.55, -0.1], c: P.light, m: 1 },
  ]))));
  rack.rotation.x = 0.5;
  g.add(rack);
  const dish = mesh(cached('samD' + f, () => vox([{ s: [1.1, 0.7, 0.08], p: [0, 0, 0], c: P.light }])));
  dish.position.set(1.8, 2.1, 1.2);
  g.add(dish);
  g.userData.turret = rack; g.userData.dish = dish;
  g.userData.size = 3;
  return g;
}

export function artilleryModel(f) {
  const P = PAL[f];
  const g = new THREE.Group();
  g.add(mesh(cached('art' + f, () => vox([
    { s: [2.2, 0.3, 2.2], p: [0, 0.15, 0], c: 0x8b8160 },
    { s: [1.2, 0.6, 1.6], p: [0, 0.6, 0.2], c: P.body },
  ]))));
  const turret = new THREE.Group();
  turret.position.set(0, 1.0, 0);
  turret.add(mesh(cached('artT' + f, () => vox([
    { s: [0.8, 0.5, 0.9], p: [0, 0, 0], c: P.accent },
    { s: [0.18, 0.18, 2.4], p: [0, 0.1, -1.4], c: P.dark },
  ]))));
  turret.rotation.x = 0.6;
  g.add(turret);
  g.userData.turret = turret;
  g.userData.size = 2.6;
  return g;
}

// ---------- naval ----------
export function destroyerModel(f) {
  const P = PAL[f];
  const hull = 0x6c747c, deck = 0x8b8d89;
  const g = new THREE.Group();
  g.add(mesh(cached('dd' + f, () => vox([
    { s: [1.9, 0.9, 7], p: [0, -0.1, 0.4], c: hull },
    { s: [1.4, 0.85, 1.6], p: [0, -0.05, -3.8], c: hull },
    { s: [0.7, 0.8, 1.0], p: [0, 0, -5.0], c: hull },
    { s: [1.95, 0.12, 7], p: [0, 0.38, 0.4], c: deck },
    { s: [1.2, 0.9, 2.0], p: [0, 0.85, -0.6], c: P.light },
    { s: [1.0, 0.5, 0.9], p: [0, 1.55, -1.0], c: P.light },
    { s: [0.9, 0.12, 0.1], p: [0, 1.6, -1.47], c: GLASS },
    { s: [0.1, 1.8, 0.1], p: [0, 2.6, -0.6], c: METAL },
    { s: [0.8, 0.08, 0.08], p: [0, 3.1, -0.6], c: METAL },
    { s: [0.6, 0.9, 0.7], p: [0, 1.0, 1.0], c: P.dark },
    { s: [1.0, 0.5, 1.2], p: [0, 0.65, 2.6], c: P.light },
    { s: [0.6, 0.3, 0.8], p: [0, 0.6, 3.6], c: P.body },
    { s: [1.96, 0.08, 0.4], p: [0, -0.35, 0.4], c: P.mark },
  ]))));
  const turret = new THREE.Group();
  turret.position.set(0, 0.6, -2.7);
  turret.add(mesh(cached('ddT' + f, () => vox([
    { s: [0.7, 0.35, 0.8], p: [0, 0, 0], c: P.body },
    { s: [0.1, 0.1, 1.1], p: [0, 0.05, -0.8], c: BLACK },
  ]))));
  g.add(turret);
  g.userData.turret = turret;
  g.userData.size = 10;
  return g;
}

export function patrolModel(f) {
  const P = PAL[f];
  const g = new THREE.Group();
  g.add(mesh(cached('pb' + f, () => vox([
    { s: [1.0, 0.5, 3.0], p: [0, 0, 0.2], c: 0x707880 },
    { s: [0.6, 0.45, 0.8], p: [0, 0, -1.6], c: 0x707880 },
    { s: [0.7, 0.5, 0.9], p: [0, 0.5, 0], c: P.light },
    { s: [0.6, 0.1, 0.1], p: [0, 0.6, -0.46], c: GLASS },
    { s: [0.06, 0.8, 0.06], p: [0, 1.1, 0.2], c: METAL },
    { s: [0.3, 0.2, 0.5], p: [0, 0.35, -1.1], c: P.dark },
  ]))));
  g.userData.size = 3.5;
  return g;
}

export function cargoModel(f) {
  const P = PAL[f];
  const g = new THREE.Group();
  g.add(mesh(cached('cargo' + f, () => vox([
    { s: [2.2, 1.0, 8], p: [0, -0.1, 0], c: 0x5a5f63 },
    { s: [1.4, 0.9, 1.4], p: [0, -0.1, -4.6], c: 0x5a5f63 },
    { s: [1.6, 1.4, 1.2], p: [0, 1.0, 3.2], c: P.light },
    { s: [0.5, 0.8, 0.5], p: [0, 2.0, 3.4], c: P.dark },
    { s: [0.9, 0.7, 1.5], p: [-0.5, 0.75, -2.3], c: 0x8e6a4a },
    { s: [0.9, 0.7, 1.5], p: [0.5, 0.75, -2.3], c: 0x5d7a83 },
    { s: [0.9, 0.7, 1.5], p: [-0.5, 0.75, -0.6], c: 0x7a7350 },
    { s: [0.9, 0.7, 1.5], p: [0.5, 0.75, -0.6], c: 0x8a5048 },
    { s: [0.9, 0.7, 1.5], p: [0, 0.75, 1.1], c: 0x6f7f5a },
  ]))));
  g.userData.size = 9;
  return g;
}

// ---------- structures ----------
export function structureModel(kind, f) {
  const P = PAL[f];
  const g = new THREE.Group();
  const defs = {
    radar: () => vox([
      { s: [3, 2, 3], p: [0, 1, 0], c: CONCRETE },
      { s: [0.6, 4, 0.6], p: [0, 4, 0], c: METAL },
      { s: [3.2, 0.2, 3.2], p: [0, 2.05, 0], c: P.dark },
    ]),
    factory: () => vox([
      { s: [9, 4, 6], p: [0, 2, 0], c: 0x8e6e5b },
      { s: [9.2, 0.6, 2], p: [0, 4.2, -1.5], c: 0x6b5a50 },
      { s: [9.2, 0.6, 2], p: [0, 4.2, 1.5], c: 0x6b5a50 },
      { s: [5, 3, 4], p: [7, 1.5, 0.5], c: CONCRETE },
      { s: [0.9, 8, 0.9], p: [-3, 4, 2], c: 0x7a6255 },
      { s: [0.9, 9, 0.9], p: [-1, 4.5, 2], c: 0x7a6255 },
      { s: [0.4, 0.4, 0.4], p: [0, 4.6, 0], c: P.mark },
    ]),
    fuel: () => vox([
      { s: [2.6, 2.4, 2.6], p: [-2, 1.2, 0], c: 0xd2cfc4, cyl: 1, seg: 10 },
      { s: [2.6, 2.4, 2.6], p: [1.2, 1.2, -1.5], c: 0xd2cfc4, cyl: 1, seg: 10 },
      { s: [2.6, 2.4, 2.6], p: [1.2, 1.2, 1.6], c: 0xc8c2b0, cyl: 1, seg: 10 },
      { s: [6, 0.2, 6], p: [0, 0.1, 0], c: 0x777068 },
      { s: [0.3, 0.3, 4], p: [-0.4, 0.4, 0], c: METAL },
    ]),
    bunker: () => vox([
      { s: [6, 2.2, 6], p: [0, 1.1, 0], c: 0x8a877d },
      { s: [4, 1, 4], p: [0, 2.6, 0], c: 0x7d7a71 },
      { s: [3, 0.3, 0.2], p: [0, 1.6, -3.05], c: BLACK },
      { s: [0.15, 3, 0.15], p: [1.4, 4.4, 1.4], c: METAL },
    ]),
    hq: () => vox([
      { s: [8, 3, 8], p: [0, 1.5, 0], c: 0x8d8678 },
      { s: [5, 3, 5], p: [0, 4.5, 0], c: 0x9b9384 },
      { s: [2, 2, 2], p: [0, 7, 0], c: P.dark },
      { s: [0.2, 4, 0.2], p: [0.6, 10, 0.6], c: METAL },
      { s: [8.2, 0.3, 0.3], p: [0, 3, -4], c: P.mark },
    ]),
    silo: () => vox([
      { s: [4, 0.6, 4], p: [0, 0.3, 0], c: CONCRETE },
      { s: [2.2, 0.4, 2.2], p: [0, 0.7, 0], c: P.dark },
      { s: [1.6, 0.1, 1.6], p: [0, 0.95, 0], c: BLACK },
    ]),
    outpost: () => vox([
      { s: [5, 2, 4], p: [0, 1, 0], c: 0x8c8a76 },
      { s: [1.2, 4, 1.2], p: [3, 2, 2], c: 0x7b6d55 },
      { s: [2, 0.4, 2], p: [3, 4.2, 2], c: 0x6a5d48 },
      { s: [0.1, 2.5, 0.1], p: [-2, 3.2, -1.5], c: METAL },
      { s: [0.9, 0.5, 0.05], p: [-1.5, 4.1, -1.5], c: P.mark },
    ]),
  };
  g.add(mesh(cached('st' + kind + f, defs[kind])));
  if (kind === 'radar') {
    const dish = mesh(cached('dish' + f, () => vox([
      { s: [3, 1.8, 0.2], p: [0, 0, 0], c: P.light },
      { s: [0.2, 0.2, 1], p: [0, 0, -0.5], c: METAL },
    ])));
    dish.position.set(0, 6.5, 0);
    g.add(dish);
    g.userData.dish = dish;
  }
  g.userData.size = { radar: 6, factory: 14, fuel: 7, bunker: 6, hq: 10, silo: 4, outpost: 6 }[kind];
  return g;
}

// ---------- munitions ----------
export function missileModel(kind, f) {
  const P = PAL[f];
  const g = new THREE.Group();
  const defs = {
    small: () => vox([
      { s: [0.13, 0.13, 1.0], p: [0, 0, 0], c: 0xd5d6d2 },
      { s: [0.1, 0.1, 0.16], p: [0, 0, -0.56], c: P.dark },
      { s: [0.44, 0.03, 0.16], p: [0, 0, 0.42], c: 0xa9aaa6 },
      { s: [0.03, 0.44, 0.16], p: [0, 0, 0.42], c: 0xa9aaa6 },
    ]),
    big: () => vox([
      { s: [0.26, 0.26, 1.7], p: [0, 0, 0], c: 0xc9c9c2 },
      { s: [0.2, 0.2, 0.3], p: [0, 0, -0.95], c: P.dark },
      { s: [1.1, 0.04, 0.3], p: [0, 0, -0.1], c: 0x9a9b96 },
      { s: [0.04, 0.5, 0.3], p: [0, 0.15, 0.75], c: 0x9a9b96 },
    ]),
    bomb: () => vox([
      { s: [0.26, 0.26, 0.85], p: [0, 0, 0], c: OLIVE },
      { s: [0.2, 0.2, 0.2], p: [0, 0, -0.5], c: 0x4b513a },
      { s: [0.9, 0.03, 0.22], p: [0, 0, 0.0], c: 0x7a7f63 },
      { s: [0.4, 0.4, 0.06], p: [0, 0, 0.45], c: 0x4b513a },
    ]),
    torpedo: () => vox([{ s: [0.25, 0.25, 1.6], p: [0, 0, 0], c: 0x3d4146 }]),
  };
  g.add(mesh(cached('ms' + kind + f, defs[kind])));
  if (kind !== 'bomb' && kind !== 'torpedo') g.add(glowBox(0.1, 0.1, 0.25, 0xffc27a, 0, 0, kind === 'big' ? 0.95 : 0.6));
  return g;
}

// Ground shadow blob under the player's aircraft (depth cue near terrain).
export function shadowBlob() {
  const geo = new THREE.CircleGeometry(1, 16);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
  m.renderOrder = 2;
  return m;
}

export function ringMesh(color = 0xff4433) {
  const geo = new THREE.RingGeometry(0.85, 1, 40);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = 3;
  return m;
}
