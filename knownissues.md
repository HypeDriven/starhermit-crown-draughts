# Known Issues — Crown Draughts

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on local5090 (HauhauCS Q3_K_P, 32k ctx),
alongside the game's own unit tests, end-to-end suite, and an independent engine property sweep.

## Test results

| Check | Result |
| --- | --- |
| `npm test` (`node --test tests/engine|ai|content|session|server.test.mjs`) | 61/61 pass, 0 fail (23.2s) |
| `node --check` on all modules | clean (`js/**/*.js`, `server.js`, `tools/*.mjs`, `tests/*.mjs`) |
| `tests/e2e.mjs` (headless Chrome via puppeteer-core) | PASS — 28/28 checks, "e2e all green", no console errors |
| Independent engine sweep (180 random games across `duel`/`grand`/`melee`, 14 661 plies) | 0 mandatory-capture violations, 0 apply errors, 390 promotions, all games terminated |
| HTTP fuzz of `server.js` | **found a remote crash** — see confirmed defect 1 |

`starhermit.txt` declares `server=server.js`, so the server below is the shipped authoritative script,
not just a local dev convenience.

## Confirmed defects

Both were reproduced against a freshly started `server.js` whose PID I tracked, so neither is a
mis-attributed external process kill.

**Update 2026-08-26 — both fixed and verified live (malformed URL → 400, process survives;
code-less join on a private table → `bad-join-code`); `npm test` 61/61 pass afterwards.**

### 1. `GET /%` — any malformed percent-encoding kills the server process — **FIXED 2026-08-26**

- **Fix:** a `safeDecode` helper (try/catch around `decodeURIComponent`) was added ahead of
  `createServer`, and all nine call sites in the handler use it; a malformed encoding now returns
  `400 {error:'bad-encoding'}` and the process stays alive.

- **File:** `server.js:574` (`let rel = decodeURIComponent(path);`) on the static path, and
  `server.js:567` (`engine.getSession(decodeURIComponent(mGet[1]), …)`) on the API path. The same
  unguarded `decodeURIComponent` appears at lines 513, 518, 525, 532, 538, 543 and 548.
- **Trigger:** one unauthenticated request — `GET /%`, or `GET /api/v1/sessions/%`.
- **Behaviour:** `decodeURIComponent` throws `URIError: URI malformed`. The request handler
  (`server.js:484-584`) has no `try/catch` around it — the only `try` is the narrow one around `readFile`
  at lines 578-583 — so the throw escapes the `async` handler as an unhandled rejection and Node exits.
- **Expected:** a malformed URL is a 400, not a service outage.
- **Evidence:**

  ```
  GET /api/v1/ping              -> 200
  GET /%                        -> 000   (connection dropped)
  process alive afterwards      -> NO

  server log:
  server.js:574
      let rel = decodeURIComponent(path);
                ^
  URIError: URI malformed
      at decodeURIComponent (<anonymous>)
      at Server.<anonymous> (file:///.../server.js:574:15)
  ```

  And on the API path:

  ```
  GET /api/v1/sessions/%        -> 000
  server.js:567
          const out = engine.getSession(decodeURIComponent(mGet[1]), authOf(req, url));
  URIError: URI malformed
  ```

### 2. Private tables can be joined by omitting the join code entirely — **FIXED 2026-08-26**

- **Fix:** the guard now reads `String(joinCode || '')` — an absent or empty code no longer falls back
  to the session's own code, so it fails with `bad-join-code` exactly like a wrong code.

- **File:** `server.js:188`
  (`if (!sess.listed && sess.joinCode !== String(joinCode || sess.joinCode).toUpperCase() && sess.seats.length > 0)`)
- **Trigger:** `POST /api/v1/sessions/<id>/join` with a body that has no `joinCode` field, or
  `joinCode: ""`.
- **Behaviour:** when `joinCode` is falsy the expression `String(joinCode || sess.joinCode)` falls back to
  the session's *own* code, so the comparison is `sess.joinCode !== sess.joinCode` — always false — and
  the whole guard short-circuits. Supplying a wrong code is correctly refused; supplying **no** code is
  not. The route resolves `:id` as either a session id or a join code (`server.js:182`,
  `sessions.get(id) || api.findByJoinCode(id)`), so possession of the session id alone is enough to take
  a seat at an unlisted table.
