// Localization: the engine's string tables (assets/strings.json, nine locales,
// keyed by the US-English text; the game's own StarHermit lines under
// `platform.*`, the shared account lines the engine's `starhermit.*`). The
// engine resolves the interface language (Options › Language, else the
// device's) to the nearest locale. The browser build's own Language selector,
// its ?lang= override and the account's preferred-language lookup are the
// runtime's now. A change re-renders everything next frame (the UI is
// immediate mode).
import { strings } from "starhermit:engine";
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
  strings.load("assets/strings.json");
  strings.defaultLocale = "en-US";
  // Engine announcements and move descriptions follow the game language.
  setTextTranslator(T);
  ui.setLanguage(strings.locale);
  strings.onChange((locale) => ui.setLanguage(locale));
}
