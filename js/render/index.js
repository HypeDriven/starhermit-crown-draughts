// Render facade: Three.js scene graph, lighting, quality tiers, camera,
// fixed-step loop with interpolation, context-loss recovery, and a
// compatibility message when WebGL is unavailable. The UI talks only to this
// facade; the scene never mutates rules state.

import * as THREE from '../../vendor/three.module.js';
import { BoardView, LAYER_ENV, LAYER_GAME, LAYER_SELECT } from './board.js';
import { Garden } from './garden.js';
import { FxPool, FX_LAYER } from './fx.js';
import { CameraRig, FRAMING } from './camera.js';
import { THEMES } from '../content/themes.js';

export const QUALITY_TIERS = {
  high: { shadow: 2048, dprCap: 2.0, garden: 'high', fx: 'high', antialias: true },
  medium: { shadow: 1024, dprCap: 1.5, garden: 'medium', fx: 'medium', antialias: true },
  low: { shadow: 0, dprCap: 1.0, garden: 'low', fx: 'low', antialias: false },
};

export class RenderFacade {
  constructor(container, { onCompat } = {}) {
    this.container = container;
    this.renderer = null;
    this.ok = false;
    this.themeId = 'royal-garden';
    this.tier = 'medium';
    this.reducedMotion = false;
    this.paused = false;
    this.hidden = false;
    this._raf = null;
    this._last = 0;
    this._acc = 0;
    this._elapsed = 0;
    this._fpsSamples = [];
    this._autoScale = 1;
    try {
      this._init();
      this.ok = true;
    } catch (e) {
      console.warn('WebGL unavailable:', e);
      this.ok = false;
      onCompat?.(e);
    }
  }

  _init() {
    const canvas = document.createElement('canvas');
    canvas.className = 'scene-canvas';
    canvas.setAttribute('aria-hidden', 'true'); // semantic mirror lives in the DOM
    this.container.appendChild(canvas);
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FRAMING.fov, 1, FRAMING.near, FRAMING.far);
    this.camera.layers.enable(LAYER_GAME);
    this.camera.layers.enable(LAYER_SELECT);
    this.camera.layers.enable(FX_LAYER);
    this.rig = new CameraRig(this.camera, this.reducedMotion);

