// Crown Draughts rules engine.
//
// Pure, deterministic state transitions independent of rendering. Exposes:
//   - legal-action queries          legalActions(state)
//   - deterministic resolution      apply(state, action) / applyInPlace + undoInPlace
//   - serializable state            serialize / deserialize / migrateState
//   - monotonic ply counter         state.ply increments on every applied command
//   - terminal-state reason         state.result = { winner, reason, ... }
//
// Rules of the house (taught by the Learn mode):
//   * Men step one square diagonally forward; crowned pieces step one square
//     diagonally in any of the four directions.
//   * Captures jump over an adjacent enemy onto the empty square beyond and
//     are mandatory. Men capture in all four diagonal directions.
//   * Jumps chain: after a jump, if the same piece can jump again it must
//     continue. A chain ends only when no further jump exists, or when a man
//     reaches the far edge and is crowned (crowning ends the turn).
//   * Win by capturing every enemy piece or leaving the enemy no legal move.
//   * Draws: threefold repetition, 80 plies without capture or promotion
//     (ruleset-dependent), or agreement.

import { fnv1aHex } from './rng.js';

export const ENGINE_VERSION = 1;
export const CONTENT_VERSION = 1;

export const RULESETS = {
  duel: {
    id: 'duel', name: 'Crown Duel', size: 8, playerCount: 2, homeRows: 3, drawPlies: 80,
    playersLabel: '2 players',
    description: 'The classic contest on an 8×8 court. Twelve pieces per house.',
  },
  grand: {
    id: 'grand', name: 'Grand Court', size: 10, playerCount: 2, homeRows: 4, drawPlies: 100,
    playersLabel: '2 players',
    description: 'A wide 10×10 court, twenty pieces per house, deeper endgames.',
  },
  melee: {
    id: 'melee', name: 'Royal Melee', size: 10, playerCount: 4, homeRows: 2, drawPlies: 140,
    playersLabel: '2–4 players',
    description: 'Four houses strike from four sides of a 10×10 court. Last house standing wins.',
  },
};

const DIAGS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
export const PLAYER_COLORS = ['ivory', 'onyx', 'jade', 'ember'];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function playerDef(ruleset, i) {
  if (ruleset.playerCount === 2) return i === 0 ? { axis: 'r', dir: +1 } : { axis: 'r', dir: -1 };
  return [
    { axis: 'r', dir: +1 },  // south house advances up the rows
    { axis: 'c', dir: +1 },  // west house advances along the columns
    { axis: 'r', dir: -1 },  // north house
    { axis: 'c', dir: -1 },  // east house
  ][i];
}

export function moveDirs(def, crowned) {
  if (crowned) return DIAGS;
  if (def.axis === 'r') return [[def.dir, -1], [def.dir, +1]];
  return [[-1, def.dir], [+1, def.dir]];
}

export function isPlayable(size, r, c) {
  return r >= 0 && c >= 0 && r < size && c < size && ((r + c) & 1) === 1;
}

export function isPromotionSquare(def, size, r, c) {
  const coord = def.axis === 'r' ? r : c;
  return def.dir === +1 ? coord === size - 1 : coord === 0;
}

const COL_LETTERS = 'abcdefghij';
export function squareName(r, c) {
  return `${COL_LETTERS[c]}${r + 1}`;
}

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

function initialPieces(ruleset) {
  const size = ruleset.size;
  const pieces = [];
  let id = 0;
  for (let p = 0; p < ruleset.playerCount; p++) {
    const def = playerDef(ruleset, p);
    for (let a = 0; a < size; a++) {
      for (let b = 0; b < size; b++) {
        let r, c;
        if (ruleset.playerCount === 2) {
          if (def.dir === +1) { if (a >= ruleset.homeRows) continue; r = a; }
          else { if (a < size - ruleset.homeRows) continue; r = a; }
          c = b;
        } else {
          if (a >= ruleset.homeRows) continue;
          const near = def.dir === +1 ? a : size - 1 - a;
          const mid = 2 + b;
          if (mid > size - 3) continue;
          if (def.axis === 'r') { r = near; c = mid; } else { c = near; r = mid; }
        }
        if (isPlayable(size, r, c)) pieces.push({ id: id++, owner: p, r, c, crowned: false, captured: false });
      }
    }
  }
  return pieces;
}

