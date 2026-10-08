import * as THREE from 'three';
import { mulberry32 } from './noise.js';

export const REGION_NAMES = ['Valdren', 'Ostmark', 'Kessa Basin', 'Thalor Reach', 'Irongate', 'Sundar Coast', 'Corvane', 'Mirela Isles',
  'Drakos Highlands', 'Halvard', 'Nyssa Straits', 'Tarkand', 'Verlo Plains', 'Ebon Shore', 'Kaskara', 'Lowmere'];
export const FACTIONS = ['Allied Coalition', 'Red Dominion'];

// Regions are Voronoi cells around seed points on the sphere.
export class Campaign {
  constructor(seed) {
    const rng = mulberry32(seed * 17 + 3);
    const n = REGION_NAMES.length;
    this.seeds = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i + 0.5) / n * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i + rng() * 0.5;
      this.seeds.push(new THREE.Vector3(Math.cos(th) * r, y * 0.92, Math.sin(th) * r).normalize());
    }
    this.regions = this.seeds.map((s, i) => ({ id: i, name: REGION_NAMES[i], dir: s, owner: 1, strength: 3 }));
    // initial front line: the "west" half belongs to the coalition
    const order = this.regions.slice().sort((a, b) => a.dir.x - b.dir.x);
    order.forEach((r, i) => { r.owner = i < n / 2 ? 0 : 1; });
    this.adj = this.regions.map(() => new Set());
    this.load();
  }
  regionOf(dir) {
    let best = 0, bd = -2;
    for (let i = 0; i < this.seeds.length; i++) { const d = this.seeds[i].dot(dir); if (d > bd) { bd = d; best = i; } }
    return best;
  }
  computeAdjacency(w = 180, h = 90) {
    const ids = new Int16Array(w * h), d = new THREE.Vector3();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const lat = (0.5 - (y + 0.5) / h) * Math.PI, lon = ((x + 0.5) / w) * Math.PI * 2 - Math.PI;
      d.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      ids[y * w + x] = this.regionOf(d);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = ids[y * w + x], b = ids[y * w + (x + 1) % w], c = y + 1 < h ? ids[(y + 1) * w + x] : a;
      if (a !== b) { this.adj[a].add(b); this.adj[b].add(a); }
      if (a !== c) { this.adj[a].add(c); this.adj[c].add(a); }
    }
    this.idMap = { ids, w, h };
  }
  front(owner) {
    // regions of `owner` that border the other side
    return this.regions.filter((r) => r.owner === owner && [...this.adj[r.id]].some((j) => this.regions[j].owner !== owner));
  }
  friendlyNeighbour(region) {
    const ns = [...this.adj[region.id]].map((j) => this.regions[j]).filter((r) => r.owner === 0);
    if (!ns.length) return this.regions.filter((r) => r.owner === 0).sort((a, b) => b.dir.dot(region.dir) - a.dir.dot(region.dir))[0] || region;
    return ns.sort((a, b) => b.dir.dot(region.dir) - a.dir.dot(region.dir))[0];
  }
  hostileNeighbour(region) {
    const ns = [...this.adj[region.id]].map((j) => this.regions[j]).filter((r) => r.owner === 1);
    if (!ns.length) return this.regions.filter((r) => r.owner === 1).sort((a, b) => b.dir.dot(region.dir) - a.dir.dot(region.dir))[0] || region;
    return ns.sort((a, b) => b.dir.dot(region.dir) - a.dir.dot(region.dir))[0];
  }
  // returns a list of news lines
  applyResult(mission, success) {
    const news = [];
    const r = this.regions[mission.regionId];
    if (!r) return news;
    if (success) {
      if (r.owner === 1) {
        r.strength -= mission.impact || 1;
        if (r.strength <= 0) { r.owner = 0; r.strength = 3; news.push(`${r.name} has been LIBERATED by the ${FACTIONS[0]}!`); }
        else news.push(`${r.name}: enemy hold weakened (${r.strength} left).`);
      } else {
        r.strength = Math.min(5, r.strength + 1);
        news.push(`${r.name} defences reinforced.`);
      }
    } else {
      const target = r.owner === 0 ? r : this.friendlyNeighbour(r);
      target.strength -= 1;
      if (target.strength <= 0) { target.owner = 1; target.strength = 2; news.push(`${target.name} has FALLEN to the ${FACTIONS[1]}.`); }
      else news.push(`${target.name} is under pressure (${target.strength} left).`);
    }
    const blue = this.regions.filter((x) => x.owner === 0).length;
    if (blue === this.regions.length) news.push('VICTORY — the whole world is free!');
    this.save();
    return news;
  }
  reset() { try { localStorage.removeItem('skyfront.campaign'); } catch (e) { /* ignore */ } location.reload(); }
  save() {
    try { localStorage.setItem('skyfront.campaign', JSON.stringify(this.regions.map((r) => [r.owner, r.strength]))); } catch (e) { /* ignore */ }
  }
  load() {
    try {
      const s = JSON.parse(localStorage.getItem('skyfront.campaign') || 'null');
      if (s && s.length === this.regions.length) s.forEach(([o, st], i) => { this.regions[i].owner = o; this.regions[i].strength = st; });
    } catch (e) { /* ignore */ }
  }
}
