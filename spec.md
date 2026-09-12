# Crown Draughts — Game Design Document (running spec)

**Pitch:** carved-stone draughts in a royal garden — mandatory captures, chain jumps and crowning on an 8×8 duel court, a 10×10 grand court, or a four-house 10×10 melee, against a deterministic alpha-beta AI, a friend on the same device, or a hosted table.
**Genre:** turn-based abstract board strategy. **Players:** 1 (vs AI), 2–4 pass-and-play, 2–4 hosted. **Session:** 2–5 min per lesson, 3–10 min per journey stage, 5–25 min per full game.
**Platforms:** desktop and mobile browsers (portrait and landscape), keyboard, mouse, touch and gamepad.
**Rendering:** a Three.js scene (vendored `three.module.js`, procedural geometry and canvas textures, no external 3D assets) with a fully playable semantic HTML board and HUD layered over it. Every rule, screen and control works with WebGL unavailable.
**Version:** `starhermit.txt` declares `version=1.0.0`, `content-version=1`, `launch=index.html`, `server=server.js`, `cover=coverart.png`.

| Path | Responsibility |
|---|---|
| `index.html` | Shell: scene region, `#game-ui` HUD regions, one `<section class="screen">` per menu screen, overlay root, toast and live regions. |
| `css/main.css` | Palette tokens, layout, breakpoints, palettes for colour vision, reduced motion, high contrast, large text. |
| `js/main.js` | Boot: constructs `App`, exposes `globalThis.__crownDraughts` for the e2e test and host shells, renders the boot-error panel. |
| `js/rules/engine.js` | Pure rules: rulesets, move generation, validation, `apply`/`applyInPlace`/`undoInPlace`, serialization, migration, hashing, scoring, Elo, announcements. |
| `js/rules/ai.js` | Deterministic negamax with quiescence, four named levels, `hintAction`. |
| `js/rules/rng.js` | mulberry32 PRNG, FNV-1a hashing, `seedFromString`, forkable `createRng`. |
| `js/core/session.js` | One live local round: command pipeline, AI driver, clocks, undo/hint, draw answers, snapshots, replay envelope, `verifyReplay`. |
| `js/core/hosted.js` | `HostedSessionClient`: same event surface as `Session` over realtime rooms (host-routed): the host seat runs the local engine and broadcasts snapshots; guests send their action JSON as binary frames. |
| `js/core/platform.js` | Fragment launch-token read + Bearer + 45-min refresh, `/api/v1/time` sync, retrying REST, profile nickname, cloud-save slot (zip+base64), realtime-rooms REST + the `ws/v1/realtime` socket (16-byte sender prefix stripped). |
| `js/core/storage.js` | Versioned, checksummed localStorage documents: settings, profile, progress, cloud-save mirror, session snapshot, local boards. |
| `js/core/progress.js` | Folds a finished round into progress: stars, streaks, records, rating, mastery, achievements. |
| `js/core/audio.js` | Four-bus WebAudio engine: authored `sfx/*.opus` clips with synthesized fallbacks, generative music pad, ambience beds. |
| `js/content/*.js` | Journey stages, challenges, lessons, daily definition, themes and cosmetics, achievements, validators, `baked.js` (pre-validated layouts). |
| `js/render/*.js` | `RenderFacade`, `BoardView`, `CameraRig`, `Garden`, `FxPool`, procedural `textures.js`. |
| `js/ui/*.js` | `App` orchestrator, `screens.js` builders, `GameController`, `InputManager`, `DomBoard`, `widgets.js`. |
| `server.js` | `createAuthoritativeEngine()` (the StarHermit game script shape) plus the `--dev` static + `/api/v1` + SSE harness. |
| `tests/` | `node --test` suites for engine, AI, content, session, server; `e2e.mjs` browser playthrough. |
| `tools/` | `check.mjs` (syntax sweep), `bake-content.mjs` (regenerates `js/content/baked.js`). Never served. |
| `sfx/` | 47 Opus clips, `manifest.txt` (canonical event binding), `manifest.json` (generator input), `manifest.md` (generator output). |
| `assets/` | `title-emblem.webp`, `results-victory.webp`, `results-defeat.webp`. `coverart.png`, `icon.png`, `favicon.svg` sit at the root. |

## 1. Vision and design pillars

Crown Draughts is draughts played on a quiet stone terrace: the board is heavy, the pieces are turned stone, the garden goes on with or without you. The fantasy is calm mastery — the court enforces the law of capture so the player only has to think about which capture, and how far the chain runs.

1. **The court enforces the law, the player chooses the line.** Captures are mandatory and chains must run to the end; the engine generates only maximal chains and the UI refuses everything else with a named reason (`must-capture`, `incomplete-chain`). Rules in: forced captures, chain preview square by square, crowning that ends the turn. Rules out: optional captures, flying kings, "are you sure?" prompts on legal moves.
2. **One engine, every surface.** Lessons, hints, the AI, the daily, the hosted server and the replay verifier all call `legalActions`/`validateAction` in `js/rules/engine.js`; nothing re-implements a rule. Rules in: tutorials that check goals against real applied actions. Rules out: scripted tutorial boards that bypass validation, client-trusted outcomes in hosted play.
3. **The stone is the hero; the garden is set dressing.** The camera frames the board; the hedges, fountain, lanterns and petals sit on a non-raycast environment layer and change per theme without touching gameplay. Rules in: instanced cells and pieces, procedural marble and slate, a golden selection ring, green ghosts and orange capture rings. Rules out: effects that hide legal targets, camera moves during the player's own input, cosmetics that change hitboxes.
4. **Same truth in HTML.** The `role="grid"` DOM board is a first-class input surface with identical semantics to the canvas: the same `onCell(r, c)` path, the same ghosts, the same announcements. Rules in: keyboard-only play, screen-reader play, WebGL-less play. Rules out: canvas-only affordances, hover-only information.
5. **Deterministic and inspectable.** Every round has a seed, three derived streams (rules, decor, av), a hash after every command and a replay envelope that `verifyReplay` can re-run. Rules in: reproducible dailies, reproducible AI given a seed, baked and proven puzzle stages. Rules out: unseeded randomness in rules, hidden stat boosts, purchases.

