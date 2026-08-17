// Board view: carved stone board, instanced pieces, selection/ghost layer,
// pick plane, and DOM projection anchors. Renders from snapshots; animation
// tweens are cosmetic and always settle into the exact deterministic state.

import * as THREE from '../../vendor/three.module.js';
import { marbleTexture, slateTexture, softDiscTexture } from './textures.js';

export const LAYER_ENV = 0;
export const LAYER_GAME = 1;
export const LAYER_SELECT = 2;

const PIECE_COLORS = {
  ivory: { color: 0xece2c8, rough: 0.5 },
  onyx: { color: 0x4c5468, rough: 0.4 },
  jade: { color: 0x54a078, rough: 0.45 },
  ember: { color: 0xc05c40, rough: 0.48 },
};

/** Cosmetic material variants for the first house (never affect gameplay). */
const MATERIAL_TINTS = {
  'marble-ivory': null,
  'material-jade': 0xa8d8c0,
  'material-amber': 0xf0c070,
  'material-moonstone': 0xd8e0f8,
  'slate-onyx': null,
};

function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function easeOutBack(t) { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

export class BoardView {
  constructor(scene, theme) {
    this.scene = scene;
    this.theme = theme;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.size = 8;
    this.pieces = new Map();      // pieceId -> view state
    this.tweens = [];
    this.cellGeoCache = new Map();
    this._buildStatic();
    this._buildMarkers();
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._v3 = new THREE.Vector3();
  }

  cellToWorld(r, c, out = new THREE.Vector3()) {
    const mid = (this.size - 1) / 2;
    out.set(c - mid, 0, mid - r);
    return out;
  }

  worldToCell(x, z) {
    const mid = (this.size - 1) / 2;
    const c = Math.round(x + mid);
    const r = Math.round(mid - z);
    if (r < 0 || c < 0 || r >= this.size || c >= this.size) return null;
    return { r, c };
  }

  _buildStatic() {
    const t = this.theme;
    // plinth: carved stone slab with a stepped edge
    const slabMat = new THREE.MeshStandardMaterial({ map: marbleTexture(numToHex(t.frame), '#6a5a44', 3), roughness: 0.7, metalness: 0.05 });
    this.slab = new THREE.Mesh(new THREE.BoxGeometry(1, 0.55, 1), slabMat);
    this.slab.position.y = -0.3;
    this.slab.receiveShadow = true;
    this.slab.layers.set(LAYER_ENV);
    this.group.add(this.slab);
    // support the cells rest on; its top stays BELOW the cell tops
    this.frame = new THREE.Mesh(new THREE.BoxGeometry(1, 0.14, 1), slabMat.clone());
    this.frame.position.y = -0.055;
    this.frame.receiveShadow = true;
    this.frame.layers.set(LAYER_ENV);
    this.group.add(this.frame);
    // raised border rails around the play area
    this.rails = new THREE.Group();
    const railMat = slabMat.clone();
    this.railN = new THREE.Mesh(new THREE.BoxGeometry(1, 0.16, 0.5), railMat);
    this.railS = this.railN.clone();
    this.railE = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 1), railMat);
    this.railW = this.railE.clone();
    for (const r of [this.railN, this.railS, this.railE, this.railW]) {
      r.castShadow = true;
      r.receiveShadow = true;
      r.layers.set(LAYER_ENV);
      this.rails.add(r);
    }
    this.group.add(this.rails);
    // corner ornaments
    this.ornaments = new THREE.Group();
    const ornGeo = new THREE.SphereGeometry(0.16, 12, 10);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(ornGeo, slabMat);
      m.layers.set(LAYER_ENV);
      m.castShadow = true;
      this.ornaments.add(m);
    }
    this.group.add(this.ornaments);
    // cells parent
    this.cellsGroup = new THREE.Group();
    this.group.add(this.cellsGroup);
    // invisible pick plane on the game layer
    this.pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.pickPlane.rotation.x = -Math.PI / 2;
    this.pickPlane.layers.set(LAYER_GAME);
    this.group.add(this.pickPlane);
  }

  _buildMarkers() {
    const discTex = softDiscTexture();
    // selection ring
    this.selRing = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.47, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd873, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.selRing.rotation.x = -Math.PI / 2;
    this.selRing.position.y = 0.105;
    this.selRing.visible = false;
    this.selRing.layers.set(LAYER_SELECT);
    this.group.add(this.selRing);
    // hover ring
    this.hoverRing = this.selRing.clone();
    this.hoverRing.material = this.selRing.material.clone();
    this.hoverRing.material.opacity = 0.4;
    this.hoverRing.layers.set(LAYER_SELECT);
    this.group.add(this.hoverRing);
    // last-move from/to discs
    this.lastFrom = new THREE.Mesh(
      new THREE.CircleGeometry(0.2, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.lastFrom.rotation.x = -Math.PI / 2;
    this.lastFrom.position.y = 0.103;
    this.lastFrom.visible = false;
    this.lastFrom.layers.set(LAYER_SELECT);
    this.group.add(this.lastFrom);
    this.lastTo = this.lastFrom.clone();
    this.lastTo.layers.set(LAYER_SELECT);
    this.group.add(this.lastTo);
    // legal-target ghosts: small instanced discs
    this.ghostGeo = new THREE.CircleGeometry(0.15, 20);
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0xa8e890, transparent: true, opacity: 0.85, depthWrite: false, map: discTex });
    this.ghosts = new THREE.InstancedMesh(this.ghostGeo, this.ghostMat, 40);
    this.ghosts.count = 0;
    this.ghosts.layers.set(LAYER_SELECT);
    this.ghosts.raycast = () => {};
    this.group.add(this.ghosts);
    this.captureRingMat = new THREE.MeshBasicMaterial({ color: 0xff9a5c, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    this.captureRings = new THREE.InstancedMesh(new THREE.RingGeometry(0.36, 0.44, 28), this.captureRingMat, 16);
    this.captureRings.count = 0;
    this.captureRings.layers.set(LAYER_SELECT);
    this.captureRings.raycast = () => {};
    this.group.add(this.captureRings);
  }

  /** Rebuild board geometry for a new game state. */
  buildFor(state, decorRng) {
    this.disposePieces();
    this.size = state.size;
    const s = this.size;
    const t = this.theme;
    // scale statics
    this.slab.scale.set(s + 2.6, 1, s + 2.6);
    this.frame.scale.set(s + 1.15, 1, s + 1.15);
    this.pickPlane.scale.set(s + 0.001, s + 0.001, 1);
    const railOff = s / 2 + 0.32;
    this.railN.scale.set(s + 1.3, 1, 1);
    this.railN.position.set(0, 0.06, -railOff);
    this.railS.scale.set(s + 1.3, 1, 1);
    this.railS.position.set(0, 0.06, railOff);
    this.railE.scale.set(1, 1, s + 1.3);
    this.railE.position.set(railOff, 0.06, 0);
    this.railW.scale.set(1, 1, s + 1.3);
    this.railW.position.set(-railOff, 0.06, 0);
    const off = (s + 1.15) / 2 - 0.28;
    this.ornaments.children.forEach((m, i) => {
      m.position.set((i & 1 ? 1 : -1) * off, 0.2, (i & 2 ? 1 : -1) * off);
    });
    // cells: two instanced meshes (light/dark) keep draw calls flat on any size
    if (this.cellsMeshLight) {
      this.group.remove(this.cellsMeshLight, this.cellsMeshDark);
      this.cellsMeshLight.geometry.dispose();
    }
    const lightMat = new THREE.MeshStandardMaterial({ map: marbleTexture(numToHex(t.stoneLight), '#b0a488', 17 + s), roughness: 0.55 });
    const darkMat = new THREE.MeshStandardMaterial({ map: slateTexture(numToHex(t.stoneDark), 23 + s), roughness: 0.6, color: new THREE.Color(0x9aa0b0) });
    const cellGeo = new THREE.BoxGeometry(0.955, 0.09, 0.955);
    const lightCells = [];
    const darkCells = [];
    for (let r = 0; r < s; r++) {
      for (let c = 0; c < s; c++) {
        (((r + c) & 1) === 1 ? darkCells : lightCells).push([r, c]);
      }
    }
    const mkCells = (list, mat, raised) => {
      const im = new THREE.InstancedMesh(cellGeo, mat, Math.max(1, list.length));
      const m4 = new THREE.Matrix4();
      list.forEach(([r, c], i) => {
        m4.setPosition(c - (s - 1) / 2, 0.045 + (raised ? 0.008 : 0), (s - 1) / 2 - r);
        im.setMatrixAt(i, m4);
      });
      im.receiveShadow = true;
      im.layers.set(LAYER_ENV);
      im.raycast = () => {}; // picking goes through the cell plane
      this.group.add(im);
      return im;
    };
    this.cellsMeshLight = mkCells(lightCells, lightMat, false);
    this.cellsMeshDark = mkCells(darkCells, darkMat, true);
    // pieces: one InstancedMesh per house color, plus crown markers
    const colors = [...new Set(state.players.map((p) => p.color))];
    this.pieceMeshes = new Map();
    this.crownMeshes = new Map();
    const bodyGeo = pieceBodyGeometry();
    const crownGeo = crownGeometry();
    for (const color of colors) {
      const maxForColor = state.pieces.filter((p) => state.players[p.owner].color === color).length + 2;
      const spec = { ...(PIECE_COLORS[color] || PIECE_COLORS.ivory) };
      if (color === 'ivory') {
        const tint = MATERIAL_TINTS[this.cosmetics?.material];
        if (tint) spec.color = tint;
      }
      const mat = new THREE.MeshStandardMaterial({
        color: spec.color, roughness: spec.rough, metalness: 0.12,
        map: color === 'onyx' ? slateTexture(numToHex(spec.color), 41) : marbleTexture(numToHex(spec.color), '#00000022', 43),
      });
      const im = new THREE.InstancedMesh(bodyGeo, mat, maxForColor);
      im.castShadow = true;
      im.receiveShadow = true;
      im.layers.set(LAYER_GAME);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.raycast = () => {}; // picking goes through the cell plane
      this.group.add(im);
      this.pieceMeshes.set(color, im);
      const cm = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.35, metalness: 0.65, emissive: 0x332200 }), maxForColor);
      cm.castShadow = true;
      cm.layers.set(LAYER_GAME);
      cm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      cm.raycast = () => {};
      this.group.add(cm);
      this.crownMeshes.set(color, cm);
    }
    // per-piece view state
    this.pieces.clear();
    const perColorCount = new Map();
    for (const p of state.pieces) {
      const color = state.players[p.owner].color;
      const idx = perColorCount.get(color) || 0;
      perColorCount.set(color, idx + 1);
      const w = this.cellToWorld(p.r, p.c);
      this.pieces.set(p.id, {
        id: p.id, color, inst: idx,
        x: w.x, z: w.z, y: 0, lift: 0, scale: p.captured ? 0 : 1,
        crowned: p.crowned, visible: !p.captured,
        selected: false, wobble: 0,
      });
    }
    // only draw the instances that exist — spare capacity stays invisible
    for (const [color, im] of this.pieceMeshes) {
      im.count = perColorCount.get(color) || 0;
      const cm = this.crownMeshes.get(color);
      if (cm) cm.count = im.count;
    }
    this._writeInstances();
  }

  /** Set targets from a fresh snapshot (idempotent). */
  syncState(state) {
    for (const p of state.pieces) {
      const v = this.pieces.get(p.id);
      if (!v) continue;
      const w = this.cellToWorld(p.r, p.c);
      v.tx = w.x; v.tz = w.z;
      v.tCrowned = p.crowned;
      v.tVisible = !p.captured;
    }
    // spring toward targets without queueing tweens (used on load/resume)
    for (const v of this.pieces.values()) {
      if (v.tVisible !== undefined) {
        v.x = v.tx; v.z = v.tz;
        v.crowned = v.tCrowned;
        v.visible = v.tVisible;
        v.scale = v.visible ? 1 : 0;
      }
    }
    this._writeInstances();
  }

  /** Cosmetic animation for an applied action. */
  animateAction(action, stateAfter, fx, { skip = false } = {}) {
    if (action.type === 'move') {
      const v = this.pieces.get(action.piece);
      if (v) {
        const squares = [action.from, ...action.path];
        let delay = 0;
        for (let i = 1; i < squares.length; i++) {
          const w = this.cellToWorld(squares[i][0], squares[i][1]);
          this._tween(v, { x: w.x, z: w.z }, 0.22, easeInOutCubic, delay);
          // little hop per step
          this._tween(v, { lift: 0.35 }, 0.11, easeInOutCubic, delay);
          this._tween(v, { lift: 0 }, 0.11, easeInOutCubic, delay + 0.11);
          delay += 0.22;
        }
        if (action.crowns) {
          this._tween(v, { scale: 1.18 }, 0.14, easeOutBack, delay);
          this._tween(v, { scale: 1, crowned: true }, 0.14, easeInOutCubic, delay + 0.14);
        }
      }
      for (const cid of action.captures) {
        const cv = this.pieces.get(cid);
        if (!cv) continue;
        const at = new THREE.Vector3(cv.x, 0.1, cv.z);
        this._tween(cv, { lift: 0.5, scale: 0.01 }, 0.3, easeInOutCubic, 0.05, () => { cv.visible = false; });
        fx?.capture(at.x, 0.12, at.z, colorHex(PIECE_COLORS[cv.color]?.color));
      }
      const dest = this.cellToWorld(action.path[action.path.length - 1][0], action.path.at(-1)[1]);
      if (action.captures.length === 0) fx?.move(dest.x, 0.06, dest.z, this.trailColor ?? 0xcfc4a4);
      if (action.crowns) fx?.crown(dest.x, 0.2, dest.z, 0xffd873);
      // last-move markers
      const from = this.cellToWorld(action.from[0], action.from[1]);
      this.lastFrom.position.set(from.x, 0.103, from.z);
      this.lastTo.position.set(dest.x, 0.103, dest.z);
      this.lastFrom.visible = this.lastTo.visible = true;
    }
    if (skip) this.skipAll(stateAfter);
    return skip ? 0 : this.tweens.length ? Math.max(...this.tweens.map((t) => t.delay + t.dur)) : 0;
  }

  /** Settle every object into the exact deterministic end state. */
  skipAll(stateAfter) {
    this.tweens.length = 0;
    if (stateAfter) this.syncState(stateAfter);
    for (const v of this.pieces.values()) v.lift = 0;
    this._writeInstances();
  }

  _tween(view, props, dur, ease, delay = 0, onDone = null) {
    const from = {};
    for (const k of Object.keys(props)) from[k] = view[k];
    this.tweens.push({ view, props, from, dur, ease, delay, t: 0, onDone });
  }

  setSelection(pieceId, legalFromSelection) {
    for (const v of this.pieces.values()) v.selected = false;
    if (pieceId != null && this.pieces.has(pieceId)) {
      const v = this.pieces.get(pieceId);
      v.selected = true;
      this.selRing.visible = true;
      this.selRing.position.set(v.x, 0.105, v.z);
    } else {
      this.selRing.visible = false;
    }
    // ghosts at legal destinations; rings where a capture lands
    let gi = 0;
    let ci = 0;
    const m = new THREE.Matrix4();
    if (legalFromSelection) {
      for (const a of legalFromSelection) {
        const next = a.path[0];
        const w = this.cellToWorld(next[0], next[1]);
        if (a.captures.length > 0) {
          if (ci < 16) {
            m.makeRotationX(-Math.PI / 2).setPosition(w.x, 0.106, w.z);
            this.captureRings.setMatrixAt(ci++, m);
          }
        } else if (gi < 40) {
          m.makeRotationX(-Math.PI / 2).setPosition(w.x, 0.106, w.z);
          this.ghosts.setMatrixAt(gi++, m);
        }
      }
    }
    this.ghosts.count = gi;
    this.captureRings.count = ci;
    this.ghosts.instanceMatrix.needsUpdate = true;
    this.captureRings.instanceMatrix.needsUpdate = true;
  }

  setHover(cell) {
    if (cell) {
      const w = this.cellToWorld(cell.r, cell.c);
      this.hoverRing.position.set(w.x, 0.105, w.z);
      this.hoverRing.visible = true;
    } else {
      this.hoverRing.visible = false;
    }
  }

  /** Raycast the pick plane; returns {r, c} or null. */
  pickCell(clientX, clientY, camera, domElement) {
    const rect = domElement.getBoundingClientRect();
    this._ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(this._ndc, camera);
    this._raycaster.layers.set(LAYER_GAME);
    const hits = this._raycaster.intersectObject(this.pickPlane, false);
    if (!hits.length) return null;
    return this.worldToCell(hits[0].point.x, hits[0].point.z);
  }

  /** Project a cell to CSS pixels for DOM label alignment. */
  projectToScreen(r, c, camera, domElement) {
    const w = this.cellToWorld(r, c, this._v3);
    w.project(camera);
    const rect = domElement.getBoundingClientRect();
    return {
      x: (w.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-w.y * 0.5 + 0.5) * rect.height + rect.top,
    };
  }

  update(dt) {
    // tweens
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      if (tw.delay > 0) { tw.delay -= dt; continue; }
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      const e = tw.ease(k);
      for (const [prop, to] of Object.entries(tw.props)) {
        tw.view[prop] = tw.from[prop] + (to - tw.from[prop]) * e;
      }
      if (k >= 1) {
        this.tweens.splice(i, 1);
        tw.onDone?.();
      }
    }
    // selection lift + pulse
    const pulse = 1 + Math.sin(performance.now() / 240) * 0.06;
    for (const v of this.pieces.values()) {
      const targetLift = v.selected ? 0.22 : v.lift;
      v.renderLift = v.selected ? 0.22 + 0.04 * pulse : v.lift;
      if (v.selected) this.selRing.position.set(v.x, 0.105, v.z);
    }
    this.ghostMat.opacity = 0.65 + Math.sin(performance.now() / 300) * 0.2;
    this._writeInstances();
  }

  _writeInstances() {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const [color, im] of this.pieceMeshes || []) {
      const cm = this.crownMeshes.get(color);
      let count = 0;
      for (const v of this.pieces.values()) {
        if (v.color !== color) continue;
        if (v.visible && v.scale > 0.01) {
          pos.set(v.x, 0.10 + (v.renderLift || 0), v.z);
          scl.setScalar(v.scale);
          m.compose(pos, q, scl);
          im.setMatrixAt(v.inst, m);
          if (v.crowned) {
            pos.y += 0.30 * v.scale;
            m.compose(pos, q, scl);
            cm.setMatrixAt(v.inst, m);
          } else {
            cm.setMatrixAt(v.inst, zero);
          }
          count++;
        } else {
          im.setMatrixAt(v.inst, zero);
          cm.setMatrixAt(v.inst, zero);
        }
      }
      im.instanceMatrix.needsUpdate = true;
      cm.instanceMatrix.needsUpdate = true;
    }
  }

  disposePieces() {
    for (const im of this.pieceMeshes?.values() || []) {
      this.group.remove(im);
      im.material.map?.dispose();
      im.material.dispose();
    }
    for (const cm of this.crownMeshes?.values() || []) {
      this.group.remove(cm);
      cm.material.dispose();
    }
    this.pieceMeshes = new Map();
    this.crownMeshes = new Map();
    this.pieces.clear();
    this.tweens.length = 0;
  }

  dispose() {
    this.disposePieces();
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          m.map?.dispose?.();
          m.dispose?.();
        }
      }
    });
  }
}

/** Turned-stone piece profile (lathe). */
function pieceBodyGeometry() {
  const pts = [];
  const profile = [
    [0.001, 0], [0.34, 0], [0.40, 0.03], [0.42, 0.08], [0.38, 0.13],
    [0.30, 0.16], [0.28, 0.20], [0.33, 0.24], [0.30, 0.28], [0.20, 0.30], [0.001, 0.31],
  ];
  for (const [x, y] of profile) pts.push(new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(pts, 22);
  geo.computeVertexNormals();
  return geo;
}

function crownGeometry() {
  const pts = [];
  const profile = [
    [0.001, 0], [0.22, 0], [0.26, 0.03], [0.24, 0.08], [0.16, 0.10], [0.20, 0.16], [0.10, 0.20], [0.001, 0.22],
  ];
  for (const [x, y] of profile) pts.push(new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 14);
}

function numToHex(n) {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

function colorHex(n) {
  return n ?? 0xcfc4a4;
}
