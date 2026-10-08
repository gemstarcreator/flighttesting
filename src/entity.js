import * as THREE from 'three';

let UID = 0;
const _f = new THREE.Vector3();

export class Entity {
  constructor(game, o) {
    this.game = game;
    this.id = ++UID;
    this.kind = o.kind;
    this.cat = o.cat;           // 'air' | 'ground' | 'naval' | 'static'
    this.faction = o.faction;   // 0 allied, 1 hostile
    this.name = o.name || o.kind;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.hp = this.maxHp = o.hp ?? 100;
    this.radius = o.radius ?? 2;
    this.score = o.score ?? 100;
    this.alive = true;
    this.dying = false;
    this.targetable = o.targetable ?? true;
    this.isPlayer = false;
    this.lastHit = -99;
    this.mesh = o.mesh || null;
    this.dmgMul = 1;
    this.tag = o.tag || null;
    if (this.mesh) game.scene.add(this.mesh);
  }
  get up() { return this._up || (this._up = new THREE.Vector3()), this._up.copy(this.pos).normalize(); }
  forward(out = _f) { return out.set(0, 0, -1).applyQuaternion(this.quat); }
  right(out) { return out.set(1, 0, 0).applyQuaternion(this.quat); }
  localUp(out) { return out.set(0, 1, 0).applyQuaternion(this.quat); }

  damage(amount, src) {
    if (!this.alive || this.dying || amount <= 0) return;
    amount *= this.dmgMul;
    this.hp -= amount;
    this.lastHit = this.game.time;
    this.lastAttacker = src && src.owner ? src.owner : src;
    this.onDamage?.(amount, src);
    if (this.hp <= 0) { this.hp = 0; this.destroy(src); }
  }

  destroy(src) {
    if (this.dying || !this.alive) return;
    this.dying = true;
    this.game.onDestroyed(this, src);
    this.onDestroyed?.(src);
    if (!this.keepWreck) this.remove();
  }

  remove() {
    this.alive = false;
    if (this.mesh) this.game.scene.remove(this.mesh);
  }

  sync() {
    if (this.mesh) { this.mesh.position.copy(this.pos); this.mesh.quaternion.copy(this.quat); }
  }
}
