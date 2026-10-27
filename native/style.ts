// The look of the menus and HUD: the browser build's style sheet
// (tools/ui-style.css, converted once with `starhermit css` into
// assets/ui-style.json by `npm run css`) registered as starhermit:ui styles,
// plus what the sheet had no selector for: the theme's colours, the dialog
// (the browser's .modal-backdrop veil + .modal), text fields, selects,
// checkboxes and scroll bars. The colour-vision palettes swap tokens, as the
// browser build's body[data-palette] rules swapped its custom properties.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

let base: Record<string, unknown> = {};

const PALETTES: Record<string, Record<string, string>> = {
  default: {},
  deuteranopia: { accent: "#e8c85a", ok: "#6ab0ff", warn: "#f0a030" },
  protanopia: { accent: "#f0d060", ok: "#58b8e8", warn: "#e8a038" },
  tritanopia: { accent: "#f0b860", ok: "#60d8c0", warn: "#e08850" },
};

export function setStyle(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  base = { ...css.tokens };
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setTheme({
    fontSize: 16, headingSize: 24, smallSize: 13.6, padding: 8, spacing: 8,
    text: "#f2ecdc", muted: "#c9c0a8", panel: "#1c2119", control: "#262c20", hovered: "#38402e",
    pressed: "#46503a", field: "#12160f", accent: "#d4af37", focus: "#7fb2e0", outline: "#d4af37", radius: 12,
  });
  const modal = css.styles[".modal"]!;
  const veil = css.styles[".veil"]!;
  ui.setStyles({
    ...css.styles,
    dialog: {
      background: modal.background!, radius: modal.radius!, padding: modal.padding!, border: modal.border!,
      shadow: { y: 12, blur: 40, color: "rgba(0,0,0,0.5)" },
      inside: { heading: { text: { font: "serif", size: 24, weight: "600", color: "$ink" } } },
      parts: { backdrop: { background: veil.background! } },
    },
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    heading: { text: { color: "$ink", font: "serif", weight: "600" } },
    checkbox: { text: { color: "$ink" }, minHeight: 40, parts: { box: { background: "$field", border: { width: 1, color: "$line" }, radius: 4 }, mark: { background: "$accent" } } },
    select: {
      text: { color: "$ink" },
      parts: {
        field: { background: "$field", radius: 8, padding: { top: 8, end: 11, bottom: 8, start: 11 }, minHeight: 44, border: { width: 1, color: "$line" }, hovered: { border: { color: "$accent" } } },
        list: { background: "$panel-solid", radius: 8, border: { width: 1, color: "$accent" } },
        option: { hovered: { background: "#38402e" }, selected: { text: { color: "$accent" } } },
      },
    },
    textField: { text: { color: "$ink" }, background: "$field", radius: 8, border: { width: 1, color: "$line" }, padding: { top: 8, end: 11, bottom: 8, start: 11 }, minHeight: 44 },
    scrollArea: { parts: { bar: { background: "$line", radius: 4 } } },
    // The title emblem and the results illustrations (the browser's <img>).
    ".emblem-img": { extends: [".title-emblem"], background: [{ image: "assets/title-emblem.webp", size: "cover" }, "#1c2119"] },
    ".banner-victory": { extends: [".result-banner"], background: [{ image: "assets/results-victory.webp", size: "cover" }, "#1c2119"] },
    ".banner-defeat": { extends: [".result-banner"], background: [{ image: "assets/results-defeat.webp", size: "cover" }, "#1c2119"] },
  });
}

/** The colour-vision palette (Settings › Accessibility). */
export function setPalette(name: string): void {
  const p = PALETTES[name] || PALETTES.default!;
  ui.setTokens({ accent: (base.accent as string) ?? "#d4af37", ok: (base.ok as string) ?? "#8fd18a", warn: (base.warn as string) ?? "#e8b45a", ...p });
}
