// Localization: the browser build's dictionaries (js/i18n, nine locales,
// keyed by the US-English text) in the interface language the runtime
// reports (preferences().language: the player's choice in Options ›
// Language, else the device's). The browser build's own Language selector,
// its ?lang= override and the account's preferred-language lookup are the
// runtime's now. A change re-renders everything next frame (the UI is
// immediate mode); js/i18n's onLanguage listeners hear it for what is cached.
import { onPreferencesChange, preferences } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { T, N, fmt, getLang, setLocale } from "../js/i18n/index.js";
import { setTextTranslator } from "../js/rules/engine.js";
import { pickLocale } from "../js/ui/platform-i18n.js";

export { T, N, fmt, getLang };

function apply(tag: string): void {
  const locale = pickLocale(tag);
  setLocale(locale);
  ui.setLanguage(locale);
}

/** Wires the language (from onStart; preferences are read at once too). */
export function initLanguage(): void {
  // Engine announcements and move descriptions follow the game language.
  setTextTranslator(T);
  apply(preferences().language);
  onPreferencesChange((p) => apply(p.language));
}