## 2. Player experience

**Target player:** someone who knows what draughts is and wants a beautiful, fair, complete single-player and couch game with a real learning path; secondary, the accessibility-first player who needs a board they can drive with keys or a screen reader.

**First 60 seconds.** Boot shows the title over a live attract board (`App._attractBoard`, seed 20260817) with Play, Daily Court, Journey and Learn the rules, plus a non-blocking anonymous-stats banner. A new player who presses Learn sees eight lessons with minutes and an intro line; "First Steps" places a single ivory piece, the coach card in the left rail says what to do, the piece glows gold (`allowPieces`), and a wrong piece is refused with "This lesson asks you to move a different piece — it glows gold." A player who presses Play → Practice is on the board in two more presses; selecting a piece shows green ghost discs on legal squares and orange rings where a capture lands, and attempting a quiet move while a capture exists rattles (`mandatory-capture-alert`) and toasts "A capture is available — you must take it." Journey stage 1 is a full game against the Novice with a par of 90 plies; stages 2–6 use small baked positions that introduce captures.

**Session shape.** Menu → setup facts (court, opponent, goal, par, ranked) → "Ready?" or 3-2-1 → play → results with a component score table → next recommended action (next stage, back to the garden, or play again). The pause overlay and the local snapshot mean a round can be left and resumed from the title screen.

**Emotional beat.** The chain: a piece that lands, lifts, lands again while the court lights the next square; the crown ping and camera nudge when a man reaches the far row. Everything else is quiet so those two moments read.

## 3. Core loop and rules contract

All rules below live in `js/rules/engine.js` unless noted.

**Courts (`RULESETS`).**

| id | name | board | players | home rows | pieces per house | draw clock |
|---|---|---|---|---|---|---|
| `duel` | Crown Duel | 8×8 | 2 | 3 | 12 | 80 plies |
| `grand` | Grand Court | 10×10 | 2 | 4 | 20 | 100 plies |
| `melee` | Royal Melee | 10×10 | 4 | 2 | 6 | 140 plies |

Only dark squares (`isPlayable`: `(r + c) & 1 === 1`) are used. In two-player courts house 0 (ivory) advances up the rows, house 1 (onyx) down. In melee the houses advance south→north (ivory), west→east (jade), north→south (onyx), east→west (ember) (`playerDef`), each from a 2-row strip across columns 2–7; turn order is seat order 0→1→2→3, skipping eliminated houses (`advanceTurn`).

**Entities.** `state.pieces[]` = `{ id, owner, r, c, crowned, captured }`; `state.players[]` = `{ id, name, kind: 'human'|'ai', axis, dir, color, eliminated }`; `state.turn`, `state.ply` (monotonic), `state.sinceProgress`, `state.rep` (position → count), `state.pendingDraw`, `state.phase: 'active'|'over'`, `state.result`, `state.streams { rules, decor, av }`, `state.log`, `state.invalids`, `state.meta { contentId, contentVersion, createdAtUtc }`.

**Legal actions (`legalActions`).**
- A man steps one square diagonally forward (`moveDirs`); a crowned piece steps one square along any of the four diagonals. There are no flying kings.
- A capture jumps an adjacent enemy onto the empty square directly beyond. Men and crowns capture in all four diagonal directions (`genCapturesForPiece` iterates `DIAGS`).
- If any capture exists for the side to move, only capture actions are returned; quiet moves are never offered alongside captures.
- Captures chain: the DFS continues from each landing square and emits only maximal chains (the piece in flight is lifted from the board; jumped pieces are removed for the rest of the chain, so a piece cannot be jumped twice). A man that lands on its promotion row is crowned and the chain ends there (`crowns: true`), even if further jumps would exist.
- An action is `{ type: 'move', piece, from, path: [[r,c]...], captures: [ids], crowns }`. Other action types: `resign`, `offerDraw`, `acceptDraw`, `declineDraw` (only the non-offering side), `timeout` (attested by the session or server clock).

**Validation (`validateAction`).** Returns `{ ok, resolved }` or `{ ok: false, reason }` with stable reasons: `bad-format`, `game-over`, `unknown-action`, `no-piece`, `no-such-player`, `not-your-piece`, `not-your-turn`, `must-capture`, `incomplete-chain`, `illegal-target`, `draw-already-pending`, `no-draw-pending`. `INVALID_REASON_TEXT` holds the player-facing sentences.

**Resolution (`applyInPlace`).** Ply increments; captured pieces are flagged; the mover lands on the last path square; crowning sets `crowned`; `sinceProgress` resets on capture or crowning, else increments; the move is logged; then, in order: (1) `sinceProgress >= drawPlies` → draw `move-limit`; (2) `advanceTurn` — the next house with pieces and a legal move takes the turn, a house with no pieces is eliminated (`elimination`), a house with pieces but no move is eliminated (`immobilized`); (3) the new position key (pieces + side to move) is counted and a third occurrence ends the round as `repetition`. `resign`/`timeout` eliminate that house and remove its pieces; the last remaining house wins.

**Terminal states.** `state.result = { winner | null, reason, ply, eliminated, stats }` with reasons `elimination`, `immobilized`, `resignation`, `timeout`, `agreement`, `repetition`, `move-limit`, `mutual-elimination`, plus `abandoned` (server) and `move-limit-failed` (session goal, `Session._checkMoveLimit`). `TERMINAL_REASON_TEXT` gives the sentence shown on results.