/**
 * Create a game.
 * opts: { ruleset, seed, players: [{name, kind}], setup?: {pieces:[{owner,r,c,crowned}], turn},
 *         contentId, contentVersion, createdAtUtc }
 */
export function createGame(opts = {}) {
  const ruleset = RULESETS[opts.ruleset || 'duel'];
  if (!ruleset) throw new Error(`unknown ruleset: ${opts.ruleset}`);
  const seed = (opts.seed ?? 1) >>> 0;
  const players = [];
  for (let i = 0; i < ruleset.playerCount; i++) {
    const def = playerDef(ruleset, i);
    const given = opts.players?.[i] || {};
    players.push({
      id: i,
      name: given.name || `House ${i + 1}`,
      kind: given.kind || 'human',
      axis: def.axis, dir: def.dir,
      color: PLAYER_COLORS[i],
      eliminated: false,
    });
  }
  const pieces = opts.setup
    ? opts.setup.pieces.map((p, i) => ({ id: i, owner: p.owner, r: p.r, c: p.c, crowned: !!p.crowned, captured: false }))
    : initialPieces(ruleset);
  const state = {
    v: ENGINE_VERSION,
    ruleset: ruleset.id,
    size: ruleset.size,
    seed,
    players, pieces,
    turn: opts.setup?.turn ?? 0,
    ply: 0,
    sinceProgress: 0,
    rep: {},
    pendingDraw: null,
    phase: 'active',
    result: null,
    streams: {
      rules: (seed ^ 0x9e3779b9) >>> 0,
      decor: (seed ^ 0x85ebca6b) >>> 0,
      av: (seed ^ 0xc2b2ae35) >>> 0,
    },
    log: [],
    invalids: {},
    meta: {
      contentId: opts.contentId || null,
      contentVersion: opts.contentVersion ?? CONTENT_VERSION,
      createdAtUtc: opts.createdAtUtc || null,
    },
  };
  state.rep[positionKey(state)] = 1;
  if (opts.setup) {
    const err = validateSetup(state);
    if (err) throw new Error(`illegal setup: ${err}`);
  }
  return state;
}

/** Validate a custom setup. Returns null when legal, else a reason string. */
export function validateSetup(state) {
  const seen = new Set();
  for (const p of state.pieces) {
    if (!isPlayable(state.size, p.r, p.c)) return `piece ${p.id} on unplayable square ${p.r},${p.c}`;
    const key = p.r * state.size + p.c;
    if (seen.has(key)) return `two pieces share square ${p.r},${p.c}`;
    seen.add(key);
    if (!state.players[p.owner]) return `piece ${p.id} has unknown owner ${p.owner}`;
  }
  const ruleset = RULESETS[state.ruleset];
  for (const pl of state.players) {
    if (pl.eliminated) continue;
    for (const p of state.pieces) {
      if (p.owner !== pl.id || p.crowned || p.captured) continue;
      if (isPromotionSquare(pl, state.size, p.r, p.c)) return `uncrowned piece ${p.id} starts on its promotion square`;
    }
  }
  if (state.turn < 0 || state.turn >= state.players.length) return 'turn out of range';
  if (state.pieces.length > state.size * state.size / 2) return 'too many pieces';
  return null;
}

// ---------------------------------------------------------------------------
// Move generation
// ---------------------------------------------------------------------------

function buildBoard(state) {
  const b = new Int16Array(state.size * state.size).fill(-1);
  for (const p of state.pieces) if (!p.captured) b[p.r * state.size + p.c] = p.id;
  return b;
}

