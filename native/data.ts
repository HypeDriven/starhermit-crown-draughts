// The shared JS tables (rules, AI levels, content) as loosely typed records:
// the browser build's modules are untyped JavaScript, read with allowJs.
import * as Engine from "../js/rules/engine.js";
import * as Ai from "../js/rules/ai.js";
import * as Themes from "../js/content/themes.js";
import * as Lessons from "../js/content/lessons.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any;
export const RULESETS = Engine.RULESETS as Record<string, Any>;
export const INVALID_REASON_TEXT = Engine.INVALID_REASON_TEXT as Record<string, string>;
export const AI_LEVELS = Ai.AI_LEVELS as Record<string, Any>;
export const THEMES = Themes.THEMES as Record<string, Any>;
export const COSMETICS = Themes.COSMETICS as Any[];
export const LESSONS = Lessons.LESSONS as Any[];
export const lessonById = Lessons.lessonById as (id: string) => Any;
