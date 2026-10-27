// Sound, ported from the browser build's js/core/audio.js onto the engine's
// mixer: the authored one-shots (sfx/<name>.opus, sfx/manifest.json) per
// logical event, the theme's authored ambience bed and the generative music
// pad. The runtime's Options › Audio owns the volumes, mute and voice limit
// (the browser build's Music / Effects / Ambience / Voice sliders and its
// game-options.js sound panel); the M key still silences the game's own
// sound (settings.muted). Event cues play on "effects", interface clicks on
// "interface", the fanfares, the pad and the bed on "music", each at the
// level the browser build's default bus volume gave it.
//
// The pad's chords are rendered once into clips (createClip) with the same
// detuned sines and envelopes rather than run as a live synthesis graph (the
// engine's browser runtime drops clip loads while a graph changes; see the
// arrow-exodus port). For the same reason the browser build's synthesized
// stand-ins for clips still loading (and its synthesized wind, birds and
// fountain under the authored bed) are not ported: clips load once the mixer
// runs (natively at once, in a browser after the first press) and a cue
// before that is silent; every cue has a visual or announced twin. The
// spoken turn announcements (the device's speech voice) are the screen
// reader's now (ui.announce).
import { context, createClip, loadClip, play as playClip, type AudioClip, type Bus, type Sound } from "starhermit:audio";

/** Logical event → authored clip (the browser build's event map). */
const SAMPLES: Record<string, string> = {
  select: "piece-lift", hover: "ui-hover", uiClick: "ui-click", uiOpen: "ui-modal-open", invalid: "ui-error",
  move: "piece-slide", capture: "capture", crown: "king", turn: "turn-pass", hint: "hint", undo: "undo",
  win: "win", lose: "lose", draw: "draw", achievement: "ui-success", clockWarn: "ui-timer-warning",
  uiConfirm: "ui-confirm", uiBack: "ui-back", toggle: "ui-toggle", tabSwitch: "ui-tab-switch", sliderDrag: "ui-slider-drag",
  scrollTick: "ui-scroll-tick", panelClose: "ui-panel-close", toast: "ui-toast", pause: "ui-pause", resume: "ui-resume",
  countdownTick: "ui-countdown-tick", roundStart: "round-start", settingsSaved: "ui-settings-saved", multiJump: "multi-jump",
  mandatoryCapture: "mandatory-capture-alert", opponentTurn: "opponent-turn", starAward: "star-award", levelFail: "level-fail",
  newRecord: "new-record", streak: "streak", chainStep: "chain-step", setDown: "piece-set-down", drawOffer: "draw-offer",
  houseFall: "house-fall", cameraMove: "camera-move", masteryUnlock: "mastery-unlock",
};
const INTERFACE = new Set(["hover", "uiClick", "uiOpen", "uiConfirm", "uiBack", "toggle", "tabSwitch", "sliderDrag", "scrollTick", "panelClose", "toast", "settingsSaved", "countdownTick"]);
const MUSIC_CUES = new Set(["win", "lose", "draw"]);
/** Authored ambience beds per theme (sfx/manifest events `ambience:<theme>`). */
const BEDS: Record<string, string> = {
  "royal-garden": "amb-royal-garden", "dusk-conservatory": "amb-dusk-conservatory", "ember-court": "amb-ember-court",
  "frost-arbor": "amb-frost-arbor", "tide-terrace": "amb-tide-terrace",
};
// The browser build's default bus volumes: music 0.7, effects 0.9, ambience 0.6 (the bed at 0.35).
const EFFECTS = 0.9, MUSIC = 0.7, AMBIENCE = 0.6 * 0.35;

let muted = false;
const clips = new Map<string, AudioClip>();
const loading = new Set<string>();
const queue: string[] = [];
let wantClips = false;
function load(file: string): void {
  if (clips.has(file) || loading.has(file)) return;
  loading.add(file);
  loadClip(`sfx/${file}.opus`).then((c) => { clips.set(file, c); }, (e: unknown) => console.warn(`sfx ${file}: ${String(e)}`))
    .finally(() => loading.delete(file));
}
/** Loads every clip once the mixer runs (a few a frame). */
export function loadSfx(): void {
  if (wantClips) return;
  wantClips = true;
  queue.push(...new Set([...Object.values(BEDS), ...Object.values(SAMPLES)]));
}

