import { ROLES, MISSILES } from './data.js';
import { ACTIONS } from './input.js';
import { generateMissions } from './missions.js';
import { FACTIONS } from './campaign.js';

const ICON = { jet: '✈', striker: '⛟', heli: '🚁', tank: '▣', destroyer: '⚓', launcher: '☄' };
function lockPointer() {
  try {
    const r = document.getElementById('game').requestPointerLock?.();
    if (r && r.catch) r.catch(() => {});
  } catch (e) { /* needs a user gesture; ignore */ }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class UI {
  constructor(game) {
    this.g = game;
    this.root = document.getElementById('ui');
    this.items = []; this.focus = 0; this.back = null; this.capture = null; this.screen = '';
    this.root.addEventListener('mousemove', (e) => {
      const el = e.target.closest('[data-nav]');
      if (el) { const i = this.items.indexOf(el); if (i >= 0 && i !== this.focus) this.setFocus(i); }
    });
    document.getElementById('game').addEventListener('click', () => {
      if (this.g.state === 'play' && !document.pointerLockElement) lockPointer();
    });
  }

  show(name, html, back) {
    this.screen = name;
    this.root.innerHTML = html;
    this.root.classList.add('show');
    this.back = back || null;
    this.items = [...this.root.querySelectorAll('[data-nav]')];
    this.setFocus(0);
    this.g.input.menu(0); // swallow the press that opened this screen
  }
  hide() { this.root.classList.remove('show'); this.root.innerHTML = ''; this.items = []; this.screen = ''; }
  setFocus(i) {
    if (!this.items.length) return;
    this.items.forEach((el) => el.classList.remove('focus'));
    this.focus = (i + this.items.length) % this.items.length;
    const el = this.items[this.focus];
    el.classList.add('focus');
    el.scrollIntoView?.({ block: 'nearest' });
    if (el.dataset.hover) this.onHover?.(el);
  }
  move(dir) {
    const cur = this.items[this.focus];
    if (!cur) return;
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = -1, bs = 1e9;
    this.items.forEach((el, i) => {
      if (i === this.focus) return;
      const b = el.getBoundingClientRect();
      const dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
      const along = { up: -dy, down: dy, left: -dx, right: dx }[dir];
      const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (along <= 4) return;
      const s = along + across * 2.2;
      if (s < bs) { bs = s; best = i; }
    });
    if (best >= 0) { this.setFocus(best); this.g.audio.ui(); }
    else if (dir === 'down' || dir === 'right') { this.setFocus(this.focus + 1); this.g.audio.ui(); }
    else { this.setFocus(this.focus - 1); this.g.audio.ui(); }
  }

  frame(dt) {
    const g = this.g;
    if (this.capture) return this.captureFrame(dt);
    if (this.screen === 'controls') this.updatePadTest();
    if (this.screen === 'title') this.updatePadStatus();
    if (g.state === 'play') return;
    const nav = g.input.menu(dt);
    if (!nav) return;
    g.audio.init();
    if (nav === 'ok') { const el = this.items[this.focus]; if (el) { g.audio.ui(); el.click(); } }
    else if (nav === 'back' || nav === 'start') { if (nav === 'start' && this.screen === 'pause') this.items[0]?.click(); else if (this.back) { g.audio.ui(); this.back(); } }
    else this.move(nav);
  }

  bind(map) {
    for (const el of this.root.querySelectorAll('[data-act]')) {
      const fn = map[el.dataset.act];
      if (fn) el.addEventListener('click', (e) => { e.stopPropagation(); this.g.audio.init(); fn(el); });
    }
  }

  // ------------------------------------------------------------------ screens
  showLoading(text) {
    this.show('loading', `<div class="panel center"><h1 class="logo">SKYFRONT</h1><p class="sub">${esc(text)}</p><div class="spinner"></div></div>`);
  }

  showTitle() {
    const camp = this.g.campaign;
    const blue = camp.regions.filter((r) => r.owner === 0).length;
    this.show('title', `
      <div class="panel title">
        <h1 class="logo">SKYFRONT</h1>
        <p class="sub">GLOBAL CONFLICT</p>
        <div class="menu">
          <button data-nav data-act="campaign">Campaign · War Map <span class="hint">${blue}/${camp.regions.length} regions free</span></button>
          <button data-nav data-act="open">Open War <span class="hint">endless free play</span></button>
          <button data-nav data-act="controls">Controls & Controller</button>
          <button data-nav data-act="settings">Settings</button>
        </div>
        <div class="padstatus" id="padstatus"></div>
        <p class="tips">Yellow warning = press <b>COUNTER</b> at the right moment · Red warning = <b>evade</b> (break turn / move out)</p>
      </div>`);
    this.bind({
      campaign: () => this.showRoles('campaign'),
      open: () => this.showRoles('open'),
      controls: () => this.showControls(() => this.showTitle()),
      settings: () => this.showSettings(),
    });
    this.updatePadStatus();
  }
  updatePadStatus() {
    const el = document.getElementById('padstatus');
    if (!el) return;
    const n = this.g.input.padName;
    const txt = n ? `🎮 Controller ready: ${esc(n.slice(0, 48))}` : '🎮 No controller detected — connect it and press any button (keyboard & mouse also work)';
    if (el.textContent !== txt) el.textContent = txt;
  }

  showRoles(mode) {
    const cards = Object.entries(ROLES).map(([k, r]) => {
      const stats = Object.entries(r.stats).map(([n, v]) => `<div class="stat"><span>${n}</span><i style="--v:${v / 5}"></i></div>`).join('');
      const w = [r.primary.name, ...r.secondaries.map((s) => s.name || MISSILES[s.spec].name)].join(' · ');
      return `<button class="card" data-nav data-act="pick" data-role="${k}">
        <div class="icon">${ICON[k]}</div><h3>${esc(r.name)}</h3><p>${esc(r.desc)}</p>${stats}<p class="weap">${esc(w)}</p></button>`;
    }).join('');
    this.show('roles', `<div class="panel wide"><h2>Choose your role</h2><div class="cards">${cards}</div>
      <div class="row"><button data-nav data-act="back">◂ Back</button></div></div>`, () => this.showTitle());
    this.bind({
      pick: (el) => { const k = el.dataset.role; if (mode === 'campaign') this.showMissions(k); else this.deploy(k, null); },
      back: () => this.showTitle(),
    });
  }

  showMissions(roleKey, defs) {
    const g = this.g;
    defs = defs || generateMissions(g, roleKey, 4);
    this.missionDefs = defs;
    const list = defs.map((d, i) => `<button class="mission" data-nav data-hover="1" data-act="go" data-i="${i}">
        <div class="mtitle"><span class="num">${i + 1}</span> ${d.icon} ${esc(d.typeName)} <span class="hint">${esc(d.regionName)}</span></div>
        <div class="mop">${esc(d.title)}</div><p>${esc(d.brief)}</p></button>`).join('') || '<p>No missions available for this role right now. Try another role or reroll.</p>';
    const blue = g.campaign.regions.filter((r) => r.owner === 0).length;
    this.show('missions', `<div class="panel wide">
      <h2>${ICON[roleKey]} ${esc(ROLES[roleKey].name)} — War Map <span class="hint">${FACTIONS[0]} holds ${blue}/${g.campaign.regions.length} regions</span></h2>
      <div class="mapwrap"><canvas id="warmap" width="720" height="360"></canvas><div class="legend"><span class="b">■ ${FACTIONS[0]}</span> <span class="r">■ ${FACTIONS[1]}</span> <span class="o">◆ mission</span></div></div>
      <div class="mlist">${list}</div>
      <div class="row"><button data-nav data-act="back">◂ Roles</button><button data-nav data-act="reroll">↻ New missions</button></div></div>`, () => this.showRoles('campaign'));
    this.bind({
      go: (el) => this.deploy(roleKey, defs[+el.dataset.i]),
      back: () => this.showRoles('campaign'),
      reroll: () => this.showMissions(roleKey),
    });
    this.onHover = (el) => this.drawMap(+el.dataset.i);
    this.drawMap(0);
  }

  drawMap(sel = -1) {
    const g = this.g, cv = document.getElementById('warmap');
    if (!cv) return;
    const c = cv.getContext('2d'), W = cv.width, H = cv.height;
    c.drawImage(g.mapImg, 0, 0, W, H);
    const camp = g.campaign, im = camp.idMap;
    const sx = W / im.w, sy = H / im.h;
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
      const id = im.ids[y * im.w + x];
      const own = camp.regions[id].owner;
      c.fillStyle = own === 0 ? 'rgba(90,150,230,0.20)' : 'rgba(230,90,70,0.20)';
      c.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      const r = im.ids[y * im.w + (x + 1) % im.w], d = y + 1 < im.h ? im.ids[(y + 1) * im.w + x] : id;
      if (r !== id || d !== id) { c.fillStyle = 'rgba(20,20,20,0.55)'; c.fillRect(x * sx + (r !== id ? sx - 1 : 0), y * sy + (d !== id ? sy - 1 : 0), r !== id ? 1.5 : sx, d !== id ? 1.5 : sy); }
    }
    const toXY = (v) => { const lat = Math.asin(Math.max(-1, Math.min(1, v.y / v.length()))), lon = Math.atan2(v.z, v.x); return [(lon + Math.PI) / (2 * Math.PI) * W, (0.5 - lat / Math.PI) * H]; };
    c.font = '600 11px "Segoe UI", Arial'; c.textAlign = 'center';
    for (const r of camp.regions) {
      const [x, y] = toXY(r.dir);
      c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillText(r.name, x + 1, y + 1);
      c.fillStyle = r.owner === 0 ? '#cfe3ff' : '#ffd6cc'; c.fillText(r.name, x, y);
      c.fillStyle = r.owner === 0 ? '#9cc3ff' : '#ff9d8a'; c.fillText('●'.repeat(Math.max(0, r.strength)), x, y + 12);
    }
    (this.missionDefs || []).forEach((d, i) => {
      const [x, y] = toXY(d.site);
      c.beginPath(); c.moveTo(x, y - 9); c.lineTo(x + 9, y); c.lineTo(x, y + 9); c.lineTo(x - 9, y); c.closePath();
      c.fillStyle = i === sel ? '#ffd166' : 'rgba(255,209,102,0.55)'; c.fill();
      c.strokeStyle = '#1c1c1c'; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = '#1c1c1c'; c.font = '800 10px Arial'; c.fillText(String(i + 1), x, y + 3.5);
    });
  }

  deploy(roleKey, def) {
    this.lastRole = roleKey; this.lastDef = def;
    this.hide();
    this.g.startMission(roleKey, def);
    lockPointer();
  }

  showPause(info) {
    const g = this.g;
    g.state = 'paused';
    if (document.pointerLockElement) document.exitPointerLock();
    const m = g.mission;
    const obj = m ? m.objectiveLines().map((l) => `<li class="${l.done ? 'done' : ''}">${esc(l.text)}</li>`).join('') : '<li>Destroy as many enemies as you can. Enemies keep coming.</li>';
    this.show('pause', `<div class="panel">
      <h2>${info ? 'Mission Info' : 'Paused'}</h2>
      <h3 class="mop">${esc(m ? m.title : 'Open War')}</h3>
      ${m ? `<p>${esc(m.def.brief)}</p>` : ''}
      <ul class="obj">${obj}</ul>
      <p class="hint">Score ${g.score} · Kills ${g.kills} · Redeploys left ${g.lives}</p>
      <div class="menu">
        <button data-nav data-act="resume">Resume</button>
        <button data-nav data-act="controls">Controls</button>
        <button data-nav data-act="restart">Restart mission</button>
        <button data-nav data-act="abort">Abort to menu</button>
      </div></div>`, () => this.resume());
    this.bind({
      resume: () => this.resume(),
      controls: () => this.showControls(() => this.showPause(info)),
      restart: () => this.deploy(this.lastRole, this.lastDef),
      abort: () => { g.abort(); this.showTitle(); },
    });
  }
  resume() {
    this.hide();
    this.g.state = 'play';
    this.g.input.poll(); this.g.input.poll(); // swallow the button that closed the menu
    lockPointer();
  }

  showDebrief(r) {
    const g = this.g;
    const mins = Math.floor(r.time / 60), secs = Math.floor(r.time % 60);
    this.show('debrief', `<div class="panel">
      <h1 class="${r.success ? 'win' : 'lose'}">${r.openWar ? 'GAME OVER' : r.success ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'}</h1>
      <h3 class="mop">${esc(r.title)}</h3>
      ${r.reason ? `<p>${esc(r.reason)}</p>` : ''}
      <div class="stats"><div><b>${r.score}</b><span>score</span></div><div><b>${r.kills}</b><span>kills</span></div><div><b>${mins}:${String(secs).padStart(2, '0')}</b><span>time</span></div></div>
      ${r.news.length ? `<h3>War report</h3><ul class="obj">${r.news.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <div class="menu">
        <button data-nav data-act="next">${r.openWar ? 'Back to menu' : 'Continue to war map'}</button>
        <button data-nav data-act="retry">Retry</button>
      </div></div>`, () => this.showTitle());
    this.bind({
      next: () => { g.abort(); if (r.openWar || !this.lastRole) this.showTitle(); else this.showMissions(this.lastRole); },
      retry: () => this.deploy(this.lastRole, this.lastDef),
    });
  }

  showControls(back) {
    const inp = this.g.input;
    const rows = ACTIONS.map(([a, label]) => `<tr><td>${esc(label)}</td><td><button class="small" data-nav data-act="remap" data-a="${a}">${esc(inp.bindLabel(inp.bind[a]))}</button></td></tr>`).join('');
    const S = inp.settings;
    this.show('controls', `<div class="panel wide">
      <h2>Controls & Controller</h2>
      <div class="cols">
        <div>
          <h3>Controller buttons <span class="hint">select one to remap</span></h3>
          <table class="binds">${rows}</table>
        </div>
        <div>
          <h3>Sticks</h3>
          <p class="hint">Left stick: fly / drive · Right stick: look & aim (helicopter, tank, ship turn toward where you aim)</p>
          <div class="toggles">
            <button data-nav data-act="invp">Invert pitch: <b>${S.invertPitch ? 'ON' : 'OFF'}</b></button>
            <button data-nav data-act="invl">Invert look: <b>${S.invertLook ? 'ON' : 'OFF'}</b></button>
            <button data-nav data-act="dz">Deadzone: <b>${Math.round(S.deadzone * 100)}%</b></button>
            <button data-nav data-act="expo">Stick curve: <b>${Math.round(S.expo * 100)}%</b></button>
            <button data-nav data-act="sens">Look speed: <b>${S.sens.toFixed(1)}×</b></button>
            <button data-nav data-act="rumble">Vibration: <b>${inp.rumbleOn ? 'ON' : 'OFF'}</b></button>
            <button data-nav data-act="reset">Reset to defaults</button>
          </div>
          <h3>Controller test</h3>
          <div id="padtest" class="padtest"></div>
          <h3>Keyboard & mouse</h3>
          <p class="hint">Air: W/S pitch · A/D roll · Q/E rudder · Shift boost · Z brake · Space guns · F guided weapon · R target · C counter · Tab weapon · V camera · T assist<br>
          Ground/sea/heli: W/S/A/D move · Mouse aim (click to lock pointer) · Shift/Z up/down (heli)<br>
          Missile cam: W/S/A/D steer · Shift boost · Z fine aim · R release to auto-guide · F detonate</p>
        </div>
      </div>
      <div class="row"><button data-nav data-act="back">◂ Back</button></div></div>`, back);
    const redraw = () => this.showControls(back);
    const step = (v, a, b, d) => { v += d; if (v > b + 1e-6) v = a; return Math.round(v * 100) / 100; };
    this.bind({
      remap: (el) => this.startCapture(el.dataset.a, redraw),
      invp: () => { S.invertPitch = !S.invertPitch; inp.save(); redraw(); },
      invl: () => { S.invertLook = !S.invertLook; inp.save(); redraw(); },
      dz: () => { S.deadzone = step(S.deadzone, 0.05, 0.3, 0.03); inp.save(); redraw(); },
      expo: () => { S.expo = step(S.expo, 0, 0.8, 0.1); inp.save(); redraw(); },
      sens: () => { S.sens = step(S.sens, 0.5, 2, 0.25); inp.save(); redraw(); },
      rumble: () => { inp.rumbleOn = !inp.rumbleOn; redraw(); },
      reset: () => { inp.resetBindings(); Object.assign(S, { deadzone: 0.14, expo: 0.35, invertPitch: false, invertLook: false, sens: 1 }); inp.save(); redraw(); },
      back: () => back(),
    });
  }
  updatePadTest() {
    const el = document.getElementById('padtest');
    if (!el) return;
    const pad = this.g.input.pad;
    if (!pad) { el.textContent = 'No controller detected. Press a button on it.'; return; }
    const ax = pad.axes.map((a, i) => `A${i}:${a.toFixed(2)}`).join('  ');
    const bt = pad.buttons.map((b, i) => (b.pressed || b.value > 0.3) ? this.g.input.bindLabel({ t: 'b', i }) : '').filter(Boolean).join(' ');
    const txt = `${pad.id.slice(0, 40)} · mapping: ${pad.mapping || 'non-standard'}\n${ax}\nPressed: ${bt || '—'}`;
    if (el.textContent !== txt) el.textContent = txt;
  }
  startCapture(action, done) {
    const inp = this.g.input;
    this.capture = { action, done, rest: inp.snapshot(), t: 6, armed: false };
    const label = ACTIONS.find((a) => a[0] === action)[1];
    const ov = document.createElement('div');
    ov.className = 'capture';
    ov.innerHTML = `<div class="panel center"><h2>Remap</h2><p>${esc(label)}</p><p class="big">Press a controller button or trigger…</p><p class="hint" id="capt">6</p></div>`;
    this.root.appendChild(ov);
  }
  captureFrame(dt) {
    const c = this.capture, inp = this.g.input;
    c.t -= dt;
    const el = document.getElementById('capt');
    if (el) el.textContent = Math.ceil(c.t) + 's (Esc to cancel)';
    // wait until everything that was held is released before listening
    if (!c.armed) {
      const s = inp.snapshot();
      if (!s.buttons.some((b) => b)) { c.armed = true; c.rest = s; }
    } else {
      const b = inp.captureBinding(c.rest);
      if (b) { inp.bind[c.action] = b; inp.save(); this.capture = null; this.g.audio.ui(); c.done(); return; }
    }
    if (c.t <= 0 || inp.keys.has('Escape')) { this.capture = null; c.done(); }
  }

  showSettings() {
    const g = this.g, S = g.settings;
    this.show('settings', `<div class="panel">
      <h2>Settings</h2>
      <div class="menu">
        <button data-nav data-act="vol">Volume: <b>${Math.round(S.volume * 100)}%</b></button>
        <button data-nav data-act="q">Graphics quality: <b>${S.quality}</b></button>
        <button data-nav data-act="win">Counter timing window: <b>${g.COUNTER_WINDOW.toFixed(1)} s</b></button>
        <button data-nav data-act="resetc">Reset campaign progress</button>
        <button data-nav data-act="back">◂ Back</button>
      </div>
      <p class="hint">Lower quality renders at a lower resolution for smoother frame rates on laptops.</p></div>`, () => this.showTitle());
    this.bind({
      vol: () => { S.volume = S.volume >= 1 ? 0 : Math.round((S.volume + 0.1) * 10) / 10; g.audio.setVolume(S.volume); g.saveSettings(); this.showSettings(); },
      q: () => { S.quality = { low: 'medium', medium: 'high', high: 'low' }[S.quality]; g.applyQuality(); g.saveSettings(); this.showSettings(); },
      win: () => { g.COUNTER_WINDOW = g.COUNTER_WINDOW >= 2.2 ? 1.0 : Math.round((g.COUNTER_WINDOW + 0.3) * 10) / 10; this.showSettings(); },
      resetc: () => { if (confirm('Reset the whole campaign?')) g.campaign.reset(); },
      back: () => this.showTitle(),
    });
  }
}