function genCapturesForPiece(state, board, piece, out) {
  const size = state.size;
  const def = state.players[piece.owner];
  const startR = piece.r, startC = piece.c;
  const path = [];
  const caps = [];
  board[startR * size + startC] = -1; // piece in flight
  const pushChain = (crowns) => {
    out.push({
      type: 'move', piece: piece.id,
      from: [startR, startC],
      path: path.map((s) => s.slice()),
      captures: caps.slice(),
      crowns,
    });
  };
  const dfs = (r, c, crowned) => {
    let continued = false;
    for (const [dr, dc] of DIAGS) {
      const mr = r + dr, mc = c + dc;
      const tr = r + 2 * dr, tc = c + 2 * dc;
      if (!isPlayable(size, tr, tc)) continue;
      if (board[tr * size + tc] !== -1) continue;
      const midId = board[mr * size + mc];
      if (midId < 0) continue;
      if (state.pieces[midId].owner === piece.owner) continue;
      board[mr * size + mc] = -1;
      board[tr * size + tc] = piece.id;
      path.push([tr, tc]);
      caps.push(midId);
      const landsPromo = !crowned && isPromotionSquare(def, size, tr, tc);
      if (landsPromo) {
        pushChain(true); // crowning ends the chain
        continued = true;
      } else {
        dfs(tr, tc, crowned);
        continued = true;
      }
      caps.pop();
      path.pop();
      board[mr * size + mc] = midId;
      board[tr * size + tc] = -1;
    }
    if (!continued && caps.length > 0) pushChain(false);
  };
  dfs(startR, startC, piece.crowned);
  board[startR * size + startC] = piece.id;
}

/** All legal move actions for a player (defaults to the side to move). */
export function legalActions(state, playerId = state.turn) {
  if (state.phase !== 'active') return [];
  const pl = state.players[playerId];
  if (!pl || pl.eliminated) return [];
  const size = state.size;
  const board = buildBoard(state);
  const captures = [];
  for (const piece of state.pieces) {
    if (piece.captured || piece.owner !== playerId) continue;
    genCapturesForPiece(state, board, piece, captures);
  }
  if (captures.length) return captures;
  const quiet = [];
  for (const piece of state.pieces) {
    if (piece.captured || piece.owner !== playerId) continue;
    for (const [dr, dc] of moveDirs(pl, piece.crowned)) {
      const tr = piece.r + dr, tc = piece.c + dc;
      if (!isPlayable(size, tr, tc)) continue;
      if (board[tr * size + tc] !== -1) continue;
      quiet.push({
        type: 'move', piece: piece.id,
        from: [piece.r, piece.c], path: [[tr, tc]], captures: [],
        crowns: !piece.crowned && isPromotionSquare(pl, size, tr, tc),
      });
    }
  }
  return quiet;
}

/** Legal actions that begin with a given piece — used by hints and tutorials. */
export function legalActionsForPiece(state, pieceId, playerId = state.turn) {
  return legalActions(state, playerId).filter((a) => a.piece === pieceId);
}

