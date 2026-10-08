import * as THREE from 'three';
import { R, clamp, headingDeg, fmtDist, tangentOf } from './util.js';

const C = {
  hud: 'rgba(214,236,222,0.92)', dim: 'rgba(214,236,222,0.45)', faint: 'rgba(214,236,222,0.18)',
  enemy: '#ff6d5e', ally: '#78b8ff', obj: '#ffd166', yellow: '#ffcc33', red: '#ff4436', good: '#8fe39a', panel: 'rgba(12,20,28,0.42)',
};
const FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4();

const KEY_LABEL = { primary: 'Space', secondary: 'F', target: 'R', counter: 'C', yawL: 'Q', yawR: 'E', throttle: 'Shift', brake: 'Z', weaponNext: 'Tab', weaponPrev: '1', camera: 'V', map: 'M', pause: 'Esc', assist: 'T' };

export class HUD {
  constructor(game, canvas) {
    this.game = game;
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.msgs = [];        // feed (top right)
    this.banner = null;    // big centre text
    this.hitT = 0; this.hitBig = false; this.dmgT = 0; this.dmgDir = null; this.flashT = 0; this.flashCol = C.yellow;
    this.resize();
  }
  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth; this.h = innerHeight;
    this.cv.width = this.w * dpr; this.cv.height = this.h * dpr;
    this.cv.style.width = this.w + 'px'; this.cv.style.height = this.h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.s = clamp(Math.min(this.w, this.h) / 820, 0.65, 1.5);
  }
  glyph(action) {
    const inp = this.game.input;
    if (inp.lastDevice === 'pad') return inp.bindLabel(inp.bind[action]);
    return KEY_LABEL[action] || action;
  }
  message(text, kind = 'info', dur = 2.5) {
    if (kind === 'kill' || kind === 'info' && dur < 0) { this.msgs.unshift({ text, kind, t: 4 }); if (this.msgs.length > 6) this.msgs.pop(); return; }
    if (this.banner && this.banner.text === text) { this.banner.t = dur; return; }
    this.banner = { text, kind, t: dur, max: dur };
  }
  feed(text, kind = 'kill') { this.msgs.unshift({ text, kind, t: 4.5 }); if (this.msgs.length > 6) this.msgs.pop(); }

  proj(p) {
    const cam = this.game.camera;
    _v.copy(p).project(cam);
    const behind = _v.z > 1;
    return { x: (_v.x * 0.5 + 0.5) * this.w, y: (-_v.y * 0.5 + 0.5) * this.h, behind, on: !behind && Math.abs(_v.x) < 1 && Math.abs(_v.y) < 1 };
  }
  // direction on screen toward a world point (works behind the camera)
  screenDir(p) {
    const cam = this.game.camera;
    _w.copy(p).applyMatrix4(cam.matrixWorldInverse);
    const a = Math.atan2(-_w.y, _w.x);
    return a;
  }

  text(t, x, y, size = 14, col = C.hud, align = 'center', weight = 600) {
    const c = this.ctx;
    c.font = `${weight} ${Math.round(size * this.s)}px ${FONT}`;
    c.textAlign = align; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillText(t, x + 1, y + 1);
    c.fillStyle = col;
    c.fillText(t, x, y);
  }
  panel(x, y, w, h) {
    const c = this.ctx;
    c.fillStyle = C.panel;
    c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, 6 * this.s) : c.rect(x, y, w, h); c.fill();
  }
  bar(x, y, w, h, f, col, bg = 'rgba(255,255,255,0.12)') {
    const c = this.ctx;
    c.fillStyle = bg; c.fillRect(x, y, w, h);
    c.fillStyle = col; c.fillRect(x, y, w * clamp(f, 0, 1), h);
  }

  draw(dt) {
    const c = this.ctx, g = this.game;
    c.clearRect(0, 0, this.w, this.h);
    if (g.state !== 'play' && g.state !== 'paused') return;
    const p = g.player;
    if (!p) return;
    this.hitT -= dt; this.dmgT -= dt; this.flashT -= dt;
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
    for (const m of this.msgs) m.t -= dt;
    this.msgs = this.msgs.filter((m) => m.t > 0);
    const ctl = g.controlled;
    const inMissile = ctl && ctl.cat === 'missile' && ctl.alive;

    this.drawMarkers(p, inMissile ? ctl : p);
    if (inMissile) this.drawMissileHUD(ctl, p);
    else if (!p.dying) this.drawVehicleHUD(p);
    this.drawThreats(p, inMissile ? ctl : null);
    this.drawMission();
    this.drawRadar(inMissile ? ctl : p, p);
    this.drawStatus(p, inMissile);
    this.drawFeed();
    this.drawBanner();
    if (!inMissile && !p.dying) this.drawWeapons(p);
    this.drawHints(p, inMissile);
    this.drawOverlays(p);
  }

  // ------------------------------------------------------------------ markers
  drawMarkers(p, viewer) {
    const g = this.game, c = this.ctx, s = this.s;
    const range = p.type === 'plane' || viewer.cat === 'missile' ? 4200 : 2600;
    for (const e of g.world.entities) {
      if (!e.alive || e.dying || e === p) continue;
      const d = e.pos.distanceTo(viewer.pos);
      if (d > range && e !== p.target && e.tag !== 'objective') continue;
      const pr = this.proj(e.pos);
      if (!pr.on) continue;
      const isT = e === p.target;
      if (e.faction === p.faction) {
        if (d > 2000) continue;
        c.strokeStyle = C.ally; c.lineWidth = 1.5;
        const z = 5 * s;
        c.beginPath(); c.moveTo(pr.x - z, pr.y - z * 1.6); c.lineTo(pr.x, pr.y - z * 0.6); c.lineTo(pr.x + z, pr.y - z * 1.6); c.stroke();
        if (e.tag === 'protect') this.text(e.name, pr.x, pr.y - z * 3, 11, C.ally);
        continue;
      }
      const sz = clamp(900 / Math.max(d, 1) * (e.radius + 1), 7, 34) * s;
      c.strokeStyle = isT ? C.enemy : 'rgba(255,109,94,0.8)';
      c.lineWidth = isT ? 2 : 1.3;
      const k = sz * 0.45;
      c.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        c.moveTo(pr.x + sx * sz, pr.y + sy * sz - sy * k); c.lineTo(pr.x + sx * sz, pr.y + sy * sz); c.lineTo(pr.x + sx * sz - sx * k, pr.y + sy * sz);
      }
      c.stroke();
      if (e.tag === 'objective') {
        c.fillStyle = C.obj;
        c.beginPath(); const y0 = pr.y - sz - 9 * s; c.moveTo(pr.x, y0 - 5 * s); c.lineTo(pr.x + 5 * s, y0); c.lineTo(pr.x, y0 + 5 * s); c.lineTo(pr.x - 5 * s, y0); c.fill();
      }
      if (isT || d < 900) {
        this.text((e.kind === 'ace' ? e.name : e.name) + '  ' + fmtDist(d), pr.x, pr.y + sz + 10 * s, isT ? 12 : 10, isT ? C.enemy : 'rgba(255,140,120,0.8)');
      }
      if (isT) {
        this.bar(pr.x - sz, pr.y - sz - 6 * s, sz * 2, 3 * s, e.hp / e.maxHp, C.enemy);
        if (p.lockT > 0 && !viewer.spec) {
          const f = clamp(p.lockT / 0.8, 0, 1);
          c.strokeStyle = f >= 1 ? C.enemy : 'rgba(255,109,94,0.6)';
          c.lineWidth = 2;
          c.beginPath(); c.arc(pr.x, pr.y, sz + 8 * s, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); c.stroke();
          if (f >= 1) this.text('LOCK', pr.x, pr.y - sz - 16 * s, 11, C.enemy, 'center', 800);
        }
        // gun lead pipper for aircraft
        if (p.type === 'plane' && viewer === p && d < 900) {
          const t = d / (p.role.primary.speed);
          const lead = _w.copy(e.pos).addScaledVector(e.vel, t).addScaledVector(p.vel, -t * 0.0);
          const lp = this.proj(lead);
          if (lp.on) {
            c.strokeStyle = C.hud; c.lineWidth = 1.5;
            c.beginPath(); c.arc(lp.x, lp.y, 6 * s, 0, Math.PI * 2); c.stroke();
            c.beginPath(); c.moveTo(pr.x, pr.y); c.lineTo(lp.x, lp.y); c.strokeStyle = C.faint; c.stroke();
          }
        }
      }
    }
    // off-screen arrow to target
    const t = p.target;
    if (t && t.alive) {
      const pr = this.proj(t.pos);
      if (!pr.on) this.edgeArrow(this.screenDir(t.pos), C.enemy, 'TGT ' + fmtDist(t.pos.distanceTo(viewer.pos)));
    }
    // mission waypoints
    const mk = g.mission ? g.mission.markers() : [];
    for (const m of mk) {
      const pr = this.proj(m.pos);
      const d = m.pos.distanceTo(viewer.pos);
      if (pr.on) {
        c.strokeStyle = m.color || C.obj; c.lineWidth = 2;
        const z = 8 * s;
        c.beginPath(); c.moveTo(pr.x, pr.y - z); c.lineTo(pr.x + z, pr.y); c.lineTo(pr.x, pr.y + z); c.lineTo(pr.x - z, pr.y); c.closePath(); c.stroke();
        this.text(m.label + '  ' + fmtDist(d), pr.x, pr.y + z + 9 * s, 11, m.color || C.obj);
      } else if (m.arrow !== false) this.edgeArrow(this.screenDir(m.pos), m.color || C.obj, m.label + ' ' + fmtDist(d));
    }
  }

  edgeArrow(ang, col, label) {
    const c = this.ctx, s = this.s;
    const rx = this.w * 0.42, ry = this.h * 0.4;
    const x = this.w / 2 + Math.cos(ang) * rx, y = this.h / 2 + Math.sin(ang) * ry;
    c.save(); c.translate(x, y); c.rotate(ang);
    c.fillStyle = col;
    c.beginPath(); c.moveTo(10 * s, 0); c.lineTo(-6 * s, -7 * s); c.lineTo(-6 * s, 7 * s); c.closePath(); c.fill();
    c.restore();
    if (label) this.text(label, x - Math.cos(ang) * 30 * s, y - Math.sin(ang) * 18 * s, 10, col);
  }

  // ------------------------------------------------------------------ vehicle HUD
  drawVehicleHUD(p) {
    const g = this.game, c = this.ctx, s = this.s, cx = this.w / 2, cy = this.h / 2;
    const up = p.pos.clone().normalize();
    const alt = g.planet.altitude(p.pos);
    c.lineWidth = 1.5;
    if (p.type === 'plane') {
      // nose / gun cross
      const nose = this.proj(_w.copy(p.pos).addScaledVector(p.forward(new THREE.Vector3()), 500));
      if (nose.on) {
        c.strokeStyle = C.hud;
        c.beginPath();
        c.moveTo(nose.x - 14 * s, nose.y); c.lineTo(nose.x - 5 * s, nose.y);
        c.moveTo(nose.x + 5 * s, nose.y); c.lineTo(nose.x + 14 * s, nose.y);
        c.moveTo(nose.x, nose.y - 5 * s); c.lineTo(nose.x, nose.y - 10 * s);
        c.stroke();
        c.beginPath(); c.arc(nose.x, nose.y, 2 * s, 0, Math.PI * 2); c.fillStyle = C.hud; c.fill();
      }
      // speed + altitude tapes
      this.tape(cx - 210 * s, cy, Math.round(p.speed * 10), 'SPD', p.speed > p.role.maxSpeed * 0.9 ? C.yellow : C.hud);
      this.tape(cx + 210 * s, cy, Math.round(alt), 'ALT', alt < 40 ? C.red : C.hud);
      const climb = p.vel.dot(up);
      this.text((climb >= 0 ? '▲ ' : '▼ ') + Math.abs(climb).toFixed(0), cx + 210 * s, cy + 28 * s, 10, C.dim);
      this.bar(cx - 230 * s, cy + 24 * s, 40 * s, 4 * s, p.throttleVis, C.yellow);
      this.text(p.throttleVis > 0.5 ? 'BOOST' : 'THR', cx - 210 * s, cy + 36 * s, 9, C.dim);
      if (p.pullUp && Math.floor(g.time * 4) % 2 === 0) this.text('PULL UP', cx, cy + 70 * s, 22, C.red, 'center', 800);
      if (p.stall) this.text('STALL — LOWER THE NOSE', cx, cy + 96 * s, 14, C.yellow, 'center', 700);
      // horizon ladder (subtle)
      this.horizon(p);
    } else {
      // crosshair at screen centre
      c.strokeStyle = C.hud;
      c.beginPath(); c.arc(cx, cy, 14 * s, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(cx, cy, 1.8 * s, 0, Math.PI * 2); c.fillStyle = C.hud; c.fill();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.beginPath(); c.moveTo(cx + dx * 18 * s, cy + dy * 18 * s); c.lineTo(cx + dx * 26 * s, cy + dy * 26 * s); c.stroke(); }
      if (g.aimEntity) { c.strokeStyle = C.enemy; c.beginPath(); c.arc(cx, cy, 18 * s, 0, Math.PI * 2); c.stroke(); }
      if (g.aimPoint) this.text(fmtDist(g.aimPoint.distanceTo(p.pos)), cx + 34 * s, cy + 14 * s, 10, C.dim, 'left');
      // turret alignment
      if (p.mesh.userData.turret && p.role.primary.kind === 'cannon') {
        const bt = this.proj(_w.copy(p.muzzlePos(new THREE.Vector3())).addScaledVector(p.barrelDir(new THREE.Vector3()), 300));
        if (bt.on && (p.turretErr || 0) > 0.03) {
          c.strokeStyle = C.dim; c.beginPath(); c.rect(bt.x - 4 * s, bt.y - 4 * s, 8 * s, 8 * s); c.stroke();
        }
        const rl = p.reload > 0 ? 1 - p.reload / p.role.primary.reload : 1;
        this.bar(cx - 20 * s, cy + 32 * s, 40 * s, 3 * s, rl, rl >= 1 ? C.good : C.yellow);
      }
      const sp = Math.abs(p.speed);
      this.text(Math.round(sp * 10) + ' km/h' + (p.type === 'ship' ? '   throttle ' + Math.round((p.shipThr ?? 0.4) * 100) + '%' : ''), cx, this.h - 120 * s, 12, C.dim);
      if (p.type === 'heli') {
        this.tape(cx + 200 * s, cy, Math.round(alt), 'ALT', alt < 8 ? C.yellow : C.hud);
        if (p.landed) this.text('LANDED', cx, cy + 50 * s, 12, C.dim);
      }
    }
    // compass
    this.compass(p.type === 'plane' ? p.forward(new THREE.Vector3()) : (p.camViewDir || p.hf), up);
  }

  tape(x, y, val, label, col) {
    const s = this.s;
    this.panel(x - 34 * s, y - 13 * s, 68 * s, 26 * s);
    this.text(String(val), x, y, 16, col, 'center', 700);
    this.text(label, x, y - 22 * s, 9, C.dim);
  }

  horizon(p) {
    const c = this.ctx;
    const up = p.pos.clone().normalize();
    const f = p.forward(new THREE.Vector3());
    const fl = tangentOf(up, f, new THREE.Vector3());
    const a = this.proj(_w.copy(p.pos).addScaledVector(fl, 400).addScaledVector(tangentOf(up, p.right(new THREE.Vector3()), new THREE.Vector3()), -120));
    const b = this.proj(_w.copy(p.pos).addScaledVector(fl, 400).addScaledVector(tangentOf(up, p.right(new THREE.Vector3()), new THREE.Vector3()), 120));
    if (a.on && b.on) {
      c.strokeStyle = C.faint; c.lineWidth = 1.2;
      c.setLineDash([10, 8]);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      c.setLineDash([]);
    }
  }

  compass(fwd, up) {
    const c = this.ctx, s = this.s, cx = this.w / 2, y = 26 * s;
    const hdg = headingDeg(up, fwd);
    const w = 320 * s;
    this.panel(cx - w / 2, y - 14 * s, w, 28 * s);
    c.save(); c.beginPath(); c.rect(cx - w / 2, y - 14 * s, w, 28 * s); c.clip();
    for (let d = -60; d <= 60; d += 5) {
      const deg = Math.round(hdg / 5) * 5 + d;
      const x = cx + (deg - hdg) * (w / 120);
      const dd = ((deg % 360) + 360) % 360;
      c.strokeStyle = C.dim; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y + 10 * s); c.lineTo(x, y + (dd % 15 === 0 ? 2 : 6) * s); c.stroke();
      if (dd % 45 === 0) this.text({ 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[dd], x, y - 4 * s, 11, dd % 90 === 0 ? C.hud : C.dim);
    }
    c.restore();
    this.text(String(Math.round(hdg)).padStart(3, '0'), cx, y + 24 * s, 11, C.hud, 'center', 700);
  }

  // ------------------------------------------------------------------ missile camera HUD
  drawMissileHUD(m, p) {
    const g = this.game, c = this.ctx, s = this.s, cx = this.w / 2, cy = this.h / 2;
    // seeker vignette
    const grd = c.createRadialGradient(cx, cy, Math.min(this.w, this.h) * 0.35, cx, cy, Math.max(this.w, this.h) * 0.7);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(5,12,10,0.55)');
    c.fillStyle = grd; c.fillRect(0, 0, this.w, this.h);
    c.strokeStyle = C.hud; c.lineWidth = 1.5;
    const z = 22 * s;
    c.beginPath();
    c.moveTo(cx - z * 2, cy); c.lineTo(cx - z * 0.5, cy); c.moveTo(cx + z * 0.5, cy); c.lineTo(cx + z * 2, cy);
    c.moveTo(cx, cy - z * 2); c.lineTo(cx, cy - z * 0.5); c.moveTo(cx, cy + z * 0.5); c.lineTo(cx, cy + z * 2);
    c.stroke();
    c.strokeStyle = C.dim; c.strokeRect(cx - z * 3, cy - z * 2, z * 6, z * 4);
    const alt = g.planet.altitude(m.pos);
    const spec = m.spec;
    this.text(spec.name + (m.mode === 'manual' ? '  —  MANUAL GUIDANCE' : ''), cx, 70 * s, 15, C.hud, 'center', 700);
    // fuel
    const fuelF = clamp(m.fuel / spec.fuel, 0, 1);
    this.panel(cx - 150 * s, this.h - 150 * s, 300 * s, 54 * s);
    this.text(spec.unpowered ? 'GLIDE' : 'FUEL', cx - 140 * s, this.h - 136 * s, 10, C.dim, 'left');
    this.bar(cx - 100 * s, this.h - 140 * s, 240 * s, 7 * s, fuelF, fuelF < 0.25 ? C.red : C.yellow);
    this.text('SPD ' + Math.round(m.speed * 10), cx - 140 * s, this.h - 114 * s, 12, C.hud, 'left');
    this.text('ALT ' + Math.round(alt), cx, this.h - 114 * s, 12, alt < 15 ? C.yellow : C.hud);
    if (m.target && m.target.alive) {
      const d = m.target.pos.distanceTo(m.pos);
      this.text('TGT ' + fmtDist(d) + '  ' + (d / Math.max(m.speed, 1)).toFixed(1) + 's', cx + 140 * s, this.h - 114 * s, 12, C.enemy, 'right');
    }
    if (m.boost) this.text('BOOST', cx, cy + z * 2.6, 12, C.yellow, 'center', 800);
    this.compass(m.dir, _v.copy(m.pos).normalize());
  }

  // ------------------------------------------------------------------ threats (Hogwarts-style)
  drawThreats(p, missile) {
    const g = this.game, c = this.ctx, s = this.s, cx = this.w / 2, cy = this.h / 2;
    const T = g.threats;
    let yellow = null, red = null;
    for (const t of T) {
      const ang = this.screenDir(t.m.pos);
      const col = t.color === 'red' ? C.red : C.yellow;
      // ring segment indicator
      const rad = 120 * s;
      const pulse = 0.6 + 0.4 * Math.sin(g.time * (t.tti < 2 ? 20 : 8));
      c.strokeStyle = col; c.globalAlpha = pulse; c.lineWidth = 6 * s;
      c.beginPath(); c.arc(cx, cy, rad, ang - 0.25, ang + 0.25); c.stroke();
      c.globalAlpha = 1;
      this.edgeArrow(ang, col, (t.color === 'red' ? 'EVADE ' : 'COUNTER ') + t.tti.toFixed(1) + 's');
      if (t.color === 'yellow' && t.onVehicle && (!yellow || t.tti < yellow.tti)) yellow = t;
      if (t.color === 'red' && (!red || t.tti < red.tti)) red = t;
    }
    const W = g.COUNTER_WINDOW;
    if (yellow && yellow.tti < 4) {
      // timing ring: outer ring shrinks to the inner ring; press when inside
      const inner = 34 * s, outer = inner + yellow.tti * 40 * s;
      const ready = yellow.tti <= W;
      c.lineWidth = 3 * s;
      c.strokeStyle = C.yellow; c.globalAlpha = 0.9;
      c.beginPath(); c.arc(cx, cy + 90 * s, inner, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = ready ? 1 : 0.55; c.lineWidth = (ready ? 4 : 2) * s;
      c.beginPath(); c.arc(cx, cy + 90 * s, outer, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 1;
      if (ready) {
        c.fillStyle = 'rgba(255,204,51,0.25)';
        c.beginPath(); c.arc(cx, cy + 90 * s, inner, 0, Math.PI * 2); c.fill();
      }
      const cd = p.counterCd > 0;
      this.text(cd ? 'RECHARGING' : this.glyph('counter'), cx, cy + 90 * s, ready ? 20 : 15, cd ? C.dim : C.yellow, 'center', 800);
      this.text(ready ? p.role.counter.name + ' NOW!' : 'INCOMING — WAIT FOR IT', cx, cy + 90 * s + inner + 18 * s, 13, C.yellow, 'center', 800);
    }
    if (red && red.tti < 5) {
      const pulse = Math.floor(g.time * 6) % 2 === 0;
      const ang = this.screenDir(red.m.pos);
      // suggest breaking perpendicular to the threat
      const side = Math.cos(ang) > 0 ? 'LEFT' : 'RIGHT';
      const what = red.zone ? 'ARTILLERY — MOVE OUT!' : red.m.spec.torpedo ? 'TORPEDO — TURN AWAY!' : 'RADAR MISSILE — EVADE!';
      this.text(what, cx, cy - 120 * s, 20, pulse ? C.red : '#ff8a7a', 'center', 800);
      const hint = red.zone ? 'Leave the red circle' : red.m.spec.torpedo ? 'Turn parallel to its track' : (red.tti < 1.6 ? 'BREAK ' + side + ' HARD NOW!' : 'Break hard when it gets close · fly low behind terrain');
      this.text(hint, cx, cy - 96 * s, 13, C.red, 'center', 700);
      // red vignette
      const grd = c.createRadialGradient(cx, cy, Math.min(this.w, this.h) * 0.4, cx, cy, Math.max(this.w, this.h) * 0.75);
      grd.addColorStop(0, 'rgba(255,40,30,0)'); grd.addColorStop(1, `rgba(255,40,30,${0.12 + (pulse ? 0.08 : 0)})`);
      c.fillStyle = grd; c.fillRect(0, 0, this.w, this.h);
    }
    // radar lock warnings
    const target = missile || p;
    let lock = 0;
    for (const l of g.locks) if (l.target === target || l.target === p) lock = Math.max(lock, l.p);
    if (lock > 0.05 && !T.length) {
      const flash = lock > 0.7 && Math.floor(g.time * 8) % 2 === 0;
      this.panel(cx - 70 * s, 54 * s, 140 * s, 22 * s);
      this.text(lock > 0.7 ? '⚠ LOCKED ON' : 'BEING TRACKED', cx, 65 * s, 12, flash ? C.red : C.yellow, 'center', 800);
      this.bar(cx - 60 * s, 79 * s, 120 * s, 3 * s, lock, C.red);
    }
  }

  // ------------------------------------------------------------------ panels
  drawMission() {
    const g = this.game, m = g.mission, s = this.s;
    if (!m) return;
    const lines = m.objectiveLines();
    const x = 16 * s, y = 16 * s, w = 300 * s, lh = 18 * s;
    this.panel(x, y, w, (34 + lines.length * 18) * s);
    this.text(m.title, x + 10 * s, y + 14 * s, 13, C.obj, 'left', 800);
    lines.forEach((l, i) => this.text((l.done ? '✔ ' : '▸ ') + l.text, x + 12 * s, y + 34 * s + i * lh, 12, l.done ? C.good : l.fail ? C.red : C.hud, 'left', 600));
    if (m.timeLeft != null) this.text('⏱ ' + Math.max(0, Math.ceil(m.timeLeft)) + 's', x + w - 10 * s, y + 14 * s, 12, m.timeLeft < 30 ? C.red : C.hud, 'right', 700);
  }

  drawRadar(viewer, p) {
    const g = this.game, c = this.ctx, s = this.s;
    const r = 70 * s, cx = 18 * s + r, cy = this.h - 18 * s - r;
    const range = p.type === 'plane' || viewer.cat === 'missile' ? 3000 : 1600;
    c.fillStyle = 'rgba(10,22,20,0.5)';
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = C.faint; c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, r * 0.5, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    const up = _v.copy(viewer.pos).normalize().clone();
    const fwd = tangentOf(up, viewer === p ? (p.type === 'plane' ? p.forward(new THREE.Vector3()) : (p.camViewDir || p.hf)) : viewer.dir, new THREE.Vector3());
    const rt = new THREE.Vector3().crossVectors(fwd, up);
    const plot = (pos, col, size, shape) => {
      const d = _w.subVectors(pos, viewer.pos);
      let x = d.dot(rt) / range * r, y = -d.dot(fwd) / range * r;
      const l = Math.hypot(x, y);
      if (l > r) { if (shape !== 'edge') return; x *= r / l; y *= r / l; }
      c.fillStyle = col;
      if (shape === 'tri') { c.beginPath(); c.moveTo(cx + x, cy + y - size); c.lineTo(cx + x + size, cy + y + size); c.lineTo(cx + x - size, cy + y + size); c.fill(); }
      else c.fillRect(cx + x - size / 2, cy + y - size / 2, size, size);
    };
    for (const e of g.world.entities) {
      if (!e.alive || e.dying || e === p) continue;
      const col = e.faction === p.faction ? C.ally : e.tag === 'objective' ? C.obj : C.enemy;
      plot(e.pos, col, (e.cat === 'air' ? 4 : 3.5) * s, e.cat === 'air' ? 'tri' : 'sq');
    }
    for (const m of g.world.missiles) if (m.alive) plot(m.pos, m.faction === p.faction ? '#ffffff' : (Math.floor(g.time * 8) % 2 ? C.red : C.yellow), 2.5 * s);
    if (g.mission) for (const mk of g.mission.markers()) plot(mk.pos, C.obj, 5 * s, 'edge');
    if (viewer !== p) plot(p.pos, C.ally, 5 * s, 'edge');
    c.fillStyle = C.hud;
    c.beginPath(); c.moveTo(cx, cy - 5 * s); c.lineTo(cx + 4 * s, cy + 4 * s); c.lineTo(cx - 4 * s, cy + 4 * s); c.fill();
    this.text(fmtDist(range), cx + r - 4 * s, cy - r + 6 * s, 9, C.dim, 'right');
  }

  drawStatus(p, inMissile) {
    const g = this.game, s = this.s;
    const x = 18 * s + 150 * s, y = this.h - 70 * s;
    this.panel(x, y - 16 * s, 190 * s, 60 * s);
    this.text(p.role.name.toUpperCase(), x + 10 * s, y - 4 * s, 11, C.dim, 'left', 700);
    const hpf = p.hp / p.maxHp;
    this.bar(x + 10 * s, y + 8 * s, 170 * s, 7 * s, hpf, hpf > 0.5 ? C.good : hpf > 0.25 ? C.yellow : C.red);
    this.text('HULL ' + Math.round(hpf * 100) + '%', x + 10 * s, y + 26 * s, 10, C.hud, 'left');
    if (p.type === 'plane') this.text('ASSIST ' + (p.assist ? 'ON' : 'OFF') + ' [' + this.glyph('assist') + ']', x + 180 * s, y + 26 * s, 9, C.dim, 'right');
    if (inMissile) {
      const under = g.threats.some((t) => t.onVehicle);
      if (under && Math.floor(g.time * 4) % 2 === 0) this.text('YOUR VEHICLE IS UNDER ATTACK', x + 95 * s, y - 28 * s, 12, C.red, 'center', 800);
    }
    // score / lives (top right)
    const rx = this.w - 16 * s;
    this.text('SCORE ' + g.score, rx, 22 * s, 14, C.hud, 'right', 800);
    if (g.mission) this.text('LIVES ' + '■'.repeat(Math.max(0, g.lives)), rx, 42 * s, 11, C.dim, 'right');
  }

  drawWeapons(p) {
    const s = this.s, g = this.game;
    const w = 210 * s, x = this.w - 16 * s - w, y = this.h - 16 * s - (40 + p.secs.length * 20) * s;
    this.panel(x, y, w, (40 + p.secs.length * 20) * s);
    const P = p.role.primary;
    const heat = P.kind === 'gun' ? (p.overheat ? 'OVERHEAT' : '') : (p.reload > 0 ? 'RELOAD' : 'READY');
    this.text(P.name + ' [' + this.glyph('primary') + ']', x + 10 * s, y + 13 * s, 12, C.hud, 'left', 700);
    if (P.kind === 'gun') this.bar(x + 120 * s, y + 10 * s, 80 * s, 5 * s, p.gunHeat, p.overheat ? C.red : C.yellow);
    else this.text(heat, x + w - 10 * s, y + 13 * s, 11, p.reload > 0 ? C.yellow : C.good, 'right');
    p.secs.forEach((sc, i) => {
      const yy = y + 33 * s + i * 20 * s;
      const sel = i === p.secIdx;
      if (sel) { this.ctx.fillStyle = 'rgba(255,209,102,0.15)'; this.ctx.fillRect(x + 4 * s, yy - 9 * s, w - 8 * s, 18 * s); }
      this.text((sel ? '▶ ' : '   ') + sc.name + (sel ? ' [' + this.glyph('secondary') + ']' : ''), x + 10 * s, yy, 12, sel ? C.obj : C.dim, 'left', sel ? 700 : 500);
      this.text(sc.ammo + '/' + sc.max, x + w - 10 * s, yy, 12, sc.ammo ? (sel ? C.obj : C.dim) : C.red, 'right');
    });
    // counter charge
    const cd = clamp(p.counterCd / p.role.counter.cd, 0, 1);
    const cx = x - 34 * s, cy = this.h - 50 * s, rr = 22 * s, c = this.ctx;
    c.fillStyle = C.panel; c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI * 2); c.fill();
    c.strokeStyle = cd > 0 ? C.dim : C.yellow; c.lineWidth = 3 * s;
    c.beginPath(); c.arc(cx, cy, rr - 2 * s, -Math.PI / 2, -Math.PI / 2 + (1 - cd) * Math.PI * 2); c.stroke();
    this.text(this.glyph('counter'), cx, cy - 2 * s, 13, cd > 0 ? C.dim : C.yellow, 'center', 800);
    this.text(p.role.counter.name, cx, cy + rr + 9 * s, 9, C.dim);
  }

  drawFeed() {
    const s = this.s;
    this.msgs.forEach((m, i) => {
      const a = clamp(m.t, 0, 1);
      this.ctx.globalAlpha = a;
      this.text(m.text, this.w - 16 * s, 68 * s + i * 18 * s, 12, m.kind === 'kill' ? C.good : m.kind === 'bad' ? C.red : C.hud, 'right', 600);
      this.ctx.globalAlpha = 1;
    });
  }

  drawBanner() {
    const b = this.banner;
    if (!b) return;
    const s = this.s;
    const col = { good: C.good, warn: C.yellow, bad: C.red, info: C.hud, obj: C.obj }[b.kind] || C.hud;
    const a = clamp(b.t / 0.4, 0, 1);
    this.ctx.globalAlpha = a;
    this.text(b.text, this.w / 2, this.h * 0.3, b.kind === 'good' ? 24 : 17, col, 'center', 800);
    this.ctx.globalAlpha = 1;
  }

  drawHints(p, inMissile) {
    const g = this.game, s = this.s;
    let t;
    const G = (a) => this.glyph(a);
    if (inMissile) t = `${g.input.lastDevice === 'pad' ? 'L-Stick' : 'W/A/S/D'} steer · ${G('throttle')} boost · ${G('brake')} fine aim · ${G('target')} release (auto-guide) · ${G('secondary')} detonate · ${G('counter')} counter`;
    else if (g.showHints > 0) {
      const pad = g.input.lastDevice === 'pad';
      if (p.type === 'plane') t = `${pad ? 'L-Stick' : 'W/S/A/D'} pitch/roll · ${G('yawL')}/${G('yawR')} rudder · ${G('throttle')} boost · ${G('brake')} brake · ${G('primary')} guns · ${G('secondary')} missile · ${G('target')} target · ${G('counter')} counter`;
      else if (p.type === 'heli') t = `${pad ? 'L-Stick' : 'W/A/S/D'} fly · ${pad ? 'R-Stick' : 'Mouse/Arrows'} aim & turn · ${G('throttle')}/${G('brake')} up/down · ${G('primary')} gun · ${G('secondary')} weapon · ${G('counter')} counter`;
      else t = `${pad ? 'L-Stick' : 'W/A/S/D'} drive · ${pad ? 'R-Stick' : 'Mouse/Arrows'} aim · ${G('primary')} fire · ${G('secondary')} guided weapon · ${G('target')} target · ${G('counter')} counter`;
    }
    if (t) this.text(t, this.w / 2, this.h - 14 * s, 11, C.dim, 'center', 500);
  }

  drawOverlays(p) {
    const g = this.game, c = this.ctx, s = this.s;
    if (this.hitT > 0) {
      const cx = this.w / 2, cy = this.h / 2, z = (this.hitBig ? 14 : 8) * s;
      c.strokeStyle = this.hitBig ? C.enemy : C.hud; c.lineWidth = 2;
      c.beginPath();
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.moveTo(cx + a * z, cy + b * z); c.lineTo(cx + a * z * 0.4, cy + b * z * 0.4); }
      c.stroke();
    }
    if (this.dmgT > 0) {
      const a = clamp(this.dmgT, 0, 0.6);
      const grd = c.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.3, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.7);
      grd.addColorStop(0, 'rgba(200,20,10,0)'); grd.addColorStop(1, `rgba(200,20,10,${a * 0.6})`);
      c.fillStyle = grd; c.fillRect(0, 0, this.w, this.h);
      if (this.dmgDir != null) {
        c.strokeStyle = `rgba(255,70,50,${a * 1.4})`; c.lineWidth = 8 * s;
        c.beginPath(); c.arc(this.w / 2, this.h / 2, 150 * s, this.dmgDir - 0.35, this.dmgDir + 0.35); c.stroke();
      }
    }
    if (this.flashT > 0) {
      c.fillStyle = this.flashCol; c.globalAlpha = clamp(this.flashT, 0, 0.3);
      c.fillRect(0, 0, this.w, this.h); c.globalAlpha = 1;
    }
    if (p.hp / p.maxHp < 0.25 && !p.dying) {
      c.fillStyle = `rgba(160,0,0,${0.08 + 0.05 * Math.sin(g.time * 6)})`; c.fillRect(0, 0, this.w, this.h);
    }
    if (p.dying && g.downT > 1.5) {
      this.panel(this.w / 2 - 190 * s, this.h / 2 - 50 * s, 380 * s, 100 * s);
      this.text('VEHICLE DESTROYED', this.w / 2, this.h / 2 - 22 * s, 22, C.red, 'center', 800);
      if (g.lives > 0) this.text(`Press ${g.input.lastDevice === 'pad' ? 'A' : 'Space'} to redeploy (${g.lives} left)`, this.w / 2, this.h / 2 + 14 * s, 14, C.hud);
      else this.text('No redeploys left', this.w / 2, this.h / 2 + 14 * s, 14, C.hud);
    }
  }

  damageFrom(srcPos) {
    this.dmgT = 0.6;
    this.dmgDir = srcPos ? this.screenDir(srcPos) : null;
  }
}
