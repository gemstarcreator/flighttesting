import * as THREE from 'three';
import { R, rand, randInt, pick, clamp, dirToward, tangentOf, randomTangent, fmtDist } from './util.js';

const OPS = ['Iron Gale', 'Black Lantern', 'Silent Tide', 'Ember Fall', 'Crimson Veil', 'Glass Hammer', 'North Wind', 'Broken Arrow',
  'Last Light', 'Deep Current', 'Stone Wall', 'Night Owl', 'Steel Rain', 'Ghost Pass', 'Red Horizon', 'Cold Harbor', 'High Noon', 'Thunderhead'];

// site tests
export const SITE = {
  land: (g, d) => {
    const h = g.planet.heightAt(d);
    if (h < 4 || h > 75) return false;
    return flatness(g, d, 30) < 12;
  },
  water: (g, d) => {
    if (g.planet.heightAt(d) > -20) return false;
    for (let i = 0; i < 6; i++) if (g.planet.heightAt(dirToward(d, randomTangent(d), 160 / R)) > -8) return false;
    return true;
  },
  coast: (g, d) => {
    const h = g.planet.heightAt(d);
    if (h < 3 || h > 35 || flatness(g, d, 25) > 10) return false;
    for (let i = 0; i < 10; i++) if (g.planet.heightAt(dirToward(d, randomTangent(d), 170 / R)) < -12) return true;
    return false;
  },
};
function flatness(g, d, r) {
  const h0 = g.planet.heightAt(d);
  let m = 0;
  for (let i = 0; i < 4; i++) m = Math.max(m, Math.abs(g.planet.heightAt(dirToward(d, randomTangent(d), r / R)) - h0));
  return m;
}