**Scoring (`scoreBreakdown`).** Integers only: captures ×100, crowns captured ×60, survival = pieces left ×25 + crowned left ×35, objective 500 for a win / 150 for a draw / 0, efficiency = max(0, par − ply) ×10 (wins only, when a par exists), speed = max(0, (timeTarget − elapsed) seconds) ×5 (wins only, when a time target exists — no shipped content sets one), penalties −5 per invalid action. Worked example, a duel win at ply 50 with par 60, 12 captures including 1 crown, 5 pieces left of which 1 crowned, no slips: 1200 + 60 + (125 + 35) + 500 + 100 + 0 − 0 = **2020**. Ties (`compareResults`): outcome, fewer invalids, lower elapsed time, then session id.

**Rating.** `eloDelta(a, b, score, k = 24)`. Solo rating changes only in Daily (`progress.js`), against the AI level's nominal rating (Novice 800, Apprentice 1050, Adept 1350, Master 1650), stored per ruleset in the profile. The hosted server keeps its own per-name ratings for two-seat tables.

**RNG and seeding.** Practice and Pass & Play draw a random 32-bit seed; journey stages, challenges and lessons use authored seeds; the daily seed is `fnv1a('crown-draughts:daily:YYYY-MM-DD')`. Rules never consume randomness; the AI's blunder/noise rolls use `createRng(streams.rules ^ ply·0x9e3779b9)` (`Session._maybeDriveAi`), so a replayed seed reproduces the same AI move. Decor uses `streams.decor`-style seeds in `Garden`; audio uses none.

**AI (`js/rules/ai.js`).** Iterative-deepening negamax with alpha-beta, capture-only quiescence to depth 10, stable move ordering (captures, crowning, square index) and a wall-clock deadline that leaves the state hash untouched on timeout.

| level | depth | time | noise | blunder | rating |
|---|---|---|---|---|---|
| Novice | 2 | 120 ms | ±70 | 22 % random move | 800 |
| Apprentice | 4 | 300 ms | ±28 | 7 % | 1050 |
| Adept | 6 | 650 ms | ±8 | 2 % | 1350 |
| Master | 9 | 1300 ms | 0 | 0 | 1650 |

In melee the evaluation scores only the mover against the next house in turn order. The AI thinks after a 350–650 ms pause (`config.aiDelayMs` overrides).

**Undo and hints (`Session`).** Undo is available in `practice`, `lesson` and `journey` unless the content sets `noUndo`; it rewinds to the last point where a human is to move, retiring the rolled-back command ids. Hint runs `hintAction` (depth 5, 400 ms, seed `rules ^ 0x51f15e`), selects the suggested piece and toasts its description. Either counts as an assist, which costs the third journey star.

## 4. Modes and progression

`js/ui/screens.js` `MODES` exposes seven modes on the "Choose your court" screen; the title screen adds Resume, Daily and Journey shortcuts.

| Mode | Setup screen | Opponent | Ruleset | Ranked | Undo/Hint | Progress written |
|---|---|---|---|---|---|---|
| Learn | `learn` (8 lessons) | Garden Novice where a step has one | duel, authored positions | no | yes | `lessonsComplete` |
| Journey | `journey` map → `stage-setup` | Novice→Master by chapter | duel; four grand stages in chapter 6 | no | yes | stars, best plies, plays |
| Daily Court | `daily` facts | seeded level | duel / duel / grand by day | first play only | no undo, hint allowed | daily record, streak, rating |
| Practice | `practice` | any level, either side | duel or grand | no | yes | stats, `masterWins` |
| Challenge | `challenges` → `challenge-setup` | per challenge | duel, grand, melee (local) | no | per constraints | completed, best score |
| Hosted Play | `lobby` → `table-room` | humans | duel, grand, melee | server rating | no | none locally |
| Pass & Play | `local` | 2–4 humans | duel, grand, melee | no | no | stats only |

**Learn.** Eight lessons (`js/content/lessons.js`): First Steps, Taking Pieces, The Law of Capture, Chain Jumps, Crowning, The Crown Walks Backward, The Quiet Victory, Endings and Truces. Each has a `read` step and an `action` step with a baked `setup`, optional `allowPieces` and a goal (`any-move`, `capture`, `capture-crowned`, `crown`, `finish-win`, `finish`) checked by `lessonGoalMet` against the applied action. A legal but off-topic move toasts a nudge; the two free-play lessons complete on any terminal state (or a win).

**Journey.** 48 stages in six chapters of eight (`js/content/journey.js`): The Garden Gate (Novice), The Hedges (chains), The Fountain Court (crowning), The Rose Walk (Adept tactics), The Old Walls (endgames), The Throne Walk (Master, grand court). Stage 8 of each chapter is a mastery trial on the standard layout. Generated stages describe material as `{ w: [men, crowns], b: [men, crowns], capture? }`, are resolved deterministically from the stage seed, and "win in N plies" puzzles are proven by the exact solver to have a forced win with a unique first move; the results are baked into `js/content/baked.js` and verified by `tests/content.test.mjs`. Unlocking (`stageUnlocked`): stage n needs stage n−1 of the chapter; chapter n needs stage 8 of chapter n−1. Stars (`starsForResult`): 1 for the win, +1 at or under par, +1 without assists; a goal with `maxPlies` failing ends the round without completion. Themes rotate per chapter.

