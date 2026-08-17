// Authored camera rig: low-distortion perspective, fixed framing constants,
// critically damped spring transitions (never cumulative per-frame lerp),
// interruptible presets, low-amplitude tiered shake, reduced-motion aware.

import * as THREE from '../../vendor/three.module.js';

export const FRAMING = {
  fov: 33,
  near: 0.5,
  far: 120,
  presets: {
    classic: { dist: 16.4, height: 12.6, lookY: 0.1, azimuth: 0 },
    low: { dist: 14.8, height: 7.8, lookY: 0.5, azimuth: 0 },
    top: { dist: 12.8, height: 17.6, lookY: 0, azimuth: 0 },
  },
  // melee (10x10) needs a touch more room
  distPerSize: (size) => 1 + (size - 8) * 0.11,
};

class Spring {
  constructor(value, stiffness = 42, dampingRatio = 1) {
    this.x = value;
    this.v = 0;
    this.target = value;
    this.k = stiffness;
    this.zeta = dampingRatio;
  }
  /** Critically damped spring integrated with a fixed sub-step. */
  update(dt) {
    const steps = Math.max(1, Math.ceil(dt / 0.016));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const f = -this.k * (this.x - this.target) - 2 * this.zeta * Math.sqrt(this.k) * this.v;
      this.v += f * h;
      this.x += this.v * h;
    }
  }
  snap(v) { this.x = v; this.target = v; this.v = 0; }
}

export class CameraRig {
  constructor(camera, reducedMotion = false) {
    this.camera = camera;
    this.reducedMotion = reducedMotion;
    this.size = 8;
    this.preset = 'classic';
    const p = FRAMING.presets.classic;
    this.dist = new Spring(p.dist);
    this.height = new Spring(p.height);
    this.lookX = new Spring(0);
    this.lookZ = new Spring(0);
    this.azimuth = new Spring(0);
    this.shakeAmp = 0;
    this.shakeT = 0;
    this.idleT = 0;
    this._tmp = new THREE.Vector3();
  }

  setReducedMotion(v) { this.reducedMotion = v; }
  setBoardSize(size) { this.size = size; }

  /** Move to a preset; interruptible — the spring just re-targets. */
  goTo(presetName, snap = false) {
    const p = FRAMING.presets[presetName] || FRAMING.presets.classic;
    this.preset = presetName in FRAMING.presets ? presetName : 'classic';
    const scale = FRAMING.distPerSize(this.size);
    if (snap || this.reducedMotion) {
      this.dist.snap(p.dist * scale);
      this.height.snap(p.height * scale);
      this.lookX.snap(0);
      this.lookZ.snap(0);
      this.azimuth.snap(p.azimuth);
    } else {
      this.dist.target = p.dist * scale;
      this.height.target = p.height * scale;
      this.lookX.target = 0;
      this.lookZ.target = 0;
      this.azimuth.target = p.azimuth;
    }
  }

  /** Brief focus on a board square (used sparingly: crowning, round end). */
  focusOn(x, z, strength = 0.35) {
    if (this.reducedMotion) return;
    this.lookX.target = x * strength;
    this.lookZ.target = z * strength;
    clearTimeout(this._focusT);
    this._focusT = setTimeout(() => { this.lookX.target = 0; this.lookZ.target = 0; }, 900);
  }

  /** Low-amplitude, event-tiered shake. Never changes raycast truth. */
  shake(tier = 'small') {
    if (this.reducedMotion) return;
    this.shakeAmp = Math.max(this.shakeAmp, tier === 'big' ? 0.10 : 0.035);
    this.shakeT = 0;
  }

  update(dt) {
    this.dist.update(dt);
    this.height.update(dt);
    this.lookX.update(dt);
    this.lookZ.update(dt);
    this.azimuth.update(dt);
    this.idleT += dt;

    const az = this.azimuth.x;
    const fit = this.fitScale || 1; // portrait/narrow viewports pull back
    const d = this.dist.x * fit;
    const h = this.height.x * (0.9 + 0.35 * fit);
    const px = Math.sin(az) * d;
    const pz = Math.cos(az) * d;
    this._tmp.set(px, h, pz);

    // gentle idle sway (decorative only)
    if (!this.reducedMotion) {
      this._tmp.x += Math.sin(this.idleT * 0.23) * 0.05;
      this._tmp.y += Math.sin(this.idleT * 0.31) * 0.03;
    }
    // shake decays to zero; render-only offset
    if (this.shakeAmp > 0.0005) {
      this.shakeT += dt;
      const s = this.shakeAmp * Math.exp(-this.shakeT * 6);
      this._tmp.x += (Math.random() - 0.5) * 2 * s;
      this._tmp.y += (Math.random() - 0.5) * 1.2 * s;
      this._tmp.z += (Math.random() - 0.5) * 2 * s;
    } else {
      this.shakeAmp = 0;
    }

    this.camera.position.copy(this._tmp);
    this.camera.lookAt(this.lookX.x, FRAMING.presets[this.preset]?.lookY ?? 0.2, this.lookZ.x - 0.4);
  }
}