// --------------------------------------------------------------- mission catalogue
export const TYPES = {
  strike: {
    name: 'Precision Strike', site: 'land', icon: '✸',
    brief: (d) => `Enemy infrastructure in ${d.regionName} is feeding the front. Destroy every marked structure. Expect AA guns${d.air ? ' and SAM sites (red threats — evade, fly low)' : ' and armour'}.`,
    build(m, g, d) {
      const S = d.site;
      const kinds = ['radar', 'factory', 'fuel', 'bunker', 'silo'];
      const n = 3 + (Math.random() < 0.5 ? 1 : 0);
      const targets = [];
      for (let i = 0; i < n; i++) targets.push(g.spawnStruct(kinds[(i + randInt(0, 4)) % kinds.length], 1, g.nearbyLand(S, 15, 95), { tag: 'objective' }));
      for (let i = 0; i < 2 + (d.strength > 2 ? 1 : 0); i++) g.spawnGround('aa', 1, g.nearbyLand(S, 50, 160));
      if (d.air) for (let i = 0; i < (d.roleKey === 'heli' ? 1 : 2); i++) g.spawnGround('sam', 1, g.nearbyLand(S, 120, 260));
      if (d.roleKey === 'jet' || d.roleKey === 'striker') for (let i = 0; i < 2; i++) g.spawnAir('fighter', 1, S, 420, null, { home: S, patrolR: 500 });
      if (!d.air || d.roleKey === 'heli') {
        for (let i = 0; i < 3; i++) g.spawnGround('tank', 1, g.nearbyLand(S, 60, 200));
        g.spawnGround('apc', 1, g.nearbyLand(S, 40, 150));
      }
      if (d.roleKey === 'heli' || d.roleKey === 'tank') g.spawnHeli(1, S, { home: S });
      if (d.roleKey === 'tank') g.spawnGround('artillery', 1, g.nearbyLand(dirToward(S, d.B.clone().negate(), 280 / R), 0, 80));
      m.destroy('Destroy target structures', targets);
      m.area(S, 'TARGET AREA');
    },
  },
  air_superiority: {
    name: 'Air Superiority', site: 'land', icon: '✈',
    brief: (d) => `An enemy fighter wing with an ace pilot has been spotted over ${d.regionName}. Clear the skies. Two wingmen will fly with you.`,
    build(m, g, d) {
      const S = d.site;
      const air = [];
      for (let i = 0; i < 4 + (d.strength > 2 ? 1 : 0); i++) air.push(g.spawnAir('fighter', 1, dirToward(S, randomTangent(S), rand(0, 300) / R), rand(380, 520), null, { home: S, patrolR: 600 }));
      air.push(g.spawnAir('ace', 1, S, 650, null, { home: S, patrolR: 400, skill: 0.9 }));
      m.destroy('Shoot down the enemy squadron', air);
      m.wingmen = 2;
      m.area(S, 'ENEMY CAP');
    },
  },
  intercept: {
    name: 'Bomber Intercept', site: 'city', friendly: true, icon: '⚑',
    brief: (d) => `A bomber formation is heading for the city of ${d.cityName}. Shoot them all down before they reach it.`,
    build(m, g, d) {
      const S = d.site, H = d.B.clone().negate();
      const start = dirToward(S, H, 2300 / R);
      const side = new THREE.Vector3().crossVectors(start, H).normalize();
      const bombers = [];
      const n = 3 + (d.strength > 2 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const p = dirToward(start, side, (i - (n - 1) / 2) * 40 / R);
        bombers.push(g.spawnAir('bomber', 1, dirToward(p, H, (i % 2) * 30 / R), 320, null, { role: 'bomb', dest: S, home: start }));
      }
      const esc = [];
      for (let i = 0; i < 2; i++) { const f = g.spawnAir('fighter', 1, start, 420, null, { home: start, patrolR: 300 }); f.guard = bombers[0]; esc.push(f); }
      m.destroy('Shoot down all bombers', bombers);
      m.noArrive(bombers, `A bomber reached ${d.cityName}`);
      m.marks.push({ pos: S.clone().multiplyScalar(R + 30), label: d.cityName.toUpperCase(), color: '#78b8ff', arrow: false });
    },
  },
  naval_strike: {
    name: 'Naval Strike', site: 'water', icon: '⚓',
    brief: (d) => `An enemy flotilla is operating in the waters of ${d.regionName}. Sink the destroyer and the supply ship. Warships throw up flak and radar SAMs.`,
    build(m, g, d) {
      const S = d.site;
      const loop = g.waterLoop(S, 350);
      const dd = g.spawnShip('destroyer', 1, S, { path: loop, loop: true });
      const cargo = g.spawnShip('cargo', 1, g.nearbyWater(S, 60, 150), { path: loop.slice(1).concat(loop[0]), loop: true });
      for (let i = 0; i < 2; i++) g.spawnShip('patrol', 1, g.nearbyWater(S, 80, 250), { path: loop.slice(2).concat(loop.slice(0, 2)), loop: true });
      m.destroy('Sink the destroyer and cargo ship', [dd, cargo]);
      if (d.air) g.spawnAir('fighter', 1, S, 450, null, { home: S });
      m.area(S, 'FLEET');
    },
  },
  armor: {
    name: 'Armour Column', site: 'land', icon: '▣',
    brief: (d) => `An armoured column is pushing out of ${d.regionName} toward our lines. Stop it before it breaks through.`,
    build(m, g, d) {
      const S = d.site;
      const path = g.landPath(S, d.B, 1000);
      m.columnPath = path;
      const units = [];
      const back = d.B.clone().negate();
      for (let i = 0; i < 6; i++) {
        const k = i < 4 ? 'tank' : 'apc';
        const p = dirToward(S, back, (i * 14) / R);
        const u = g.spawnGround(k, 1, g.planet.heightAt(p) > 1 ? p : S, { path, heading: d.B });
        units.push(u);
      }
      g.spawnGround('aa', 1, g.nearbyLand(S, 30, 90));
      if (d.air && d.roleKey !== 'heli') g.spawnGround('sam', 1, g.nearbyLand(S, 100, 200));
      if (d.roleKey === 'heli' || d.roleKey === 'tank') g.spawnHeli(1, S, { home: S });
      m.destroy('Destroy the armoured column', units);
      m.track(units[0], 'COLUMN');
    },
  },
  defend: {
    name: 'Hold the Line', site: 'land', friendly: true, icon: '⛨',
    brief: (d) => `Our outpost in ${d.regionName} is about to be assaulted in three waves. Hold until every wave is broken. The outpost must survive.`,
    build(m, g, d) {
      const S = d.site, H = d.B.clone().negate();
      const outpost = g.spawnStruct('outpost', 0, S, { tag: 'protect', name: 'OUTPOST' });
      for (let i = 0; i < 2; i++) g.spawnGround('tank', 0, g.nearbyLand(S, 20, 60), { heading: H });
      g.spawnGround('aa', 0, g.nearbyLand(S, 15, 50));
      m.protect('Outpost must survive', [outpost], 1, 'The outpost was destroyed');
      const waveUnits = [];
      const spawnWave = (n, heli, planes) => {
        const from = g.nearbyLand(dirToward(S, H, 650 / R), 0, 150);
        const path = [S.clone()];
        for (let i = 0; i < n; i++) waveUnits.push(g.spawnGround(i === n - 1 ? 'apc' : 'tank', 1, g.nearbyLand(from, 0, 60), { path, heading: H.clone().negate() }));
        if (heli) waveUnits.push(g.spawnHeli(1, dirToward(S, H, 500 / R), { home: S }));
        for (let i = 0; i < planes; i++) waveUnits.push(g.spawnAir('attacker', 1, dirToward(S, H, 1800 / R), 300, null, { home: S, role: 'attack' }));
        g.message('Enemy wave incoming!', 'warn', 2.5);
      };
      m.waves = [
        { t: 6, fn: () => spawnWave(4, false, 0) },
        { t: 65, fn: () => spawnWave(4, true, 0) },
        { t: 125, fn: () => spawnWave(3, true, d.air ? 1 : 2) },
      ];
      m.objectives.push({
        kind: 'waves', label: 'Break all assault waves', primary: true,
        status: () => {
          const spawned = m.waves.filter((w) => w.done).length;
          const alive = waveUnits.filter((u) => u.alive && !u.dying).length;
          return { done: spawned === m.waves.length && alive === 0, text: `Break all assault waves (${spawned}/${m.waves.length} · ${alive} hostiles left)` };
        },
      });
      m.marks.push({ pos: outpost.pos.clone().addScaledVector(S, 8), label: 'OUTPOST', color: '#78b8ff', arrow: true });
    },
  },
  recon: {
    name: 'Low-Level Recon', site: 'land', icon: '◎',
    brief: (d) => `Photograph enemy positions in ${d.regionName}. Fly through each checkpoint LOW (under ${d.roleKey === 'heli' ? 80 : 150} m) — radar will see you if you climb.`,
    build(m, g, d) {
      const S = d.site;
      for (let i = 0; i < 2; i++) g.spawnGround('sam', 1, g.nearbyLand(S, 100, 300));
      for (let i = 0; i < 2; i++) g.spawnGround('aa', 1, g.nearbyLand(S, 50, 250));
      const pts = [];
      let a = rand(0, Math.PI * 2);
      const t1 = randomTangent(S), t2 = new THREE.Vector3().crossVectors(S, t1);
      for (let i = 0; i < 5; i++) {
        a += rand(0.9, 1.6);
        const tt = t1.clone().multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a)).normalize();
        pts.push(dirToward(S, tt, rand(220, 600) / R));
      }
      m.reach('Fly through recon checkpoints', pts, d.roleKey === 'heli' ? 30 : 45, d.roleKey === 'heli' ? 80 : 150);
      m.timeLeft = 300;
    },
  },
  escort: {
    name: 'Convoy Escort', site: 'land', icon: '⇶',
    brief: (d) => `A supply convoy must reach the forward base in ${d.regionName}. Enemy armour is waiting in ambush. At least 2 of 3 trucks must arrive.`,
    build(m, g, d) {
      const S = d.site, H = d.B.clone().negate();
      const path = g.landPath(S, H, 850);
      const dest = path[path.length - 1];
      const trucks = [];
      for (let i = 0; i < 3; i++) trucks.push(g.spawnGround('truck', 0, dirToward(S, d.B, (i * 12) / R), { path, heading: H, tag: 'protect', name: 'TRUCK' }));
      const mid = path[Math.floor(path.length / 2)];
      for (let i = 0; i < 3; i++) g.spawnGround('tank', 1, g.nearbyLand(mid, 80, 200));
      g.spawnGround('apc', 1, g.nearbyLand(mid, 60, 160));
      g.spawnGround('aa', 1, g.nearbyLand(dest, 60, 160));
      if (d.roleKey !== 'tank') g.spawnHeli(1, mid, { home: mid });
      m.deliver('Escort the convoy to the base', trucks, dest, 2);
      m.marks.push({ pos: dest.clone().multiplyScalar(R + g.planet.heightAt(dest) + 6), label: 'BASE', color: '#78b8ff', arrow: true });
    },
  },
  long_strike: {
    name: 'Deep Strike', site: 'land', icon: '☄',
    brief: (d) => `A command HQ and missile silos sit deep inside ${d.regionName}, far beyond our lines. Steer your cruise missiles there yourself — fly low (under 28 m) or enemy SAMs will shoot them down.`,
    build(m, g, d) {
      const S = d.site;
      const t = [g.spawnStruct('hq', 1, S, { tag: 'objective' })];
      for (let i = 0; i < 2; i++) t.push(g.spawnStruct('silo', 1, g.nearbyLand(S, 30, 90), { tag: 'objective' }));
      for (let i = 0; i < 2; i++) g.spawnGround('sam', 1, g.nearbyLand(S, 150, 350));
      for (let i = 0; i < 3; i++) g.spawnGround('aa', 1, g.nearbyLand(S, 50, 200));
      m.destroy('Destroy the HQ and silos', t);
      m.area(S, 'DEEP TARGET');
      m.spawnDist = 2900;
    },
  },
  fleet_battle: {
    name: 'Fleet Engagement', site: 'water', icon: '⚔',
    brief: (d) => `Enemy warships are contesting the sea lanes of ${d.regionName}. Engage and sink them. Watch for anti-ship missiles (counter with CIWS) and torpedoes (turn away).`,
    build(m, g, d) {
      const S = d.site;
      const loop = g.waterLoop(S, 400);
      const ships = [g.spawnShip('destroyer', 1, S, { path: loop, loop: true })];
      if (d.strength > 2) ships.push(g.spawnShip('destroyer', 1, g.nearbyWater(S, 100, 200), { path: loop.slice(2).concat(loop.slice(0, 2)), loop: true }));
      for (let i = 0; i < 2; i++) ships.push(g.spawnShip('patrol', 1, g.nearbyWater(S, 80, 250), { path: loop.slice(1).concat(loop[0]), loop: true }));
      m.destroy('Sink the enemy warships', ships);
      m.waves = [{ t: 50, fn: () => { for (let i = 0; i < 2; i++) g.spawnAir('attacker', 1, dirToward(S, randomTangent(S), 1500 / R), 300, null, { home: S }); g.message('Enemy strike aircraft inbound!', 'warn'); } }];
      m.area(S, 'ENEMY FLEET');
    },
  },
  shore_bombard: {
    name: 'Shore Bombardment', site: 'coast', icon: '☗',
    brief: (d) => `Coastal guns and bunkers in ${d.regionName} block our landings. Bombard them from the sea. Their artillery will drop red zones on you — keep moving.`,
    build(m, g, d) {
      const S = d.site;
      const t = [];
      for (let i = 0; i < 2; i++) t.push(g.spawnStruct('bunker', 1, g.nearbyLand(S, 10, 80), { tag: 'objective' }));
      t.push(g.spawnStruct('radar', 1, g.nearbyLand(S, 30, 120), { tag: 'objective' }));
      for (let i = 0; i < 2; i++) { const a = g.spawnGround('artillery', 1, g.nearbyLand(S, 20, 120), { tag: 'objective' }); t.push(a); }
      g.spawnGround('aa', 1, g.nearbyLand(S, 30, 120));
      for (let i = 0; i < 2; i++) g.spawnShip('patrol', 1, g.nearbyWater(S, 200, 450, 6), {});
      m.destroy('Destroy coastal defences', t);
      m.area(S, 'COAST');
    },
  },
  air_defense: {
    name: 'Air Defence', site: 'city', friendly: true, icon: '⛉',
    brief: (d) => `Enemy raids are coming for ${d.cityName}. Use your interceptor missiles (and guns) to destroy every raider. If two bombers get through, the city is lost.`,
    build(m, g, d) {
      const S = d.site, H = d.B.clone().negate();
      const raiders = [];
      const wave = (nb, na, nf) => {
        const start = dirToward(S, H, 2200 / R);
        for (let i = 0; i < nb; i++) raiders.push(g.spawnAir('bomber', 1, dirToward(start, randomTangent(start), rand(0, 80) / R), 300, null, { role: 'bomb', dest: S, home: start }));
        for (let i = 0; i < na; i++) raiders.push(g.spawnAir('attacker', 1, dirToward(start, randomTangent(start), rand(0, 80) / R), 280, null, { home: S }));
        for (let i = 0; i < nf; i++) raiders.push(g.spawnAir('fighter', 1, start, 420, null, { home: S }));
        g.message('Raid incoming!', 'warn');
      };
      m.waves = [{ t: 5, fn: () => wave(3, 0, 0) }, { t: 70, fn: () => wave(2, 2, 1) }];
      let bombersHit = 0;
      m.objectives.push({
        kind: 'raid', label: 'Destroy all raiders', primary: true,
        status: () => {
          const spawned = m.waves.every((w) => w.done);
          const alive = raiders.filter((u) => u.alive && !u.dying).length;
          bombersHit = raiders.filter((u) => u.reached).length;
          return { done: spawned && alive === 0, fail: bombersHit >= 2, failText: `${d.cityName} was bombed`, text: `Destroy all raiders (${alive} airborne · ${bombersHit}/2 got through)` };
        },
      });
      m.marks.push({ pos: S.clone().multiplyScalar(R + 30), label: d.cityName.toUpperCase(), color: '#78b8ff', arrow: false });
    },
  },
};

