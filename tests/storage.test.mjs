// The save shapes (js/core/storage.js): defaults, the browser build's cloud
// save read back as progress (the engine shows it as a foreign save), its
// legacy settings keys mapped onto the game's options, and the merge of two
// devices' progress (js/core/progress.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROGRESS, DEFAULT_SETTINGS, fromBrowserCloudSave, migrateLegacySetting, normalizeProgress, normalizeSettings } from '../js/core/storage.js';
import { mergeProgress } from '../js/core/progress.js';
import { fnv1aHex } from '../js/rules/rng.js';

/** The browser build's writeDoc(): a versioned, checksummed document. */
function browserDoc(payload, parentId = null) {
  const body = { payload, parentId };
  return { v: 1, id: 'kz1-abc', at: '2026-10-01T10:00:00.000Z', parentId, sum: fnv1aHex(JSON.stringify(body)), ...body };
}

test('the browser build\'s cloud save reads back as progress', () => {
  const payload = { ...JSON.parse(JSON.stringify(DEFAULT_PROGRESS)), journey: { 'ch1-s1': { completed: true, stars: 3, bestPlies: 12, plays: 2 } }, achievements: ['first-verdict'] };
  payload.stats.wins = 4;
  const p = fromBrowserCloudSave(JSON.stringify(browserDoc(payload, 'kz0-xyz')));
  assert.equal(p.journey['ch1-s1'].stars, 3);
  assert.deepEqual(p.achievements, ['first-verdict']);
  assert.equal(p.stats.wins, 4);
  assert.equal(p.stats.dailyStreak, 0, 'defaults fill what the old save lacked');
});

test('damaged, newer or foreign saves are not progress', () => {
  const doc = browserDoc({ ...DEFAULT_PROGRESS, lessonsComplete: ['first-steps'] });
  assert.equal(fromBrowserCloudSave(JSON.stringify({ ...doc, sum: '00000000' })), null);
  assert.equal(fromBrowserCloudSave(JSON.stringify({ ...doc, v: 2 })), null);
  assert.equal(fromBrowserCloudSave('not json'), null);
  assert.equal(fromBrowserCloudSave(JSON.stringify({ data: {}, check: 'x' })), null);
  assert.equal(fromBrowserCloudSave(null), null);
});

test('legacy settings keys map onto the game\'s own options', () => {
  assert.deepEqual(migrateLegacySetting('theme', 'ember-court'), [{ key: 'theme', value: 'ember-court' }]);
  assert.deepEqual(migrateLegacySetting('camera', { preset: 'top' }), [{ key: 'camera', value: { preset: 'top' } }]);
  assert.deepEqual(migrateLegacySetting('audio', { music: 0.3, muted: true }), [{ key: 'muted', value: true }]);
  const [acc] = migrateLegacySetting('accessibility', { reducedMotion: true, leftHanded: true, colorPalette: 'tritanopia', largeText: true });
  assert.equal(acc.key, 'accessibility');
  assert.equal(acc.value.leftHanded, true);
  assert.equal(acc.value.colorPalette, 'tritanopia');
  assert.equal(acc.value.haptics, true);
  assert.equal('reducedMotion' in acc.value, false, 'the runtime owns reduced motion now');
  assert.deepEqual(migrateLegacySetting('graphics', { preset: 'high' }), []);
  assert.deepEqual(migrateLegacySetting('gamepad', { confirm: [0] }), []);
});

test('settings fill defaults and drop unknown keys', () => {
  const s = normalizeSettings({ theme: 'frost-arbor', accessibility: { leftHanded: true }, graphics: { preset: 'ultra' } });
  assert.equal(s.theme, 'frost-arbor');
  assert.equal(s.accessibility.leftHanded, true);
  assert.equal(s.accessibility.haptics, DEFAULT_SETTINGS.accessibility.haptics);
  assert.equal('graphics' in s, false);
});

test('two devices\' progress merges without losing either', () => {
  const a = normalizeProgress({ journey: { 'ch1-s1': { completed: true, stars: 2, bestPlies: 20, plays: 1 } }, lessonsComplete: ['first-steps'] });
  const b = normalizeProgress({ journey: { 'ch1-s1': { completed: true, stars: 3, bestPlies: 25, plays: 3 }, 'ch1-s2': { completed: true, stars: 1, bestPlies: 40, plays: 1 } }, lessonsComplete: ['taking'] });
  const m = mergeProgress(a, b);
  assert.equal(m.journey['ch1-s1'].stars, 3);
  assert.equal(m.journey['ch1-s1'].bestPlies, 20);
  assert.ok(m.journey['ch1-s2'].completed);
  assert.deepEqual(m.lessonsComplete.sort(), ['first-steps', 'taking']);
});
