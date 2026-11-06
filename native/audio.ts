// Sound, ported from the browser build's js/core/audio.js onto the engine's
// mixer: the authored one-shots (sfx/<name>.opus, sfx/manifest.json) per
// logical event, the theme's authored ambience bed and the generative music
// pad. The runtime's Options › Audio owns the volumes, mute and voice limit
// (the browser build's Music / Effects / Ambience / Voice sliders and its
// game-options.js sound panel); the M key silences the game through the
// engine's game-level mute (setMuted; settings.muted keeps it saved). Event cues play on "effects", interface clicks on
// "interface", the fanfares, the pad and the bed on "music", each at the
// level the browser build's default bus volume gave it.
//
// The pad's chords are rendered once into clips by the engine
// (OfflineAudioContext): the same detuned sines and envelopes. The browser
// build's synthesized stand-ins for clips still loading (and its synthesized wind, birds and
// fountain under the authored bed) are not ported: every clip loads at once
// in onStart (every loaded clip reaches the mixer, natively and on the web)
// and a cue whose clip is still loading is silent; every cue has a visual or
// announced twin. The
// spoken turn announcements (the device's speech voice) are the screen
// reader's now (ui.announce).
import { context, createClip, loadClip, OfflineAudioContext, play as playClip, setMuted as setGameMuted, type AudioClip, type Bus, type Sound } from "starhermit:audio";

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

const clips = new Map<string, AudioClip>();
/** Loads every clip at once (onStart); a cue whose clip is still loading is skipped. */
export function loadSfx(): void {
  for (const file of new Set([...Object.values(BEDS), ...Object.values(SAMPLES)])) {
    loadClip(`sfx/${file}.opus`).then((c) => { clips.set(file, c); }, (e: unknown) => console.warn(`sfx ${file}: ${String(e)}`));
  }
}

/** Plays a logical event's cue (the browser build's audio.<event>()). */
export function play(event: string): void {
  const file = SAMPLES[event];
  const clip = file ? clips.get(file) : undefined;
  if (!clip) return;
  const bus: Bus = INTERFACE.has(event) ? "interface" : MUSIC_CUES.has(event) ? "music" : "effects";
  try { playClip(clip, { bus, gain: bus === "music" ? MUSIC : EFFECTS }); }
  catch { /* the mixer is full this frame: skip it */ }
}

export function setMuted(v: boolean): void { setGameMuted(v); }

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
async function renderChord(root: number, chord: number[]): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, Math.round(8 * RATE), RATE);
  const env = off.createGain();
  env.gain.setValueAtTime(0, 0);
  env.gain.linearRampToValueAtTime(0.028, 2.2);
  env.gain.linearRampToValueAtTime(0, 7.5);
  env.connect(off.destination);
  for (const semi of chord) {
    const f = root * Math.pow(2, semi / 12);
    for (const det of [-4, 3]) {
      const osc = off.createOscillator();
      osc.frequency.value = f * Math.pow(2, det / 1200);
      osc.connect(env);
      osc.start();
    }
  }
  return createClip(await off.startRendering());
}
let music: { root: number; tempo: number; step: number; next: number } | null = null;
const chordCache = new Map<string, AudioClip>();
const chordsAsked = new Set<number>();
/** Renders a root's four chords once; the pad waits for each clip. */
function renderChords(root: number): void {
  if (chordsAsked.has(root)) return;
  chordsAsked.add(root);
  CHORDS.forEach((chord, c) => {
    renderChord(root, chord).then((clip) => { chordCache.set(`${root}:${c}`, clip); }, (e: unknown) => console.warn(`pad: ${String(e)}`));
  });
}
let clock = 0;
export function startMusic(theme: { music?: { root: number; tempo: number } } | null | undefined): void {
  const m = theme?.music || { root: 220, tempo: 0.1 };
  if (music && music.root === m.root && music.tempo === m.tempo) return;
  renderChords(m.root);
  music = { root: m.root, tempo: m.tempo, step: 0, next: clock };
}
export function stopMusic(): void { music = null; }

/** Called each frame with its seconds: once the mixer runs, the bed and the pad. */
export function poll(dt: number): void {
  clock += dt;
  if (context.state !== "running") return; // starting the bed and the pad still waits for the mixer
  if (wantBed && (!bed || bed.theme !== wantBed)) {
    const clip = clips.get(BEDS[wantBed] || "");
    if (clip) {
      stopBed();
      try { bed = { theme: wantBed, sound: playClip(clip, { bus: "music", loop: true, gain: AMBIENCE }) }; }
      catch (e) { console.warn(`ambience: ${String(e)}`); bed = { theme: wantBed, sound: null }; }
      return;
    }
  }
  if (music && clock >= music.next) {
    const c = music.step % CHORDS.length;
    const clip = chordCache.get(`${music.root}:${c}`);
    if (!clip) return; // still rendering
    music.step++;
    music.next = clock + 6 / Math.max(0.05, music.tempo * 10);
    try { playClip(clip, { bus: "music", gain: MUSIC }); } catch { /* the mixer is full */ }
  }
}