export const ROLE_POOLS = {
  jet: ['strike', 'air_superiority', 'intercept', 'naval_strike', 'recon'],
  striker: ['strike', 'armor', 'naval_strike', 'defend'],
  heli: ['armor', 'defend', 'escort', 'strike', 'recon'],
  tank: ['armor', 'strike', 'defend', 'escort'],
  destroyer: ['fleet_battle', 'shore_bombard', 'air_defense'],
  launcher: ['long_strike', 'air_defense', 'naval_strike', 'intercept'],
};

// --------------------------------------------------------------- generation
export function generateMissions(g, roleKey, count = 4) {
  const camp = g.campaign;
  const pool = ROLE_POOLS[roleKey].slice().sort(() => Math.random() - 0.5);
  while (pool.length < count) pool.push(pick(ROLE_POOLS[roleKey]));
  const defs = [];
  const air = roleKey === 'jet' || roleKey === 'striker' || roleKey === 'heli';
  for (const type of pool) {
    if (defs.length >= count) break;
    const T = TYPES[type];
    let regions = T.friendly ? camp.front(0) : camp.front(1);
    if (type === 'long_strike') regions = camp.regions.filter((r) => r.owner === 1);
    if (!regions.length) regions = camp.regions.filter((r) => r.owner === (T.friendly ? 0 : 1));
    if (!regions.length) regions = camp.regions;
    let def = null;
    for (let tries = 0; tries < 6 && !def; tries++) {
      const region = pick(regions);
      const s = findSite(g, region, T.site);
      if (!s) continue;
      const other = T.friendly ? camp.hostileNeighbour(region) : camp.friendlyNeighbour(region);
      let B = tangentOf(s.dir, other.dir.clone().sub(s.dir), new THREE.Vector3());
      if (T.friendly) B.negate();
      if (other === region) B = randomTangent(s.dir);
      def = {
        type, roleKey, air, regionId: region.id, regionName: region.name, strength: region.strength, site: s.dir, B,
        cityName: s.city ? s.city.name : region.name, title: 'Operation ' + pick(OPS), typeName: T.name, icon: T.icon,
        impact: type === 'long_strike' ? 2 : 1,
      };
      def.brief = T.brief(def);
    }
    if (def) defs.push(def);
  }
  return defs;
}

