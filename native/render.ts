// The royal garden and the carved stone board on starhermit:scene, ported
// from the browser build's three.js renderer (js/render/*.js before the
// port): the board (stepped slab, rails, corner ornaments, instanced light
// and dark cells, turned pieces with gold crowns, selection ring, hover ring,
// last-move discs, legal-target ghosts and capture rings), the garden
// (lawn, terrace, hedge ring, trees, fountain, lanterns or braziers,
// flowers, the detailed dressing and drifting petals / snow / embers), the
// pooled particle bursts, the sky dome and the authored camera rig. It
// renders from rules snapshots and never mutates rules state.
//
// What changed from three.js, and why:
// - The procedural canvas textures are baked grey factor maps
//   (tools/bake-textures.mjs, the same seeded noise) tinted per theme.
// - The sky's ShaderMaterial is a vertex-coloured dome (the same gradient
//   by elevation, written as the old shader showed it).
// - The EffectComposer chain (GTAO, UnrealBloom, the grade ShaderPass,
//   SMAA / FXAA / MSAA) is renderer.ao / bloom / grade / antialias.
// - Light intensities are three.js r160's divided by π (the engine's convention).
// - Layers and the invisible pick plane: picking intersects the pointer's
//   ray with the board's top plane.
// - Timers (the crowning focus) run on the frame clock, not setTimeout.
import {
  ACESFilmicToneMapping, AmbientLight, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, Color,
  ConeGeometry, CylinderGeometry, DataTexture, DirectionalLight, DoubleSide, SRGBColorSpace, TextureLoader, Euler, FogExp2, Group, HemisphereLight,
  IcosahedronGeometry, InstancedMesh, LatheGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, OrthographicCamera, PMREMGenerator, PerspectiveCamera, Plane, Points, PointsMaterial,
  Quaternion, Raycaster, RepeatWrapping, RingGeometry, RoomEnvironment, SphereGeometry, Vector2, Vector3,
  pointerToNdc, renderer, scene,
} from "starhermit:scene";
import type { Texture } from "starhermit:scene";
import { THEMES } from "./data.ts";
import { createRng } from "../js/rules/rng.js";
import { AMBIENT_MAX, TUFT_MAX, type Budget, type Look } from "./quality.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type State = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Theme = any;
type LitMat = MeshLambertMaterial | MeshStandardMaterial | MeshPhysicalMaterial;
type Polish = { clearcoat?: number; clearcoatRoughness?: number; bump?: number; env?: number };
const PI = Math.PI;

// ------------------------------------------------------------------ budget and materials
let budget: Budget = { material: "physical", texture: 256, pieceSegs: 40, crownSegs: 28, tufts: 420, ambient: 140, bloomRes: 0.5, aoRes: 0.5, hudBlur: false };
const polish = new WeakMap<object, Polish>();

/** Lit material in the budget's class (Lambert on Low, Standard on Balanced,
 * Physical for the polished stone on High and Ultra). */
function litMaterial(params: Record<string, unknown>, physical = false): LitMat {
  const { roughness, metalness, clearcoat, clearcoatRoughness, ...rest } = params;
  if (budget.material === "lambert") return new MeshLambertMaterial(rest as never);
  if (budget.material === "physical" && physical) return new MeshPhysicalMaterial(params as never);
  return new MeshStandardMaterial({ ...rest, ...(roughness != null ? { roughness } : {}), ...(metalness != null ? { metalness } : {}) } as never);
}

