// Small synthesized sound set (no audio files needed).
export class Audio {
  constructor() { this.ctx = null; this.vol = 0.6; this.last = {}; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.vol; this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // engine: filtered noise + low oscillator
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 400;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    src.connect(this.engFilter); this.engFilter.connect(this.engGain);
    this.engOsc = ctx.createOscillator(); this.engOsc.type = 'sawtooth'; this.engOsc.frequency.value = 60;
    this.oscGain = ctx.createGain(); this.oscGain.gain.value = 0.0;
    this.engOsc.connect(this.oscGain); this.oscGain.connect(this.engGain);
    this.engGain.connect(this.master);
    src.start(); this.engOsc.start();
    // wind (missile cam)
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 900; wf.Q.value = 0.7;
    const ws = ctx.createBufferSource(); ws.buffer = this.noise; ws.loop = true;
    ws.connect(wf); wf.connect(this.windGain); this.windGain.connect(this.master); ws.start();
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }

  engine(kind, power, on = true) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const cfg = {
      plane: [250 + power * 900, 0.13 + power * 0.1, 55 + power * 40, 0.05],
      heli: [180 + power * 200, 0.12, 18 + power * 4, 0.35],
      ground: [140 + power * 260, 0.1 + power * 0.06, 35 + power * 30, 0.25],
      ship: [120 + power * 150, 0.08 + power * 0.05, 28 + power * 15, 0.2],
      missile: [1200, 0.12, 120, 0.02],
    }[kind] || [300, 0.1, 50, 0.1];
    this.engFilter.frequency.setTargetAtTime(cfg[0], t, 0.1);
    this.engGain.gain.setTargetAtTime(on ? cfg[1] : 0, t, 0.15);
    this.engOsc.frequency.setTargetAtTime(cfg[2], t, 0.1);
    this.oscGain.gain.setTargetAtTime(cfg[3], t, 0.1);
  }
  wind(v) { if (this.ctx) this.windGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2); }

  _noise(dur, freq, type, vol, sweepTo) {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  _tone(freq, dur, vol, type = 'sine', delay = 0, slideTo) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  throttle(key, ms) {
    const now = performance.now();
    if (this.last[key] && now - this.last[key] < ms) return false;
    this.last[key] = now; return true;
  }

  gun(heavy) { if (this.ctx && this.throttle('gun', 45)) this._noise(heavy ? 0.12 : 0.06, heavy ? 700 : 1600, 'bandpass', heavy ? 0.5 : 0.32); }
  cannon() { if (this.ctx) { this._noise(0.5, 500, 'lowpass', 0.9, 60); this._tone(70, 0.3, 0.4, 'sine', 0, 35); } }
  launch() { if (this.ctx) this._noise(0.9, 2500, 'bandpass', 0.35, 400); }
  explosion(dist = 0, big = false) {
    if (!this.ctx || !this.throttle('exp', 40)) return;
    const v = Math.max(0.05, 1 - dist / 2500) * (big ? 1.2 : 0.8);
    this._noise(big ? 1.6 : 1.0, 900, 'lowpass', v, 40);
    this._tone(55, 0.6, v * 0.4, 'sine', 0, 30);
  }
  hit() { if (this.ctx && this.throttle('hit', 80)) this._noise(0.08, 3000, 'highpass', 0.3); }
  beep(freq = 1000, dur = 0.08, vol = 0.15) { if (this.ctx) this._tone(freq, dur, vol, 'square'); }
  parry() { if (this.ctx) { this._tone(880, 0.25, 0.2, 'triangle'); this._tone(1320, 0.4, 0.18, 'triangle', 0.08); } }
  evade() { if (this.ctx) { this._tone(660, 0.2, 0.18, 'triangle'); this._tone(990, 0.35, 0.16, 'triangle', 0.1); } }
  ui() { if (this.ctx) this._tone(700, 0.05, 0.08, 'triangle'); }
  success() { if (this.ctx) [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.4, 0.15, 'triangle', i * 0.12)); }
  fail() { if (this.ctx) [392, 330, 262].forEach((f, i) => this._tone(f, 0.5, 0.15, 'triangle', i * 0.18)); }
  flare() { if (this.ctx) this._noise(0.4, 1200, 'highpass', 0.25, 4000); }
}
