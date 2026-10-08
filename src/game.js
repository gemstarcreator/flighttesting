import * as THREE from 'three';
import { Planet } from './planet.js';
import { FX } from './fx.js';
import { Projectiles } from './weapons.js';
import { AirUnit, HeliUnit, GroundUnit, ShipUnit, Structure } from './units.js';
import { PlayerVehicle } from './player.js';
import { CamCtl } from './camera.js';
import { HUD } from './hud.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Campaign } from './campaign.js';
import { Mission } from './missions.js';
import { R, clamp, rand, pick, dmgFor, tangentOf, dirToward, randomTangent, quatFromForwardUp } from './util.js';
import { ringMesh, vox, voxMat } from './models.js';

export const SEED = 7;
const tick = () => new Promise((r) => setTimeout(r, 30));
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Game {
  constructor(canvas, hudCanvas) {
    this.settings = { quality: 'medium', volume: 0.6 };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('skyfront.settings') || '{}')); } catch (e) { /* ignore */ }
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.applyQuality();
    this.renderer.setSize(innerWidth, innerHeight);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.3, 30000);
    this.scene.add(this.camera);

    this.sun = new THREE.DirectionalLight(0xfff0da, 2.3);
    this.hemi = new THREE.HemisphereLight(0xc2d6e8, 0x6a5a46, 1.05);
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.scene.fog = new THREE.Fog(0xaec2d2, 800, 5000);
    this.buildSky();

    this.input = new Input();
    this.audio = new Audio();
    this.audio.setVolume(this.settings.volume);
    this.hud = new HUD(this, hudCanvas);
    this.world = { entities: [], missiles: [] };
    this.state = 'loading';
    this.time = 0; this.score = 0; this.kills = 0; this.lives = 3;
    this.COUNTER_WINDOW = 1.6;
    this.threats = []; this.locks = []; this.zones = []; this.wrecks = [];
    this.slowT = 0; this.holdCam = 0; this.showHints = 0; this.downT = 0;
    this.menuT = 0;
    addEventListener('resize', () => this.resize());
  }

  saveSettings() { try { localStorage.setItem('skyfront.settings', JSON.stringify(this.settings)); } catch (e) { /* ignore */ } }
  applyQuality() {
    const dpr = devicePixelRatio || 1;
    const pr = { low: 0.7, medium: Math.min(dpr, 1.25), high: Math.min(dpr, 2) }[this.settings.quality] || 1;
    this.renderer.setPixelRatio(pr);
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.hud.resize();
  }

  buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uUp: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Vector3(0, 1, 0) },
        uHorizon: { value: new THREE.Color(0xb5c8d6) }, uZenith: { value: new THREE.Color(0x5f88ae) }, uGround: { value: new THREE.Color(0x8296a3) },
        uSpace: { value: 0 },
      },
      vertexShader: `varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uUp, uSun, uHorizon, uZenith, uGround; uniform float uSpace; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float t = dot(d, uUp);
          vec3 c = t > 0.0 ? mix(uHorizon, uZenith, pow(clamp(t, 0.0, 1.0), 0.55)) : mix(uHorizon, uGround, clamp(-t * 5.0, 0.0, 1.0));
          c = mix(c, vec3(0.006, 0.01, 0.022), uSpace);
          float s = max(dot(d, uSun), 0.0);
          c += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 2.0 + pow(s, 16.0) * 0.16 * (1.0 - uSpace));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 32, 16), this.skyMat);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    const sp = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(24000);
      sp[i * 3] = v.x; sp[i * 3 + 1] = v.y; sp[i * 3 + 2] = v.z;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0 }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
    this.scene.add(this.stars);
  }

  async init(progress) {
    progress('Shaping continents…'); await tick();
    this.planet = new Planet(SEED);
    this.planet.generate();
    progress('Growing forests and cities…'); await tick();
    this.planet.build(this.scene);
    progress('Drawing the war map…'); await tick();
    this.campaign = new Campaign(SEED);
    this.campaign.computeAdjacency();
    this.mapImg = this.planet.renderMap(720, 360);
    this.fx = new FX(this);
    this.projectiles = new Projectiles(this);
    this.camCtl = new CamCtl(this);
    this.state = 'menu';
  }

  // ------------------------------------------------------------------ spawning helpers
  spawn(e) { this.world.entities.push(e); return e; }
  spawnStruct(kind, faction, dir, o = {}) {
    const d = this.planet.heightAt(dir) > 1 ? dir : this.nearbyLand(dir, 0, 200);
    return this.spawn(new Structure(this, kind, faction, d, o));
  }
  spawnGround(kind, faction, dir, o = {}) {
    const d = this.planet.heightAt(dir) > 1 ? dir : this.nearbyLand(dir, 0, 200);
    return this.spawn(new GroundUnit(this, kind, faction, d, o));
  }
  spawnShip(kind, faction, dir, o = {}) {
    const d = this.planet.heightAt(dir) < -4 ? dir : this.nearbyWater(dir, 0, 400, 4);
    const s = new ShipUnit(this, kind, faction, d, o);
    if (o.loop) s.loop = true;
    return this.spawn(s);
  }
  spawnAir(kind, faction, dir, alt, fwd, o = {}) {
    const d = dir.clone().normalize();
    const pos = d.clone().multiplyScalar(this.planet.surfaceR(d) + alt);
    const f = tangentOf(d, fwd || randomTangent(d), new THREE.Vector3());
    return this.spawn(new AirUnit(this, kind, faction, pos, f, o));
  }
  spawnHeli(faction, dir, o = {}) {
    const d = dir.clone().normalize();
    return this.spawn(new HeliUnit(this, faction, d.clone().multiplyScalar(this.planet.surfaceR(d) + 40), o));
  }
  nearbyLand(dir, rMin, rMax) {
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < 80; i++) {
        const d = dirToward(dir, randomTangent(dir), rand(rMin, rMax) / R);
        const h = this.planet.heightAt(d);
        if (h > 2.5 && h < 110) return d;
      }
      rMax *= 2;
    }
    return dir.clone();
  }
  nearbyWater(dir, rMin, rMax, depth = 4) {
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < 80; i++) {
        const d = dirToward(dir, randomTangent(dir), rand(rMin, rMax) / R);
        if (this.planet.heightAt(d) < -depth) return d;
      }
      rMax *= 2;
    }
    return dir.clone();
  }
  landPath(start, bearing, length) {
    const pts = [];
    let cur = start.clone();
    let b = tangentOf(cur, bearing, new THREE.Vector3());
    const step = 40;
    for (let dist = 0; dist < length; dist += step) {
      let ok = false;
      for (const a of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.3, -1.3]) {
        const nb = b.clone().applyAxisAngle(cur, a);
        const nd = dirToward(cur, nb, step / R);
        const mid = dirToward(cur, nb, step / 2 / R);
        const h0 = this.planet.heightAt(cur), h1 = this.planet.heightAt(nd);
        if (h1 > 1.5 && this.planet.heightAt(mid) > 1.5 && Math.abs(h1 - h0) < step * 0.8) {
          cur = nd; b = tangentOf(nd, nb, new THREE.Vector3()); pts.push(nd.clone()); ok = true; break;
        }
      }
      if (!ok) break;
    }
    return pts.length ? pts : [start.clone()];
  }
  waterLoop(S, r) {
    const pts = [];
    const t0 = randomTangent(S);
    for (let k = 0; k < 6; k++) {
      const t = t0.clone().applyAxisAngle(S, k * Math.PI / 3);
      for (let rr = r; rr > 30; rr *= 0.75) {
        const d = dirToward(S, t, rr / R);
        if (this.planet.heightAt(d) < -6) { pts.push(d); break; }
      }
    }
    return pts.length >= 2 ? pts : [S.clone(), dirToward(S, t0, 60 / R)];
  }

  // ------------------------------------------------------------------ mission lifecycle
  startMission(roleKey, def) {
    this.clearWorld();
    this.roleKey = roleKey;
    this.mission = def ? new Mission(this, def) : null;
    this.openWar = !def;
    this.score = 0; this.kills = 0; this.lives = 3; this.time = 0;
    if (this.mission) {
      this.mission.start();
      this.spawnPoint = this.mission.spawn;
    } else {
      this.spawnPoint = this.openWarSpawn(roleKey);
      this.directorT = 3;
    }
    this.spawnPlayer();
    if (this.mission && this.mission.wingmen) {
      const p = this.player;
      for (let i = 0; i < this.mission.wingmen; i++) {
        const w = this.spawnAir('fighter', 0, p.pos.clone().normalize(), this.planet.altitude(p.pos) + 5, p.forward(new THREE.Vector3()), { role: 'escort', name: i ? 'Wingman 2' : 'Wingman 1' });
        w.pos.addScaledVector(p.right(new THREE.Vector3()), (i ? 1 : -1) * 14).addScaledVector(p.forward(new THREE.Vector3()), -12);
        w.slot = i ? 1 : -1;
        w.hp = w.maxHp = 200;
      }
    }
    this.state = 'play';
    this.showHints = 30;
    this.audio.init();
    this.message(this.mission ? this.mission.title : 'OPEN WAR — survive and score', 'obj', 4);
  }
  spawnPlayer() {
    const sp = this.spawnPoint;
    if (this.player) { this.player.dispose(); }
    let pos = sp.pos.clone();
    if (this.roleKey === 'tank' || this.roleKey === 'launcher') pos = sp.dir.clone().multiplyScalar(R + this.planet.heightAt(sp.dir) + 0.05);
    this.player = new PlayerVehicle(this, this.roleKey, pos, sp.heading.clone());
    this.world.entities.push(this.player);
    this.controlled = this.player;
    this.camCtl.reset(); this.camCtl.deathT = 0;
    this.downT = 0; this.holdCam = 0; this.pendingReturn = false;
  }
  openWarSpawn(roleKey) {
    const type = { jet: 'plane', striker: 'plane', heli: 'heli', tank: 'ground', destroyer: 'ship', launcher: 'ground' }[roleKey];
    const blue = this.campaign.front(0);
    const region = pick(blue.length ? blue : this.campaign.regions);
    let d = region.dir.clone();
    d = type === 'ship' ? this.nearbyWater(d, 0, 1500, 15) : (type === 'plane' ? d : this.nearbyLand(d, 0, 900));
    const heading = randomTangent(d);
    const agl = type === 'plane' ? 400 : type === 'heli' ? 30 : 0;
    return { dir: d, pos: d.clone().multiplyScalar((type === 'ship' ? R : this.planet.surfaceR(d)) + agl), heading };
  }
  clearWorld() {
    for (const e of this.world.entities) { if (e.dispose) e.dispose(); else e.remove(); }
    for (const m of this.world.missiles) { this.scene.remove(m.mesh); m.alive = false; }
    this.world.entities = []; this.world.missiles = [];
    if (this.projectiles) this.projectiles.clear();
    for (const z of this.zones) this.scene.remove(z.ring);
    for (const w of this.wrecks) this.scene.remove(w.mesh);
    this.zones = []; this.wrecks = []; this.threats = []; this.locks = [];
    this.player = null; this.controlled = null; this.mission = null;
    this.aimPoint = null; this.aimEntity = null;
  }
  endMission(success, reason) {
    if (this.state !== 'play') return;
    this.state = 'debrief';
    if (document.pointerLockElement) document.exitPointerLock();
    const news = this.mission ? this.campaign.applyResult(this.mission.def, success) : [];
    this.audio.engine('plane', 0, false); this.audio.wind(0);
    this.ui.showDebrief({ success, reason, score: this.score, kills: this.kills, time: this.time, news, title: this.mission ? this.mission.title : 'Open War', openWar: this.openWar });
  }
  abort() {
    this.clearWorld();
    this.state = 'menu';
    this.audio.engine('plane', 0, false); this.audio.wind(0);
  }

  // ------------------------------------------------------------------ events
  message(text, kind = 'info', dur = 2.5) { this.hud.message(text, kind, dur); }
  hitMarker(big = false) { this.hud.hitT = big ? 0.35 : 0.15; this.hud.hitBig = big; if (!big) this.audio.hit(); }
  slowmo(t) { this.slowT = Math.max(this.slowT, t); }
  registerLock(src, target, p) { this.locks.push({ src, target, p: clamp(p, 0, 1) }); }
  missilesOn(t) { let n = 0; for (const m of this.world.missiles) if (m.alive && m.target === t && !m.lost) n++; return n; }
  takeControl(obj) {
    this.controlled = obj;
    this.camCtl.reset();
    this.audio.wind(obj && obj.cat === 'missile' ? 0.12 : 0);
    if (obj && obj.cat === 'missile') this.audio.engine('missile', 1, true);
  }
  notifyLaunch(m) {
    if (this.time - (this.lastLaunchMsg || -9) > 1.2) {
      this.lastLaunchMsg = this.time;
      this.hud.feed(m.spec.threat === 'red' ? '⚠ RADAR MISSILE LAUNCH — evade!' : '⚠ Missile launch — get ready to counter', 'bad');
    }
  }
  onMissileEvaded(m) {
    const p = this.player;
    if (!p || !(m.target === p || m.target === this.controlled)) return;
    this.message('EVADED!', 'good', 1.4);
    this.score += 50;
    this.slowmo(0.35);
    this.audio.evade();
  }
  onMissileEnd(m, hit) {
    if (this.controlled === m) {
      this.holdCam = 0.9;
      this.pendingReturn = true;
      if (hit) this.message('DIRECT HIT', 'good', 1.2);
      else if (m.shotDown) this.message('MISSILE SHOT DOWN', 'warn', 1.5);
    }
  }
  onDestroyed(e, src) {
    const killer = src && src.owner ? src.owner : src;
    if (e.isPlayer) return;
    if (killer && killer.isPlayer) {
      this.score += e.score; this.kills++;
      this.hud.feed(`${e.name} destroyed  +${e.score}`, 'kill');
      this.audio.beep(1500, 0.07, 0.08);
      if (e.kind === 'ace') this.message('ACE SHOT DOWN!', 'good', 2.5);
      this.input.rumble(0.3, 0.5, 150);
    } else if (e.faction === 1 && killer && killer.faction === 0) this.hud.feed(`Allies destroyed ${e.name}`, 'info');
    if (e.faction === 0 && e.tag === 'protect') this.message(`${e.name} destroyed!`, 'bad', 2.5);
  }
  onPlayerDown() {
    this.downT = 0;
    if (this.controlled !== this.player) this.takeControl(this.player);
    this.message('YOU WERE SHOT DOWN', 'bad', 2);
  }

  splash(pos, radius, table, src, faction, exclude, hitMissiles) {
    if (!radius) return;
    for (const e of this.world.entities) {
      if (e === exclude || !e.alive || e.dying || e.faction === faction) continue;
      const d = e.pos.distanceTo(pos) - e.radius * 0.6;
      if (d < radius) e.damage(dmgFor(table, e.cat) * (1 - Math.max(0, d) / radius) * (exclude ? 0.5 : 1), src);
    }
    if (hitMissiles) for (const m of this.world.missiles) {
      if (!m.alive || m.faction === faction) continue;
      const d = m.pos.distanceTo(pos);
      if (d < radius) m.damage(dmgFor(table, 'missile') * (1 - d / radius), src);
    }
  }

  addZone(pos, radius, delay, dmg, src, silent) {
    const up = pos.clone().normalize();
    const surf = up.clone().multiplyScalar(this.planet.surfaceR(up) + 0.6);
    const ring = ringMesh(0xff4433);
    ring.position.copy(surf);
    quatFromForwardUp(randomTangent(up), up, ring.quaternion);
    ring.scale.set(radius, 1, radius);
    if (silent) ring.visible = false;
    this.scene.add(ring);
    this.zones.push({ pos: surf, radius, t: delay, dmg, src, ring, faction: src.faction, silent, shots: 0, shotT: 0 });
  }
  updateZones(dt) {
    for (const z of this.zones) {
      z.t -= dt;
      if (z.t > 0) { z.ring.material.opacity = 0.35 + 0.3 * Math.sin(this.time * (z.t < 1.2 ? 22 : 9)); continue; }
      z.shotT -= dt;
      if (z.shotT <= 0 && z.shots < 7) {
        z.shotT = 0.16; z.shots++;
        const up = z.pos.clone().normalize();
        const p = dirToward(up, randomTangent(up), rand(0, z.radius) / R);
        const h = this.planet.heightAt(p);
        const pt = p.multiplyScalar(R + Math.max(0, h));
        this.fx.explosion(pt, 1.5, { water: h < 0 });
        this.splash(pt, 11, z.dmg, z.src, z.faction, null, false);
        this.audio.explosion(this.camera.position.distanceTo(pt), false);
      }
      if (z.shots >= 7) { this.scene.remove(z.ring); z.done = true; }
    }
    this.zones = this.zones.filter((z) => !z.done);
  }

  addWreck(pos, quat, size, building) {
    if (!this.rubbleGeo) this.rubbleGeo = vox([
      { s: [1.6, 0.5, 1.4], p: [0, 0.2, 0], c: 0x2e2c2a }, { s: [0.8, 0.7, 0.6], p: [0.3, 0.4, -0.2], c: 0x3b3835 },
      { s: [0.6, 0.3, 0.9], p: [-0.5, 0.3, 0.4], c: 0x252422 }, { s: [0.4, 0.9, 0.4], p: [-0.2, 0.45, -0.5], c: 0x4a4541 },
    ]);
    const m = new THREE.Mesh(this.rubbleGeo, voxMat);
    m.position.copy(pos); m.quaternion.copy(quat); m.scale.setScalar(size * (building ? 1.6 : 1));
    this.scene.add(m);
    this.wrecks.push({ mesh: m, t: building ? 40 : 18, st: 0, pos: pos.clone().addScaledVector(pos.clone().normalize(), size) });
    if (this.wrecks.length > 60) this.scene.remove(this.wrecks.shift().mesh);
  }

  // Yellow threats can be countered at the right moment; red ones cannot.
  counter() {
    const p = this.player;
    if (!p || p.dying) return;
    if (p.counterCd > 0) { this.message('Counter recharging…', 'info', 0.7); return; }
    p.counterCd = p.role.counter.cd;
    const up = _a.copy(p.pos).normalize();
    if (p.type === 'plane' || p.type === 'heli') {
      for (let i = 0; i < 10; i++) this.fx.flare(p.pos, _b.copy(p.vel).multiplyScalar(0.25).add(randomTangent(up).multiplyScalar(rand(6, 14))).addScaledVector(up, -2));
    } else if (p.type === 'ground') this.fx.smokeScreen(p.pos);
    this.audio.flare();
    let parried = 0, early = 0, red = 0, perfect = 0;
    for (const m of this.world.missiles) {
      if (!m.alive || m.target !== p || m.lost || m.decoy) continue;
      const to = _b.subVectors(p.pos, m.pos);
      const d = to.length();
      const closing = _a.subVectors(m.vel, p.vel).dot(to) / Math.max(d, 1);
      const tti = d / Math.max(closing, 5);
      if (m.spec.threat === 'yellow') {
        if (tti <= this.COUNTER_WINDOW) {
          parried++;
          if (tti < 0.7) perfect++;
          if (p.type === 'ship') {
            // CIWS tracer stream toward the missile
            for (let i = 0; i < 6; i++) {
              const o = p.pos.clone().addScaledVector(p.up, 3);
              const v = m.pos.clone().sub(o).normalize().multiplyScalar(400);
              this.projectiles.spawn({ pos: o, vel: v, owner: p, dmg: 0, life: d / 400, color: 0xffe0a0 });
            }
            m.damage(999, p);
          } else {
            m.decoy = p.pos.clone().addScaledVector(p.vel, -0.4); m.decoyT = 1.0;
          }
        } else early++;
      } else red++;
    }
    if (parried) {
      this.message(perfect ? 'PERFECT COUNTER!' : 'COUNTERED!', 'good', 1.4);
      this.score += 50 * parried + 50 * perfect;
      this.slowmo(0.45);
      this.audio.parry();
      this.hud.flashT = 0.25; this.hud.flashCol = '#ffcc33';
      this.input.rumble(0.2, 0.7, 120);
    } else if (early) this.message('TOO EARLY — it is still tracking you!', 'warn', 1.5);
    else if (red) this.message('RED threat — counters do not work, EVADE!', 'bad', 1.5);
  }

  computeThreats(dtReal) {
    const T = this.threats;
    T.length = 0;
    const p = this.player, ctl = this.controlled;
    for (const m of this.world.missiles) {
      if (!m.alive || m.lost || m.decoy) continue;
      const onVehicle = p && m.target === p && !p.dying;
      const onMissile = ctl && ctl !== p && ctl.cat === 'missile' && m.target === ctl;
      if (!onVehicle && !onMissile) continue;
      const tgt = onVehicle ? p : ctl;
      const to = _a.subVectors(tgt.pos, m.pos);
      const d = to.length();
      if (d > 2500) continue;
      const closing = _b.subVectors(m.vel, tgt.vel).dot(to) / Math.max(d, 1);
      T.push({ m, tti: d / Math.max(closing, 4), color: m.spec.threat, onVehicle });
    }
    if (p && !p.dying && p.cat !== 'air') {
      for (const z of this.zones) {
        if (z.silent || z.t <= 0) continue;
        if (z.pos.distanceTo(p.pos) < z.radius * 1.1) T.push({ m: { pos: z.pos, spec: {} }, tti: z.t, color: 'red', zone: true, onVehicle: true });
      }
    }
    T.sort((a, b) => a.tti - b.tti);
    // warning tones
    this.toneT = (this.toneT || 0) - dtReal;
    if (this.toneT <= 0) {
      if (T.length) {
        const t = T[0];
        this.toneT = clamp(t.tti * 0.12, 0.07, 0.45);
        this.audio.beep(t.color === 'red' ? 760 : 1180, 0.05, 0.11);
      } else {
        let lock = 0;
        for (const l of this.locks) if (l.target === p || l.target === ctl) lock = Math.max(lock, l.p);
        if (lock > 0.05) { this.toneT = lock > 0.7 ? 0.12 : 0.45; this.audio.beep(900, 0.04, 0.06); }
        else this.toneT = 0.2;
      }
    }
  }

  // ------------------------------------------------------------------ open-war director
  director(dt) {
    this.directorT -= dt;
    if (this.directorT > 0 || !this.player || this.player.dying) return;
    this.directorT = 14;
    const p = this.player;
    const hostile = this.world.entities.filter((e) => e.faction === 1 && e.alive && !e.dying && e.pos.distanceTo(p.pos) < 2600).length;
    if (hostile >= 7) return;
    const up = p.pos.clone().normalize();
    const fwd = tangentOf(up, p.type === 'plane' ? p.forward(new THREE.Vector3()) : p.hf, new THREE.Vector3());
    const ahead = (dist, spread = 0.8) => dirToward(up, fwd.clone().applyAxisAngle(up, rand(-spread, spread)), dist / R);
    const r = Math.random();
    const t = p.type;
    if (t === 'plane') {
      if (r < 0.55) { const d = ahead(1800); for (let i = 0; i < 2; i++) this.spawnAir(Math.random() < 0.12 ? 'ace' : 'fighter', 1, d, 420, null, { home: d }); }
      else {
        const d = this.nearbyLand(ahead(1600), 0, 400);
        this.spawnStruct(pick(['radar', 'factory', 'fuel', 'bunker']), 1, d, {});
        this.spawnGround('aa', 1, this.nearbyLand(d, 40, 120));
        if (Math.random() < 0.5) this.spawnGround('sam', 1, this.nearbyLand(d, 80, 200));
        for (let i = 0; i < 2; i++) this.spawnGround('tank', 1, this.nearbyLand(d, 30, 150));
      }
    } else if (t === 'heli' || t === 'ground') {
      const d = this.nearbyLand(ahead(t === 'heli' ? 800 : 550), 0, 200);
      for (let i = 0; i < 2 + (r < 0.4 ? 1 : 0); i++) this.spawnGround('tank', 1, this.nearbyLand(d, 0, 80), { path: [up.clone()] });
      this.spawnGround(r < 0.5 ? 'apc' : 'aa', 1, this.nearbyLand(d, 0, 80));
      if (r > 0.7) this.spawnHeli(1, d, { home: up.clone() });
      if (this.roleKey === 'launcher') { const far = this.nearbyLand(ahead(2000, 1.5), 0, 400); this.spawnStruct(pick(['hq', 'silo', 'factory']), 1, far, { tag: 'objective' }); this.spawnGround('sam', 1, this.nearbyLand(far, 80, 200)); }
      if (t === 'ground' && r < 0.3) this.spawnGround('artillery', 1, this.nearbyLand(ahead(1200), 0, 200));
    } else {
      const d = this.nearbyWater(ahead(900), 0, 300, 8);
      if (r < 0.4) this.spawnShip('destroyer', 1, d, {});
      for (let i = 0; i < 2; i++) this.spawnShip('patrol', 1, this.nearbyWater(d, 30, 150, 4), { path: [up.clone()] });
      if (r > 0.7) this.spawnAir('attacker', 1, ahead(1600), 300, null, { home: up.clone() });
    }
  }

  // ------------------------------------------------------------------ frame
  readInput() {
    const i = this.input, c = i.cur;
    return {
      moveX: c.moveX || 0, moveY: c.moveY || 0, pitchSign: c.pitchSign || 1, lookX: c.lookX || 0, lookY: c.lookY || 0,
      mouseX: c.mouseX || 0, mouseY: c.mouseY || 0,
      yawL: i.val('yawL'), yawR: i.val('yawR'), throttle: i.val('throttle'), brake: i.val('brake'),
      primaryDown: i.down('primary'), primaryPressed: i.pressed('primary'), secondaryPressed: i.pressed('secondary'),
      targetPressed: i.pressed('target'), counterPressed: i.pressed('counter'), weaponNextPressed: i.pressed('weaponNext'),
      weaponPrevPressed: i.pressed('weaponPrev'), assistPressed: i.pressed('assist'), cameraPressed: i.pressed('camera'),
      mapPressed: i.pressed('map'), pausePressed: i.pressed('pause'),
    };
  }

  frame(dtReal) {
    this.input.poll();
    dtReal = Math.min(dtReal, 0.05);
    if (this.state === 'play') {
      const I = this.readInput();
      if (I.pausePressed || I.mapPressed) { this.ui.showPause(I.mapPressed); }
      else {
        this.slowT -= dtReal;
        const scale = this.slowT > 0 ? 0.35 : 1;
        this.update(dtReal * scale, dtReal, I);
      }
    } else if (this.state === 'menu' || this.state === 'debrief' || this.state === 'loading') {
      this.menuView(dtReal);
    }
    if (this.state !== 'loading' || this.planet) this.renderer.render(this.scene, this.camera);
    this.hud.draw(this.state === 'play' ? dtReal : 0);
    if (this.ui) this.ui.frame(dtReal);
  }

  update(dt, dtReal, I) {
    const g = this, p = this.player;
    this.time += dt;
    this.showHints -= dtReal;
    this.locks.length = 0;
    // missile control
    const ctl = this.controlled;
    let mctrl = null;
    if (ctl && ctl.cat === 'missile') {
      if (ctl.alive) {
        mctrl = { pitch: I.moveY * I.pitchSign, yaw: I.moveX, boost: I.throttle > 0.3, fine: I.brake > 0.3 };
        if (I.targetPressed) {
          const t = ctl.target && ctl.target.alive && !ctl.target.dying ? ctl.target : null;
          ctl.mode = t ? 'homing' : 'dumb';
          this.message(t ? 'Released — auto-guiding to target' : 'Released', 'info', 1.2);
          this.takeControl(p);
          I.targetPressed = false;
        } else if (I.secondaryPressed && ctl.age > 0.5) { ctl.explode(null); I.secondaryPressed = false; }
        if (I.counterPressed) { this.counter(); I.counterPressed = false; }
      }
    }
    if (this.holdCam > 0) {
      this.holdCam -= dtReal;
      if (this.holdCam <= 0 && this.pendingReturn) { this.pendingReturn = false; this.takeControl(this.player); }
    }
    // player
    if (p) {
      p.update(dt, I);
      if (p.dying) {
        this.downT += dtReal;
        if (this.downT > 1.5 && this.lives > 0 && (this.input.pressed('primary') || I.secondaryPressed)) { this.lives--; this.spawnPlayer(); }
        if (this.lives <= 0 && this.downT > 3) {
          if (this.mission) this.mission.onPlayerOut();
          else if (!this.endQueued) { this.endQueued = true; setTimeout(() => { this.endQueued = false; this.endMission(false, 'Shot down'); }, 1500); }
        }
      }
    }
    // AI
    const ents = this.world.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e === this.player || !e.alive) continue;
      e.update(dt);
    }
    // missiles
    const ms = this.world.missiles;
    for (let i = 0; i < ms.length; i++) { const m = ms[i]; if (m.alive) m.update(dt, m === this.controlled ? mctrl : null); }
    this.world.missiles = ms.filter((m) => m.alive);
    this.world.entities = ents.filter((e) => e.alive);
    this.projectiles.update(dt);
    this.updateZones(dt);
    for (const w of this.wrecks) { if (w.t > 0) { w.t -= dt; w.st -= dt; if (w.st <= 0) { w.st = 0.25; this.fx.trail(w.pos, 0x3a3836, 1.2, 3.5); } } }
    this.fx.update(dt);
    this.computeThreats(dtReal);
    if (this.mission) this.mission.update(dt);
    else if (this.openWar) this.director(dt);
    this.camCtl.update(dtReal, I);
    this.updateEnvironment(dt);
    this.planet.update(this.camera.position, dt);
    // engine sound only from the vehicle you are in
    if (!p || p.dying) this.audio.engine('plane', 0, false);
  }

  updateEnvironment(dt) {
    const cam = this.camera.position;
    const up = _a.copy(cam).normalize();
    const alt = cam.length() - R;
    const t = clamp(alt / 3500, 0, 1);
    const u = this.skyMat.uniforms;
    u.uUp.value.copy(up);
    u.uHorizon.value.setHex(0xb5c8d6).lerp(_c1.setHex(0x3c5576), t * 0.9);
    u.uZenith.value.setHex(0x5f88ae).lerp(_c1.setHex(0x0a1426), t);
    u.uGround.value.setHex(0x8b9ba5).lerp(_c1.setHex(0x2c3d4f), t);
    u.uSpace.value = clamp((alt - 2500) / 4000, 0, 1);
    this.stars.material.opacity = clamp((alt - 1800) / 2500, 0, 1);
    this.sky.position.copy(cam);
    this.stars.position.copy(cam);
    this.scene.fog.color.copy(u.uHorizon.value);
    this.scene.fog.near = 500 + alt * 0.6;
    this.scene.fog.far = 3600 + alt * 3.5;
    // sun follows the player so the whole globe is daylit; it sits high and a little to the side
    const st = tangentOf(up, _b.set(0.35, 0.25, 0.9), new THREE.Vector3());
    const sunDir = up.clone().multiplyScalar(0.78).addScaledVector(st, 0.62).normalize();
    u.uSun.value.copy(sunDir);
    this.sun.position.copy(cam).addScaledVector(sunDir, 500);
    this.sun.target.position.copy(cam);
    this.hemi.position.copy(up);
  }

  menuView(dt) {
    this.menuT += dt;
    const a = this.menuT * 0.035;
    const cam = this.camera;
    cam.position.set(Math.cos(a) * 12500, 3800, Math.sin(a) * 12500);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.fov = 45; cam.updateProjectionMatrix();
    const u = this.skyMat.uniforms;
    u.uSpace.value = 1; this.stars.material.opacity = 1;
    this.sky.position.copy(cam.position); this.stars.position.copy(cam.position);
    this.scene.fog.near = 1e6; this.scene.fog.far = 2e6;
    const sunDir = _a.set(Math.cos(a + 0.9), 0.45, Math.sin(a + 0.9)).normalize();
    u.uSun.value.copy(sunDir);
    this.sun.position.copy(sunDir).multiplyScalar(10000);
    this.sun.target.position.set(0, 0, 0);
    this.hemi.position.set(0, 1, 0);
    if (this.planet && this.planet.chunks) this.planet.update(cam.position, dt);
  }
}
const _c1 = new THREE.Color();