function findSite(g, region, kind) {
  const camp = g.campaign;
  if (kind === 'city') {
    const cities = g.planet.cities.filter((c) => camp.regionOf(c.dir) === region.id);
    if (cities.length) { const c = pick(cities); return { dir: c.dir.clone(), city: c }; }
    kind = 'land';
  }
  const test = SITE[kind];
  for (let i = 0; i < 400; i++) {
    const d = dirToward(region.dir, randomTangent(region.dir), Math.sqrt(Math.random()) * 0.45);
    if (camp.regionOf(d) !== region.id) continue;
    if (test(g, d)) return { dir: d };
  }
  return null;
}

// --------------------------------------------------------------- runtime
export class Mission {
  constructor(g, def) {
    this.g = g; this.def = def;
    this.title = def.title + ' — ' + def.typeName;
    this.objectives = []; this.waves = []; this.marks = [];
    this.t = 0; this.state = 'active'; this.timeLeft = null; this.wingmen = 0;
    this.endT = 0;
  }
  start() {
    TYPES[this.def.type].build(this, this.g, this.def);
    this.spawn = computeSpawn(this.g, this.def, this.spawnDist);
  }
  // objective helpers
  destroy(label, units) {
    this.objectives.push({
      kind: 'destroy', primary: true,
      status: () => {
        const dead = units.filter((u) => !u.alive || u.dying).length;
        return { done: dead === units.length, text: `${label} (${dead}/${units.length})` };
      },
    });
  }
  protect(label, units, minAlive, failText) {
    this.objectives.push({
      kind: 'protect', primary: false,
      status: () => {
        const alive = units.filter((u) => u.alive && !u.dying).length;
        const hp = units.reduce((s, u) => s + (u.alive && !u.dying ? u.hp / u.maxHp : 0), 0) / units.length;
        return { done: false, fail: alive < minAlive, failText, text: `${label} (${Math.round(hp * 100)}%)` };
      },
    });
  }
  noArrive(units, failText) {
    this.objectives.push({ kind: 'noarrive', primary: false, hidden: true, status: () => ({ fail: units.some((u) => u.reached), failText }) });
  }
  reach(label, pts, radius, maxAlt) {
    const st = { i: 0, warnT: 0 };
    this.reachState = st;
    this.reachPts = pts;
    this.objectives.push({
      kind: 'reach', primary: true,
      status: () => {
        const g = this.g, p = g.player;
        if (st.i < pts.length && p && p.alive && !p.dying) {
          const target = pts[st.i];
          const alt = g.planet.altitude(p.pos);
          const surf = target.clone().multiplyScalar(g.planet.surfaceR(target));
          const flat = p.pos.clone().normalize().multiplyScalar(surf.length()).distanceTo(surf);
          if (flat < radius) {
            if (alt <= maxAlt) { st.i++; g.message(`Checkpoint ${st.i}/${pts.length} captured`, 'good', 1.8); g.audio.success(); g.score += 100; }
            else if (g.time > st.warnT) { st.warnT = g.time + 2; g.message(`TOO HIGH — get below ${maxAlt} m`, 'warn', 1.8); }
          }
        }
        return { done: st.i >= pts.length, text: `${label} (${st.i}/${pts.length}) · stay under ${maxAlt} m` };
      },
    });
  }
  deliver(label, units, dest, need) {
    this.objectives.push({
      kind: 'deliver', primary: true,
      status: () => {
        const arrived = units.filter((u) => u.alive && !u.dying && u.arrived).length;
        const alive = units.filter((u) => u.alive && !u.dying).length;
        return { done: arrived >= need, fail: alive < need, failText: 'Too many trucks were lost', text: `${label} (${arrived}/${need} arrived · ${alive} alive)` };
      },
    });
  }
  area(dir, label) { this.areaMark = { dir, label }; }
  track(unit, label) { this.trackUnit = { unit, label }; }

