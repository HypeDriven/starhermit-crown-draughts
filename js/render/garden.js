// The royal garden: ground, paths, hedges, trees, fountain, flowers,
// lanterns/torches and ambient drifting particles, all procedural and seeded
// by the decor stream. Environment lives on LAYER_ENV and never raycasts.

import * as THREE from '../../vendor/three.module.js';
import { grassTexture, hedgeTexture, marbleTexture, softDiscTexture } from './textures.js';
import { createRng } from '../rules/rng.js';
import { LAYER_ENV } from './board.js';

function hex(n) { return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`; }

export class Garden {
  constructor(scene, theme, seed = 1, surround = 'surround-fountain') {
    this.scene = scene;
    this.surround = surround;
    this.group = new THREE.Group();
    this.group.traverse?.((o) => o.layers?.set(LAYER_ENV));
    scene.add(this.group);
    this.disposables = [];
    this.reducedMotion = false;
    this.leaves = [];
    this.build(theme, seed);
  }

  track(obj) { this.disposables.push(obj); return obj; }

  build(theme, seed) {
    const rng = createRng(seed ^ 0x5eed);
    const t = theme;
    const g = this.group;

    // ground lawn
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(34, 48),
      new THREE.MeshStandardMaterial({ map: grassTexture(hex(t.ground), seed), roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.62;
    ground.receiveShadow = true;
    ground.layers.set(LAYER_ENV);
    g.add(ground);

    // stone terrace under the board
    const terrace = new THREE.Mesh(
      new THREE.CylinderGeometry(9.5, 10.2, 0.25, 40),
      new THREE.MeshStandardMaterial({ map: marbleTexture(hex(t.path), '#8a7a62', seed + 5), roughness: 0.8 }),
    );
    terrace.position.y = -0.55;
    terrace.receiveShadow = true;
    terrace.layers.set(LAYER_ENV);
    g.add(terrace);

    // hedge ring
    const hedgeMat = new THREE.MeshStandardMaterial({ map: hedgeTexture(hex(t.hedge), seed + 9), roughness: 0.9 });
    const hedgeGeo = new THREE.BoxGeometry(3.4, 1.5, 1.1);
    const hedges = new THREE.InstancedMesh(hedgeGeo, hedgeMat, 26);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    let hi = 0;
    const hedgeCount = this.surround === 'surround-maze' ? 34 : 22;
    const hedgeHeight = this.surround === 'surround-maze' ? 2.3 : 1.0;
    for (let i = 0; i < hedgeCount; i++) {
      const a = (i / hedgeCount) * Math.PI * 2;
      if (Math.abs(Math.sin(a)) < 0.35 && Math.cos(a) > 0) continue; // gate opening toward camera
      const r = 15 + rng.next() * 1.2;
      eul.set(0, -a + Math.PI / 2, 0);
      q.setFromEuler(eul);
      m4.compose(new THREE.Vector3(Math.sin(a) * r, 0.1, Math.cos(a) * r), q, new THREE.Vector3(1, (0.9 + rng.next() * 0.3) * hedgeHeight, 1));
      hedges.setMatrixAt(hi++, m4);
    }
    hedges.count = hi;
    hedges.castShadow = true;
    hedges.receiveShadow = true;
    hedges.layers.set(LAYER_ENV);
    hedges.raycast = () => {};
    g.add(hedges);

    // trees: trunk + layered foliage blobs
    if (t.env.trees) {
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
      const leafMat = new THREE.MeshStandardMaterial({ color: shade(t.hedge, 1.15), roughness: 0.85 });
      const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1.8, 8);
      const leafGeo = new THREE.IcosahedronGeometry(1.15, 1);
      const treeSpots = [[-13, -9], [13, -10], [-15, 4], [15, 6], [-8, -14], [9, -15]];
      for (const [x, z] of treeSpots) {
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(x, 0.25, z);
        trunk.castShadow = true;
        trunk.layers.set(LAYER_ENV);
        g.add(trunk);
        const blobs = 3;
        for (let b = 0; b < blobs; b++) {
          const leaf = new THREE.Mesh(leafGeo, leafMat);
          leaf.position.set(x + (rng.next() - 0.5) * 1.2, 1.5 + b * 0.75 + rng.next() * 0.3, z + (rng.next() - 0.5) * 1.2);
          leaf.scale.setScalar(0.8 + rng.next() * 0.5);
          leaf.castShadow = true;
          leaf.layers.set(LAYER_ENV);
          leaf.userData.base = leaf.position.clone();
          leaf.userData.phase = rng.next() * Math.PI * 2;
          g.add(leaf);
          this.leaves.push(leaf);
        }
      }
    }

    // fountain behind the board
    if (t.env.fountain) {
      const stoneMat = new THREE.MeshStandardMaterial({ map: marbleTexture(hex(t.frame), '#77664e', seed + 13), roughness: 0.7 });
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.6, 24), stoneMat);
      basin.position.set(0, -0.3, -11.5);
      basin.castShadow = true;
      basin.receiveShadow = true;
      basin.layers.set(LAYER_ENV);
      g.add(basin);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 1.5, 12), stoneMat);
      pillar.position.set(0, 0.6, -11.5);
      pillar.castShadow = true;
      pillar.layers.set(LAYER_ENV);
      g.add(pillar);
      this.water = new THREE.Mesh(
        new THREE.CircleGeometry(1.55, 32),
        new THREE.MeshPhysicalMaterial({ color: t.water, roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.9 }),
      );
      this.water.rotation.x = -Math.PI / 2;
      this.water.position.set(0, 0.02, -11.5);
      this.water.layers.set(LAYER_ENV);
      g.add(this.water);
    }

    // lanterns / torches (the surround cosmetic can force a dressing)
    this.flames = [];
    const wantLanterns = t.env.lanterns || this.surround === 'surround-lanterns';
    const wantTorches = t.env.torches;
    if (wantLanterns || wantTorches) {
      const postGeo = new THREE.CylinderGeometry(0.06, 0.09, 1.6, 8);
      const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.8 });
      const glowColor = wantTorches ? 0xff9a4a : 0xffd9a0;
      for (const [x, z] of [[-7.5, 7.5], [7.5, 7.5], [-7.5, -7.5], [7.5, -7.5]]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(x, 0.15, z);
        post.castShadow = true;
        post.layers.set(LAYER_ENV);
        g.add(post);
        const glow = new THREE.Mesh(
          new THREE.SphereGeometry(0.18, 10, 8),
          new THREE.MeshStandardMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 5 }),
        );
        glow.position.set(x, 1.05, z);
        glow.layers.set(LAYER_ENV);
        g.add(glow);
        this.flames.push(glow);
      }
    }

    // flowers: instanced small crosses of color
    const flowerGeo = new THREE.IcosahedronGeometry(0.09, 0);
    const flowerMatA = new THREE.MeshStandardMaterial({ color: t.flowerA, roughness: 0.7 });
    const flowerMatB = new THREE.MeshStandardMaterial({ color: t.flowerB, roughness: 0.7 });
    for (const [mat, count] of [[flowerMatA, 60], [flowerMatB, 60]]) {
      const inst = new THREE.InstancedMesh(flowerGeo, mat, count);
      for (let i = 0; i < count; i++) {
        const a = rng.next() * Math.PI * 2;
        const r = 11 + rng.next() * 12;
        m4.compose(
          new THREE.Vector3(Math.sin(a) * r, -0.5, Math.cos(a) * r),
          q.identity(),
          new THREE.Vector3(0.6 + rng.next(), 0.6 + rng.next(), 0.6 + rng.next()),
        );
        inst.setMatrixAt(i, m4);
      }
      inst.layers.set(LAYER_ENV);
      inst.raycast = () => {};
      g.add(inst);
    }

    // detailed dressing: grass tufts around the terrace, a ring of kerb stones
    // and a second scatter of blossoms; toggled by the `detail` graphics tier
    this.detailGroup = new THREE.Group();
    const tuftGeo = new THREE.ConeGeometry(0.07, 0.34, 5);
    const tuftMat = new THREE.MeshStandardMaterial({ color: shade(t.ground, 1.12), roughness: 0.9 });
    const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 420);
    for (let i = 0; i < 420; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = 10.4 + Math.pow(rng.next(), 1.6) * 13;
      eul.set((rng.next() - 0.5) * 0.5, rng.next() * 6, (rng.next() - 0.5) * 0.5);
      q.setFromEuler(eul);
      const sc = 0.6 + rng.next() * 0.9;
      m4.compose(new THREE.Vector3(Math.sin(a) * r, -0.5, Math.cos(a) * r), q, new THREE.Vector3(sc, sc, sc));
      tufts.setMatrixAt(i, m4);
    }
    tufts.layers.set(LAYER_ENV);
    tufts.raycast = () => {};
    this.detailGroup.add(tufts);
    const kerbGeo = new THREE.BoxGeometry(0.9, 0.16, 0.42);
    const kerbMat = new THREE.MeshStandardMaterial({ map: marbleTexture(hex(t.path), '#6f624e', seed + 29), roughness: 0.85 });
    const kerbN = 44;
    const kerbs = new THREE.InstancedMesh(kerbGeo, kerbMat, kerbN);
    for (let i = 0; i < kerbN; i++) {
      const a = (i / kerbN) * Math.PI * 2;
      eul.set(0, a, 0);
      q.setFromEuler(eul);
      m4.compose(new THREE.Vector3(Math.sin(a) * 10.25, -0.42, Math.cos(a) * 10.25), q, new THREE.Vector3(1, 0.9 + rng.next() * 0.2, 1));
      kerbs.setMatrixAt(i, m4);
    }
    kerbs.receiveShadow = true;
    kerbs.layers.set(LAYER_ENV);
    kerbs.raycast = () => {};
    this.detailGroup.add(kerbs);
    const blossom = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ color: 0xf4efe0, roughness: 0.7 }), 70);
    for (let i = 0; i < 70; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = 10.8 + rng.next() * 10;
      m4.compose(new THREE.Vector3(Math.sin(a) * r, -0.48, Math.cos(a) * r), q.identity(), new THREE.Vector3(0.5 + rng.next() * 0.5, 0.5, 0.5 + rng.next() * 0.5));
      blossom.setMatrixAt(i, m4);
    }
    blossom.layers.set(LAYER_ENV);
    blossom.raycast = () => {};
    this.detailGroup.add(blossom);
    g.add(this.detailGroup);

    // ambient drifting particles (petals / snow / embers)
    this.ambient = null;
    const ambColor = t.env.snow ? 0xffffff : t.env.torches ? 0xffb060 : 0xe8a0b0;
    const ambCount = t.env.snow ? 260 : 140;
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
    const ambGeo = new THREE.BufferGeometry();
    ambGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.ambient = new THREE.Points(ambGeo, new THREE.PointsMaterial({
      color: ambColor, size: t.env.snow ? 0.07 : 0.09, map: softDiscTexture(),
      transparent: true, opacity: 0.8, depthWrite: false,
    }));
    this.ambient.layers.set(LAYER_ENV);
    this.ambient.raycast = () => {};
    this.ambient.frustumCulled = false;
    g.add(this.ambient);
    this.ambCount = ambCount;
  }

  /** Decorative motion; paused when the tab is hidden (the loop stops). */
  update(dt, elapsed) {
    if (this.reducedMotion) return; // decorative motion holds still
    if (this.water) {
      this.water.position.y = 0.02 + Math.sin(elapsed * 1.4) * 0.015;
    }
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const s = 1 + Math.sin(elapsed * 9 + i * 1.7) * 0.08;
      f.scale.setScalar(s);
      // warm shimmer: layered sines read as a flame, never a strobe
      f.material.emissiveIntensity = 4.6 + Math.sin(elapsed * 7.3 + i) * 0.25 + Math.sin(elapsed * 13.1 + i * 2.3) * 0.15;
    }
    // canopy sway
    for (const leaf of this.leaves) {
      const b = leaf.userData.base;
      const ph = leaf.userData.phase;
      leaf.position.x = b.x + Math.sin(elapsed * 0.9 + ph) * 0.05;
      leaf.position.z = b.z + Math.sin(elapsed * 0.7 + ph * 1.3) * 0.035;
    }
    if (this.ambient) {
      const pos = this.ambient.geometry.attributes.position;
      const arr = pos.array;
      for (let i = 0; i < this.ambCount; i++) {
        arr[i * 3] += this.ambVel[i * 3] * dt + Math.sin(elapsed * 0.7 + i) * 0.0015;
        arr[i * 3 + 1] += this.ambVel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += this.ambVel[i * 3 + 2] * dt;
        if (arr[i * 3 + 1] < -0.6) arr[i * 3 + 1] = 9 + (i % 3);
      }
      pos.needsUpdate = true;
    }
  }

  /** Graphics tiers: `particles` gates ambient drift, `detail` the extra dressing. */
  setDetail(q) {
    const particles = q?.particles || 'low';
    if (this.ambient) this.ambient.visible = particles === 'high' && !this.reducedMotion;
    if (this.detailGroup) this.detailGroup.visible = q?.detail === 'detailed';
  }

  dispose() {
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

function shade(hexColor, factor) {
  const c = new THREE.Color(hex(hexColor));
  c.multiplyScalar(factor);
  return c;
}