- **Expected:** spec.md §6 "Sessions and transport" — private tables are gated by their join code; an
  absent credential must fail at least as hard as a wrong one.
- **Evidence:** an unlisted 4-seat `melee` table, `id=uH8APnd8_k2L`, `joinCode=5EE995`, absent from
  `GET /api/v1/sessions`:

  ```
  wrong code  : {"ok":false,"error":"bad-join-code"}
  no code     : {"ok":true,"sessionId":"uH8APnd8_k2L","seat":1,"playerToken":"F-QUyRwog1XydJSTQYyfHu0H"}
  empty code  : {"ok":true,"sessionId":"uH8APnd8_k2L","seat":2,"playerToken":"DhURykYzAEwu0kU2Iu-xd6U1"}
  ```

## Suspected — not confirmed

### 1. Join codes can be brute-forced — the join route has no rate limit

- **File:** `server.js:32` (`const shortCode = () => randomBytes(4).toString('hex').toUpperCase().slice(0, 6);`),
  `server.js:174-179` (`findByJoinCode`), `server.js:509-515` (the join route)
- **Concern:** the code space is 6 uppercase hex characters (16^6 ≈ 16.7M), and
  `POST /api/v1/sessions/<code>/join` accepts a code in the path. Rate limiting exists only for commands
  (`server.js:245`, `MAX_COMMANDS_PER_10S`) and chat (`server.js:286`, `CHAT_PER_MINUTE`) — nothing
  throttles session creation, lookup, or join. An attacker could sweep the space to find live tables.
- **Why unconfirmed:** I did not run a brute-force (it would be indistinguishable from a denial-of-service
  against a shared machine, and the practical exposure depends on how many tables are live at once). The
  absence of a limiter on that route is verifiable from the source; the exploitability is a judgement
  call.
- **Disposition 2026-08-26:** left as-is. Real but a design/trade-off decision (choosing limits for a
  dev-oriented server), not a clear bug with a safe minimal fix.

### 2. Uncrowned men capture backwards — intended variant, or a rule bug?

- **File:** `js/rules/engine.js:221-234` (`genCapturesForPiece`'s `dfs`, the `for (const [dr, dc] of DIAGS)`
  on line 223)
- **Concern:** the quiet-move generator restricts direction with `moveDirs(pl, piece.crowned)`, but the
  capture DFS iterates all four diagonals unconditionally, so an uncrowned man can jump backwards — and,
  because captures are mandatory, can be *forced* to.
- **Behaviour (reproduced):** a duel board reduced to one uncrowned man of player 0 at (2,3) and one enemy
  man at (1,4), with player 0's men walking toward increasing rows:

  ```
  man forward row delta = 1 | backward = -1
  legal actions: 1 | capture actions: 1
     capture: {"from":[2,3],"path":[[0,5]],"captures":[12]}
  validateAction: {"ok":true, ...}
  apply ok: true
  ```

  The only legal action is a backward jump.
- **Why unconfirmed:** this is the international-draughts rule and may well be deliberate. spec.md says
  only "Move diagonal pieces, make mandatory captures, chain jumps" and never states a capture direction.
  The shipped tutorial is carefully worded either way: lesson 1 says "Forward is the only way a piece
  **walks** on its own" (`js/content/lessons.js:23`), and the crown lesson says crowned pieces
  "step — and capture — in all four diagonal directions" (`js/content/lessons.js:123`) without claiming
  men cannot. Nothing in the help screens settles it. A human needs to say which draughts variant this is;
  if men are meant to capture forward only, the fix is to filter `DIAGS` by `moveDirs` at line 223.
- **Disposition 2026-08-26:** left as-is. The behaviour matches international draughts and nothing in
  spec.md, lessons, or help contradicts it; changing capture rules without a ruling risks breaking the
  intended variant.

### 2. `tests/e2e.mjs` depends on a puppeteer install outside the repo

- **File:** `tests/e2e.mjs:6`
  (`import puppeteer from '/tmp/cd-e2e/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';`)
- **Concern:** the suite imports from an absolute `/tmp` path. It ran green here because that directory
  happens to exist on this machine, but on a clean checkout the e2e suite cannot run at all.
- **Why unconfirmed:** whether this is intended (a deliberately unvendored dev-only dependency) or an
  accident is a project decision, not something the source settles.
