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
import { EffectComposer } from '../../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from '../../vendor/three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from '../../vendor/three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from '../../vendor/three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from '../../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from '../../vendor/three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from '../../vendor/three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from '../../vendor/three/addons/environments/RoomEnvironment.js';
import { detectPreset, describe, resolve, SHADOW_MAP } from './gfx.js';

// Colour grade + vignette, applied in display space after the output pass:
// gentle S-curve, a touch more saturation, warm highlights / cool shadows.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.2 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.18);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.07);
      s *= mix(vec3(0.97, 0.99, 1.04), vec3(1.035, 1.0, 0.965), smoothstep(0.2, 0.8, l));
      c = mix(c, s, uAmount);
      float d = length(vUv - 0.5);
      c *= 1.0 - uVignette * smoothstep(0.38, 0.85, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

function isMobileDevice() {
  try {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const small = Math.min(screen.width, screen.height) < 760;
    return coarse && (small || navigator.maxTouchPoints > 0);
  } catch { return false; }
}

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
    this._frames = [];
    this.adaptiveScale = 1;
    this.fps = 0;
    this.size = [1, 1];
    this.pixelRatio = 1;
    this.composer = null;
    this.postKey = null;
    this.postFailed = false;
    this.q = resolve({}, 'low');
    try {
      this._init();
      this.ok = true;
    } catch (e) {
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
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.gpu = RenderFacade._gpuName(renderer);
    this.detected = detectPreset(this.gpu, { mobile: isMobileDevice() });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FRAMING.fov, 1, FRAMING.near, FRAMING.far);
    this.camera.layers.enable(LAYER_GAME);
    this.camera.layers.enable(LAYER_SELECT);
    this.camera.layers.enable(FX_LAYER);
    this.rig = new CameraRig(this.camera, this.reducedMotion);

    // lights
    this.sun = new THREE.DirectionalLight(0xffe7c4, 2.6);
    this.sun.castShadow = false;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this._fitShadow(8);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbdd7f0, 0x6d7c53, 0.75);
    this.scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0xffffff, 0.12);
    this.scene.add(this.amb);

    // sky dome
    this.sky = this._buildSky();
    this.scene.add(this.sky);

    this.fx = new FxPool(this.scene, 'high', this.reducedMotion);
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
      this._envTex = null;
      this.postKey = null;
      this.composer = null;
      this._applyEnv();
      this.setTheme(this.themeId, this._seed || 1, true);
      if (this._lastState) this.loadState(this._lastState, { snap: true });
    });

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
    this.setGraphics({});
    this._start();
  }

  static _gpuName(r) {
    try {
      const gl = r.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    } catch { return ''; }
  }

  /** Fit the sun's shadow box to the board and its terrace (no clipped edges on the stone). */
  _fitShadow(boardSize) {
    const cam = this.sun.shadow.camera;
    const ext = Math.max(11, boardSize / 2 + 6); // board plus the whole terrace
    Object.assign(cam, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 70 });
    cam.updateProjectionMatrix();
    this.sun.target.position.set(0, 0, 0);
  }

  // ---------------------------------------------------------------- graphics settings

  /** Apply saved graphics settings ({} = auto). Live: no reload needed. */
  setGraphics(saved) {
    if (!this.ok && !this.renderer) { this.q = resolve(saved, 'low'); return; }
    const g = resolve(saved, this.detected);
    const prevShadows = this.q?.shadows;
    this.q = g;
    const size = SHADOW_MAP[g.shadows];
    this.renderer.shadowMap.enabled = size > 0;
    this.sun.castShadow = size > 0;
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (prevShadows !== g.shadows) {
      // shadow-receiving materials recompile when the shadow map toggles
      this.scene.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
      });
    }
    this._applyEnv();
    this.fx?.setTier(g.particles === 'high' ? 'high' : 'low');
    this.garden?.setDetail(g);
    this.board?.setLook(g, this._boardEnv());
    this.adaptiveScale = 1;
    this._frames = [];
    this.postKey = null; // rebuild the post chain on the next frame
    this.postFailed = false;
    this._fpsVisible(g.showFps);
    if (this.canvas) this.canvas.dataset.gfxPreset = g.preset;
    document.body.dataset.gfxPreset = g.preset;
    this.resize();
  }

  /** What the settings panel shows: GPU, auto choice, resolved tiers, cost and frame rate. */
  graphicsInfo() {
    const px = [Math.round(this.size[0] * this.pixelRatio), Math.round(this.size[1] * this.pixelRatio)];
    return {
      gpu: this.gpu || 'unknown GPU',
      detected: this.detected || 'low',
      resolved: this.q,
      summary: describe(this.q, px),
      pixels: px,
      fps: Math.round(this.fps || 0),
      adaptiveScale: Math.round(this.adaptiveScale * 100) / 100,
      postFailed: !!this.postFailed,
      postActive: !!this.composer,
    };
  }

  /** Image-based lighting from a prefiltered room environment (reflections tier). */
  _applyEnv() {
    if (!this.renderer) return;
    const on = this.q?.reflections === 'on';
    if (on && !this._envTex) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      this._envTex = pmrem.fromScene(room, 0.04).texture;
      room.dispose?.();
      pmrem.dispose();
    }
    // the garden gets a faint wash; the board and pieces bind the map
    // themselves with per-material strengths (see BoardView.setLook)
    this.scene.environment = on ? this._envTex : null;
    this.scene.environmentIntensity = 0.22;
    const t = THEMES[this.themeId] || THEMES['royal-garden'];
    this.hemi.intensity = t.hemi.intensity * (on ? 0.85 : 1);
    this.board?.setLook(this.q, this._boardEnv());
  }

  _boardEnv() {
    return this.q?.reflections === 'on' ? this._envTex || null : null;
  }

  _fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '— fps';
      document.body.append(el);
    }
    if (el) el.hidden = !on;
  }

  /**
   * Direct rendering mixes fog after the sRGB conversion; through the post
   * chain it mixes in linear light, which lifts dark stone far more. Halving
   * the density there keeps the two paths at the same contrast.
   */
  _applyFog() {
    if (this.scene?.fog && this._fogDensity != null) this.scene.fog.density = this._fogDensity * (this.composer ? 0.5 : 1);
    if (this.sky) this.sky.material.uniforms.uPost.value = this.composer ? 1 : 0;
  }

  _postKey(w, h) {
    const g = this.q;
    return g.post && !this.postFailed ? [g.ao, g.bloom, g.grade, g.antialias, w, h, this.pixelRatio].join('|') : 'none';
  }

  _buildPost(w, h) {
    const g = this.q;
    this.composer?.renderTarget1?.dispose();
    this.composer?.renderTarget2?.dispose();
    this.composer?.dispose?.();
    this.composer = null;
    if (!g.post || this.postFailed) return;
    try {
      const pr = this.pixelRatio;
      const target = new THREE.WebGLRenderTarget(w * pr, h * pr, {
        type: THREE.HalfFloatType, samples: g.antialias === 'msaa' ? 4 : 0,
      });
      const composer = new EffectComposer(this.renderer, target);
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (g.ao !== 'off') {
        const ao = new GTAOPass(this.scene, this.camera, w * pr, h * pr);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.75;
        ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.6, thickness: 1.0, scale: 1.0, samples: g.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.ao === 'high' ? 6 : 4, rings: 2, samples: g.ao === 'high' ? 16 : 8 });
        composer.addPass(ao);
      }
      if (g.bloom === 'on') {
        // HDR threshold (pre-tone-mapping luminance): only lanterns, torches and
        // specular glints on gold crowns and polished stone bloom.
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.45, 2.4));
      }
      composer.addPass(new OutputPass());
      if (g.grade === 'on') composer.addPass(new ShaderPass(GradeShader));
      if (g.antialias === 'smaa') composer.addPass(new SMAAPass(w * pr, h * pr));
      if (g.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
        composer.addPass(fxaa);
      }
      this.composer = composer;
    } catch {
      // Post-processing is an enhancement: render directly if the chain cannot be built.
      this.postFailed = true;
      this.composer = null;
    }
  }

  // Adaptive resolution: step the render scale down when frames are slow, back up when fast.
  _adapt(dtMs) {
    const f = this._frames;
    f.push(dtMs);
    if (f.length < 90) return false;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    this.fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = `${Math.round(this.fps)} fps · ${Math.round(this.pixelRatio * 100) / 100}×`;
    if (!this.q.adaptive) return false;
    const before = this.adaptiveScale;
    if (avg > 26) this.adaptiveScale = Math.max(0.6, this.adaptiveScale - 0.1);
    else if (avg < 14 && this.adaptiveScale < 1) this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.05);
    return before !== this.adaptiveScale;
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(60, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x7fb2e0) },
        bottom: { value: new THREE.Color(0xf6e3c0) },
        uPost: { value: 0 },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; uniform float uPost; varying vec3 vPos;
        void main() {
          float h = clamp(normalize(vPos).y * 0.5 + 0.5, 0.0, 1.0);
          vec3 c = mix(bottom, top, pow(h, 0.8));
          // through the post chain the output pass tone-maps and encodes
          // sRGB; pre-compensate so the sky keeps the direct-render look
          if (uPost > 0.5) c = pow(c, vec3(2.2)) * 1.3;
          gl_FragColor = vec4(c, 1.0);
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
    this._fogDensity = t.fogDensity;
    this._applyFog();
    this.sky.material.uniforms.top.value.set(t.skyTop);
    this.sky.material.uniforms.bottom.value.set(t.skyBottom);
    this.sun.color.set(t.sun.color);
    this.sun.intensity = t.sun.intensity;
    this.sun.position.set(...t.sun.position);
    this.hemi.color.set(t.hemi.sky);
    this.hemi.groundColor.set(t.hemi.ground);
    this.hemi.intensity = t.hemi.intensity * (this.q?.reflections === 'on' ? 0.85 : 1);
    if (this.garden) { this.garden.dispose(); this.garden = null; }
    this.garden = new Garden(this.scene, t, seed, this._cosmetics?.surround);
    this.garden.reducedMotion = this.reducedMotion;
    this.garden.setDetail(this.q);
    if (this.board && this._lastState) {
      // re-skin the board immediately on theme change
      const st = this._lastState;
      this.board.dispose();
      this.board = new BoardView(this.scene, t);
      this.board.cosmetics = this._cosmetics;
      this.board.trailColor = this.trailColor;
      this.board.setLook(this.q, this._boardEnv());
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

  setReducedMotion(v) {
    this.reducedMotion = v;
    if (this.rig) this.rig.setReducedMotion(v);
    if (this.fx) this.fx.reducedMotion = v;
    if (this.garden) { this.garden.reducedMotion = v; this.garden.setDetail(this.q); }
  }

  /** Build board meshes for a new game. */
  loadState(state, { snap = true, seed = 1 } = {}) {
    this._lastState = state;
    if (!this.ok) return;
    // Reuse the board only for the same population of pieces (same ids);
    // a new setup (lesson, puzzle, attract board) rebuilds so absent pieces
    // never linger and new ones always exist.
    const pieceKey = state.pieces.map((p) => p.id).sort().join(',');
    if (this.board && this.board.size === state.size && this._boardPlayers === state.players.map((p) => p.color).join()
        && this._boardPieces === pieceKey) {
      this.board.syncState(state);
      return;
    }
    if (this.board) { this.board.dispose(); }
    this.board = new BoardView(this.scene, THEMES[this.themeId]);
    this.board.setLook(this.q, this._boardEnv());
    this.board.buildFor(state);
    this._fitShadow(state.size);
    this._boardPlayers = state.players.map((p) => p.color).join();
    this._boardPieces = pieceKey;
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
    const q = this.q;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, q.dprCap) * q.scale * this.adaptiveScale;
    this.size = [w, h];
    this.renderer.setPixelRatio(this.pixelRatio);
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
      if (this._adapt(dt * 1000)) this.resize();
      const cw = this.container.clientWidth || 1;
      const ch = this.container.clientHeight || 1;
      if (cw !== this.size[0] || ch !== this.size[1]) this.resize();
      if (!this.paused) {
        this.rig.update(dt);
        if (this.board) this.board.reducedMotion = this.reducedMotion;
        this.board?.update(dt);
        this.garden?.update(dt, this._elapsed);
        this.fx.update(dt);
      }
      const key = this._postKey(this.size[0], this.size[1]);
      if (key !== this.postKey) {
        this.postKey = key;
        this._buildPost(this.size[0], this.size[1]);
        this._applyFog();
      }
      if (this.composer) {
        try {
          this.composer.render(dt);
        } catch {
          this.postFailed = true;
          this.composer = null;
          this._applyFog();
          this.renderer.setRenderTarget(null);
          this.renderer.render(this.scene, this.camera);
        }
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    };
    this._raf = requestAnimationFrame(loop);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this.board?.dispose();
    this.garden?.dispose();
    this.fx?.dispose();
    this.composer?.dispose?.();
    this._envTex?.dispose();
    this.renderer?.dispose();
    this.canvas?.remove();
  }
}
