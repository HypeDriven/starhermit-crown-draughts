// Localization: the engine's string tables (assets/strings.json, nine locales,
// keyed by the US-English text; the game's own StarHermit lines under
// `platform.*`, the shared account lines the engine's `starhermit.*`). The
// engine resolves the interface language (Options › Language, else the
// device's) to the nearest locale. The browser build's own Language selector,
// its ?lang= override and the account's preferred-language lookup are the
// runtime's now. A change re-renders everything next frame (the UI is
// immediate mode).
import {files, preferences, strings} from "starhermit:engine";

// Locale tables are split per language. Only the player's fallback chain is
// parsed and kept (en-US first, so it remains the default). Other locales stay
// in the package until the language changes.
const __stringLocales = new Set<string>();
let __stringsBusy = false;
let __stringsWatching = false;
function loadGameStrings(dir: string): void {
  if (__stringsBusy) return;
  __stringsBusy = true;
  try {
    let tag = "en";
    try {
      const language = preferences().language;
      if (language) tag = language;
    } catch { /* preferences are not ready while the module is still loading */ }
    const want = stringLocalesFor(tag);
    const ordered = [...want.filter((locale) => locale === "en-US"), ...want.filter((locale) => locale !== "en-US")];
    const batch: { [locale: string]: unknown } = {};
    for (const locale of ordered) {
      if (__stringLocales.has(locale)) continue;
      const path = `${dir}/${locale}.json`;
      if (!files.exists(path)) continue;
      const table = files.readJson(path);
      if (!table || typeof table !== "object" || Array.isArray(table)) continue;
      batch[locale] = table;
    }
    const added = Object.keys(batch);
    if (added.length) {
      strings.load(batch);
      for (const locale of added) __stringLocales.add(locale);
    }
  } finally {
    __stringsBusy = false;
  }
  if (!__stringsWatching) {
    __stringsWatching = true;
    strings.onChange(() => loadGameStrings(dir));
  }
}
function stringLocalesFor(tag: string): string[] {
  const out: string[] = [];
  const add = (locale: string): void => { if (locale && !out.includes(locale)) out.push(locale); };
  const bits = tag.replace(/_/g, "-").split("-").filter(Boolean);
  const language = (bits[0] || "en").toLowerCase();
  const regionBit = bits.slice(1).find((part) => /^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part));
  const region = regionBit ? (/^\d{3}$/.test(regionBit) ? regionBit : regionBit.toUpperCase()) : "";
  add(region ? `${language}-${region}` : language);
  if (bits.length > 2) {
    add(bits.map((part, index) => index === 0 ? language : (/^[A-Za-z]{2}$/.test(part) ? part.toUpperCase() : part)).join("-"));
  }
  if (language === "en" && region && region !== "US" && region !== "CA") add("en-001");
  if (language === "en" && region && region !== "US") add("en-GB");
  if (language === "es" && region !== "ES") add("es-419");
  if (language === "es") add("es-ES");
  if (language === "fr") add("fr-FR");
  if (language === "fr" && region === "CA") add("fr-CA");
  if (language === "de") add("de-DE");
  if (language === "pt" && region !== "BR") add("pt-PT");
  if (language === "pt") add("pt-BR");
  if (language === "it") add("it-IT");
  if (language === "nl") add("nl-NL");
  if (language === "ja") add("ja-JP");
  if (language === "zh") {
    const traditional = region === "HK" || region === "TW" || region === "MO";
    add(traditional ? "zh-HK" : "zh-CN");
    if (!traditional) add("zh-SG");
  }
  if (language === "yue") add("yue-HK");
  if (language === "ru") add("ru-FI");
  add(language);
  add("en-US");
  return out;
}
import * as ui from "starhermit:ui";
import { setTextTranslator } from "../js/rules/engine.js";

type Vars = { readonly [name: string]: unknown } | null | undefined;

export function fmt(s: string, vars: Vars): string {
  return String(s).replace(/\{(\w+)\}/g, (m, k: string) => (vars && vars[k] != null ? String(vars[k]) : m));
}
/** strings keys stop at 256 characters: a longer English line has a short key. */
const keyOf = (s: string): string => (s.length <= 256 ? s : "long." + s.slice(0, 24).replace(/\W+/g, "-"));

/** Translate an English source string (unknown strings, e.g. player names, pass through). */
export function T(key: unknown, vars?: Vars): string {
  if (key == null) return "";
  const s = String(key), k = keyOf(s);
  if (strings.has(k)) return vars ? strings.t(k, vars) : strings.t(k);
  // Default seat names from the engine ("House 2") read naturally in every locale.
  const house = /^House (\d+)$/.exec(s);
  if (house) return T("House {n}", { n: house[1] });
  return vars ? fmt(s, vars) : s;
}
/** Mark a string for extraction; translated later with T(). */
export const N = (key: string): string => key;
/** The game's own StarHermit lines. */
export const P = (key: string, vars?: Vars): string => strings.t(`platform.${key}`, vars ?? undefined);
/** The engine's account lines. */
export const SH = (key: string, vars?: Vars): string => strings.t(`starhermit.${key}`, vars ?? undefined);

export const getLang = (): string => strings.locale;

/** Wires the language (from onStart). */
export function initLanguage(): void {
  loadGameStrings("assets/l10n/strings");
  strings.defaultLocale = "en-US";
  // Engine announcements and move descriptions follow the game language.
  setTextTranslator(T);
  ui.setLanguage(strings.locale);
  strings.onChange((locale) => ui.setLanguage(locale));
}