**Mastery track and cosmetics (`js/content/themes.js`).** Total journey stars unlock, in order: Garden Guest title (5), Jade Inlay material (12), Ember Sparks trail (20), Lantern Walk surround (30), Laurel Flourish (40), Amber Glass (55), Snowfall trail (70), Maze Walls surround (85), Crown Flourish (100), Moonstone (120), Keeper of the Court title (144). Cosmetics are chosen in Profile and only tint the ivory material, colour the move trail, or change the garden surround.

**Daily Court (`js/content/daily.js`).** For UTC date key `d`: ruleset `['duel','duel','grand'][day % 3]`, opponent `['apprentice','apprentice','adept','adept','master','novice','adept'][day % 7]`, theme `themes[floor(day/2) % 5]`, a move limit (80 duel / 120 grand) when `day % 7 === 3`, par 70 (110 on grand). The first play of a day is ranked: it writes the daily record, extends or resets the streak, and moves the ruleset rating by Elo against the level's rating; later plays are unranked. A day can be flagged `excluded` in progress and is then shown as excluded from ranking. The countdown uses platform time when synced.

**Challenges (`js/content/challenges.js`).** Ten authored: Sprint Crown (win ≤48 plies), Blitz Garden (90 s clocks), Surgical Strike (five-ply puzzle, no undo/hints), Thin Ice, Cornered (two pieces down), Trial of Crowns (crowns only), Royal Rumble (local melee), Perfection (lose ≤2 pieces), The Long Game (grand vs Adept), Master Trial. Constraints (`clockMs`, `noUndo`, `noHints`, `localMultiplayer`) and goals (`maxPlies`, `maxLost`) are read by `Session`, never hard-coded.

**Achievements (`js/content/achievements.js`).** Stable lowercase keys, evaluated idempotently from progress: `first_completion`, `mechanic_mastery` (all 8 lessons), `sustained_streak` (5 daily wins), `difficult_milestone` (ch6-s8), `long_term_goal` (100 rounds), `first_crown`, `triple_chain`, `master_beaten`.

## 5. Controls and interaction

**Pointer (canvas).** `GameController._pointerDown/_pointerUp` raycast the invisible pick plane on the game layer only (`BoardView.pickCell`); pieces, cells, garden and particles never intercept. A press on a cell resolves through `onCell(r, c)`: own piece → select (gold ring, lift, ghosts); a lit square → advance the chain one landing; another own piece → reselect; enemy piece or dead square → explanation toast + wobble. Drag start and drag end resolve to the same cell presses (9 px threshold); pointer capture is taken on the canvas; `pointercancel` drops the drag. Mouse hover shows a faint ring on the hovered cell and a wooden tick on UI controls; touch never hovers.

**DOM board.** `DomBoard` is a `role="grid"` of `<button role="gridcell">`s with roving tabindex, shown with B, the "HTML board" button, the "Always show HTML board" setting, or automatically when WebGL fails or an arrow key is pressed in a round. Cells announce `b3: Guest Gardener piece, selected` / `d5: empty — legal destination`.

**Keyboard (`DEFAULT_KEYBOARD`, remappable in Settings → Controls).**

| Action | Keys | Gamepad |
|---|---|---|
| Confirm / select | Enter, Space | A (0) |
| Cancel / back | Escape | B (1) |
| Cursor up / down / left / right | Arrows, WASD | d-pad 12–15, left stick |
| Pause | P | Start (9) |
| Undo / Hint | U / H | X (2) / Y (3) |
| Camera cycle | C | L3 (10) |
| Mute | M | — |
| Toggle HTML board | B | — |
| Help | F1 | — |
| Skip animation | F | RB (5) |

Enter/Space on a focused button is left to the browser so a control never fires twice; arrows, Space and F1 are `preventDefault`ed so the page never scrolls under the board; keys typed into inputs are ignored except Escape. The gamepad is polled every 90 ms with edge detection.

**Input locking.** `GameController.busy` is set while the move animation plays (capped at 900 ms) and cleared on skip; presses are ignored while busy, during the AI's turn, when it is not the local seat's turn in hosted play, during the countdown (session paused) and after the round ends. Commands carry ids; duplicates are idempotent.

**Feedback per input.** Select → `piece-lift` + ring + ghosts; chain landing → `chain-step` + remaining ghosts + "Chain continues — n follow-up jumps"; commit → slide/capture/multi-jump/crown clips, particles, log entry, live announcement, haptic pulse on captures; cancel → `piece-set-down`; invalid → `ui-error` or `mandatory-capture-alert`, toast, assertive announcement, piece wobble; cursor move → `ui-scroll-tick`; camera → `camera-move` + toast.

## 6. Screens and UI flow

`App.go(screen)` toggles `hidden` on the `<section data-screen>` elements, sets `body[data-screen]`, shows `#game-ui` only for `game`, focuses the screen heading and announces it.

```
boot → title ─┬→ modes ─┬→ practice ───────────────→ game
              │         ├→ local ──────────────────→ game
              │         ├→ journey → stage-setup ──→ game
              │         ├→ learn ──────────────────→ game (lesson coach)
              │         ├→ challenges → challenge-setup → game
              │         ├→ daily ──────────────────→ game
              │         └→ lobby → table-room ─────→ game (hosted)
              ├→ daily (facts) / journey / learn (shortcuts)
              └→ game (Resume round, from the local snapshot)
game → results → (next stage | play again | leave → title)
overlays: pause · settings · profile · help · confirm dialogs · consent banner · countdown
```

**Desktop (≥1024 px).** Scene full-bleed. Top bar: objective title and subtitle left; turn banner (house-coloured left border), clocks, thinking indicator and Pause right. Left rail (250 px): lesson coach, Progress card (par, move limit, piece cap, draw clock), Moves log. Right rail (230 px): Actions (Undo, Hint, Offer draw, Resign, Camera, HTML board), Houses (name, pieces ⬤, crowns ♛, active highlight), Chat when hosted. Menus are centred columns of at most 960 px over the live scene; `.screen` children keep `margin: auto` so overflowing content starts at the top instead of clipping.

