import { clamp } from './util.js';

// Unified gamepad + keyboard/mouse input with remappable controller bindings.
// Standard (XInput) layout indices.
export const BTN_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-Up', 'D-Down', 'D-Left', 'D-Right', 'Home'];

export const ACTIONS = [
  ['primary', 'Fire guns / cannon'],
  ['secondary', 'Launch guided weapon (you steer it)'],
  ['target', 'Next target  /  release missile to auto-guide'],
  ['counter', 'COUNTER (flares / smoke / CIWS) on YELLOW threats'],
  ['yawL', 'Rudder left (air)'],
  ['yawR', 'Rudder right (air)'],
  ['throttle', 'Throttle / climb'],
  ['brake', 'Brake / descend'],
  ['weaponPrev', 'Previous special weapon'],
  ['weaponNext', 'Next special weapon'],
  ['camera', 'Camera view'],
  ['assist', 'Toggle flight assist'],
  ['map', 'Mission info / map'],
  ['pause', 'Pause'],
];

const DEFAULT_BIND = {
  primary: { t: 'b', i: 0 }, secondary: { t: 'b', i: 1 }, target: { t: 'b', i: 2 }, counter: { t: 'b', i: 3 },
  yawL: { t: 'b', i: 4 }, yawR: { t: 'b', i: 5 }, brake: { t: 'b', i: 6 }, throttle: { t: 'b', i: 7 },
  map: { t: 'b', i: 8 }, pause: { t: 'b', i: 9 }, assist: { t: 'b', i: 10 }, camera: { t: 'b', i: 12 },
  weaponPrev: { t: 'b', i: 14 }, weaponNext: { t: 'b', i: 15 },
};
const DEFAULT_AXES = { lx: { i: 0, inv: false }, ly: { i: 1, inv: false }, rx: { i: 2, inv: false }, ry: { i: 3, inv: false } };