  update(dt) {
    if (this.state !== 'active') {
      this.endT -= dt;
      if (this.endT <= 0 && !this.reported) { this.reported = true; this.g.endMission(this.state === 'success', this.reason); }
      return;
    }
    this.t += dt;
    for (const w of this.waves) if (!w.done && this.t >= w.t) { w.done = true; w.fn(); }
    if (this.timeLeft != null) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) return this.finish(false, 'Out of time');
    }
    this.checkT = (this.checkT || 0) - dt;
    if (this.checkT > 0) return;
    this.checkT = 0.25;
    let allDone = true;
    this.lines = [];
    for (const o of this.objectives) {
      const s = o.status();
      if (s.fail) return this.finish(false, s.failText);
      if (o.primary && !s.done) allDone = false;
      if (!o.hidden) this.lines.push({ text: s.text, done: !!s.done });
    }
    if (allDone) this.finish(true);
  }
  finish(success, reason) {
    if (this.state !== 'active') return;
    this.state = success ? 'success' : 'fail';
    this.reason = reason;
    this.endT = 3.5;
    this.g.message(success ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED' + (reason ? ' — ' + reason : ''), success ? 'good' : 'bad', 4);
    if (success) this.g.audio.success(); else this.g.audio.fail();
  }
  onPlayerOut() { this.finish(false, 'No redeploys left'); }
  objectiveLines() {
    if (!this.lines) { this.lines = []; for (const o of this.objectives) { const s = o.status(); if (!o.hidden) this.lines.push({ text: s.text, done: !!s.done }); } }
    return this.lines;
  }
  markers() {
    const out = this.markers_ || (this.markers_ = []);
    out.length = 0;
    const g = this.g, p = g.player;
    for (const m of this.marks) out.push(m);
    if (this.reachPts && this.reachState.i < this.reachPts.length) {
      const d = this.reachPts[this.reachState.i];
      out.push({ pos: d.clone().multiplyScalar(g.planet.surfaceR(d) + 25), label: 'CHECKPOINT ' + (this.reachState.i + 1), color: '#ffd166' });
    }
    if (this.areaMark && p) {
      const a = this.areaMark.dir.clone().multiplyScalar(g.planet.surfaceR(this.areaMark.dir) + 10);
      if (a.distanceTo(p.pos) > 700) out.push({ pos: a, label: this.areaMark.label, color: '#ffd166' });
    }
    if (this.trackUnit && this.trackUnit.unit.alive && p && this.trackUnit.unit.pos.distanceTo(p.pos) > 600)
      out.push({ pos: this.trackUnit.unit.pos.clone(), label: this.trackUnit.label, color: '#ffd166' });
    return out;
  }
}