    // lights
    this.sun = new THREE.DirectionalLight(0xffe7c4, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -10;
    this.sun.shadow.camera.right = 10;
    this.sun.shadow.camera.top = 10;
    this.sun.shadow.camera.bottom = -10;
    this.sun.shadow.camera.far = 60;
    this.sun.shadow.bias = -0.0015;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbdd7f0, 0x6d7c53, 0.75);
    this.scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0xffffff, 0.12);
    this.scene.add(this.amb);

    // sky dome
    this.sky = this._buildSky();
    this.scene.add(this.sky);

    this.fx = new FxPool(this.scene, this.tier, this.reducedMotion);
    this.board = null;   // built per game
    this.garden = null;
    this.setTheme(this.themeId, 1);

    // context loss recovery: rebuild GPU resources from CPU descriptors
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this._contextLost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this._contextLost = false;
      this.renderer.dispose();
      this.setTheme(this.themeId, this._seed || 1, true);
      if (this._lastState) this.loadState(this._lastState, { snap: true });
    });

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
    this._start();
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(60, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x7fb2e0) },
        bottom: { value: new THREE.Color(0xf6e3c0) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; varying vec3 vPos;
        void main() {
          float h = clamp(normalize(vPos).y * 0.5 + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(mix(bottom, top, pow(h, 0.8)), 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.layers.set(LAYER_ENV);
    return mesh;
  }

  setTheme(themeId, seed = 1, force = false) {
    const theme = THEMES[themeId] || THEMES['royal-garden'];
    if (this.themeId === themeId && this.garden && !force) return;
    this.themeId = themeId;
    this._seed = seed;
    const t = theme;
    this.scene.fog = new THREE.FogExp2(t.fog, t.fogDensity);
    this.sky.material.uniforms.top.value.set(t.skyTop);
    this.sky.material.uniforms.bottom.value.set(t.skyBottom);
    this.sun.color.set(t.sun.color);
    this.sun.intensity = t.sun.intensity;
    this.sun.position.set(...t.sun.position);
    this.hemi.color.set(t.hemi.sky);
    this.hemi.groundColor.set(t.hemi.ground);
    this.hemi.intensity = t.hemi.intensity;
    if (this.garden) { this.garden.dispose(); this.garden = null; }
    this.garden = new Garden(this.scene, t, seed, this._cosmetics?.surround);
    this.garden.setDetail(QUALITY_TIERS[this.tier].garden);
    if (this.board && this._lastState) {
      // re-skin the board immediately on theme change
      const st = this._lastState;
      this.board.dispose();
      this.board = new BoardView(this.scene, t);
      this.board.cosmetics = this._cosmetics;
      this.board.trailColor = this.trailColor;
      this.board.buildFor(st);
    } else if (this.board) {
      this.board.theme = t;
    }
  }

  /** Cosmetics only ever alter materials, trails and surrounds. */
  setCosmetics(cosmetics) {
    this._cosmetics = cosmetics;
    if (this.board) {
      this.board.cosmetics = cosmetics;
      this.board.trailColor = this.trailColor;
    }
  }

  get trailColor() {
    return {
      'trail-petals': 0xe8a0b0,
      'trail-sparks': 0xff9a4a,
      'trail-snow': 0xffffff,
    }[this._cosmetics?.trail] ?? 0xcfc4a4;
  }

  setQuality(tier) {
    if (!QUALITY_TIERS[tier]) return;
    this.tier = tier;
    const q = QUALITY_TIERS[tier];
    if (this.renderer) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dprCap) * this._autoScale);
      this.renderer.shadowMap.enabled = q.shadow > 0;
      this.sun.castShadow = q.shadow > 0;
      if (q.shadow > 0) {
        this.sun.shadow.mapSize.set(q.shadow, q.shadow);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.fx?.setTier(q.fx);
    this.garden?.setDetail(q.garden);
  }

  setReducedMotion(v) {
    this.reducedMotion = v;
    if (this.rig) this.rig.setReducedMotion(v);
    if (this.fx) this.fx.reducedMotion = v;
  }

  /** Build board meshes for a new game. */
  loadState(state, { snap = true, seed = 1 } = {}) {
    this._lastState = state;
    if (!this.ok) return;
    if (this.board && this.board.size === state.size && this._boardPlayers === state.players.map((p) => p.color).join()) {
      this.board.syncState(state);
      return;
    }
    if (this.board) { this.board.dispose(); }
    this.board = new BoardView(this.scene, THEMES[this.themeId]);
    this.board.buildFor(state);
    this._boardPlayers = state.players.map((p) => p.color).join();
    this.rig.setBoardSize(state.size);
    this.rig.goTo(this.rig.preset, snap);
  }

  syncState(state) {
    this._lastState = state;
    if (!this.ok || !this.board) return;
    this.board.syncState(state);
  }

  /** Cosmetic animation for an applied action; returns approx duration (s). */
  playAction(action, stateAfter, { skip = false, tier = 'move' } = {}) {
    if (!this.ok || !this.board) return 0;
    const dur = this.board.animateAction(action, stateAfter, this.fx, { skip });
    if (action.type === 'move' && !skip) {
      if (action.captures.length >= 2) this.rig.shake('small');
      if (action.crowns) {
        const w = this.board.cellToWorld(action.path.at(-1)[0], action.path.at(-1)[1]);
        this.rig.focusOn(w.x, w.z);
      }
    }
    return dur;
  }

  roundEndFx(center = { x: 0, z: 0 }, color = 0xffd873) {
    if (!this.ok) return;
    this.fx.roundEnd(center.x, 0.3, center.z, color);
    this.rig.shake('big');
  }

  setSelection(pieceId, legalFromSelection) {
    this.board?.setSelection(pieceId, legalFromSelection);
  }
  setHover(cell) {
    this.board?.setHover(cell);
  }
  pickCell(clientX, clientY) {
    if (!this.ok || !this.board) return null;
    return this.board.pickCell(clientX, clientY, this.camera, this.canvas);
  }
  projectCell(r, c) {
    if (!this.ok || !this.board) return null;
    return this.board.projectToScreen(r, c, this.camera, this.canvas);
  }
  resetCamera(preset) {
    if (preset) this.rig.preset = preset;
    this.rig.goTo(preset || this.rig.preset);
  }
  setCameraPreset(preset) {
    this.rig.goTo(preset);
  }

  resize() {
    if (!this.renderer) return;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // narrow viewports: pull back so the board always fits
    if (this.rig) this.rig.fitScale = Math.min(2.6, Math.max(1, 1.42 / this.camera.aspect));
    const q = QUALITY_TIERS[this.tier];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dprCap) * this._autoScale);
    this.renderer.setSize(w, h, false);
  }

  setHidden(hidden) {
    this.hidden = hidden;
    if (!hidden) this._last = performance.now();
  }

  setPaused(v) { this.paused = v; }

  _start() {
    const loop = (t) => {
      this._raf = requestAnimationFrame(loop);
      if (this.hidden || this._contextLost) { this._last = t; return; }
      let dt = (t - this._last) / 1000;
      this._last = t;
      if (dt > 0.25) dt = 0.25; // tab-switch clamp
      this._elapsed += dt;
      // FPS monitor: drop render scale before touching simulation quality
      this._fpsSamples.push(dt);
      if (this._fpsSamples.length >= 90) {
        const avg = this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length;
        this._fpsSamples.length = 0;
        if (avg > 1 / 45 && this._autoScale > 0.6) {
          this._autoScale = Math.max(0.6, this._autoScale - 0.15);
          this.resize();
        } else if (avg < 1 / 58 && this._autoScale < 1) {
          this._autoScale = Math.min(1, this._autoScale + 0.1);
          this.resize();
        }
      }
      if (!this.paused) {
        this.rig.update(dt);
        this.board?.update(dt);
        this.garden?.update(dt, this._elapsed);
        this.fx.update(dt);
      }
      this.renderer.render(this.scene, this.camera);
    };
    this._raf = requestAnimationFrame(loop);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this.board?.dispose();
    this.garden?.dispose();
    this.fx?.dispose();
    this.renderer?.dispose();
    this.canvas?.remove();
  }
}