function samePath(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const fail = (reason) => ({ ok: false, reason });

/**
 * Validate a command against the state. Returns { ok:true, resolved } or
 * { ok:false, reason }. Reasons are stable machine strings the UI translates
 * into explanations.
 */
export function validateAction(state, action) {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return fail('bad-format');
  if (state.phase !== 'active') return fail('game-over');
  switch (action.type) {
    case 'move': return validateMove(state, action);
    case 'resign': {
      const p = state.players[action.player];
      if (!p || p.eliminated) return fail('no-such-player');
      if (action.player !== state.turn) return fail('not-your-turn');
      return { ok: true };
    }
    case 'offerDraw': {
      if (action.player !== state.turn) return fail('not-your-turn');
      if (state.pendingDraw) return fail('draw-already-pending');
      return { ok: true };
    }
    case 'acceptDraw':
    case 'declineDraw': {
      if (!state.pendingDraw) return fail('no-draw-pending');
      if (action.player === state.pendingDraw.by) return fail('not-your-turn');
      return { ok: true };
    }
    case 'timeout': {
      const p = state.players[action.player];
      if (!p || p.eliminated) return fail('no-such-player');
      return { ok: true }; // session/host attests the clock
    }
    default:
      return fail('unknown-action');
  }
}

function validateMove(state, action) {
  if (!Number.isInteger(action.piece)) return fail('bad-format');
  const p = state.pieces[action.piece];
  if (!p || p.captured) return fail('no-piece');
  if (p.owner !== state.turn) return fail('not-your-piece');
  if (!Array.isArray(action.path) || action.path.length === 0) return fail('bad-format');
  if (action.path.length > 64) return fail('bad-format');
  for (const s of action.path) {
    if (!Array.isArray(s) || s.length !== 2 || !Number.isInteger(s[0]) || !Number.isInteger(s[1])) return fail('bad-format');
  }
  const legal = legalActions(state);
  const match = legal.find((a) => a.piece === action.piece && samePath(a.path, action.path));
  if (match) return { ok: true, resolved: match };
  return classifyMoveError(state, action, legal);
}

function classifyMoveError(state, action, legal) {
  const p = state.pieces[action.piece];
  const anyCapture = legal.some((a) => a.captures.length > 0);
  const step = action.path[0];
  if (!isPlayable(state.size, step[0], step[1])) return fail('illegal-target');
  const dr = step[0] - p.r, dc = step[1] - p.c;
  const ad = Math.abs(dr);
  if (ad !== Math.abs(dc) || (ad !== 1 && ad !== 2)) return fail('illegal-target');
  const board = buildBoard(state);
  if (board[step[0] * state.size + step[1]] !== -1) return fail('illegal-target');
  if (ad === 1 && anyCapture) return fail('must-capture');
  if (ad === 2) {
    const mid = board[(p.r + dr / 2) * state.size + (p.c + dc / 2)];
    if (mid < 0 || state.pieces[mid].owner === p.owner) return fail('illegal-target');
    // a valid first jump that does not complete a maximal chain
    const prefixes = legal.filter((a) => a.piece === action.piece && a.path.length > action.path.length &&
      samePath(a.path.slice(0, action.path.length), action.path));
    if (prefixes.length) return fail('incomplete-chain');
    return fail('illegal-target');
  }
  if (ad === 1) {
    const def = state.players[p.owner];
    const dirs = moveDirs(def, p.crowned);
    if (!dirs.some((d) => d[0] === dr && d[1] === dc)) return fail('illegal-target');
    return fail('illegal-target');
  }
  return fail('illegal-target');
}

export const INVALID_REASON_TEXT = {
  'bad-format': 'That command was not understood.',
  'game-over': 'This round has already ended.',
  'unknown-action': 'Unknown action.',
  'no-piece': 'There is no piece there.',
  'no-such-player': 'No such player.',
  'not-your-piece': 'That piece belongs to another house.',
  'not-your-turn': 'It is not your turn.',
  'must-capture': 'A capture is available — you must take it.',
  'incomplete-chain': 'The jump chain continues — keep jumping.',
  'illegal-target': 'That square is not a legal destination.',
  'draw-already-pending': 'A draw offer is already on the table.',
  'no-draw-pending': 'There is no draw offer to answer.',
};

// ---------------------------------------------------------------------------
// Application (immutable + in-place variants for search)
// ---------------------------------------------------------------------------

/** Pure application: returns a new state; the input state is untouched. */
export function apply(state, action) {
  const check = validateAction(state, action);
  if (!check.ok) {
    const err = new Error(`invalid action: ${check.reason}`);
    err.reason = check.reason;
    throw err;
  }
  const next = cloneState(state);
  applyInPlace(next, check.resolved || action);
  return next;
}

/**
 * In-place application for search. `resolved` must be a validated action
 * (from validateAction). Returns an undo token for undoInPlace.
 */
export function applyInPlace(state, action, commandId = null) {
  const token = {
    action, captured: [], removed: [], eliminated: [],
    promoted: false, prevTurn: state.turn, prevSince: state.sinceProgress,
    prevPhase: state.phase, prevResult: state.result, prevPending: state.pendingDraw,
    repKey: null,
  };
  state.ply += 1;
  switch (action.type) {
    case 'move': {
      const p = state.pieces[action.piece];
      for (const cid of action.captures) {
        const victim = state.pieces[cid];
        victim.captured = true;
        token.captured.push({ id: cid });
      }
      const last = action.path[action.path.length - 1];
      p.r = last[0];
      p.c = last[1];
      if (action.crowns && !p.crowned) {
        p.crowned = true;
        token.promoted = true;
      }
      state.pendingDraw = null;
      state.sinceProgress = (action.captures.length > 0 || token.promoted) ? 0 : state.sinceProgress + 1;
      state.log.push({ t: 'm', c: commandId, p: action.piece, path: action.path, caps: action.captures, cr: action.crowns ? 1 : 0 });
      if (state.sinceProgress >= RULESETS[state.ruleset].drawPlies) {
        setResult(state, null, 'move-limit');
        break;
      }
      advanceTurn(state, token);
      if (state.phase === 'active') {
        const key = positionKey(state);
        token.repKey = key;
        const count = (state.rep[key] || 0) + 1;
        state.rep[key] = count;
        if (count >= 3) setResult(state, null, 'repetition');
      }
      break;
    }
    case 'resign': {
      state.log.push({ t: 'resign', c: commandId, pl: action.player });
      eliminatePlayer(state, action.player, 'resignation', token);
      break;
    }
    case 'timeout': {
      state.log.push({ t: 'timeout', c: commandId, pl: action.player });
      eliminatePlayer(state, action.player, 'timeout', token);
      break;
    }
    case 'offerDraw': {
      state.pendingDraw = { by: action.player };
      state.log.push({ t: 'offer', c: commandId, pl: action.player });
      break;
    }
    case 'acceptDraw': {
      state.pendingDraw = null;
      state.log.push({ t: 'accept', c: commandId, pl: action.player });
      setResult(state, null, 'agreement');
      break;
    }
    case 'declineDraw': {
      state.pendingDraw = null;
      state.log.push({ t: 'decline', c: commandId, pl: action.player });
      break;
    }
    default:
      throw new Error(`cannot apply unvalidated action type ${action.type}`);
  }
  return token;
}

export function undoInPlace(state, token) {
  state.ply -= 1;
  const a = token.action;
  if (a.type === 'move') {
    const p = state.pieces[a.piece];
    p.r = a.from[0];
    p.c = a.from[1];
    if (token.promoted) p.crowned = false;
    for (const c of token.captured) state.pieces[c.id].captured = false;
  }
  for (const rm of token.removed) {
    const p = state.pieces[rm.id];
    p.captured = false;
  }
  for (const el of token.eliminated) state.players[el.player].eliminated = false;
  if (token.repKey) {
    const n = (state.rep[token.repKey] || 1) - 1;
    if (n <= 0) delete state.rep[token.repKey];
    else state.rep[token.repKey] = n;
  }
  state.turn = token.prevTurn;
  state.sinceProgress = token.prevSince;
  state.phase = token.prevPhase;
  state.result = token.prevResult;
  state.pendingDraw = token.prevPending;
  state.log.pop();
}

function setResult(state, winner, reason) {
  state.phase = 'over';
  const stats = playerStats(state);
  state.result = {
    winner,
    reason,
    ply: state.ply,
    eliminated: state.players.filter((p) => p.eliminated).map((p) => p.id),
    stats,
  };
}

function eliminatePlayer(state, playerId, reason, token) {
  const pl = state.players[playerId];
  if (pl.eliminated) return;
  pl.eliminated = true;
  token.eliminated.push({ player: playerId, reason });
  for (const p of state.pieces) {
    if (!p.captured && p.owner === playerId) {
      p.captured = true;
      token.removed.push({ id: p.id });
    }
  }
  const alive = state.players.filter((p) => !p.eliminated);
  if (alive.length === 1) setResult(state, alive[0].id, reason);
  else if (alive.length === 0) setResult(state, null, 'mutual-elimination');
  else if (state.turn === playerId) advanceTurn(state, token);
}

function advanceTurn(state, token) {
  const n = state.players.length;
  let idx = state.turn;
  for (let steps = 0; steps < n; steps++) {
    idx = (idx + 1) % n;
    const pl = state.players[idx];
    if (pl.eliminated) continue;
    const hasPieces = state.pieces.some((p) => !p.captured && p.owner === idx);
    if (!hasPieces) {
      eliminatePlayer(state, idx, 'elimination', token);
      if (state.phase !== 'active') return;
      continue;
    }
    if (legalActions(state, idx).length === 0) {
      eliminatePlayer(state, idx, 'immobilized', token);
      if (state.phase !== 'active') return;
      continue;
    }
    state.turn = idx;
    return;
  }
  // No player with legal moves found.
  const alive = state.players.filter((p) => !p.eliminated);
  if (state.phase === 'active') {
    if (alive.length === 1) setResult(state, alive[0].id, 'elimination');
    else setResult(state, null, 'immobilized');
  }
}

// ---------------------------------------------------------------------------
// Keys, hashing, serialization
// ---------------------------------------------------------------------------

export function positionKey(state) {
  let s = '';
  for (const p of state.pieces) {
    if (p.captured) continue;
    s += `${p.owner}${p.crowned ? 'K' : 'M'}${p.r},${p.c};`;
  }
  return `${s}|t${state.turn}`;
}

export function serialize(state) {
  return JSON.stringify({
    v: state.v,
    ruleset: state.ruleset,
    size: state.size,
    seed: state.seed,
    players: state.players.map((p) => [p.id, p.name, p.kind, p.axis, p.dir, p.color, p.eliminated ? 1 : 0]),
    pieces: state.pieces.map((p) => [p.id, p.owner, p.r, p.c, p.crowned ? 1 : 0, p.captured ? 1 : 0]),
    turn: state.turn,
    ply: state.ply,
    sinceProgress: state.sinceProgress,
    rep: state.rep,
    pendingDraw: state.pendingDraw,
    phase: state.phase,
    result: state.result,
    streams: state.streams,
    log: state.log,
    invalids: state.invalids,
    meta: state.meta,
  });
}

export function deserialize(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  const doc = migrateState(d);
  return {
    v: doc.v,
    ruleset: doc.ruleset,
    size: doc.size,
    seed: doc.seed,
    players: doc.players.map((p) => ({ id: p[0], name: p[1], kind: p[2], axis: p[3], dir: p[4], color: p[5], eliminated: !!p[6] })),
    pieces: doc.pieces.map((p) => ({ id: p[0], owner: p[1], r: p[2], c: p[3], crowned: !!p[4], captured: !!p[5] })),
    turn: doc.turn,
    ply: doc.ply,
    sinceProgress: doc.sinceProgress,
    rep: doc.rep || {},
    pendingDraw: doc.pendingDraw || null,
    phase: doc.phase,
    result: doc.result || null,
    streams: doc.streams,
    log: doc.log || [],
    invalids: doc.invalids || {},
    meta: doc.meta || {},
  };
}

/** Migration chain for persisted states. v0 predates repetition/streams. */
const MIGRATIONS = {
  0: (doc) => ({
    ...doc,
    v: 1,
    rep: doc.rep || {},
    streams: doc.streams || { rules: (doc.seed ^ 0x9e3779b9) >>> 0, decor: (doc.seed ^ 0x85ebca6b) >>> 0, av: (doc.seed ^ 0xc2b2ae35) >>> 0 },
    pendingDraw: doc.pendingDraw ?? null,
    invalids: doc.invalids || {},
    meta: doc.meta || {},
  }),
};

export function migrateState(doc) {
  let d = doc;
  let guard = 0;
  while (d.v !== ENGINE_VERSION) {
    const mig = MIGRATIONS[d.v];
    if (!mig || guard++ > 8) throw new Error(`cannot migrate state version ${d.v}`);
    d = mig(d);
  }
  return d;
}

export function hashState(state) {
  // The hash covers rules-relevant state only: volatile metadata like
  // createdAtUtc must never change a replay hash.
  const meta = state.meta || {};
  return fnv1aHex(serialize({
    ...state,
    meta: { contentId: meta.contentId ?? null, contentVersion: meta.contentVersion ?? 1 },
  }));
}

export function cloneState(state) {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    pieces: state.pieces.map((p) => ({ ...p })),
    rep: { ...state.rep },
    pendingDraw: state.pendingDraw ? { ...state.pendingDraw } : null,
    result: state.result ? JSON.parse(JSON.stringify(state.result)) : null,
    streams: { ...state.streams },
    log: state.log.map((e) => ({ ...e })),
    invalids: { ...state.invalids },
    meta: { ...state.meta },
  };
}

