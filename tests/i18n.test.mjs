// Every player-facing string exists in all nine locales (node --test).
// Keys are the US-English source strings: literal T('…') / N('…') / tr('…')
// calls in the UI and rules code, data-i18n markup in index.html, and the
// display fields of the content tables (stages, lessons, challenges, …).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL as SOURCE } from './i18n-keys.mjs';

const DICTS = JSON.parse(readFileSync(new URL('../assets/strings.json', import.meta.url), 'utf8'));
const LOCALES = Object.keys(DICTS);
// strings keys stop at 256 characters (native/i18n.ts keyOf); engine and own account lines aren't source text.
const keyOf = (s) => (s.length <= 256 ? s : 'long.' + s.slice(0, 24).replace(/\W+/g, '-'));
const ALL = new Set([...SOURCE].filter((k) => !k.startsWith('platform.') && !k.startsWith('starhermit.')).map(keyOf));
const LONG = new Map([...SOURCE].filter((k) => k.length > 256).map((k) => [keyOf(k), k]));
const placeholdersOfKey = (k) => placeholders(LONG.get(k) ?? k);
const own = (locale) => Object.keys(DICTS[locale]).filter((k) => !k.startsWith('platform.'));

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('the key set is non-trivial', () => {
  assert.ok(ALL.size > 300, `only ${ALL.size} keys found`);
});

for (const locale of LOCALES.filter((l) => l !== 'en-GB')) {
  test(`${locale}: every key is translated with the same placeholders`, () => {
    const dict = DICTS[locale];
    const missing = [...ALL].filter((k) => !Object.prototype.hasOwnProperty.call(dict, k));
    assert.deepEqual(missing, [], `${missing.length} missing in ${locale}`);
    const bad = [...ALL].filter((k) => placeholders(dict[k]) !== placeholdersOfKey(k));
    assert.deepEqual(bad, [], `placeholder mismatch in ${locale}`);
  });
}

test('en-GB only overrides known keys', () => {
  const stray = own('en-GB').filter((k) => !ALL.has(k));
  assert.deepEqual(stray, []);
});

test('no locale carries keys that no longer exist', () => {
  for (const locale of LOCALES) {
    const stray = own(locale).filter((k) => !ALL.has(k));
    assert.deepEqual(stray, [], locale);
  }
});

test('the game keeps its own account lines in every locale', () => {
  const need = Object.keys(DICTS['en-US']).filter((k) => k.startsWith('platform.'));
  assert.ok(need.length >= 15);
  for (const locale of LOCALES) for (const k of need) assert.ok(DICTS[locale][k], `${locale} ${k}`);
});
