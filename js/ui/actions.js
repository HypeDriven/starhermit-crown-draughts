// The game's input actions (starhermit.txt control.* lines) and their help
// labels; the runtime owns the bindings (Options › Controls).
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
