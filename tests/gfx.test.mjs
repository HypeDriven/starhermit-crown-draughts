import test from 'node:test';
import assert from 'node:assert/strict';
import '../gpu-level.js';
import { detectPreset, detectLevel, presetForLevel, budgetFor, BUDGETS, resolve, presetTier, choosePreset, describe, migrateGraphics, CATEGORIES, PRESETS } from '../js/render/gfx.js';
import { GFX_STRINGS, pickLocale } from '../js/ui/gfx-i18n.js';

const desk = { webgl: true, webgl2: true, cores: 8, memoryGb: 8 };
const phone = { webgl: true, webgl2: true, mobile: true, cores: 8, memoryGb: 8 };

test('hardware level → preset: Low 0, Balanced 4, High 10, Ultra 17', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', desk), 'low');
  assert.equal(detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', desk), 0);
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)', desk), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', desk), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', desk), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', desk), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', desk), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', desk), 20);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', desk), 'ultra');
  assert.equal(detectPreset('', desk), 'balanced');
  assert.equal(presetForLevel(3), 'low');
  assert.equal(presetForLevel(16), 'high');
});

test('phones and tablets are capped at Balanced; software GPUs stay Low', () => {
  assert.equal(detectPreset('Adreno (TM) 740', phone), 'balanced');
  assert.ok(detectLevel('Adreno (TM) 740', phone) <= 9);
  assert.equal(detectPreset('NVIDIA GeForce RTX 5090', phone), 'balanced');
  assert.equal(detectPreset('Mali-G77', phone), 'low');
  assert.equal(detectPreset('SwiftShader', phone), 'low');
});

test('every preset has an explicit budget that grows from Low to Ultra and scales with the level', () => {
  const order = ['low', 'balanced', 'high', 'ultra'];
  const keys = ['material', 'texture', 'pieceSegs', 'crownSegs', 'tufts', 'ambient', 'bloomRes', 'aoRes'];
  for (const p of order) for (const k of keys) assert.ok(BUDGETS[p][k] != null, `${p}.${k}`);
  const mats = ['lambert', 'standard', 'physical'];
  for (let i = 1; i < order.length; i++) {
    for (const k of keys) if (typeof BUDGETS.low[k] === 'number') assert.ok(BUDGETS[order[i]][k] >= BUDGETS[order[i - 1]][k], `${order[i]}.${k}`);
    assert.ok(mats.indexOf(BUDGETS[order[i]].material) >= mats.indexOf(BUDGETS[order[i - 1]].material));
  }
  assert.deepEqual(resolve({ preset: 'ultra' }, 'low', 0).budget, resolve({ preset: 'ultra' }, 'ultra', 17).budget, 'a manual Ultra on a weak GPU keeps the Ultra floor budget');
  const l0 = budgetFor('low', 0), l3 = budgetFor('low', 3);
  assert.ok(l3.ambient > l0.ambient, 'counts scale up with the level within a preset');
  assert.ok(budgetFor('low', 20).ambient <= 4 * BUDGETS.low.ambient, 'never more than 4×');
  assert.equal(resolve({}, 'balanced', 4).scale, 0.9, 'Balanced renders at 0.9 scale');
});

test('resolve: auto follows detection, explicit preset wins', () => {
  const a = resolve({}, 'high');
  assert.equal(a.preset, 'high');
  assert.equal(a.auto, true);
  assert.equal(a.shadows, presetTier('high', 'shadows'));
  const b = resolve({ preset: 'low' }, 'high');
  assert.equal(b.preset, 'low');
  assert.equal(b.auto, false);
  assert.equal(b.post, false, 'Low renders without a post chain');
  assert.equal(resolve({ preset: 'bogus' }, 'nope').preset, 'balanced');
});

test('resolve: overrides replace preset tiers, invalid ones are ignored', () => {
  const r = resolve({ preset: 'low', bloom: 'on', shadows: 'mega', particles: 'high' }, 'low');
  assert.equal(r.bloom, 'on');
  assert.equal(r.post, true);
  assert.equal(r.shadows, 'off');
  assert.equal(r.particles, 'high');
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    for (const p of PRESETS) assert.ok(tiers.includes(presetTier(p, cat)), `${p}.${cat}`);
  }
});

test('resolve: render scale is clamped to 50–200 % of the preset scale', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }, 'low').scale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }, 'low').scale, 0.5);
  assert.equal(resolve({ preset: 'ultra', render_scale: 1 }, 'low').scale, 1.25);
  assert.equal(resolve({ preset: 'high' }, 'low').adaptive, true);
  assert.equal(resolve({ preset: 'high', adaptive: false, show_fps: true }, 'low').showFps, true);
});

test('choosing a preset clears overrides but keeps scale and toggles', () => {
  const saved = { preset: 'high', bloom: 'off', ao: 'high', render_scale: 1.5, show_fps: true };
  const next = choosePreset(saved, 'low');
  assert.equal(next.preset, 'low');
  assert.equal(next.bloom, undefined);
  assert.equal(next.ao, undefined);
  assert.equal(next.render_scale, 1.5);
  assert.equal(next.show_fps, true);
  assert.equal(choosePreset(saved, 'auto').preset, 'auto');
});

test('describe summarises cost; migrate maps legacy tiers', () => {
  const d = describe(resolve({ preset: 'high' }, 'low'), [1280, 800]);
  assert.match(d, /2048² shadows/);
  assert.match(d, /1280×800 px/);
  assert.match(describe(resolve({ preset: 'low' }, 'low')), /no shadows/);
  assert.equal(migrateGraphics({ tier: 'medium', renderScale: 0.8 }).preset, 'balanced');
  assert.equal(migrateGraphics({ tier: 'medium', renderScale: 0.8 }).render_scale, 0.8);
  assert.equal(migrateGraphics(undefined).preset, 'auto');
  assert.equal(migrateGraphics({ preset: 'ultra', bloom: 'off' }).bloom, 'off');
});

test('graphics strings exist in every locale', () => {
  const ref = GFX_STRINGS['en-US'];
  for (const loc of ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']) {
    const S = GFX_STRINGS[loc];
    assert.ok(S, loc);
    for (const k of Object.keys(ref)) {
      assert.ok(S[k], `${loc}.${k}`);
      if (typeof ref[k] === 'object') for (const kk of Object.keys(ref[k])) assert.ok(S[k][kk], `${loc}.${k}.${kk}`);
    }
  }
  assert.equal(pickLocale('es-MX'), 'es-419');
  assert.equal(pickLocale('fr-CA'), 'fr-CA');
  assert.equal(pickLocale('en-AU'), 'en-GB');
  assert.equal(pickLocale('ja-JP'), 'en-US');
});