**Compact desktop / tablet (≤1023 px).** Rails become off-screen drawers and the bottom tray (Undo, Hint, Draw, Pause) appears.

**Portrait mobile (≤760 px).** Rails hidden; tray at the bottom above the safe area; the DOM board sits above the tray; mode cards collapse to name + meta; the journey grid is 4 columns; the title emblem shrinks to 88 px. The camera rig pulls back with `fitScale` so the whole board fits any aspect.

**Landscape mobile (≤560 px tall).** Left rail hidden, right rail 180 px with a single-column action grid, tray visible, 44 px targets kept.

**Safe areas.** All fixed regions pad by `env(safe-area-inset-*)`. Must never be cut off: the turn banner, Pause, the whole board, the tray, the results headline and total row, the lesson coach text and Continue button, modal action rows (modals scroll inside `max-height: 86vh`).

## 7. Art direction

**Palette (CSS tokens and scene constants).** Ink `#f2ecdc`, dim ink `#c9c0a8`, panel `rgba(24,28,20,.82)` / solid `#1c2119`, page ground `#10130d`, accent gold `#d4af37`, accent blue `#7fb2e0`, ok `#8fd18a`, warn `#e8b45a`, danger `#e06a5a`. Pieces: ivory `#ece2c8`, onyx `#4c5468`, jade `#54a078`, ember `#c05c40`; crowns `#d4af37` with emissive `#332200`. Markers: selection ring `#ffd873`, legal ghosts `#a8e890`, capture rings `#ff9a5c`, last-move discs white at 28 %. Theme keys (`THEMES`): Royal Garden sky `#7fb2e0`→`#f6e3c0`, stone `#d9cdb4`/`#4a4f58`, frame `#8a7a5c`, hedge `#3f6032`; Dusk Conservatory violet `#2c2547`/`#c96f4a` with lanterns; Ember Court `#8a5a3a`/`#e8b46a` with torches and ember drift; Frost Arbor `#9ab8d8`/`#e8f0f8` with snow; Tide Terrace `#5aa8c8`/`#e8e0c0` with a fountain and no trees.

**Shape language.** Everything is turned or carved: pieces are lathe profiles with a lip and a shallow dome, crowns a smaller lathe, the board a stepped slab with raised rails and four sphere finials, cells 0.955-unit boxes with the dark cells 8 mm proud. The garden is round: a circular lawn, a cylindrical terrace, a ring of hedges with a gate toward the camera, icosahedral trees and flowers.

**Typography.** Headings in Iowan Old Style / Palatino / Georgia (serif, 600); UI in `system-ui`. Title `clamp(2.4rem, 7vw, 4.4rem)` in gold with a soft shadow. Body copy capped at 70ch.

**Hero and hierarchy.** The board is the hero; menus are translucent panels that let the scene show through. Event tiers (`FxPool`): ack 4 particles < move 8 < capture 26 / crown 40 < round end 90, with a small camera shake for multi-jumps and a big one at round end.

**Motion.** Camera moves are critically damped springs (`CameraRig`), never per-frame lerps; presets classic / low / top, `fov 33`, distance scaled by board size. Piece hops are 0.22 s per landing with a 0.35 lift, crowning scales 1.18 with an ease-out-back, captures lift and shrink over 0.3 s. Skip (F) settles every tween into the exact state. Decorative motion: water bob, flame flicker, idle camera sway, drifting petals/snow/embers.

**Reduced motion.** Camera snaps to presets, no shake, focus or sway; particles are capped at 4 per emit; CSS animations and transitions collapse to 0.01 ms; the countdown steps faster; the boot bar stops animating. Quality tiers (high 2048-px shadows, DPR ≤2; medium 1024, ≤1.5; low no shadows, DPR 1, no ambient particles or flowers) never change rules or marker visibility; an FPS monitor lowers render scale to 0.6 before anything else.

**Visual assets the design calls for.** A cover image for the platform catalogue (`coverart.png`, 1200×675), a title emblem (`assets/title-emblem.webp`, 512², shown above the title in a gold-ringed circle), and two results illustrations (`assets/results-victory.webp`, `assets/results-defeat.webp`, 896×384) chosen by outcome — a truce shows none. All three `<img>`s are decorative (`alt=""`) and remove themselves on load error. No 3D model is called for: pieces and cells are instanced per house colour from procedural geometry, which a single GLB could not replace without breaking instancing and the cosmetic material tints.

## 8. Audio direction

**Mix.** Four buses under a master gain (`AudioEngine.ensure`): music 0.7, effects 0.9, ambience 0.6, voice 0.8, mute toggles the master. Audio is created on the first pointer or key gesture, suspended when the tab hides, resumed on return. Clips are fetched lazily from `sfx/<name>.opus` on first use and decoded once; a missing or undecodable clip is cached as `null` and the synthesized transient plays instead, so no event is ever silent and no gameplay information is audio-only.

**Music.** A generative pad (`startMusic`): four chords over the theme's root and tempo, two detuned sines per note, 8-second swells, with an intensity layer (`setIntensity`) that doubles the upper voice — the pad restarts when the theme changes. **Ambience.** Synthesized wind (filtered brown noise), scheduled bird chirps and fountain noise start immediately; the authored `amb-<theme>.opus` bed loops on the ambience bus at 0.35 once decoded and fades the synth wind/water out so the beds never stack. **Voice.** Optional `speechSynthesis` of announcements (Settings → "Spoken turn announcements").

**SFX event table** (source of `sfx/manifest.txt`; event ids are `AudioEngine` methods).