- **Disposition 2026-08-26:** left as-is. Fixing it means vendoring puppeteer or adding a dependency,
  which is a project decision; unit tests and `node --check` cover the validated surface.

## Checked, no defects found

- `js/rules/engine.js` — an independent property sweep of 180 random playouts (60 seeds × `duel`,
  `grand`, `melee`; 14 661 plies total) found **zero** positions where a non-capturing move was offered
  alongside a capture, i.e. mandatory capture is enforced everywhere; `apply` never errored; 390
  promotions occurred; every game ended with a coherent reason
  (`elimination` / `immobilized` / `move-limit` / `repetition`).
- `js/rules/engine.js:592-672` — `serialize` → `deserialize` round-trips to an identical `hashState`;
  `applyInPlace` followed by `undoInPlace` restores the exact pre-move hash while genuinely changing it in
  between.
- `js/rules/engine.js:52-193` — `playerDef`, `moveDirs` (forward-only for men, which is correct for
  *movement*; captures are generated separately), `isPlayable` parity, `isPromotionSquare`, `buildBoard`
  (fresh `Int16Array` per call, so in-place writes are local), and `validateSetup`'s square-legality,
  duplicate-occupancy, owner, promotion-square, turn-range and piece-count checks.
- `js/core/storage.js` — corrupt-storage harness: `loadCloudSave`, `loadLocalBoards`, `loadProfile`,
  `loadProgress`, `loadProgressDoc`, `loadSessionSnapshot` and `loadSettings` were each called against a
  fake `localStorage` pre-filled with `{`, `null`, `[]`, `{"v":9999}`, `"a"`, `0`, `undefined`, `{"v":1}`,
  `{"v":1,"data":null,"crc":0}` and `{"data":{"progress":null}}`. None threw.
- `server.js:254` (`const action = body.action;` in `submitCommand`) — reviewed as a suspected
  null-dereference crash and **disproved**: every route that reaches it reads the body with
  `readBody(req)` and returns 400 on a falsy result first (`server.js:523-524`, and the same pattern at
  511-512, 530-531, 537). `readBody` resolves `JSON.parse(data || '{}')`, so a literal `null` body becomes
  `null` and is caught by that guard. Confirmed by fuzzing with 20 malformed bodies per route.
- `server.js:478-482` (`authOf`) and the per-session authorisation on `getSession` / `replay` /
  `submitCommand` — an unauthenticated caller gets 403 rather than session data; the e2e suite confirms
  the guest sees only its own view.
- `server.js:577` (`if (!filePath.startsWith(ROOT))`) — reviewed as a suspected sibling-directory
  traversal (`/app/public-evil` passing a `startsWith('/app/public')` check) and **disproved**:
  `ROOT = fileURLToPath(new URL('.', import.meta.url))` resolves to
  `/home/albert/games/crown-draughts/` **with** a trailing separator, so
  `'/home/albert/games/crown-draughts-evil/x'.startsWith(ROOT)` is `false`. The prefix check is safe as
  written.
- `server.js` under POST fuzz — 20 malformed bodies plus odd query strings on `/api/v1/sessions`,
  `/api/v1/tables`, `/api/v1/scores` and `/api/v1/time` left the process alive. Directory paths (`/js`,
  `/css`, `/tests`) return 404; `../`, `%2e%2e%2f` and `....//` traversals are refused by the
  `filePath.startsWith(ROOT)` check at `server.js:577`.

## Not tested

- Real multi-machine hosted play, reconnection over a lossy network, and SSE behaviour beyond what
  `tests/e2e.mjs` drives in one browser.
- Audio output (`js/core/audio.js`) and `sfx/`.
- Rating/matchmaking behaviour over many sessions.
- The `tools/bake-content.mjs` / `tools/check.mjs` pipelines were not run (they regenerate committed
  content, which is out of scope for a read-only QA pass).

## Runtime artefacts

Starting `server.js` created an untracked `.dev-data.json` in this game folder (the dev server's
persistence file; sessions themselves are in memory). It is runtime state, not a source change, and is
being cleaned up centrally. `tests/e2e.mjs` writes its own data file and screenshots to `/tmp`. The
untracked `sfx/` directory pre-dates this pass. The join-code reproduction was run against this folder's
`server.js` but created only in-memory sessions.
