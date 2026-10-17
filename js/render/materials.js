// Per-preset asset variants (see BUDGETS in gfx.js). The renderer sets the current budget before it
// builds the garden and board; builders read it for material class, texture size and mesh detail.

import * as THREE from '../../vendor/three.module.js';

let current = { material: 'physical', texture: 256, pieceSegs: 40, crownSegs: 28, tufts: 420, ambient: 140 };

export function setAssetBudget(b) { if (b) current = { ...current, ...b }; }
export function assetBudget() { return current; }

/**
 * Lit material in the budget's class: Lambert on Low, Standard on Balanced, Physical (clearcoat-capable)
 * on High/Ultra when `physical` is asked for. Parameters a class lacks are dropped (no console warnings).
 */
export function litMaterial(params, physical = false) {
  const kind = current.material;
  const { roughness, metalness, clearcoat, clearcoatRoughness, ...rest } = params;
  if (kind === 'lambert') return new THREE.MeshLambertMaterial(rest);
  if (kind === 'physical' && physical) return new THREE.MeshPhysicalMaterial(params);
  return new THREE.MeshStandardMaterial({ ...rest, ...(roughness != null ? { roughness } : {}), ...(metalness != null ? { metalness } : {}) });
}