| Event | File | Sound | Context |
|---|---|---|---|
| `select` | piece-lift.opus | wooden checker lifted off stone | own piece selected |
| `setDown` | piece-set-down.opus | checker set back down softly | selection cancelled |
| `move` | piece-slide.opus | slide on stone ending in a knock | quiet move applied |
| `chainStep` | chain-step.opus | light mid-hop landing with stone ring | chain landing committed, more jumps remain |
| `capture` | capture.opus | hop and firm double knock | one-piece capture |
| `multiJump` | multi-jump.opus | three escalating landings | two or more captures |
| `crown` | king.opus | metal crown set down, ping and chime | move ends on the crown row |
| `mandatoryCapture` | mandatory-capture-alert.opus | hollow wooden rattle | `must-capture` refusal |
| `turn` | turn-pass.opus | cloth whoosh and knock | every local action applied |
| `opponentTurn` | opponent-turn.opus | distant knock | every hosted remote action |
| `houseFall` | house-fall.opus | checkers swept into a tray | melee house eliminated mid-round |
| `drawOffer` | draw-offer.opus | single brass handbell | draw offered |
| `undo` | undo.opus | reversed scrape | undo applied |
| `hint` | hint.opus | glassy sparkle | hint shown |
| `countdownTick` | ui-countdown-tick.opus | mallet on stone | 3-2-1 steps |
| `roundStart` | round-start.opus | bell, rising chime, clap | "Go!" / "Ready?", hosted round begins |
| `clockWarn` | ui-timer-warning.opus | urgent double knock | active clock first ≤10 s |
| `pause` / `resume` | ui-pause.opus / ui-resume.opus | descending / ascending marimba | pause overlay open / close |
| `win` / `lose` / `draw` | win.opus / lose.opus / draw.opus | bell fanfare / falling wood / two neutral notes | round over (music bus) |
| `levelFail` | level-fail.opus | piece tipping, deflating tone | journey or challenge lost |
| `starAward` | star-award.opus | crystalline star chime | stars on results |
| `newRecord` | new-record.opus | bells, marimba, crown ping | challenge best beaten |
| `streak` | streak.opus | three warm chimes | daily streak ≥3 |
| `achievement` | ui-success.opus | ascending regal chime | achievement unlocked, lesson step complete |
| `masteryUnlock` | mastery-unlock.opus | latch, harp glissando, gold bell | mastery milestone claimed |
| `uiClick` | ui-click.opus | wooden button click | fallback for menu cues |
| `hover` | ui-hover.opus | soft wooden tick | mouse enters a control |
| `uiConfirm` / `uiBack` | ui-confirm.opus / ui-back.opus | rising / falling marimba | confirm dialog yes / cancel, Escape back |
| `uiOpen` / `panelClose` | ui-modal-open.opus / ui-panel-close.opus | panel unfold / drawer shut | modal open / close |
| `toggle` / `tabSwitch` / `sliderDrag` | ui-toggle.opus / ui-tab-switch.opus / ui-slider-drag.opus | switch / tab flick / peg in groove | settings controls |
| `scrollTick` | ui-scroll-tick.opus | ratchet notch | board cursor moved by key or pad |
| `settingsSaved` | ui-settings-saved.opus | stamp on paper | display name saved |
| `toast` | ui-toast.opus | ceramic bell pop | info/ok toast shown |
| `invalid` | ui-error.opus | flat double knock | any other invalid action |
| `cameraMove` | camera-move.opus | airy glide whoosh | camera preset cycled |
| `ambience:<theme>` | amb-royal-garden / amb-dusk-conservatory / amb-ember-court / amb-frost-arbor / amb-tide-terrace .opus | 12-s seamless environment beds | looped while that theme is active |

## 9. Localization

The shipped build is English only: every string is a literal in `js/ui/*.js`, `js/content/*.js`, `INVALID_REASON_TEXT` / `TERMINAL_REASON_TEXT` in the engine, and `index.html` (`lang="en"`). There is no locale table, no language selector, and `navigator.language` is not read. Layout already tolerates longer strings: buttons wrap, panels scroll, `p` copy is capped at 70ch, and the mode cards drop their blurb on portrait phones. The required locale set (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT) is listed under design intent not yet implemented.

## 10. Accessibility

- **Keyboard-only path:** title → Play → mode card → setup radios → primary button → board via arrows/Enter on the DOM grid (auto-pinned on the first arrow press) → Pause with P/Escape → results buttons. Modals trap Tab, close on Escape and restore focus (`widgets.js Modal`). Screen headings receive programmatic focus on every screen change.
- **Focus:** `:focus-visible` 3 px blue outline everywhere; the board cursor cell has a matching inset outline.
- **Announcements:** `#live-region` (polite) receives screen changes, move descriptions ("Ivory piece b3 to d5, capturing Onyx piece at c4"), chain continuation, hints and lesson text; `#alert-region` (assertive) receives invalid-move explanations and the results headline. Toasts are `role="status"`; the turn banner is `role="status"`; chat is `role="log"`.
- **Colour and shape:** each house has a glyph (● ○ ◆ ▲) and a crown mark ♛ on the DOM board and in the Houses list; the turn banner carries a house-coloured bar. Palettes for deuteranopia, protanopia and tritanopia re-tint accent/ok/warn and the legal-target cells. High contrast switches panels to black with white ink.
- **Motion and timing:** reduced motion as in §7; timing assistance gives the human 1.5× clock in solo clocked rounds; the AI never runs a clock.
- **Text and hands:** larger text (118 %), left-handed mode mirrors the tray and rails, haptics can be turned off.
- **Targets:** buttons ≥44×44 CSS px, tabs ≥40 px, DOM cells sized from `min(92vw, 46vh)`.
- **Audio:** independent bus sliders, mute, optional spoken announcements; every audio cue has a visible twin (toast, ring, banner or log line).