// ---------------------------------------------------------------------------
// Statistics and scoring
// ---------------------------------------------------------------------------

/** Per-player match statistics derived from the log and the board. */
export function playerStats(state) {
  const stats = state.players.map(() => ({
    captures: 0, crownsCaptured: 0, piecesLeft: 0, crownedLeft: 0, moves: 0,
    crownsMade: 0, bestChain: 0,
  }));
  for (const p of state.pieces) {
    if (p.captured) continue;
    stats[p.owner].piecesLeft += 1;
    if (p.crowned) stats[p.owner].crownedLeft += 1;
  }
  for (const entry of state.log) {
    if (entry.t !== 'm') continue;
    const mover = state.pieces[entry.p].owner;
    stats[mover].moves += 1;
    if (entry.cr) stats[mover].crownsMade += 1;
    if (entry.caps.length > stats[mover].bestChain) stats[mover].bestChain = entry.caps.length;
    for (const cid of entry.caps) {
      stats[mover].captures += 1;
      if (state.pieces[cid].crowned) stats[mover].crownsCaptured += 1;
    }
  }
  return stats;
}

/**
 * Integer score breakdown for one player. Components are stored as integers;
 * formatting happens in presentation. context: { par?, invalids?, elapsedMs? }.
 */
export function scoreBreakdown(state, playerId, context = {}) {
  const stats = playerStats(state)[playerId];
  const r = state.result;
  const outcome = !r ? 0 : r.winner === null ? 1 : r.winner === playerId ? 2 : 0;
  const captures = stats.captures * 100;
  const crowns = stats.crownsCaptured * 60;
  const survival = stats.piecesLeft * 25 + stats.crownedLeft * 35;
  const objective = outcome === 2 ? 500 : outcome === 1 ? 150 : 0;
  let efficiency = 0;
  if (context.par && outcome === 2) {
    efficiency = Math.max(0, (context.par - state.ply) * 10);
  }
  let timeBonus = 0;
  if (context.timeTargetMs && outcome === 2 && Number.isFinite(context.elapsedMs)) {
    timeBonus = Math.max(0, Math.round((context.timeTargetMs - context.elapsedMs) / 1000)) * 5;
  }
  const invalids = context.invalids ?? (state.invalids[playerId] || 0);
  const penalties = -5 * invalids;
  const total = captures + crowns + survival + objective + efficiency + timeBonus + penalties;
  return {
    components: { captures, crowns, survival, objective, efficiency, timeBonus, penalties },
    outcome, total,
  };
}

