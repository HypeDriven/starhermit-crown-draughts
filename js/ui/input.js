// Input: keyboard + gamepad mapped to semantic actions through a remappable
// binding registry. Desktop bindings are declared defaults; player overrides
// are stored in settings. Touch remains pointer-driven UI.

export const ACTIONS = [
  { id: 'confirm', label: 'Confirm / select' },
  { id: 'cancel', label: 'Cancel / back' },
  { id: 'up', label: 'Move cursor up' },
  { id: 'down', label: 'Move cursor down' },
  { id: 'left', label: 'Move cursor left' },
  { id: 'right', label: 'Move cursor right' },
  { id: 'pause', label: 'Pause' },
  { id: 'undo', label: 'Undo (where allowed)' },
  { id: 'hint', label: 'Hint (where allowed)' },
  { id: 'camera', label: 'Reset / cycle camera' },
  { id: 'mute', label: 'Mute' },
  { id: 'board', label: 'Toggle HTML board' },
  { id: 'help', label: 'Help' },
  { id: 'skip', label: 'Skip animation' },
];

export const DEFAULT_KEYBOARD = {
  confirm: ['Enter', 'Space'],
  cancel: ['Escape'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  pause: ['KeyP'],
  undo: ['KeyU'],
  hint: ['KeyH'],
  camera: ['KeyC'],
  mute: ['KeyM'],
  board: ['KeyB'],
  help: ['F1'],
  skip: ['KeyF'],
};

export const DEFAULT_GAMEPAD = {
  confirm: [0],      // A
  cancel: [1],       // B
  undo: [2],         // X
  hint: [3],         // Y
  pause: [9],        // start
  camera: [10],      // left stick
  up: [12], down: [13], left: [14], right: [15], // dpad
  skip: [5],
};

export class InputManager {
  constructor({ onAction }) {
    this.onAction = onAction;
    this.keyboard = structuredClone(DEFAULT_KEYBOARD);
    this.gamepad = structuredClone(DEFAULT_GAMEPAD);
    this.enabled = true;
    this._down = (e) => this._onKeyDown(e);
    this._padState = new Set();
    this._padTimer = null;
    this._recording = null;
  }

  start() {
    window.addEventListener('keydown', this._down);
    this._padTimer = setInterval(() => this._pollGamepad(), 90);
  }

  stop() {
    window.removeEventListener('keydown', this._down);
    clearInterval(this._padTimer);
  }

  applyOverrides(overrides) {
    if (!overrides) return;
    for (const [action, keys] of Object.entries(overrides)) {
      if (this.keyboard[action] !== undefined) this.keyboard[action] = keys;
    }
  }

  applyGamepadOverrides(overrides) {
    if (!overrides) return;
    for (const [action, btns] of Object.entries(overrides)) {
      if (this.gamepad[action] !== undefined) this.gamepad[action] = btns;
    }
  }

  /** Record the next key/button for `actionId`; resolves with the new binding. */
  recordNext(actionId, kind = 'keyboard') {
    return new Promise((resolve) => {
      this._recording = { actionId, kind, resolve };
    });
  }

  cancelRecording() { this._recording = null; }

  _onKeyDown(e) {
    if (this._recording && this._recording.kind === 'keyboard') {
      e.preventDefault();
      const { actionId, resolve } = this._recording;
      this._recording = null;
      this.keyboard[actionId] = [e.code];
      resolve(e.code);
      return;
    }
    if (!this.enabled) return;
    // don't steal keys from text inputs and textareas
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.code !== 'Escape') return;
    }
    for (const [action, codes] of Object.entries(this.keyboard)) {
      if (codes.includes(e.code)) {
        this.onAction(action, { source: 'keyboard', event: e });
        return;
      }
    }
  }

  _pollGamepad() {
    let pads;
    try { pads = navigator.getGamepads?.() || []; } catch { return; }
    const pad = [...pads].find(Boolean);
    if (!pad) return;
    if (this._recording && this._recording.kind === 'gamepad') {
      const idx = pad.buttons.findIndex((b) => b.pressed);
      if (idx >= 0) {
        const { actionId, resolve } = this._recording;
        this._recording = null;
        this.gamepad[actionId] = [idx];
        resolve(idx);
      }
      return;
    }
    if (!this.enabled) return;
    const pressed = new Set();
    pad.buttons.forEach((b, i) => { if (b.pressed) pressed.add(i); });
    // axes as directional input
    const ax = pad.axes[0] || 0;
    const ay = pad.axes[1] || 0;
    for (const [action, btns] of Object.entries(this.gamepad)) {
      const hit = btns.some((b) => pressed.has(b));
      if (hit && !this._padState.has(action)) {
        this._padState.add(action);
        this.onAction(action, { source: 'gamepad' });
      } else if (!hit) {
        this._padState.delete(action);
      }
    }
    for (const [axisAction, active] of [['left', ax < -0.6], ['right', ax > 0.6], ['up', ay < -0.6], ['down', ay > 0.6]]) {
      if (active && !this._padState.has(axisAction)) {
        this._padState.add(axisAction);
        this.onAction(axisAction, { source: 'gamepad' });
      } else if (!active) {
        this._padState.delete(axisAction);
      }
    }
  }

  /** Human-readable binding summary for help cards. */
  bindingText(actionId) {
    const keys = this.keyboard[actionId] || [];
    return keys.map((k) => k.replace('Key', '').replace('Arrow', '')).join(' / ');
  }
}
