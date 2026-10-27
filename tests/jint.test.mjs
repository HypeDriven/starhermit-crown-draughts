// server.js in the platform's own script sandbox: the StarHermit platform's
// script worker (Platform.ScriptRunner, Jint, strict mode) under the default
// per-invocation budgets (250 ms, 32 MB, 5M statements). A hosted duel between
// two humans and a grand court against the script's AI seat are played to
// their results; every invocation must succeed within the budgets. Skipped
// when the worker is not built here (SH_SCRIPT_RUNNER names its dll; default
// ~/sh/starhermit/src/Platform.ScriptRunner/bin/Debug/net8.0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { legalActions } from '../js/rules/engine.js';

const DLL = process.env.SH_SCRIPT_RUNNER
  || join(homedir(), 'sh/starhermit/src/Platform.ScriptRunner/bin/Debug/net8.0/Platform.ScriptRunner.dll');
const SOURCE = readFileSync(fileURLToPath(new URL('../server.js', import.meta.url)), 'utf8');
let dotnet = false;
try { execFileSync('dotnet', ['--list-runtimes'], { stdio: 'pipe' }); dotnet = true; } catch { dotnet = false; }
const skip = !dotnet || !existsSync(DLL) ? 'the platform script worker is not built here' : false;

function worker() {
  const p = spawn('dotnet', [DLL], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = Buffer.alloc(0);
  const waiters = [];
  p.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4) {
      const n = buf.readInt32LE(0);
      if (buf.length < 4 + n) break;
      const msg = JSON.parse(buf.subarray(4, 4 + n).toString());
      buf = buf.subarray(4 + n);
      waiters.shift()(msg);
    }
  });
  const next = () => new Promise((r) => waiters.push(r));
  const ready = next();
  let sent = false;
  return {
    ready,
    async invoke(entryPoint, ctx) {
      const body = Buffer.from(JSON.stringify({
        op: 'invoke', scriptKey: 'crown-draughts', source: sent ? null : SOURCE,
        gameId: '00000000-0000-0000-0000-0000000000cd', slug: 'crown-draughts', scriptVersion: 1,
        cpuMillis: 250, memoryBytes: 32 * 1024 * 1024, maxStatements: 5_000_000,
        entryPoint, context: JSON.stringify(ctx),
      }));
      sent = true;
      const head = Buffer.alloc(4);
      head.writeInt32LE(body.length);
      p.stdin.write(Buffer.concat([head, body]));
      let r = await next();
      if (r.needSource) { sent = false; return this.invoke(entryPoint, ctx); }
      assert.ok(r.ok, `${entryPoint}: ${r.failure} ${r.message || ''}`);
      const value = JSON.parse(r.return);
      assert.ok(value.ok, `${entryPoint} refused: ${value.error}`);
      return { value, ms: r.elapsedMillis };
    },
    close() { p.stdin.end(); },
  };
}

async function play(w, { ruleset, humans }) {
  const roster = humans.map((id, i) => ({ userId: id, name: `P${i}`, team: 0, slot: i, ai: false }));
  const presence = Object.fromEntries(humans.map((id) => [id, { online: true, left: false }]));
  let now = 5_000_000;
  const ctx = (extra) => ({
    now, random: 0.42, sessionId: 's', playerStates: {},
    players: humans.map((id, i) => ({ id, name: `P${i}`, elo: 1200 })),
    room: { roomId: 'r', metadata: { ruleset }, roster }, presence, ...extra,
  });
  let { value } = await w.invoke('createSession', ctx({ sessionState: null }));
  let ss = value.sessionState, result = null, worst = 0;
  for (let i = 0; i < 2000 && !result; i++) {
    now += 1000;
    const g = ss.game;
    const seat = ss.seats[g.turn];
    const r = seat.ai
      ? await w.invoke('onTick', ctx({ sessionState: ss }))
      : await w.invoke('onPlayerMessage', ctx({
        sessionState: ss,
        message: { from: seat.userId, data: { type: 'act', action: (({ piece, path }) => ({ type: 'move', piece, path }))(legalActions(g)[i % legalActions(g).length]) } },
      }));
    worst = Math.max(worst, r.ms);
    if (r.value.sessionState) ss = r.value.sessionState;
    if (r.value.result) result = r.value;
  }
  return { result, worst };
}

test('server.js referees whole rounds inside the platform sandbox and budgets', { skip, timeout: 600_000 }, async () => {
  const w = worker();
  try {
    await w.ready;
    const duel = await play(w, { ruleset: 'duel', humans: ['a', 'b'] });
    assert.ok(duel.result, 'the duel ended');
    assert.ok(duel.result.result.ranked);
    assert.ok(duel.result.eloUpdates);
    const grand = await play(w, { ruleset: 'grand', humans: ['a'] });
    assert.ok(grand.result, 'the grand court against the AI seat ended');
    console.log(`# slowest invocation: duel ${duel.worst} ms, grand vs AI ${grand.worst} ms (budget 250)`);
    assert.ok(Math.max(duel.worst, grand.worst) < 200, 'every invocation well inside 250 ms');
  } finally { w.close(); }
});
