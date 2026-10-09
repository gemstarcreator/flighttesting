import * as THREE from 'three';

// World scale: a jet (~2.6 units long) cruising at ~46 u/s circles the planet in ~11 minutes.
export const R = 5000;
export const G = 9.8;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4();

// Quaternion for an object whose local -Z points along `f` and +Y is as close to `up` as possible.
export function quatFromForwardUp(f, up, out = new THREE.Quaternion()) {
  _r.crossVectors(f, up);
  if (_r.lengthSq() < 1e-10) {
    _r.set(1, 0, 0).cross(f);
    if (_r.lengthSq() < 1e-10) _r.set(0, 0, 1).cross(f);
  }
  _r.normalize();
  _u.crossVectors(_r, f).normalize();
  _b.copy(f).negate();
  _m.makeBasis(_r, _u, _b);
  return out.setFromRotationMatrix(_m);
}

// Project `hint` onto the tangent plane of unit vector `up`.
export function tangentOf(up, hint, out = new THREE.Vector3()) {
  out.copy(hint).addScaledVector(up, -hint.dot(up));
  if (out.lengthSq() < 1e-10) {
    out.set(0, 1, 0).addScaledVector(up, -up.y);
    if (out.lengthSq() < 1e-8) out.set(1, 0, 0).addScaledVector(up, -up.x);
  }
  return out.normalize();
}

export function randomTangent(up, out = new THREE.Vector3()) {
  return tangentOf(up, _b.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)), out);
}

// Rotate unit direction `dir` toward tangent `t` by `angle` radians (great-circle step).
export function dirToward(dir, t, angle, out = new THREE.Vector3()) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return out.copy(dir).multiplyScalar(c).addScaledVector(t, s).normalize();
}

export function randomDirNear(dir, maxAngle, minAngle = 0, out = new THREE.Vector3()) {
  const t = randomTangent(dir, new THREE.Vector3());
  const a = minAngle + Math.sqrt(Math.random()) * (maxAngle - minAngle);
  return dirToward(dir, t, a, out);
}

export const angleBetween = (a, b) => Math.acos(clamp(a.dot(b) / Math.sqrt(a.lengthSq() * b.lengthSq() || 1), -1, 1));
export const surfDist = (a, b) => R * angleBetween(a, b);

export function latLonOf(dir) {
  const d = _b.copy(dir).normalize();
  return { lat: Math.asin(clamp(d.y, -1, 1)), lon: Math.atan2(d.z, d.x) };
}
export function dirFromLatLon(lat, lon, out = new THREE.Vector3()) {
  return out.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
}

// Local compass frame at unit `up`: north toward +Y pole, east = up x north.
export function compassFrame(up, north = new THREE.Vector3(), east = new THREE.Vector3()) {
  tangentOf(up, _b.set(0, 1, 0), north);
  east.crossVectors(up, north).normalize();
  return { north, east };
}

export function headingDeg(up, f) {
  const { north, east } = compassFrame(up, new THREE.Vector3(), new THREE.Vector3());
  let h = Math.atan2(f.dot(east), f.dot(north)) * 180 / Math.PI;
  if (h < 0) h += 360;
  return h;
}

// Damage tables are either numbers or {air, ground, naval, static, missile}.
export function dmgFor(table, cat) {
  if (typeof table === 'number') return table;
  return table[cat] ?? table.default ?? 0;
}

export function fmtDist(d) {
  return d >= 1000 ? (d / 1000).toFixed(1) + 'k' : Math.round(d).toString();
}