// --------------------------------------------------------------- player spawn
export function computeSpawn(g, def, distOverride) {
  const S = def.site, B = def.B;
  const type = { jet: 'plane', striker: 'plane', heli: 'heli', tank: 'ground', destroyer: 'ship', launcher: 'ground' }[def.roleKey];
  const friendlySite = ['defend', 'escort', 'intercept', 'air_defense'].includes(def.type);
  let dist = distOverride || { plane: 1700, heli: 850, ground: 420, ship: 750 }[type];
  if (friendlySite) dist = { plane: 900, heli: 160, ground: 120, ship: 500 }[type];
  if (def.type === 'armor' && type === 'ground') dist = 650;
  if (def.roleKey === 'launcher' && !distOverride && !friendlySite) dist = 2400;
  if (def.type === 'air_defense' && def.roleKey === 'launcher') dist = 150;
  const toward = (d) => tangentOf(d, S.clone().sub(d), new THREE.Vector3());
  if (type === 'plane' || type === 'heli') {
    const d = dirToward(S, B, dist / R);
    const agl = type === 'plane' ? 380 : 30;
    return { dir: d, pos: d.clone().multiplyScalar(g.planet.surfaceR(d) + agl), heading: friendlySite ? B.clone().negate() : toward(d), alt: agl };
  }
  const test = type === 'ship' ? (d) => g.planet.heightAt(d) < -6 : (d) => g.planet.heightAt(d) > 1.2;
  const clear = (d) => {
    if (def.roleKey === 'launcher') return test(d);
    // the path toward the site must be passable
    const n = Math.ceil(dist / 25);
    const t = toward(d);
    for (let i = 0; i <= n; i++) if (!test(dirToward(d, t, i * 25 / R))) return i > n * 0.8;
    return true;
  };
  for (const scale of [1, 0.75, 0.5, 1.4]) {
    for (let k = 0; k < 13; k++) {
      const ang = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.42;
      const bear = B.clone().applyAxisAngle(S, ang);
      const d = dirToward(S, bear, dist * scale / R);
      if (test(d) && clear(d)) {
        const up = d.clone();
        return { dir: d, pos: up.clone().multiplyScalar(type === 'ship' ? R : R + g.planet.heightAt(d)), heading: friendlySite ? B.clone().negate() : toward(d) };
      }
    }
  }
  const d = type === 'ship' ? g.nearbyWater(S, 200, 1200, 6) : g.nearbyLand(S, 100, 900);
  return { dir: d, pos: d.clone().multiplyScalar(type === 'ship' ? R : R + g.planet.heightAt(d)), heading: toward(d) };
}

export { fmtDist, clamp };