## 11. StarHermit integration

Conventions follow https://wiki.starhermit.com/ (manifest, launch token, `/api/v1/time`, game script).

- **Packaging:** `starhermit.txt` with `name`, `launch=index.html`, `owner`, `server=server.js`, `cover=coverart.png`, `version`, `ruleset-engine`, `content-version`. `tests/` and `tools/` are dev-only; the dev server refuses to serve them and any dotfile.
- **Launch and identity:** `Platform.init` reads `#game_token=<jwt>` from the URL fragment (optional `&session_id=`, stripped after the read; query forms for local dev), decodes `sub` + `game_scope` (never hard-coded), sends the token as `Authorization: Bearer` on every API call, and re-mints it every 45 min via `POST /api/v1/games/{slug}/launch-token` (60 s retry). Hosted mode activates whenever a token exists. The profile name is the platform nickname from `GET /api/v1/users/{sub}/profile` (never usernames, never `/api/v1/me`); standalone keeps the local "Guest Gardener". Tokens are never persisted.
- **Time:** `GET /api/v1/time` is probed once at boot; the round-trip-adjusted offset drives `serverNow()`, the daily countdown and presence timestamps.
- **Presence / telemetry:** no per-game presence or telemetry endpoints exist for launch tokens (wiki); both are inert no-ops with the consent toggle retained.
- **Multiplayer:** realtime rooms, host-routed. Host: `POST /api/v1/realtime/rooms` (one team, `seatsPerTeam` from the ruleset, metadata, empty seats play as `apprentice` AI at start), `POST /rooms/{id}/open` to list publicly. Guest: `POST /rooms/quick-join` (`{gameSlug, seats:1}`; 404 → "no open tables"). Transport `ws(s)://<host>/ws/v1/realtime?roomId=&access_token=` — binary frames carry the 16-byte sender prefix (stripped on receipt; guest→host, host→everyone; 8 KB cap), text frames are server control (roster/presence). The host runs the authoritative `Session` locally, broadcasts serialized snapshots, validates guest inputs (`move`/`resign`/`offerDraw`/…) through the same engine, relays chat with attribution, reports via `POST /rooms/{id}/result`, leaves via `POST /rooms/{id}/leave`; guests reconnect via `GET /rooms/mine` and friend invites use `GET /api/v1/me/friends` + `POST /rooms/{id}/invites` (`GET /rooms/invites` to poll). Join codes and public browsing do not exist on the platform — the lobby quick-joins open tables and says so.
- **Cloud save:** progress is a versioned, FNV-checksummed document; `compareSaves` classifies local vs cloud as same / local-ahead / cloud-ahead / conflict by ancestry, archives both on conflict and asks the player which to keep. The cloud copy travels through the real platform slot `GET/PUT /api/v1/me/cloud-saves/{slug}` (zip+base64, debounced with a pagehide flush; the local document is the offline cache).
- **Game script:** `server.js` exports `createAuthoritativeEngine({ now, persist })` — the authoritative-engine shape used by the dev harness (`--dev`) and the node tests; hosted play itself is host-routed over realtime rooms (above) and does not call the script over HTTP.
- **Not used:** platform leaderboards, achievement or rating submission, voice rooms, host settings storage. Achievements, ratings and boards are local documents.

## 12. Technical architecture

- **Command pipeline.** UI → `GameController` → `Session.submit(action, seat)` → seat/turn binding → `validateAction` → `apply` (immutable clone) → hash → events `action`, `state`, `snapshot-request`, then `over` or AI drive. Nothing mutates `state` outside `apply`; the renderer and DOM board consume snapshots.
- **Determinism and replay.** `Session.replayEnvelope()` = schema, engine and content versions, ruleset, seed, setup, players, initial hash, ordered commands, per-command hashes, result; `verifyReplay` re-applies and compares every hash. `applyInPlace/undoInPlace` give the AI and solver allocation-free search with exact restoration (tested by hash).
- **Persistence (`storage.js`).** Keys `crown-draughts:{settings,profile,progress,cloudsave,snapshot,boards,archive:*}`; documents carry `v`, `id`, `parentId`, `at`, `sum`; newer-version documents are never clobbered; loads merge over defaults one level deep; an in-memory backend replaces localStorage when it throws.
- **Render loop.** `RenderFacade._start`: rAF, dt clamped to 0.25 s, spring camera, tweens, garden and particle updates skipped while paused, nothing rendered while hidden; `webglcontextlost/restored` rebuilds the theme and board from the last state.
- **Budgets (as built).** Cells: 2 instanced draws; pieces: 1 body + 1 crown instanced draw per house colour; particles ≤2000/900/300 by tier; ambient drift 140 (260 snow); shadows one directional light; DPR capped per tier; render scale auto 0.6–1.0. Target 60 fps on desktop, 30 fps acceptable on phones.
- **E2E driving.** `tests/e2e.mjs` boots `startDevServer({ port: 0 })`, launches headless Chrome via `puppeteer-core`, and drives visible controls (`Play`, mode cards, `Take your seat`, keys B/P/Escape/ArrowUp, real canvas clicks at `renderer.projectCell`) through `globalThis.__crownDraughts` for state assertions, opens a second page for a hosted table, then emulates a 390×844 touch viewport.

## 13. Testing and acceptance criteria

