import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPreset, resolve, presetTier, choosePreset, describe, migrateGraphics, CATEGORIES, PRESETS } from '../js/render/gfx.js';
import { GFX_STRINGS, pickLocale } from '../js/ui/gfx-i18n.js';

test('detectPreset maps GPU strings to presets', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('Apple M2'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 640'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
  // touch devices never auto-pick above Balanced
  assert.equal(detectPreset('Apple M2', { mobile: true }), 'balanced');
  assert.equal(detectPreset('SwiftShader', { mobile: true }), 'low');
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