const KEYS = {
  primary: ['Space'], secondary: ['KeyF'], target: ['KeyR'], counter: ['KeyC'],
  yawL: ['KeyQ'], yawR: ['KeyE'], throttle: ['ShiftLeft', 'ShiftRight'], brake: ['KeyZ'],
  weaponPrev: ['Digit1'], weaponNext: ['Tab', 'Digit2'], camera: ['KeyV'], assist: ['KeyT'], map: ['KeyM'], pause: ['Escape', 'KeyP'],
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.prev = {}; this.cur = {};
    this.mouse = { dx: 0, dy: 0, l: false, r: false, locked: false };
    this.settings = { deadzone: 0.14, expo: 0.35, invertPitch: false, invertLook: false, sens: 1, mouseSens: 1 };
    this.bind = { ...DEFAULT_BIND }; this.axes = JSON.parse(JSON.stringify(DEFAULT_AXES));
    this.load();
    this.padName = '';
    this.padIndex = -1;
    this.lastDevice = 'keyboard';
    this.menuRepeat = { dir: null, t: 0 };
    this.rumbleOn = true;
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code); this.lastDevice = 'keyboard';
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    addEventListener('mousedown', (e) => { if (e.button === 0) this.mouse.l = true; if (e.button === 2) this.mouse.r = true; });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('gamepadconnected', (e) => { this.padName = e.gamepad.id; });
    addEventListener('gamepaddisconnected', () => { this.padName = ''; });
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem('skyfront.input') || 'null');
      if (s) { Object.assign(this.settings, s.settings || {}); Object.assign(this.bind, s.bind || {}); Object.assign(this.axes, s.axes || {}); }
    } catch (e) { /* storage unavailable */ }
  }
  save() {
    try { localStorage.setItem('skyfront.input', JSON.stringify({ settings: this.settings, bind: this.bind, axes: this.axes })); } catch (e) { /* ignore */ }
  }
  resetBindings() { this.bind = { ...DEFAULT_BIND }; this.axes = JSON.parse(JSON.stringify(DEFAULT_AXES)); this.save(); }

  getPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let best = null;
    for (const p of pads) if (p && p.connected) { if (!best || (p.mapping === 'standard' && best.mapping !== 'standard')) best = p; }
    if (best) { this.padName = best.id; this.padIndex = best.index; }
    return best;
  }

  padValue(pad, b) {
    if (!pad || !b) return 0;
    if (b.t === 'b') { const bt = pad.buttons[b.i]; return bt ? (typeof bt === 'object' ? Math.max(bt.value, bt.pressed ? 1 : 0) : bt) : 0; }
    const a = pad.axes[b.i] ?? 0;
    return clamp(a * (b.s || 1), 0, 1);
  }

  stick(pad, ax, ay) {
    if (!pad) return [0, 0];
    let x = pad.axes[this.axes[ax].i] ?? 0, y = pad.axes[this.axes[ay].i] ?? 0;
    if (this.axes[ax].inv) x = -x; if (this.axes[ay].inv) y = -y;
    const m = Math.hypot(x, y), dz = this.settings.deadzone;
    if (m < dz) return [0, 0];
    const n = clamp((m - dz) / (1 - dz), 0, 1), k = this.settings.expo;
    const c = n * (1 - k) + n * n * n * k;
    return [x / m * c, y / m * c];
  }

  // Called once per frame.
  poll() {
    const pad = this.getPad();
    this.prev = this.cur;
    const cur = {};
    const k = (codes) => codes.some((c) => this.keys.has(c)) ? 1 : 0;
    for (const [a] of ACTIONS) cur[a] = Math.max(this.padValue(pad, this.bind[a]), k(KEYS[a] || []));
    if (this.mouse.l && document.pointerLockElement) cur.primary = 1;
    if (this.mouse.r && document.pointerLockElement) cur.secondary = 1;
    const [lx, ly] = this.stick(pad, 'lx', 'ly');
    const [rx, ry] = this.stick(pad, 'rx', 'ry');
    if (pad && (Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0.2 || pad.buttons.some((b) => b.pressed))) this.lastDevice = 'pad';
    const kx = k(['KeyD']) - k(['KeyA']), ky = k(['KeyS']) - k(['KeyW']);
    cur.moveX = clamp(lx + kx, -1, 1);
    cur.moveY = clamp(ly + ky, -1, 1);
    const ms = 0.004 * this.settings.mouseSens;
    let lookX = rx + (k(['ArrowRight']) - k(['ArrowLeft'])), lookY = ry + (k(['ArrowDown']) - k(['ArrowUp']));
    cur.mouseX = this.mouse.dx * ms; cur.mouseY = this.mouse.dy * ms;
    this.mouse.dx = 0; this.mouse.dy = 0;
    cur.lookX = clamp(lookX, -1, 1) * this.settings.sens;
    cur.lookY = clamp(lookY, -1, 1) * this.settings.sens * (this.settings.invertLook ? -1 : 1);
    cur.mouseY *= this.settings.invertLook ? -1 : 1;
    cur.pitchSign = this.settings.invertPitch ? -1 : 1;
    this.cur = cur;
    this.pad = pad;
    return cur;
  }
  down(a) { return (this.cur[a] || 0) > 0.5; }
  pressed(a) { return (this.cur[a] || 0) > 0.5 && !((this.prev[a] || 0) > 0.5); }
  released(a) { return !((this.cur[a] || 0) > 0.5) && (this.prev[a] || 0) > 0.5; }
  val(a) { return this.cur[a] || 0; }

  // Menu navigation edges: 'up','down','left','right','ok','back'
  menu(dt) {
    const pad = this.pad;
    const b = (i) => pad && pad.buttons[i] && pad.buttons[i].pressed;
    const ax = pad ? (pad.axes[0] || 0) : 0, ay = pad ? (pad.axes[1] || 0) : 0;
    let dir = null;
    if (b(12) || ay < -0.6 || this.keys.has('ArrowUp')) dir = 'up';
    else if (b(13) || ay > 0.6 || this.keys.has('ArrowDown')) dir = 'down';
    else if (b(14) || ax < -0.6 || this.keys.has('ArrowLeft')) dir = 'left';
    else if (b(15) || ax > 0.6 || this.keys.has('ArrowRight')) dir = 'right';
    let out = null;
    if (dir) {
      if (this.menuRepeat.dir !== dir) { out = dir; this.menuRepeat = { dir, t: 0.38 }; }
      else { this.menuRepeat.t -= dt; if (this.menuRepeat.t <= 0) { out = dir; this.menuRepeat.t = 0.12; } }
    } else this.menuRepeat.dir = null;
    const okNow = b(0) || this.keys.has('Enter'), backNow = b(1) || this.keys.has('Escape') || this.keys.has('Backspace');
    const startNow = b(9);
    if (okNow && !this._ok) out = 'ok';
    if (backNow && !this._back) out = 'back';
    if (startNow && !this._start) out = 'start';
    this._ok = okNow; this._back = backNow; this._start = startNow;
    return out;
  }

  rumble(strong, weak, ms) {
    if (!this.rumbleOn || !this.pad) return;
    const act = this.pad.vibrationActuator;
    if (act && act.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }

  // For remapping: returns a binding when a new button/axis is engaged.
  captureBinding(rest) {
    const pad = this.getPad();
    if (!pad) return null;
    for (let i = 0; i < pad.buttons.length; i++) if (pad.buttons[i].pressed && !(rest.buttons[i])) return { t: 'b', i };
    for (let i = 0; i < pad.axes.length; i++) {
      const d = pad.axes[i] - (rest.axes[i] || 0);
      if (Math.abs(d) > 0.6) return { t: 'a', i, s: Math.sign(pad.axes[i]) || 1 };
    }
    return null;
  }
  snapshot() {
    const pad = this.getPad();
    if (!pad) return { buttons: [], axes: [] };
    return { buttons: pad.buttons.map((b) => b.pressed), axes: pad.axes.slice() };
  }
  bindLabel(b) {
    if (!b) return '—';
    if (b.t === 'b') return BTN_NAMES[b.i] || 'Button ' + b.i;
    return 'Axis ' + b.i + (b.s > 0 ? '+' : '-');
  }
}