// ------------------------------------------------------------------ textures
// The browser build painted marble, slate, grass and hedge textures per pixel
// at start (seeded value noise); the engine's interpreter is far too slow for
// that, so tools/bake-textures.mjs bakes them once as grey factor maps
// (assets/tex/*.png: the texture over its base colour) and each material's
// colour carries the theme's tint, times the map's gain.
const loader = new TextureLoader();
const TEX_GAIN: Record<string, number> = {
  "marble-cell": 1.02, "marble-frame": 1.02, "marble-path": 1.02, "marble-piece": 1.02,
  "slate-cell": 1.2, "slate-piece": 1.2, grass: 1.18, hedge: 1.3,
};
const texCache = new Map<string, Texture>();
function tex(name: string, repeat = 1): Texture {
  const key = `${name}:${repeat}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const t = loader.load(`assets/tex/${name}.png`, undefined, (e: unknown) => console.warn(`texture ${name}: ${String(e)}`));
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}
/** A theme colour tinting a factor map (its gain restored, in linear light). */
function tint(hex: number | Color, map: string, times?: number): Color {
  const c = new Color(hex);
  if (times != null) c.multiply(new Color(times));
  return c.multiplyScalar(Math.pow(TEX_GAIN[map] ?? 1, 2.2));
}
function dataTex(key: string, size: number, fill: (px: Uint8Array, s: number) => void): Texture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const px = new Uint8Array(size * size * 4);
  fill(px, size);
  const t = new DataTexture(px, size, size);
  t.generateMipmaps = true;
  texCache.set(key, t);
  return t;
}
/** Soft radial sprite for particles and ghosts (white, alpha falling off). */
function softDiscTexture(): Texture {
  return dataTex("disc", 64, (d, s) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const r = Math.hypot(x + 0.5 - s / 2, y + 0.5 - s / 2);
      const t = Math.max(0, Math.min(1, (r - 1) / (s / 2 - 1)));
      const i = (y * s + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(255 * (1 - t));
    }
  });
}

// ------------------------------------------------------------------ the scene's fixtures
const FRAMING = {
  fov: 33, near: 0.5, far: 120,
  presets: {
    classic: { dist: 16.4, height: 12.6, lookY: 0.1, azimuth: 0 },
    low: { dist: 14.8, height: 7.8, lookY: 0.5, azimuth: 0 },
    top: { dist: 12.8, height: 17.6, lookY: 0, azimuth: 0 },
  } as Record<string, { dist: number; height: number; lookY: number; azimuth: number }>,
  distPerSize: (size: number): number => 1 + (size - 8) * 0.11,
};
const camera = new PerspectiveCamera(FRAMING.fov, 16 / 9, FRAMING.near, FRAMING.far);
const sun = new DirectionalLight(0xffe7c4, 2.6);
const hemi = new HemisphereLight(0xbdd7f0, 0x6d7c53, 0.75);
const amb = new AmbientLight(0xffffff, 0.12);
let sky: Mesh | null = null;
let look: Look | null = null;
let themeId = "royal-garden";
let seedNow = 1;
let reducedMotion = false;
let cosmetics: Record<string, string> = {};
let envTex: Texture | null = null;
let built = false;
let elapsed = 0;

function linear(c: number): number { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
/** The sky dome: the old shader's gradient by elevation, which showed its
 * (linear) uniform colours as display values. */
function buildSky(t: Theme): Mesh {
  const geo = new SphereGeometry(60, 24, 16);
  const pos = geo.attributes.position!;
  const top = new Color(t.skyTop), bottom = new Color(t.skyBottom);
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.array[i * 3 + 1]! / 60;
    const h = Math.max(0, Math.min(1, y * 0.5 + 0.5));
    const k = Math.pow(h, 0.8);
    // Colors are linear: the shader wrote them out unconverted, so the dome
    // shows them as display values (one more decode here).
    cols[i * 3] = linear(bottom.r + (top.r - bottom.r) * k);
    cols[i * 3 + 1] = linear(bottom.g + (top.g - bottom.g) * k);
    cols[i * 3 + 2] = linear(bottom.b + (top.b - bottom.b) * k);
  }
  geo.setAttribute("color", new BufferAttribute(cols, 3));
  const mesh = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, depthWrite: false, fog: false, toneMapped: false }));
  mesh.noAO = true;
  mesh.renderOrder = -10;
  return mesh;
}

/** Fit the sun's shadow box to the board and its terrace, as the browser build did. */
function fitShadow(boardSize: number): void {
  const cam = sun.shadow.camera as OrthographicCamera;
  const ext = Math.max(11, boardSize / 2 + 6);
  cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext; cam.near = 1; cam.far = 70;
  cam.updateProjectionMatrix();
  sun.target.position.set(0, 0, 0);
}

function build(): void {
  built = true;
  renderer.camera = camera;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  fitShadow(8);
  scene.add(sun, sun.target, hemi, amb);
  fx = new FxPool();
}

// ------------------------------------------------------------------ the board
const PIECE_COLORS: Record<string, { color: number; rough: number }> = {
  ivory: { color: 0xece2c8, rough: 0.5 },
  onyx: { color: 0x4c5468, rough: 0.4 },
  jade: { color: 0x54a078, rough: 0.45 },
  ember: { color: 0xc05c40, rough: 0.48 },
};
const MATERIAL_TINTS: Record<string, number | null> = {
  "marble-ivory": null, "material-jade": 0xa8d8c0, "material-amber": 0xf0c070, "material-moonstone": 0xd8e0f8, "slate-onyx": null,
};
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number): number => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

type PieceView = {
  id: number; color: string; inst: number; x: number; z: number; lift: number; scale: number; crowned: boolean;
  visible: boolean; selected: boolean; renderLift: number; tx?: number; tz?: number; tCrowned?: boolean; tVisible?: boolean;
  [k: string]: unknown;
};
type Tween = { view: PieceView; props: Record<string, number | boolean>; from: Record<string, number | boolean>; dur: number; ease: (t: number) => number; delay: number; t: number; onDone: (() => void) | null };

class BoardView {
  theme: Theme;
  group = new Group();
  size = 8;
  pieces = new Map<number, PieceView>();
  tweens: Tween[] = [];
  slab!: Mesh; frame!: Mesh; railN!: Mesh; railS!: Mesh; railE!: Mesh; railW!: Mesh;
  ornaments = new Group();
  selRing!: Mesh; hoverRing!: Mesh; lastFrom!: Mesh; lastTo!: Mesh;
  ghosts!: InstancedMesh; ghostMat!: MeshBasicMaterial; captureRings!: InstancedMesh;
  cellsLight: InstancedMesh | null = null; cellsDark: InstancedMesh | null = null;
  cellMats: LitMat[] = [];
  pieceMeshes = new Map<string, InstancedMesh>();
  crownMeshes = new Map<string, InstancedMesh>();
  trailColor = 0xcfc4a4;
  cosmetics: Record<string, string> = {};

  constructor(theme: Theme) {
    this.theme = theme;
    scene.add(this.group);
    this.buildStatic();
    this.buildMarkers();
  }

  cellToWorld(r: number, c: number, out = new Vector3()): Vector3 {
    const mid = (this.size - 1) / 2;
    return out.set(c - mid, 0, mid - r);
  }
  worldToCell(x: number, z: number): { r: number; c: number } | null {
    const mid = (this.size - 1) / 2;
    const c = Math.round(x + mid), r = Math.round(mid - z);
    if (r < 0 || c < 0 || r >= this.size || c >= this.size) return null;
    return { r, c };
  }

  buildStatic(): void {
    const t = this.theme;
    const slabMat = litMaterial({ map: tex("marble-frame"), color: tint(t.frame, "marble-frame"), roughness: 0.7, metalness: 0.05 });
    this.slab = new Mesh(new BoxGeometry(1, 0.55, 1), slabMat);
    this.slab.position.y = -0.3;
    this.slab.receiveShadow = true;
    this.group.add(this.slab);
    this.frame = new Mesh(new BoxGeometry(1, 0.14, 1), slabMat);
    this.frame.position.y = -0.055;
    this.frame.receiveShadow = true;
    this.group.add(this.frame);
    this.railN = new Mesh(new BoxGeometry(1, 0.16, 0.5), slabMat);
    this.railS = new Mesh(new BoxGeometry(1, 0.16, 0.5), slabMat);
    this.railE = new Mesh(new BoxGeometry(0.5, 0.16, 1), slabMat);
    this.railW = new Mesh(new BoxGeometry(0.5, 0.16, 1), slabMat);
    for (const r of [this.railN, this.railS, this.railE, this.railW]) { r.castShadow = true; r.receiveShadow = true; this.group.add(r); }
    const ornGeo = new SphereGeometry(0.16, 12, 10);
    for (let i = 0; i < 4; i++) { const m = new Mesh(ornGeo, slabMat); m.castShadow = true; this.ornaments.add(m); }
    this.group.add(this.ornaments);
  }

  buildMarkers(): void {
    const discTex = softDiscTexture();
    const ringMat = (opacity: number): MeshBasicMaterial => new MeshBasicMaterial({ color: 0xffd873, transparent: true, opacity, side: DoubleSide, depthWrite: false, fog: false });
    const ringGeo = new RingGeometry(0.34, 0.47, 40);
    this.selRing = new Mesh(ringGeo, ringMat(0.95));
    this.selRing.rotation.x = -PI / 2;
    this.selRing.position.y = 0.105;
    this.selRing.visible = false;
    this.hoverRing = new Mesh(ringGeo, ringMat(0.4));
    this.hoverRing.rotation.x = -PI / 2;
    this.hoverRing.position.y = 0.105;
    this.hoverRing.visible = false;
    const discGeo = new CircleGeometry(0.2, 24);
    const discMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false });
    this.lastFrom = new Mesh(discGeo, discMat);
    this.lastTo = new Mesh(discGeo, discMat);
    for (const m of [this.lastFrom, this.lastTo]) { m.rotation.x = -PI / 2; m.position.y = 0.103; m.visible = false; }
    this.ghostMat = new MeshBasicMaterial({ color: 0xa8e890, transparent: true, opacity: 0.85, depthWrite: false, map: discTex });
    this.ghosts = new InstancedMesh(new CircleGeometry(0.15, 20), this.ghostMat, 40);
    this.ghosts.count = 0;
    this.captureRings = new InstancedMesh(new RingGeometry(0.36, 0.44, 28),
      new MeshBasicMaterial({ color: 0xff9a5c, transparent: true, opacity: 0.9, side: DoubleSide, depthWrite: false }), 16);
    this.captureRings.count = 0;
    for (const m of [this.selRing, this.hoverRing, this.lastFrom, this.lastTo, this.ghosts, this.captureRings]) { m.noAO = true; this.group.add(m); }
  }

  buildFor(state: State): void {
    this.disposePieces();
    this.size = state.size;
    const s = this.size;
    const t = this.theme;
    this.slab.scale.set(s + 2.6, 1, s + 2.6);
    this.frame.scale.set(s + 1.15, 1, s + 1.15);
    const railOff = s / 2 + 0.32;
    this.railN.scale.set(s + 1.3, 1, 1); this.railN.position.set(0, 0.06, -railOff);
    this.railS.scale.set(s + 1.3, 1, 1); this.railS.position.set(0, 0.06, railOff);
    this.railE.scale.set(1, 1, s + 1.3); this.railE.position.set(railOff, 0.06, 0);
    this.railW.scale.set(1, 1, s + 1.3); this.railW.position.set(-railOff, 0.06, 0);
    const off = (s + 1.15) / 2 - 0.28;
    this.ornaments.children.forEach((m, i) => { m.position.set((i & 1 ? 1 : -1) * off, 0.2, (i & 2 ? 1 : -1) * off); });
    if (this.cellsLight) { this.group.remove(this.cellsLight); this.group.remove(this.cellsDark!); }
    const lightMat = litMaterial({ map: tex("marble-cell"), color: tint(t.stoneLight, "marble-cell"), roughness: 0.55 }, true);
    const darkMat = litMaterial({ map: tex("slate-cell"), color: tint(t.stoneDark, "slate-cell", 0x9aa0b0), roughness: 0.6 }, true);
    polish.set(lightMat, { clearcoat: 0.3, clearcoatRoughness: 0.4, bump: 0.8, env: 0.22 });
    polish.set(darkMat, { clearcoat: 0.12, clearcoatRoughness: 0.5, bump: 1.4, env: 0.12 });
    this.cellMats = [lightMat, darkMat];
    const cellGeo = new BoxGeometry(0.955, 0.09, 0.955);
    const lightCells: [number, number][] = [], darkCells: [number, number][] = [];
    for (let r = 0; r < s; r++) for (let c = 0; c < s; c++) (((r + c) & 1) === 1 ? darkCells : lightCells).push([r, c]);
    const mkCells = (list: [number, number][], mat: LitMat, raised: boolean): InstancedMesh => {
      const im = new InstancedMesh(cellGeo, mat, Math.max(1, list.length));
      const m4 = new Matrix4();
      list.forEach(([r, c], i) => { m4.makeTranslation(c - (s - 1) / 2, 0.045 + (raised ? 0.008 : 0), (s - 1) / 2 - r); im.setMatrixAt(i, m4); });
      im.count = list.length;
      im.instanceMatrix.needsUpdate = true;
      im.receiveShadow = true;
      this.group.add(im);
      return im;
    };
    this.cellsLight = mkCells(lightCells, lightMat, false);
    this.cellsDark = mkCells(darkCells, darkMat, true);
    const colors = [...new Set(state.players.map((p: { color: string }) => p.color))] as string[];
    const bodyGeo = pieceBodyGeometry();
    const crownGeo = crownGeometry();
    for (const color of colors) {
      const maxForColor = state.pieces.filter((p: { owner: number }) => state.players[p.owner].color === color).length + 2;
      const spec = { ...(PIECE_COLORS[color] || PIECE_COLORS.ivory!) };
      if (color === "ivory") { const tint = MATERIAL_TINTS[this.cosmetics.material || ""]; if (tint) spec.color = tint; }
      const map = color === "onyx" ? "slate-piece" : "marble-piece";
      // The browser build's map was the piece colour itself, times the material colour again.
      const mat = litMaterial({ color: tint(spec.color, map, spec.color), roughness: spec.rough, metalness: 0.08, map: tex(map) }, true);
      polish.set(mat, { clearcoat: 0.7, clearcoatRoughness: 0.2, bump: 0.5, env: color === "onyx" ? 0.2 : 0.35 });
      const im = new InstancedMesh(bodyGeo, mat, maxForColor);
      im.castShadow = true;
      im.receiveShadow = true;
      this.group.add(im);
      this.pieceMeshes.set(color, im);
      const crownMat = litMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.75, emissive: 0x332200 });
      polish.set(crownMat, { env: 0.9 });
      const cm = new InstancedMesh(crownGeo, crownMat, maxForColor);
      cm.castShadow = true;
      this.group.add(cm);
      this.crownMeshes.set(color, cm);
    }
    this.pieces.clear();
    const perColor = new Map<string, number>();
    for (const p of state.pieces) {
      const color = state.players[p.owner].color;
      const idx = perColor.get(color) || 0;
      perColor.set(color, idx + 1);
      const w = this.cellToWorld(p.r, p.c);
      this.pieces.set(p.id, { id: p.id, color, inst: idx, x: w.x, z: w.z, lift: 0, scale: p.captured ? 0 : 1, crowned: p.crowned, visible: !p.captured, selected: false, renderLift: 0 });
    }
    for (const [color, im] of this.pieceMeshes) {
      im.count = perColor.get(color) || 0;
      this.crownMeshes.get(color)!.count = im.count;
    }
    this.writeInstances();
    this.setLook();
  }

  /** Reflections: clearcoat + the environment; detail: bump relief from the stone maps. */
  setLook(): void {
    const refl = !!look?.reflections && !!envTex;
    const detailed = !!look?.detailed;
    const mats: LitMat[] = [...this.cellMats];
    for (const im of this.pieceMeshes.values()) mats.push(im.material as LitMat);
    for (const cm of this.crownMeshes.values()) mats.push(cm.material as LitMat);
    for (const m of mats) {
      const p = polish.get(m) || {};
      if (m instanceof MeshPhysicalMaterial) {
        m.clearcoat = refl ? (p.clearcoat || 0) : 0;
        m.clearcoatRoughness = p.clearcoatRoughness ?? 0.3;
      }
      if (m instanceof MeshStandardMaterial) {
        m.envMap = refl ? envTex : null;
        m.envMapIntensity = p.env ?? 0.3;
      }
      if (!(m instanceof MeshLambertMaterial)) {
        const sm = m as MeshStandardMaterial;
        sm.bumpMap = detailed && p.bump && sm.map ? sm.map : null;
        sm.bumpScale = p.bump || 1;
      }
    }
  }

  syncState(state: State): void {
    for (const p of state.pieces) {
      const v = this.pieces.get(p.id);
      if (!v) continue;
      const w = this.cellToWorld(p.r, p.c);
      v.x = w.x; v.z = w.z;
      v.crowned = p.crowned;
      v.visible = !p.captured;
      v.scale = v.visible ? 1 : 0;
    }
    this.writeInstances();
  }

  animateAction(action: State, stateAfter: State, { skip = false } = {}): number {
    if (action.type === "move") {
      const v = this.pieces.get(action.piece);
      if (v) {
        const squares = [action.from, ...action.path];
        let delay = 0;
        for (let i = 1; i < squares.length; i++) {
          const w = this.cellToWorld(squares[i][0], squares[i][1]);
          this.tween(v, { x: w.x, z: w.z }, 0.22, easeInOutCubic, delay);
          this.tween(v, { lift: 0.35 }, 0.11, easeInOutCubic, delay);
          this.tween(v, { lift: 0 }, 0.11, easeInOutCubic, delay + 0.11);
          delay += 0.22;
        }
        if (action.crowns) {
          this.tween(v, { scale: 1.18 }, 0.14, easeOutBack, delay);
          this.tween(v, { scale: 1, crowned: true }, 0.14, easeInOutCubic, delay + 0.14);
        }
      }
      for (const cid of action.captures) {
        const cv = this.pieces.get(cid);
        if (!cv) continue;
        const x = cv.x, z = cv.z;
        this.tween(cv, { lift: 0.5, scale: 0.01 }, 0.3, easeInOutCubic, 0.05, () => { cv.visible = false; });
        fx?.capture(x, 0.12, z, PIECE_COLORS[cv.color]?.color ?? 0xcfc4a4);
      }
      const last = action.path[action.path.length - 1];
      const dest = this.cellToWorld(last[0], last[1]);
      if (action.captures.length === 0) fx?.move(dest.x, 0.06, dest.z, this.trailColor);
      if (action.crowns) fx?.crown(dest.x, 0.2, dest.z, 0xffd873);
      const from = this.cellToWorld(action.from[0], action.from[1]);
      this.lastFrom.position.set(from.x, 0.103, from.z);
      this.lastTo.position.set(dest.x, 0.103, dest.z);
      this.lastFrom.visible = this.lastTo.visible = true;
    }
    if (skip) this.skipAll(stateAfter);
    return skip ? 0 : this.tweens.length ? Math.max(...this.tweens.map((t) => t.delay + t.dur)) : 0;
  }

  skipAll(stateAfter?: State): void {
    const done = this.tweens.filter((t) => t.onDone);
    this.tweens.length = 0;
    for (const t of done) t.onDone!();
    if (stateAfter) this.syncState(stateAfter);
    for (const v of this.pieces.values()) v.lift = 0;
    this.writeInstances();
  }

  tween(view: PieceView, props: Record<string, number | boolean>, dur: number, ease: (t: number) => number, delay = 0, onDone: (() => void) | null = null): void {
    const from: Record<string, number | boolean> = {};
    for (const k of Object.keys(props)) from[k] = view[k] as number | boolean;
    this.tweens.push({ view, props, from, dur, ease, delay, t: 0, onDone });
  }

  setSelection(pieceId: number | null, ghosts: { path: number[][]; captures: unknown[] }[] | null): void {
    for (const v of this.pieces.values()) v.selected = false;
    const v = pieceId != null ? this.pieces.get(pieceId) : undefined;
    if (v) { v.selected = true; this.selRing.visible = true; this.selRing.position.set(v.x, 0.105, v.z); }
    else this.selRing.visible = false;
    let gi = 0, ci = 0;
    const m = new Matrix4();
    for (const a of ghosts || []) {
      const next = a.path[0]!;
      const w = this.cellToWorld(next[0]!, next[1]!);
      m.makeRotationX(-PI / 2).setPosition(w.x, 0.106, w.z);
      if (a.captures.length > 0) { if (ci < 16) this.captureRings.setMatrixAt(ci++, m); }
      else if (gi < 40) this.ghosts.setMatrixAt(gi++, m);
    }
    this.ghosts.count = gi;
    this.captureRings.count = ci;
    this.ghosts.instanceMatrix.needsUpdate = true;
    this.captureRings.instanceMatrix.needsUpdate = true;
  }

  setHover(cell: { r: number; c: number } | null): void {
    if (cell) { const w = this.cellToWorld(cell.r, cell.c); this.hoverRing.position.set(w.x, 0.105, w.z); this.hoverRing.visible = true; }
    else this.hoverRing.visible = false;
  }

  update(dt: number): void {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]!;
      if (tw.delay > 0) { tw.delay -= dt; continue; }
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      const e = tw.ease(k);
      for (const [prop, to] of Object.entries(tw.props)) {
        const f = tw.from[prop];
        if (typeof to === "boolean") { if (k >= 1) tw.view[prop] = to; }
        else tw.view[prop] = (f as number) + (to - (f as number)) * e;
      }
      if (k >= 1) { this.tweens.splice(i, 1); tw.onDone?.(); }
    }
    const pulse = 1 + Math.sin(elapsed * 1000 / 240) * 0.06;
    for (const v of this.pieces.values()) {
      v.renderLift = v.selected ? 0.22 + 0.04 * pulse : v.lift;
      if (v.selected) this.selRing.position.set(v.x, 0.105, v.z);
    }
    this.ghostMat.opacity = 0.65 + Math.sin(elapsed * 1000 / 300) * 0.2;
    // Slow glint on the gold crowns (feeds bloom); steady under reduced motion.
    const glint = reducedMotion ? 0 : Math.max(0, Math.sin(elapsed * 1000 / 900)) ** 6;
    for (const cm of this.crownMeshes.values()) (cm.material as MeshStandardMaterial).emissiveIntensity = 1 + glint * 3;
    this.writeInstances();
  }

  writeInstances(): void {
    const m = new Matrix4(), q = new Quaternion(), pos = new Vector3(), scl = new Vector3();
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (const [color, im] of this.pieceMeshes) {
      const cm = this.crownMeshes.get(color)!;
      for (const v of this.pieces.values()) {
        if (v.color !== color) continue;
        if (v.visible && v.scale > 0.01) {
          pos.set(v.x, 0.10 + (v.renderLift || 0), v.z);
          scl.setScalar(v.scale);
          m.compose(pos, q, scl);
          im.setMatrixAt(v.inst, m);
          if (v.crowned) { pos.y += 0.30 * v.scale; m.compose(pos, q, scl); cm.setMatrixAt(v.inst, m); }
          else cm.setMatrixAt(v.inst, zero);
        } else {
          im.setMatrixAt(v.inst, zero);
          cm.setMatrixAt(v.inst, zero);
        }
      }
      im.instanceMatrix.needsUpdate = true;
      cm.instanceMatrix.needsUpdate = true;
    }
  }

  disposePieces(): void {
    for (const im of this.pieceMeshes.values()) { this.group.remove(im); }
    for (const cm of this.crownMeshes.values()) { this.group.remove(cm); }
    this.pieceMeshes.clear();
    this.crownMeshes.clear();
    this.pieces.clear();
    this.tweens.length = 0;
  }

  dispose(): void {
    this.disposePieces();
    scene.remove(this.group);
  }
}

function pieceBodyGeometry(): LatheGeometry {
  const profile = [[0.001, 0], [0.34, 0], [0.40, 0.03], [0.42, 0.08], [0.38, 0.13], [0.30, 0.16], [0.28, 0.20], [0.33, 0.24], [0.30, 0.28], [0.20, 0.30], [0.001, 0.31]];
  const geo = new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), budget.pieceSegs || 40);
  geo.computeVertexNormals();
  return geo;
}
function crownGeometry(): LatheGeometry {
  const profile = [[0.001, 0], [0.22, 0], [0.26, 0.03], [0.24, 0.08], [0.16, 0.10], [0.20, 0.16], [0.10, 0.20], [0.001, 0.22]];
  return new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), budget.crownSegs || 28);
}

// ------------------------------------------------------------------ the garden
class Garden {
  group = new Group();
  leaves: Mesh[] = [];
  flames: Mesh[] = [];
  water: Mesh | null = null;
  detailGroup = new Group();
  tufts: InstancedMesh | null = null;
  ambient: Points | null = null;
  ambVel = new Float32Array(0);
  ambCount = 0;
  surround: string;

  constructor(t: Theme, seed: number, surround = "surround-fountain") {
    this.surround = surround;
    scene.add(this.group);
    this.build(t, seed);
  }

  build(t: Theme, seed: number): void {
    const rng = createRng(seed ^ 0x5eed);
    const g = this.group;
    const ground = new Mesh(new CircleGeometry(34, 48), litMaterial({ map: tex("grass", 8), color: tint(t.ground, "grass"), roughness: 0.95 }));
    ground.rotation.x = -PI / 2;
    ground.position.y = -0.62;
    ground.receiveShadow = true;
    g.add(ground);
    const terrace = new Mesh(new CylinderGeometry(9.5, 10.2, 0.25, 40), litMaterial({ map: tex("marble-path"), color: tint(t.path, "marble-path"), roughness: 0.8 }));
    terrace.position.y = -0.55;
    terrace.receiveShadow = true;
    g.add(terrace);

    // hedge ring
    const hedgeMat = litMaterial({ map: tex("hedge", 3), color: tint(t.hedge, "hedge"), roughness: 0.9 });
    const hedges = new InstancedMesh(new BoxGeometry(3.4, 1.5, 1.1), hedgeMat, 34);
    const m4 = new Matrix4(), q = new Quaternion(), eul = new Euler();
    let hi = 0;
    const maze = this.surround === "surround-maze";
    const hedgeCount = maze ? 34 : 22, hedgeHeight = maze ? 2.3 : 1.0;
    for (let i = 0; i < hedgeCount; i++) {
      const a = (i / hedgeCount) * PI * 2;
      if (Math.abs(Math.sin(a)) < 0.35 && Math.cos(a) > 0) continue; // the gate toward the camera
      const r = 15 + rng.next() * 1.2;
      eul.set(0, -a + PI / 2, 0);
      q.setFromEuler(eul);
      m4.compose(new Vector3(Math.sin(a) * r, 0.1, Math.cos(a) * r), q, new Vector3(1, (0.9 + rng.next() * 0.3) * hedgeHeight, 1));
      hedges.setMatrixAt(hi++, m4);
    }
    hedges.count = hi;
    hedges.instanceMatrix.needsUpdate = true;
    hedges.castShadow = true;
    hedges.receiveShadow = true;
    g.add(hedges);

    if (t.env.trees) {
      const trunkMat = litMaterial({ color: 0x5a4632, roughness: 0.9 });
      const leafMat = litMaterial({ color: shade(t.hedge, 1.15), roughness: 0.85 });
      const trunkGeo = new CylinderGeometry(0.14, 0.22, 1.8, 8);
      const leafGeo = new IcosahedronGeometry(1.15, 1);
      for (const [x, z] of [[-13, -9], [13, -10], [-15, 4], [15, 6], [-8, -14], [9, -15]] as [number, number][]) {
        const trunk = new Mesh(trunkGeo, trunkMat);
        trunk.position.set(x, 0.25, z);
        trunk.castShadow = true;
        g.add(trunk);
        for (let b = 0; b < 3; b++) {
          const leaf = new Mesh(leafGeo, leafMat);
          leaf.position.set(x + (rng.next() - 0.5) * 1.2, 1.5 + b * 0.75 + rng.next() * 0.3, z + (rng.next() - 0.5) * 1.2);
          leaf.scale.setScalar(0.8 + rng.next() * 0.5);
          leaf.castShadow = true;
          leaf.userData = { base: leaf.position.clone(), phase: rng.next() * PI * 2 };
          g.add(leaf);
          this.leaves.push(leaf);
        }
      }
    }

    if (t.env.fountain) {
      const stoneMat = litMaterial({ map: tex("marble-frame"), color: tint(t.frame, "marble-frame"), roughness: 0.7 });
      const basin = new Mesh(new CylinderGeometry(1.7, 1.9, 0.6, 24), stoneMat);
      basin.position.set(0, -0.3, -11.5);
      basin.castShadow = true;
      basin.receiveShadow = true;
      g.add(basin);
      const pillar = new Mesh(new CylinderGeometry(0.22, 0.34, 1.5, 12), stoneMat);
      pillar.position.set(0, 0.6, -11.5);
      pillar.castShadow = true;
      g.add(pillar);
      this.water = new Mesh(new CircleGeometry(1.55, 32),
        litMaterial({ color: t.water, roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.9 }, true));
      this.water.rotation.x = -PI / 2;
      this.water.position.set(0, 0.02, -11.5);
      g.add(this.water);
    }

    const wantLanterns = t.env.lanterns || this.surround === "surround-lanterns";
    const wantTorches = t.env.torches;
    if (wantLanterns || wantTorches) {
      const postGeo = new CylinderGeometry(0.06, 0.09, 1.6, 8);
      const postMat = litMaterial({ color: 0x3a3430, roughness: 0.8 });
      const glowColor = wantTorches ? 0xff9a4a : 0xffd9a0;
      for (const [x, z] of [[-7.5, 7.5], [7.5, 7.5], [-7.5, -7.5], [7.5, -7.5]] as [number, number][]) {
        const post = new Mesh(postGeo, postMat);
        post.position.set(x, 0.15, z);
        post.castShadow = true;
        g.add(post);
        const glow = new Mesh(new SphereGeometry(0.18, 10, 8), litMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 5 }));
        glow.position.set(x, 1.05, z);
        g.add(glow);
        this.flames.push(glow);
      }
    }

    const flowerGeo = new IcosahedronGeometry(0.09, 0);
    for (const [mat, count] of [[litMaterial({ color: t.flowerA, roughness: 0.7 }), 60], [litMaterial({ color: t.flowerB, roughness: 0.7 }), 60]] as [LitMat, number][]) {
      const inst = new InstancedMesh(flowerGeo, mat, count);
      for (let i = 0; i < count; i++) {
        const a = rng.next() * PI * 2, r = 11 + rng.next() * 12;
        m4.compose(new Vector3(Math.sin(a) * r, -0.5, Math.cos(a) * r), q.identity(), new Vector3(0.6 + rng.next(), 0.6 + rng.next(), 0.6 + rng.next()));
        inst.setMatrixAt(i, m4);
      }
      inst.instanceMatrix.needsUpdate = true;
      g.add(inst);
    }

    // Detailed dressing: grass tufts, a ring of kerb stones and a second scatter of blossoms.
    const tufts = new InstancedMesh(new ConeGeometry(0.07, 0.34, 5), litMaterial({ color: shade(t.ground, 1.12), roughness: 0.9 }), TUFT_MAX);
    for (let i = 0; i < TUFT_MAX; i++) {
      const a = rng.next() * PI * 2, r = 10.4 + Math.pow(rng.next(), 1.6) * 13;
      eul.set((rng.next() - 0.5) * 0.5, rng.next() * 6, (rng.next() - 0.5) * 0.5);
      q.setFromEuler(eul);
      const sc = 0.6 + rng.next() * 0.9;
      m4.compose(new Vector3(Math.sin(a) * r, -0.5, Math.cos(a) * r), q, new Vector3(sc, sc, sc));
      tufts.setMatrixAt(i, m4);
    }
    tufts.instanceMatrix.needsUpdate = true;
    tufts.count = budget.tufts;
    this.tufts = tufts;
    this.detailGroup.add(tufts);
    const kerbMat = litMaterial({ map: tex("marble-path"), color: tint(t.path, "marble-path"), roughness: 0.85 });
    const kerbs = new InstancedMesh(new BoxGeometry(0.9, 0.16, 0.42), kerbMat, 44);
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * PI * 2;
      eul.set(0, a, 0);
      q.setFromEuler(eul);
      m4.compose(new Vector3(Math.sin(a) * 10.25, -0.42, Math.cos(a) * 10.25), q, new Vector3(1, 0.9 + rng.next() * 0.2, 1));
      kerbs.setMatrixAt(i, m4);
    }
    kerbs.instanceMatrix.needsUpdate = true;
    kerbs.receiveShadow = true;
    this.detailGroup.add(kerbs);
    const blossom = new InstancedMesh(flowerGeo, litMaterial({ color: 0xf4efe0, roughness: 0.7 }), 70);
    for (let i = 0; i < 70; i++) {
      const a = rng.next() * PI * 2, r = 10.8 + rng.next() * 10;
      m4.compose(new Vector3(Math.sin(a) * r, -0.48, Math.cos(a) * r), q.identity(), new Vector3(0.5 + rng.next() * 0.5, 0.5, 0.5 + rng.next() * 0.5));
      blossom.setMatrixAt(i, m4);
    }
    blossom.instanceMatrix.needsUpdate = true;
    this.detailGroup.add(blossom);
    g.add(this.detailGroup);

    // Ambient drifting particles (petals / snow / embers).
    const ambColor = t.env.snow ? 0xffffff : t.env.torches ? 0xffb060 : 0xe8a0b0;
    const ambCount = AMBIENT_MAX;
    const pos = new Float32Array(ambCount * 3);
    this.ambVel = new Float32Array(ambCount * 3);
    for (let i = 0; i < ambCount; i++) {
      pos[i * 3] = (rng.next() - 0.5) * 36;
      pos[i * 3 + 1] = rng.next() * 10;
      pos[i * 3 + 2] = (rng.next() - 0.5) * 36;
      this.ambVel[i * 3] = (rng.next() - 0.5) * 0.3;
      this.ambVel[i * 3 + 1] = t.env.snow ? -(0.25 + rng.next() * 0.3) : -(0.12 + rng.next() * 0.2);
      this.ambVel[i * 3 + 2] = (rng.next() - 0.5) * 0.3;
    }
    const ambGeo = new BufferGeometry();
    ambGeo.setAttribute("position", new BufferAttribute(pos, 3));
    this.ambient = new Points(ambGeo, new PointsMaterial({
      color: ambColor, size: t.env.snow ? 0.07 : 0.09, map: softDiscTexture(), transparent: true, opacity: 0.8, depthWrite: false,
    }));
    this.ambient.frustumCulled = false;
    this.ambient.noAO = true;
    this.ambCount = ambCount;
    this.snow = !!t.env.snow;
    g.add(this.ambient);
    this.setDetail();
  }
  snow = false;

  /** How many petals the budget draws (the same seeded flight for every count). */
  private ambientShown(): number {
    return Math.max(1, Math.min(this.ambCount, Math.round(budget.ambient * (this.snow ? 260 / 140 : 1))));
  }

  update(dt: number): void {
    if (reducedMotion) return;
    if (this.water) this.water.position.y = 0.02 + Math.sin(elapsed * 1.4) * 0.015;
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i]!;
      f.scale.setScalar(1 + Math.sin(elapsed * 9 + i * 1.7) * 0.08);
      (f.material as MeshStandardMaterial).emissiveIntensity = 4.6 + Math.sin(elapsed * 7.3 + i) * 0.25 + Math.sin(elapsed * 13.1 + i * 2.3) * 0.15;
    }
    for (const leaf of this.leaves) {
      const b = leaf.userData.base as Vector3, ph = leaf.userData.phase as number;
      leaf.position.x = b.x + Math.sin(elapsed * 0.9 + ph) * 0.05;
      leaf.position.z = b.z + Math.sin(elapsed * 0.7 + ph * 1.3) * 0.035;
    }
    if (this.ambient && this.ambient.visible) {
      const attr = this.ambient.geometry.attributes.position!;
      const arr = attr.array as Float32Array;
      const n = this.ambientShown();
      for (let i = 0; i < n; i++) {
        arr[i * 3] = arr[i * 3]! + this.ambVel[i * 3]! * dt + Math.sin(elapsed * 0.7 + i) * 0.0015;
        arr[i * 3 + 1] = arr[i * 3 + 1]! + this.ambVel[i * 3 + 1]! * dt;
        arr[i * 3 + 2] = arr[i * 3 + 2]! + this.ambVel[i * 3 + 2]! * dt;
        if (arr[i * 3 + 1]! < -0.6) arr[i * 3 + 1] = 9 + (i % 3);
      }
      attr.needsUpdate = true;
    }
  }

  /** Graphics tiers: `particles` gates ambient drift, `detail` the extra dressing. */
  setDetail(): void {
    if (this.ambient) {
      this.ambient.visible = look?.particles === "high" && !reducedMotion;
      this.ambient.geometry.setDrawRange(0, this.ambientShown());
    }
    if (this.tufts) this.tufts.count = Math.min(TUFT_MAX, budget.tufts);
    this.detailGroup.visible = !!look?.detailed;
  }

  dispose(): void { scene.remove(this.group); }
}

function shade(hex: number, factor: number): Color {
  return new Color(hex).multiplyScalar(factor);
}

// ------------------------------------------------------------------ particle bursts
const POOL = 2000;
class FxPool {
  pos = new Float32Array(POOL * 3);
  vel = new Float32Array(POOL * 3);
  col = new Float32Array(POOL * 3);
  life = new Float32Array(POOL);
  capacity = 900;
  cursor = 0;
  points: Points;
  c = new Color();
  live = 0;
  constructor() {
    for (let i = 0; i < POOL; i++) this.pos[i * 3 + 1] = -999;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new BufferAttribute(this.col, 3));
    this.points = new Points(geo, new PointsMaterial({ size: 0.09, map: softDiscTexture(), transparent: true, depthWrite: false, vertexColors: true, opacity: 0.95 }));
    this.points.frustumCulled = false;
    this.points.noAO = true;
    scene.add(this.points);
  }
  setTier(high: boolean): void { this.capacity = high ? 2000 : 300; this.cursor %= this.capacity; }
  emit(x: number, y: number, z: number, o: { count?: number; color?: number; color2?: number | null; speed?: number; up?: number; life?: number; spread?: number }): void {
    let count = o.count ?? 12;
    const speed = o.speed ?? 1.6, up = o.up ?? 1.2, life = o.life ?? 0.7, spread = o.spread ?? 0.25;
    if (reducedMotion) count = Math.min(count, 4);
    const c1 = this.c.set(o.color ?? 0xffffff);
    const r1 = c1.r, g1 = c1.g, b1 = c1.b;
    let r2 = r1, g2 = g1, b2 = b1;
    if (o.color2 != null) { const c2 = this.c.set(o.color2); r2 = c2.r; g2 = c2.g; b2 = c2.b; }
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const p3 = idx * 3;
      this.pos[p3] = x + (Math.random() - 0.5) * spread;
      this.pos[p3 + 1] = y + Math.random() * 0.05;
      this.pos[p3 + 2] = z + (Math.random() - 0.5) * spread;
      const a = Math.random() * PI * 2, sp = speed * (0.4 + Math.random() * 0.8);
      this.vel[p3] = Math.cos(a) * sp;
      this.vel[p3 + 1] = up * (0.5 + Math.random());
      this.vel[p3 + 2] = Math.sin(a) * sp;
      const t = Math.random();
      this.col[p3] = r1 + (r2 - r1) * t;
      this.col[p3 + 1] = g1 + (g2 - g1) * t;
      this.col[p3 + 2] = b1 + (b2 - b1) * t;
      this.life[idx] = life * (0.6 + Math.random() * 0.8);
    }
    this.live = Math.max(this.live, 2);
  }
  move(x: number, y: number, z: number, color: number): void { this.emit(x, y, z, { count: 8, color, speed: 0.7, up: 0.6, life: 0.45 }); }
  capture(x: number, y: number, z: number, color: number): void { this.emit(x, y, z, { count: 26, color, color2: 0xfff2cc, speed: 2.2, up: 1.6, life: 0.8, spread: 0.3 }); }
  crown(x: number, y: number, z: number, color: number): void { this.emit(x, y, z, { count: 40, color: 0xffe08a, color2: color, speed: 1.6, up: 2.4, life: 1.1, spread: 0.2 }); }
  roundEnd(x: number, y: number, z: number, color: number): void { this.emit(x, y, z, { count: 90, color, color2: 0xffffff, speed: 3.2, up: 2.8, life: 1.4, spread: 1.2 }); }
  update(dt: number): void {
    if (this.live <= 0) return;
    let any = false;
    for (let i = 0; i < POOL; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i] = this.life[i]! - dt;
      const p3 = i * 3;
      if (this.life[i]! <= 0) { this.pos[p3 + 1] = -999; any = true; continue; }
      any = true;
      this.vel[p3 + 1] = this.vel[p3 + 1]! - 3.4 * dt;
      this.pos[p3] = this.pos[p3]! + this.vel[p3]! * dt;
      this.pos[p3 + 1] = this.pos[p3 + 1]! + this.vel[p3 + 1]! * dt;
      this.pos[p3 + 2] = this.pos[p3 + 2]! + this.vel[p3 + 2]! * dt;
    }
    this.points.geometry.attributes.position!.needsUpdate = true;
    this.points.geometry.attributes.color!.needsUpdate = true;
    if (!any) this.live--;
  }
}

// ------------------------------------------------------------------ camera rig
class Spring {
  x: number; v = 0; target: number;
  constructor(value: number, public k = 42, public zeta = 1) { this.x = value; this.target = value; }
  update(dt: number): void {
    const steps = Math.max(1, Math.ceil(dt / 0.016)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const f = -this.k * (this.x - this.target) - 2 * this.zeta * Math.sqrt(this.k) * this.v;
      this.v += f * h;
      this.x += this.v * h;
    }
  }
  snap(v: number): void { this.x = v; this.target = v; this.v = 0; }
}
const rig = {
  size: 8, preset: "classic", fitScale: 1,
  dist: new Spring(16.4), height: new Spring(12.6), lookX: new Spring(0), lookZ: new Spring(0), azimuth: new Spring(0),
  shakeAmp: 0, shakeT: 0, idleT: 0, focusUntil: 0,
  tmp: new Vector3(),
  goTo(name: string, snap = false): void {
    const p = FRAMING.presets[name] || FRAMING.presets.classic!;
    this.preset = name in FRAMING.presets ? name : "classic";
    const scale = FRAMING.distPerSize(this.size);
    if (snap || reducedMotion) {
      this.dist.snap(p.dist * scale); this.height.snap(p.height * scale);
      this.lookX.snap(0); this.lookZ.snap(0); this.azimuth.snap(p.azimuth);
    } else {
      this.dist.target = p.dist * scale; this.height.target = p.height * scale;
      this.lookX.target = 0; this.lookZ.target = 0; this.azimuth.target = p.azimuth;
    }
  },
  focusOn(x: number, z: number, strength = 0.35): void {
    if (reducedMotion) return;
    this.lookX.target = x * strength;
    this.lookZ.target = z * strength;
    this.focusUntil = elapsed + 0.9;
  },
  shake(tier: "small" | "big"): void {
    if (reducedMotion) return;
    this.shakeAmp = Math.max(this.shakeAmp, tier === "big" ? 0.10 : 0.035);
    this.shakeT = 0;
  },
  update(dt: number): void {
    if (this.focusUntil && elapsed >= this.focusUntil) { this.focusUntil = 0; this.lookX.target = 0; this.lookZ.target = 0; }
    this.dist.update(dt); this.height.update(dt); this.lookX.update(dt); this.lookZ.update(dt); this.azimuth.update(dt);
    this.idleT += dt;
    const az = this.azimuth.x, fit = this.fitScale || 1;
    const d = this.dist.x * fit, h = this.height.x * (0.9 + 0.35 * fit);
    this.tmp.set(Math.sin(az) * d, h, Math.cos(az) * d);
    if (!reducedMotion) {
      this.tmp.x += Math.sin(this.idleT * 0.23) * 0.05;
      this.tmp.y += Math.sin(this.idleT * 0.31) * 0.03;
    }
    if (this.shakeAmp > 0.0005) {
      this.shakeT += dt;
      const s = this.shakeAmp * Math.exp(-this.shakeT * 6);
      this.tmp.x += (Math.random() - 0.5) * 2 * s;
      this.tmp.y += (Math.random() - 0.5) * 1.2 * s;
      this.tmp.z += (Math.random() - 0.5) * 2 * s;
      if (s < 0.0005) this.shakeAmp = 0;
    } else this.shakeAmp = 0;
    camera.position.copy(this.tmp);
    camera.lookAt(this.lookX.x, FRAMING.presets[this.preset]?.lookY ?? 0.2, this.lookZ.x - 0.4);
  },
};

// ------------------------------------------------------------------ the facade
let board: BoardView | null = null;
let garden: Garden | null = null;
let fx: FxPool | null = null;
let lastState: State | null = null;
let boardKey = "";

const trailColor = (): number => ({ "trail-petals": 0xe8a0b0, "trail-sparks": 0xff9a4a, "trail-snow": 0xffffff } as Record<string, number>)[cosmetics.trail || ""] ?? 0xcfc4a4;

/** The look for the frame's graphics level; cheap when nothing changed. */
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const prevBudget = look ? JSON.stringify(look.budget) : "";
  const rebuild = !!look && ["material", "texture", "pieceSegs", "crownSegs"].some((k) => (look!.budget as unknown as Record<string, unknown>)[k] !== (next.budget as unknown as Record<string, unknown>)[k]);
  look = next;
  budget = next.budget;
  if (!built) build();
  const shadows = next.shadows > 0;
  renderer.shadowMap.enabled = shadows;
  sun.castShadow = shadows;
  if (shadows) sun.shadow.mapSize = next.shadows;
  if (next.reflections && !envTex) {
    const pmrem = new PMREMGenerator(renderer);
    envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  }
  // The garden gets a faint wash; the board and pieces bind the map with their own strengths.
  scene.environment = next.reflections ? envTex : null;
  scene.environmentIntensity = 0.22;
  fx?.setTier(next.particles === "high");
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.45, distanceExponent: 1.6, thickness: 1.0, scale: 1.0, samples: next.ao === "high" ? 16 : 8,
    resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // HDR threshold: only lanterns, torches and glints on gold crowns and polished stone bloom.
  // r185 bloom (the default model); this page ran three r180 (r177+), so its strength is kept.
  renderer.bloom = next.bloom ? { strength: 0.5, radius: 0.45, threshold: 2.4, resolution: next.budget.bloomRes } : null;
  // The grade ShaderPass after OutputPass: gentle S-curve, a touch more
  // saturation, warm highlights / cool shadows, a soft vignette.
  renderer.grade = next.grade ? {
    space: "display", contrastCurve: "s", contrast: 0.18, saturation: 1.07, // the page's S-curve after OutputPass
    shadows: [0.97, 0.99, 1.04], highlights: [1.035, 1.0, 0.965], split: [0.2, 0.8],
    vignette: { amount: 0.2, inner: 0.38, outer: 0.85 },
  } : null;
  renderer.antialias = next.antialias;
  if (rebuild || prevBudget === "") setTheme(themeId, seedNow, true);
  else { garden?.setDetail(); board?.setLook(); }
  applyHemi();
}
function applyHemi(): void {
  const t = THEMES[themeId] || THEMES["royal-garden"];
  hemi.intensity = t.hemi.intensity * (look?.reflections ? 0.85 : 1);
}

export function setTheme(id: string, seed = 1, force = false): void {
  const t = THEMES[id] || THEMES["royal-garden"];
  if (themeId === id && garden && !force) return;
  themeId = t.id;
  seedNow = seed;
  if (!look) return; // built on the first look
  scene.fog = new FogExp2(t.fog, t.fogDensity);
  if (sky) scene.remove(sky);
  sky = buildSky(t);
  scene.add(sky);
  sun.color.set(t.sun.color);
  sun.intensity = t.sun.intensity;
  sun.position.set(t.sun.position[0], t.sun.position[1], t.sun.position[2]);
  hemi.color.set(t.hemi.sky);
  hemi.groundColor.set(t.hemi.ground);
  applyHemi();
  garden?.dispose();
  garden = new Garden(t, seed, cosmetics.surround);
  board?.dispose();
  board = null;
  boardKey = "";
  if (lastState) loadState(lastState, { snap: true });
}

/** Cosmetics only ever alter materials, trails and surrounds. */
export function setCosmetics(c: Record<string, string>): void {
  const before = JSON.stringify(cosmetics);
  cosmetics = { ...c };
  if (before !== JSON.stringify(cosmetics) && garden) setTheme(themeId, seedNow, true);
}

export function setReducedMotion(v: boolean): void {
  if (reducedMotion === v) return;
  reducedMotion = v;
  garden?.setDetail();
}

/** Builds (or reuses) the board for a state. */
export function loadState(state: State, { snap = true } = {}): void {
  lastState = state;
  if (!look) return;
  const key = [state.size, state.players.map((p: { color: string }) => p.color).join(), state.pieces.map((p: { id: number }) => p.id).sort().join(",")].join("|");
  if (board && key === boardKey) { board.syncState(state); return; }
  board?.dispose();
  board = new BoardView(THEMES[themeId] || THEMES["royal-garden"]);
  board.cosmetics = cosmetics;
  board.trailColor = trailColor();
  board.buildFor(state);
  boardKey = key;
  rig.size = state.size;
  fitShadow(state.size);
  rig.goTo(rig.preset, snap);
}

export function syncState(state: State): void {
  lastState = state;
  board?.syncState(state);
}

/** The cosmetic animation for an applied action; its approximate length (s). */
export function playAction(action: State, stateAfter: State, { skip = false } = {}): number {
  if (!board) return 0;
  board.trailColor = trailColor();
  const dur = board.animateAction(action, stateAfter, { skip });
  if (action.type === "move" && !skip) {
    if (action.captures.length >= 2) rig.shake("small");
    if (action.crowns) {
      const last = action.path[action.path.length - 1];
      const w = board.cellToWorld(last[0], last[1]);
      rig.focusOn(w.x, w.z);
    }
  }
  return dur;
}
export function skipAll(state: State): void { board?.skipAll(state); }
export function roundEndFx(): void {
  fx?.roundEnd(0, 0.3, 0, 0xffd873);
  rig.shake("big");
}
export function setSelection(pieceId: number | null, ghosts: { path: number[][]; captures: unknown[] }[] | null): void { board?.setSelection(pieceId, ghosts); }
export function setHover(cell: { r: number; c: number } | null): void { board?.setHover(cell); }
export function setCameraPreset(preset: string): void { rig.goTo(preset); }

const _ray = new Raycaster();
const _plane = new Plane(new Vector3(0, 1, 0), -0.1);
const _hit = new Vector3();
/** The board cell under a window pixel, or null. */
export function pickCell(x: number, y: number): { r: number; c: number } | null {
  if (!board) return null;
  _ray.setFromCamera(pointerToNdc(x, y), camera);
  if (!_ray.ray.intersectPlane(_plane, _hit)) return null;
  const half = board.size / 2;
  if (Math.abs(_hit.x) > half || Math.abs(_hit.z) > half) return null;
  return board.worldToCell(_hit.x, _hit.z);
}

/** Per frame: the camera's aspect from the window, the rig, tweens, the garden and bursts. */
export function update(dtRaw: number, width: number, height: number, paused: boolean): void {
  if (!look) return;
  const dt = Math.min(0.25, Math.max(0, dtRaw || 0));
  if (width > 0 && height > 0) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // Narrow viewports pull back so the board always fits.
    rig.fitScale = Math.min(2.6, Math.max(1, 1.42 / camera.aspect));
  }
  if (paused) { rig.update(0); return; }
  elapsed += dt;
  rig.update(dt);
  board?.update(dt);
  garden?.update(dt);
  fx?.update(dt);
}
