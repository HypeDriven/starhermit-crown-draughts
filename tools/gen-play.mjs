// Writes the play scripts under tests/native/ from the rules: a Pass & Play
// duel played to its end on the semantic board (Ivory searches four plies,
// Onyx takes its last legal action: 43 plies, Ivory wins), whose every move
// is a click on the board's square buttons ("C3: Ivory piece", then each
// "D4: empty — legal destination" of its path). The other scripts are
// written by hand. Run: node tools/gen-play.mjs
import { writeFileSync } from 'node:fs';
import { createGame, legalActions, apply, squareName } from '../js/rules/engine.js';
import { chooseAction } from '../js/rules/ai.js';
import { createRng } from '../js/rules/rng.js';

const lines = [
  '# Pass & Play: a whole duel on the semantic board, to the results (tools/gen-play.mjs).',
  'until 600 Crown Draughts',
  'frames 20',
  'click No thanks',
  'frames 5',
  'click =Play',
  'frames 10',
  'click =Pass & Play',
  'frames 10',
  'click =Begin',
  'until 300 Ivory to move',
  'frames 90',
  'key KeyB 1',
  'frames 10',
];
let s = createGame({ ruleset: 'duel', seed: 1, players: [{ name: 'Ivory', kind: 'human' }, { name: 'Onyx', kind: 'human' }] });
let plies = 0;
while (s.phase === 'active' && plies < 300) {
  const acts = legalActions(s);
  const a = s.turn === 0 ? chooseAction(s, { depth: 4, timeMs: 1e9, noise: 0, blunder: 0 }, createRng(5)).action : acts[acts.length - 1];
  const piece = s.pieces[a.piece];
  const who = s.players[piece.owner].name;
  lines.push(`# ply ${plies + 1}: ${who}`);
  lines.push(`click =${squareName(piece.r, piece.c)}: ${who} ${piece.crowned ? 'crowned piece' : 'piece'}`);
  lines.push('frames 3');
  for (const [r, c] of a.path) {
    lines.push(`click =${squareName(r, c)}: empty — legal destination`);
    lines.push('frames 3');
  }
  lines.push('frames 60');
  s = apply(s, a);
  plies++;
}
if (s.phase !== 'over') throw new Error('the scripted duel did not finish');
const winner = s.players[s.result.winner].name;
lines.push(`until 600 ${winner} wins`);
lines.push('frames 30');
lines.push('save passplay-results');
lines.push('expect Score breakdown');
// The actions sit below the fold at 960 × 540: Tab scrolls them into view (Play again, then Leave).
lines.push('key Tab 1', 'frames 3', 'key Tab 1', 'frames 5', 'save passplay-leave', 'key Enter 1', 'frames 5');
lines.push('until 300 Learn the rules');
writeFileSync(new URL('../tests/native/passplay.play', import.meta.url), lines.join('\n') + '\n');
console.log(`tests/native/passplay.play: ${plies} plies, ${winner} wins`);
