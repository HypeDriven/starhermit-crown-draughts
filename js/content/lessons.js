// Learn mode: interactive lessons. Each step is validated through the same
// legal-action API used by play — lessons never duplicate rules.

export const LESSONS = [
  {
    id: 'first-steps',
    title: 'First Steps',
    minutes: 2,
    mechanics: ['move'],
    intro: 'Pieces walk the dark squares of the court, one diagonal step at a time.',
    steps: [
      {
        kind: 'read',
        text: 'This is your piece — carved ivory, on a dark square. Pieces only ever stand on dark squares, and they move diagonally forward, toward the far edge of the court.',
        focus: [[2, 1]],
      },
      {
        kind: 'action',
        text: 'Select your piece, then step it one square diagonally forward.',
        setup: { pieces: [{ owner: 0, r: 2, c: 1 }], turn: 0 },
        allowPieces: [[2, 1]],
        goal: { kind: 'any-move' },
        success: 'Well stepped. Forward is the only way a piece walks on its own.',
      },
    ],
  },
  {
    id: 'taking',
    title: 'Taking Pieces',
    minutes: 2,
    mechanics: ['capture'],
    intro: 'Leap over an enemy to remove it from the court.',
    steps: [
      {
        kind: 'read',
        text: 'When your piece stands diagonally beside an enemy and the square beyond is empty, you may jump over it. The jumped piece is taken off the board.',
        focus: [[2, 1], [3, 2]],
      },
      {
        kind: 'action',
        text: 'Jump over the onyx piece to capture it.',
        setup: { pieces: [{ owner: 0, r: 2, c: 1 }, { owner: 1, r: 3, c: 2 }], turn: 0 },
        allowPieces: [[2, 1]],
        goal: { kind: 'capture', min: 1 },
        success: 'Taken. Captures are how you empty the enemy court.',
      },
    ],
  },
  {
    id: 'must-capture',
    title: 'The Law of Capture',
    minutes: 2,
    mechanics: ['capture', 'mandatory'],
    intro: 'In Crown Draughts a capture is never optional.',
    steps: [
      {
        kind: 'read',
        text: 'If any capture is available anywhere on your side of the court, you must take it. Quiet moves are refused until every capture is spent. Try moving your other piece and see what the court says.',
        focus: [[2, 5]],
      },
      {
        kind: 'action',
        text: 'You have two pieces, but only one legal idea: make the capture.',
        setup: { pieces: [{ owner: 0, r: 2, c: 1 }, { owner: 0, r: 2, c: 5 }, { owner: 1, r: 3, c: 2 }], turn: 0 },
        goal: { kind: 'capture', min: 1 },
        success: 'Exactly. The court itself refused every quiet move.',
      },
    ],
  },
  {
    id: 'chains',
    title: 'Chain Jumps',
    minutes: 3,
    mechanics: ['capture', 'chain'],
    intro: 'One jump can become many.',
    steps: [
      {
        kind: 'read',
        text: 'After a jump, if the same piece can jump again, it must keep going. A chain ends only when no further jump exists. Watch the landing squares — the court will light your path.',
        focus: [[2, 1], [4, 3], [6, 5]],
      },
      {
        kind: 'action',
        text: 'Jump both onyx pieces in a single chain: b3 → d5 → f7.',
        setup: { pieces: [{ owner: 0, r: 2, c: 1 }, { owner: 1, r: 3, c: 2 }, { owner: 1, r: 5, c: 4 }], turn: 0 },
        allowPieces: [[2, 1]],
        goal: { kind: 'capture', min: 2 },
        success: 'A double take. Long chains decide whole games.',
      },
    ],
  },
  {
    id: 'crowning',
    title: 'Crowning',
    minutes: 2,
    mechanics: ['promotion'],
    intro: 'Reach the far edge and the piece is crowned.',
    steps: [
      {
        kind: 'read',
        text: 'The far row is the crown row. A piece that steps or lands there is crowned on the spot — and crowning ends the turn immediately, even mid-chain.',
        focus: [[6, 1], [7, 0], [7, 2]],
      },
      {
        kind: 'action',
        text: 'Step your piece onto the crown row.',
        setup: { pieces: [{ owner: 0, r: 6, c: 1 }, { owner: 1, r: 2, c: 7 }], turn: 0 },
        allowPieces: [[6, 1]],
        goal: { kind: 'crown' },
        success: 'Crowned. The piece bears a small stone coronet now.',
      },
    ],
  },
  {
    id: 'crown-moves',
    title: 'The Crown Walks Backward',
    minutes: 3,
    mechanics: ['promotion', 'crown-movement'],
    intro: 'A crowned piece owes no allegiance to direction.',
    steps: [
      {
        kind: 'read',
        text: 'Crowned pieces step — and capture — in all four diagonal directions, forward and backward alike. Your crown here can take the piece behind it.',
        focus: [[4, 3], [3, 2]],
      },
      {
        kind: 'action',
        text: 'Capture backward with your crowned piece.',
        setup: { pieces: [{ owner: 0, r: 4, c: 3, crowned: true }, { owner: 1, r: 3, c: 2 }, { owner: 1, r: 1, c: 6 }], turn: 0 },
        allowPieces: [[4, 3]],
        goal: { kind: 'capture-crowned', min: 1 },
        success: 'Backward, forward — a crown threatens every diagonal it touches.',
      },
    ],
  },
  {
    id: 'immobilize',
    title: 'The Quiet Victory',
    minutes: 4,
    mechanics: ['immobilization'],
    intro: 'You can win without taking the last piece.',
    steps: [
      {
        kind: 'read',
        text: 'A house with no legal move loses, even with pieces still standing. The onyx piece in the corner is pinned by your man — keep the trap shut. Move your crown, not the man, and the corner stays sealed.',
        focus: [[1, 0], [0, 1], [4, 3]],
      },
      {
        kind: 'action',
        text: 'Win the position. Keep the corner sealed.',
        setup: { pieces: [{ owner: 0, r: 0, c: 1 }, { owner: 0, r: 4, c: 3, crowned: true }, { owner: 1, r: 1, c: 0 }], turn: 0 },
        opponent: 'novice',
        goal: { kind: 'finish-win' },
        success: 'No moves, no mercy. The quiet victory counts the same as a rout.',
      },
    ],
  },
  {
    id: 'endings',
    title: 'Endings and Truces',
    minutes: 5,
    mechanics: ['draws', 'resignation'],
    intro: 'Not every round ends in a capture.',
    steps: [
      {
        kind: 'read',
        text: 'A round is drawn when the same position occurs three times, when eighty plies pass with no capture or crowning, or when both houses agree. A house may also resign a lost position. Now play out this endgame against the garden novice — two crowns against one. Any result completes the lesson.',
      },
      {
        kind: 'action',
        text: 'Play the endgame to its finish.',
        setup: {
          pieces: [
            { owner: 0, r: 4, c: 3, crowned: true }, { owner: 0, r: 2, c: 5, crowned: true },
            { owner: 1, r: 6, c: 7, crowned: true },
          ],
          turn: 0,
        },
        opponent: 'novice',
        goal: { kind: 'finish' },
        success: 'Lesson complete. You know every law of the court now.',
      },
    ],
  },
];

export function lessonById(id) {
  return LESSONS.find((l) => l.id === id) || null;
}

/**
 * Pure goal check, run after each applied player action.
 * goal: the step's goal; action: the applied action; stateBefore/stateAfter.
 * Returns true when the step's requirement is satisfied.
 */
export function lessonGoalMet(goal, action, stateBefore, stateAfter) {
  if (!goal) return false;
  switch (goal.kind) {
    case 'any-move':
      return action.type === 'move';
    case 'capture':
      return action.type === 'move' && action.captures.length >= (goal.min || 1);
    case 'capture-crowned': {
      if (action.type !== 'move' || action.captures.length < (goal.min || 1)) return false;
      const p = stateBefore.pieces[action.piece];
      return !!p?.crowned;
    }
    case 'crown':
      return action.type === 'move' && !!action.crowns;
    case 'finish-win':
      return stateAfter.phase === 'over' && stateAfter.result?.winner === 0;
    case 'finish':
      return stateAfter.phase === 'over';
    default:
      return false;
  }
}

/** Whether a free-play lesson step should end (terminal states always do). */
export function lessonStepTerminal(stateAfter) {
  return stateAfter.phase === 'over';
}