`npm test` runs five `node --test` suites (63 tests):
- **engine** — initial counts, opening move count, mandatory capture, maximal chains and `incomplete-chain`, crowning ends a chain, crowns and men capture backward, elimination, immobilization, move-limit and repetition draws, draw offers, timeouts, invalid reasons, melee geometry and elimination, serialize round-trip, v0 migration, in-place undo hash restore, replay determinism, malformed-command fuzz, score components, tie-breaks, Elo, descriptions, setup validation.
- **ai** — legal at every level, deterministic per seed, takes a mate-in-one, Adept beats random, Master never loses to Novice, hints legal, grand court legality, hash unchanged after timeout.
- **content** — 48 stages / 8 lessons / 10 challenges / 5 themes, unique ids and seeds, baked layouts legal and identical to live regeneration, puzzle proofs unique, daily determinism, lesson solvability, achievement idempotence, cosmetic monotonicity, unlock chain, star rules.
- **session** — golden human-vs-AI game verifies its replay, snapshot/restore, assists, AI continues after undo, AI answers draw offers, undo refusal, clock timeout, move-limit failure, duplicate command ids, invalid counting.
- **server** — ping/time, static index, full hosted duel with bad actors rejected and replay verified, reconnect snapshot with chat, non-member rejection.

`tests/e2e.mjs` (28 checks, exit 0 = "e2e all green"): boot, WebGL canvas, mode select, practice start, DOM-board move, AI reply, HUD, undo, pause, results with breakdown, 48 journey cells, lesson coach and step completion, help and settings overlays, ranked daily changes rating, journey stage id, melee 4 houses / 24 pieces, canvas click selects, hosted create/join/start/move/chat across two pages, portrait tray visible, and zero console errors or page errors.

QA bar (checkable): every mode reachable from the visible UI on desktop and phone; no console errors or 404s across a full playthrough; text and controls never clipped at 1280×800, 390×844 portrait and 844×390 landscape; the first minute teaches through Learn or the lesson coach; every audio event has a visible twin; `node --check` clean on all `.js`/`.mjs`; `python3 tools/audit_game_assets.py crown-draughts` passes (favicons, every clip bound in source, `manifest.json` in sync, Opus 48 kHz mono).

## 14. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `coverart.png` (1200×675) | platform catalogue cover: stone board, crowned ivory piece, fountain garden | FLUX.2 klein, seed 20260908, 1200×672, palette-PNG | generated in this pass (replaced the geometric placeholder) |
| `assets/title-emblem.webp` (512²) | crowned stone piece emblem above the title | FLUX.2 klein, seed 4102 | generated in this pass, wired in `buildTitle` |
| `assets/results-victory.webp` (896×384) | results illustration for wins | FLUX.2 klein, seed 7301 | generated in this pass, wired in `buildResults` |
| `assets/results-defeat.webp` (896×384) | results illustration for losses and missed goals | FLUX.2 klein, seed 7302 | generated in this pass, wired in `buildResults` |
| `icon.png` (256²), `favicon.svg` | platform icon and tab icon | authored | shipped |
| `sfx/*.opus` — 36 clips listed in §8 | UI, board and results events | MOSS-SoundEffect v2.0 | shipped, all bound (`clockWarn`, `scrollTick` newly wired) |
| `sfx/chain-step.opus`, `piece-set-down.opus`, `draw-offer.opus`, `house-fall.opus`, `camera-move.opus`, `mastery-unlock.opus` | new board and results events | MOSS-SoundEffect v2.0, 100 steps | generated in this pass, wired with synth fallbacks |
| `sfx/amb-{royal-garden,dusk-conservatory,ember-court,frost-arbor,tide-terrace}.opus` (12 s) | per-theme ambience beds | MOSS-SoundEffect v2.0, 100 steps | generated in this pass, looped by `_startAmbienceLoop` |
| `sfx/manifest.txt` / `manifest.json` / `manifest.md` | canonical binding / generator input / generator output | authored | shipped |
| 3D models, character animation | — | — | not called for: procedural instanced geometry, no humanoids |

## 15. Known limitations

- **English only** (§9).
- Hosted tables are host-routed over realtime rooms and untestable against a real host locally; report-a-player has no rooms equivalent and returns an honest unsupported; guest reconnect relies on `GET /rooms/mine` plus fresh snapshots. Offline Pass & Play and local AI are unchanged.
- **Tablet rails are unreachable.** Between 761 and 1023 px wide the rails slide off-screen and no control adds `rail-left-open` / `rail-right-open`; the tray covers Undo, Hint, Draw and Pause, but Resign, Camera, HTML board, Houses, Moves and hosted chat need keys (C, B) or a wider window.
- **Move-limit failure reads as a truce.** `Session._forceEnd(null, 'move-limit-failed')` has no `TERMINAL_REASON_TEXT` entry, so results show "A Truce — move-limit-failed" with the draw sound; progress correctly records no completion.
- **Achievement name mismatch:** "Seven Sunrises" unlocks at five daily wins.
- **Men capture backward** by design (international-style capture); Help does not say so explicitly.
- **Join codes are not rate-limited** on the dev server (6 hex characters, `findByJoinCode`).
- **e2e depends on `/tmp/cd-e2e/node_modules/puppeteer-core` and `/usr/bin/google-chrome`**; there is no `npm run test:e2e` script and the suite is not playwright-based.
- **Draws are silent illustrations** on results (no truce image), and the emblem/banner images are decorative only.
- `.dev-data.json` is written beside `server.js` at runtime (git-ignored, never served).

## Design intent not yet implemented

- Ship the nine required locales (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT) through a string table, chosen from the host profile or `navigator.language`, with 30 % expansion allowance.
- Platform leaderboards and achievement submission; voice rooms; friend-invite acceptance UI in the lobby.
- A drawer toggle for the rails on tablet widths, and a truce illustration on results.
- Author `TERMINAL_REASON_TEXT['move-limit-failed']` and play `levelFail` for it.
- Theme-specific music roots already exist per theme; a dedicated authored intensity stem for endgames is intended.
