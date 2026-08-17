// Bounded, pooled particle effects with an event hierarchy:
//   ack (input) < move < capture/goal < round completion.
// Particles live on the FX layer and never intercept raycasts. Capacity is
// set by the quality tier; reduced motion suppresses large bursts.

import * as THREE from '../../vendor/three.module.js';
import { softDiscTexture } from './textures.js';

export const FX_LAYER = 3;

const POOL_SIZES = { high: 2000, medium: 900, low: 300 };

export class FxPool {
  constructor(scene, tier = 'medium', reducedMotion = false) {
    this.scene = scene;
    this.reducedMotion = reducedMotion;
    this.capacity = POOL_SIZES[tier] || POOL_SIZES.medium;
    const n = this.capacity;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.life = new Float32Array(n);     // remaining
    this.maxLife = new Float32Array(n);
    this.sizes = new Float32Array(n);
    this.alive = 0;
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({
      size: 0.09, map: softDiscTexture(), transparent: true, depthWrite: false,
      vertexColors: true, opacity: 0.95, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.layers.set(FX_LAYER);
    this.points.frustumCulled = false;
    this.points.raycast = () => {}; // cosmetic particles never intercept raycasts
    scene.add(this.points);
    this._c = new THREE.Color();
  }

  setTier(tier) {
    this.capacity = POOL_SIZES[tier] || POOL_SIZES.medium;
  }

  emit(x, y, z, { count = 12, color = 0xffffff, color2 = null, speed = 1.6, up = 1.2, life = 0.7, spread = 0.25, size = 1 } = {}) {
    if (this.reducedMotion) count = Math.min(count, 4);
    const c1 = this._c.set(color);
    const r1 = c1.r, g1 = c1.g, b1 = c1.b;
    let r2 = r1, g2 = g1, b2 = b1;
    if (color2 != null) {
      const c2 = this._c.set(color2);
      r2 = c2.r; g2 = c2.g; b2 = c2.b;
    }
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const p3 = idx * 3;
      this.pos[p3] = x + (Math.random() - 0.5) * spread;
      this.pos[p3 + 1] = y + Math.random() * 0.05;
      this.pos[p3 + 2] = z + (Math.random() - 0.5) * spread;
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.vel[p3] = Math.cos(a) * sp;
      this.vel[p3 + 1] = up * (0.5 + Math.random());
      this.vel[p3 + 2] = Math.sin(a) * sp;
      const t = Math.random();
      this.col[p3] = r1 + (r2 - r1) * t;
      this.col[p3 + 1] = g1 + (g2 - g1) * t;
      this.col[p3 + 2] = b1 + (b2 - b1) * t;
      this.life[idx] = this.maxLife[idx] = life * (0.6 + Math.random() * 0.8);
    }
  }

  /** Event-tier emitters. */
  ack(x, y, z, color) { this.emit(x, y, z, { count: 4, color, speed: 0.5, up: 0.5, life: 0.35 }); }
  move(x, y, z, color) { this.emit(x, y, z, { count: 8, color, speed: 0.7, up: 0.6, life: 0.45 }); }
  capture(x, y, z, color) { this.emit(x, y, z, { count: 26, color, color2: 0xfff2cc, speed: 2.2, up: 1.6, life: 0.8, spread: 0.3 }); }
  crown(x, y, z, color) { this.emit(x, y, z, { count: 40, color: 0xffe08a, color2: color, speed: 1.6, up: 2.4, life: 1.1, spread: 0.2 }); }
  roundEnd(x, y, z, color) { this.emit(x, y, z, { count: 90, color, color2: 0xffffff, speed: 3.2, up: 2.8, life: 1.4, spread: 1.2 }); }

  /** Fixed-step update; no per-frame allocation. */
  update(dt) {
    const n = this.capacity;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const p3 = i * 3;
      if (this.life[i] <= 0) {
        this.pos[p3 + 1] = -999; // park below the world
        continue;
      }
      this.vel[p3 + 1] -= 3.4 * dt; // gravity
      this.pos[p3] += this.vel[p3] * dt;
      this.pos[p3 + 1] += this.vel[p3 + 1] * dt;
      this.pos[p3 + 2] += this.vel[p3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.mat.map?.dispose();
    this.mat.dispose();
  }
}