/**
 * Tie-break ordering for results with equal totals:
 * primary objective completion, fewer invalid actions, lower elapsed time,
 * then stable session identifier.
 */
export function compareResults(a, b) {
  if (a.outcome !== b.outcome) return b.outcome - a.outcome;
  if ((a.invalids ?? 0) !== (b.invalids ?? 0)) return (a.invalids ?? 0) - (b.invalids ?? 0);
  const at = Number.isFinite(a.elapsedMs) ? a.elapsedMs : Infinity;
  const bt = Number.isFinite(b.elapsedMs) ? b.elapsedMs : Infinity;
  if (at !== bt) return at - bt;
  return String(a.sessionId).localeCompare(String(b.sessionId));
}

/** Elo rating delta. score: 1 win, 0.5 draw, 0 loss. */
export function eloDelta(ratingA, ratingB, score, k = 24) {
  const expected = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return Math.round(k * (score - expected));
}

// ---------------------------------------------------------------------------
// Presentation helpers (announcements, hints)
// ---------------------------------------------------------------------------

export function describeAction(state, action) {
  if (action.type === 'move') {
    const p = state.pieces[action.piece];
    const who = state.players[p.owner];
    const kind = p.crowned ? 'crown' : 'piece';
    const from = squareName(action.from[0], action.from[1]);
    const to = squareName(action.path[action.path.length - 1][0], action.path[action.path.length - 1][1]);
    let s = `${who.name} ${kind} ${from} to ${to}`;
    if (action.captures.length) {
      const victims = action.captures.map((id) => {
        const v = state.pieces[id];
        return `${state.players[v.owner].name} ${v.crowned ? 'crown' : 'piece'} at ${squareName(v.r, v.c)}`;
      });
      s += `, capturing ${victims.join(' and ')}`;
    }
    if (action.crowns) s += ', and is crowned';
    return s;
  }
  const name = state.players[action.player]?.name || 'A house';
  switch (action.type) {
    case 'resign': return `${name} resigns`;
    case 'timeout': return `${name} runs out of time`;
    case 'offerDraw': return `${name} offers a draw`;
    case 'acceptDraw': return 'The draw is accepted';
    case 'declineDraw': return 'The draw is declined';
    default: return 'Unknown action';
  }
}

export const TERMINAL_REASON_TEXT = {
  elimination: 'all opposing pieces were captured',
  immobilized: 'the opponent had no legal move',
  resignation: 'a house resigned',
  timeout: 'time expired',
  agreement: 'draw agreed by both houses',
  repetition: 'the same position occurred three times',
  'move-limit': 'no capture or crowning within the move limit',
  'mutual-elimination': 'no houses remained',
  abandoned: 'a player left and did not return',
};

export function terminalReasonText(state) {
  if (!state.result) return '';
  return TERMINAL_REASON_TEXT[state.result.reason] || state.result.reason;
}