/** Plays a logical event's cue (the browser build's audio.<event>()). */
export function play(event: string): void {
  if (muted) return;
  const file = SAMPLES[event];
  const clip = file ? clips.get(file) : undefined;
  if (!clip) return;
  const bus: Bus = INTERFACE.has(event) ? "interface" : MUSIC_CUES.has(event) ? "music" : "effects";
  try { playClip(clip, { bus, gain: bus === "music" ? MUSIC : EFFECTS }); }
  catch { clips.delete(file!); load(file!); } // a clip the mixer lost: load it again
}

export function setMuted(v: boolean): void {
  muted = v;
  if (v) { stopBed(); }
}

// -- the ambience bed ---------------------------------------------------------------------
let bed: { theme: string; sound: Sound | null } | null = null;
let wantBed: string | null = null;
export function startAmbience(themeId: string): void { wantBed = themeId; }
function stopBed(): void {
  try { bed?.sound?.stop(); } catch { /* already gone */ }
  bed = null;
}
export function stopAmbience(): void { wantBed = null; stopBed(); }

// -- the music pad: the theme's root, four chords, rendered once ---------------------------------
const RATE = 8000;
const CHORDS = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [2, 5, 9]];
/** One pad chord: each tone two detuned sines (−4 and +3 cents), up over
 * 2.2 s to 0.028 and down to silence at 7.5 s (the browser build's envelope). */
function chordClip(root: number, chord: number[]): AudioClip {
  const n = Math.round(8 * RATE);
  const out = new Float32Array(n);
  const up = 2.2 * RATE, end = 7.5 * RATE;
  for (const semi of chord) {
    const f = root * Math.pow(2, semi / 12);
    for (const det of [-4, 3]) {
      const w = 2 * Math.PI * f * Math.pow(2, det / 1200) / RATE;
      for (let i = 0; i < n; i++) {
        const env = i < up ? (i / up) * 0.028 : i < end ? 0.028 * (1 - (i - up) / (end - up)) : 0;
        if (env > 0) out[i] = out[i]! + Math.sin(w * i) * env;
      }
    }
  }
  return createClip([out], RATE);
}
let music: { root: number; tempo: number; step: number; next: number } | null = null;
const chordCache = new Map<string, AudioClip>();
let clock = 0;
export function startMusic(theme: { music?: { root: number; tempo: number } } | null | undefined): void {
  const m = theme?.music || { root: 220, tempo: 0.1 };
  if (music && music.root === m.root && music.tempo === m.tempo) return;
  music = { root: m.root, tempo: m.tempo, step: 0, next: clock };
}
export function stopMusic(): void { music = null; }

/** Called each frame with its seconds: loads what waited for the mixer, the bed, the pad. */
export function poll(dt: number): void {
  clock += dt;
  if (context.state !== "running") return;
  // A few clip loads a frame (one at a time is kindest to the web mixer).
  if (queue.length && loading.size < 2) load(queue.shift()!);
  if (!muted && wantBed && (!bed || bed.theme !== wantBed)) {
    const clip = clips.get(BEDS[wantBed] || "");
    if (clip) {
      stopBed();
      try { bed = { theme: wantBed, sound: playClip(clip, { bus: "music", loop: true, gain: AMBIENCE }) }; }
      catch (e) { console.warn(`ambience: ${String(e)}`); bed = { theme: wantBed, sound: null }; }
      return;
    }
  }
  if (music && !muted && clock >= music.next) {
    const c = music.step % CHORDS.length;
    const key = `${music.root}:${c}`;
    let clip = chordCache.get(key);
    if (!clip) { clip = chordClip(music.root, CHORDS[c]!); chordCache.set(key, clip); return; } // rendered this frame, played next
    music.step++;
    music.next = clock + 6 / Math.max(0.05, music.tempo * 10);
    try { playClip(clip, { bus: "music", gain: MUSIC }); } catch { /* the mixer is full */ }
  }
}
