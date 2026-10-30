# Crown Draughts — Game Design Document (running spec)

**Pitch:** carved-stone draughts in a royal garden — mandatory captures, chain jumps and crowning on an 8×8 duel court, a 10×10 grand court, or a four-house 10×10 melee, against a deterministic alpha-beta AI, a friend on the same device, or a hosted table.
**Genre:** turn-based abstract board strategy. **Players:** 1 (vs AI), 2–4 pass-and-play, 2–4 hosted. **Session:** 2–5 min per lesson, 3–10 min per journey stage, 5–25 min per full game.
**Platforms:** a StarHermit engine script game (engine 1.27.0, host API 1.29): played natively by the StarHermit client and in desktop and mobile browsers (portrait and landscape) by the engine's web runtime; keyboard, mouse, touch and gamepad.
**Rendering:** the royal garden and the board on `starhermit:scene` (three.js-like; procedural geometry, baked grey factor maps for the stone, grass and hedge, no external 3D assets); menus, HUD and a fully playable semantic board on `starhermit:ui`.
**Version:** `starhermit.txt` declares `version=1.0.0`, `content-version=1`, `launch=index.html` (the engine's web loader), `engine.api=1`, `engine.entry=native/main.ts`, `engine.version=1.27.0`, `engine.minor=29`, `engine.capabilities=platform,storage,clipboard`, `server=server.js`, `cover=cover.jpg`.

| Path | Responsibility |
|---|---|
| `native/main.ts` | The entry module: lifecycle (`onStart`, `onUpdate`, `onRender`, `onSuspend`), input routing (actions, pointer and touch on the 3D board), the graphics look per frame. |
| `native/app.ts` | The app (the browser build's `js/ui/app.js` without its DOM): screen state machine, game lifecycle for every mode, hosted tables, results and leaderboard line, HUD state (move log, chat, clocks, coach, toasts, countdown), dialogs. |
| `native/game.ts` | `GameController`: selection, chains, invalid-move explanations, hints, undo, the semantic board's cell states and cursor, keys and pads in a round. |
| `native/screens.ts` | Every screen, dialog, the in-round HUD (top bar, rails, drawers, tray) and the semantic board on `starhermit:ui`, laid out per window size. |
| `native/render.ts` | The garden, board, particle bursts, sky dome and camera rig on `starhermit:scene`; picking by ray against the board plane. |
| `native/quality.ts` | The browser build's four presets and 60 FPS budgets keyed by the runtime's quality tier and level. |
| `native/audio.ts` | Authored clips per event on the engine mixer, the theme's ambience bed, the generative pad rendered into clips. |
| `native/platform.ts` | Saves (`saves`), the game's options and profile (`settings`), the round in progress (`storage`), the platform clock, the leaderboard through `server.js`, and `roomsAdapter` (realtime rooms, the room's bound session and its game socket for `js/core/hosted.js`). |
| `native/i18n.ts`, `native/style.ts`, `native/data.ts` | The runtime's interface language → `js/i18n`; the converted style sheet, theme and palettes; the shared JS tables as loose types. |
| `js/rules/engine.js` | Pure rules: rulesets, move generation, validation, `apply`/`applyInPlace`/`undoInPlace`, serialization, migration, hashing, scoring, Elo, announcements. |
| `js/rules/ai.js` | Deterministic negamax with quiescence, four named levels, `hintAction`. |
| `js/rules/rng.js` | mulberry32 PRNG, FNV-1a hashing, `seedFromString`, forkable `createRng`. |
| `js/core/session.js` | One live local round: command pipeline, AI driver, clocks (on the game clock, `setSessionClock`), undo/hint, draw answers, snapshots, replay envelope, `verifyReplay`. |
| `js/core/hosted.js` | `HostedSessionClient`: the same event surface as `Session` over a realtime room (the lobby) and the session the platform binds to it when it starts: every client sends its commands to `server.js` and replays the table it broadcasts (`replayTable`) through the same rules. |
| `js/core/storage.js` | Pure save shapes: the game's options, profile and progress defaults, the browser build's cloud-save reader and legacy settings mapping. |
| `js/core/progress.js` | Folds a finished round into progress (stars, streaks, records, rating, mastery, achievements); `mergeProgress` for two devices. |
| `js/content/*.js` | Journey stages, challenges, lessons, daily definition, themes and cosmetics, achievements, validators, `baked.js` (pre-validated layouts). |
| `js/i18n/` | `index.js` (`T`, `N`, `setLocale`, `onLanguage`) and `locales/*.js` (every player-facing string, keyed by its US-English text); `js/ui/platform-i18n.js` the StarHermit strings; `js/ui/actions.js` the input actions' help labels. |
| `server.js` | The one platform script (`server=server.js`, Jint, no imports): referees hosted tables (room-bound sessions) and posts solo totals for practice sessions (§11). Its `RULES` block is `js/rules/{rng,engine,ai}.js`, written by `node tools/build-server.mjs` (re-run after any rules change; a test fails while it is stale). |
| `leaderboards.json` | The game's boards (`high-score`, `hosted-wins`) for `~/games/tools/leaderboards.mjs`; the same JSON as `server.js`'s `BOARDS`. |
| `index.html`, `starhermit-files.json` | The engine's web loader and file index, written by `npm run package` (never edited by hand). |
| `assets/` | `ui-style.json` (the converted style sheet), `tex/*.png` (baked factor maps), `title-emblem.webp`, `results-victory.webp`, `results-defeat.webp`. |
| `sfx/` | 47 Opus clips, `manifest.txt` (canonical event binding), `manifest.json`, `manifest.md`. |
| `tests/`, `tools/` | Node tests, `tests/native.mjs` and play scripts; `package-web.mjs`, `css.mjs`, `ui-style.css`, `bake-textures.mjs`, `gen-play.mjs`, `browser-play.mjs`, `check.mjs`, `bake-content.mjs`. Left out of the package. |

## 1. Vision and design pillars

Crown Draughts is draughts played on a quiet stone terrace: the board is heavy, the pieces are turned stone, the garden goes on with or without you. The fantasy is calm mastery — the court enforces the law of capture so the player only has to think about which capture, and how far the chain runs.

1. **The court enforces the law, the player chooses the line.** Captures are mandatory and chains must run to the end; the engine generates only maximal chains and the UI refuses everything else with a named reason (`must-capture`, `incomplete-chain`). Rules in: forced captures, chain preview square by square, crowning that ends the turn. Rules out: optional captures, flying kings, "are you sure?" prompts on legal moves.
2. **One engine, every surface.** Lessons, hints, the AI, the daily, the hosted server and the replay verifier all call `legalActions`/`validateAction` in `js/rules/engine.js`; nothing re-implements a rule. Rules in: tutorials that check goals against real applied actions. Rules out: scripted tutorial boards that bypass validation, client-trusted outcomes in hosted play.
3. **The stone is the hero; the garden is set dressing.** The camera frames the board; the hedges, fountain, lanterns and petals sit on a non-raycast environment layer and change per theme without touching gameplay. Rules in: instanced cells and pieces, procedural marble and slate, a golden selection ring, green ghosts and orange capture rings. Rules out: effects that hide legal targets, camera moves during the player's own input, cosmetics that change hitboxes.
4. **Same truth on the semantic board.** The semantic board (a `starhermit:ui` grid of square buttons) is a first-class input surface with identical semantics to the 3D board: the same `onCell(r, c)` path, the same ghosts, the same announcements. Rules in: keyboard-only play, screen-reader play. Rules out: canvas-only affordances, hover-only information.
5. **Deterministic and inspectable.** Every round has a seed, three derived streams (rules, decor, av), a hash after every command and a replay envelope that `verifyReplay` can re-run. Rules in: reproducible dailies, reproducible AI given a seed, baked and proven puzzle stages. Rules out: unseeded randomness in rules, hidden stat boosts, purchases.

## 2. Player experience

**Target player:** someone who knows what draughts is and wants a beautiful, fair, complete single-player and couch game with a real learning path; secondary, the accessibility-first player who needs a board they can drive with keys or a screen reader.

**First 60 seconds.** Boot shows the title over a live attract board (`attractBoard`, seed 20260817) with Play, Daily Court, Journey and Learn the rules, plus a non-blocking anonymous-stats banner. A new player who presses Learn sees eight lessons with minutes and an intro line; "First Steps" places a single ivory piece, the coach card in the left rail says what to do, the piece glows gold (`allowPieces`), and a wrong piece is refused with "This lesson asks you to move a different piece — it glows gold." A player who presses Play → Practice is on the board in two more presses; selecting a piece shows green ghost discs on legal squares and orange rings where a capture lands, and attempting a quiet move while a capture exists rattles (`mandatory-capture-alert`) and toasts "A capture is available — you must take it." Journey stage 1 is a full game against the Novice with a par of 90 plies; stages 2–6 use small baked positions that introduce captures.

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

**Rating.** `eloDelta(a, b, score, k = 24)`. Solo rating changes only in Daily (`progress.js`), against the AI level's nominal rating (Novice 800, Apprentice 1050, Adept 1350, Master 1650), stored per ruleset in the profile. Hosted tables: `server.js` rates a two-house table of two humans (K 24, from 1200, at least 100) and returns the new ratings as `eloUpdates`.

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

`native/screens.ts` `MODES` exposes seven modes on the "Choose your court" screen; the title screen adds Resume, Daily and Journey shortcuts.

| Mode | Setup screen | Opponent | Ruleset | Ranked | Undo/Hint | Progress written |
|---|---|---|---|---|---|---|
| Learn | `learn` (8 lessons) | Garden Novice where a step has one | duel, authored positions | no | yes | `lessonsComplete` |
| Journey | `journey` map → `stage-setup` | Novice→Master by chapter | duel; four grand stages in chapter 6 | no | yes | stars, best plies, plays |
| Daily Court | `daily` facts | seeded level | duel / duel / grand by day | first play only | no undo, hint allowed | daily record, streak, rating |
| Practice | `practice` | any level, either side | duel or grand | no | yes | stats, `masterWins` |
| Challenge | `challenges` → `challenge-setup` | per challenge | duel, grand, melee (local) | no | per constraints | completed, best score |
| Hosted Play | `lobby` → `table-room` | humans (empty seats: the script's AI) | duel, grand, melee | server result, rating, `hosted-wins` | no | none locally |
| Pass & Play | `local` | 2–4 humans | duel, grand, melee | no | no | stats only |

**Learn.** Eight lessons (`js/content/lessons.js`): First Steps, Taking Pieces, The Law of Capture, Chain Jumps, Crowning, The Crown Walks Backward, The Quiet Victory, Endings and Truces. Each has a `read` step and an `action` step with a baked `setup`, optional `allowPieces` and a goal (`any-move`, `capture`, `capture-crowned`, `crown`, `finish-win`, `finish`) checked by `lessonGoalMet` against the applied action. A legal but off-topic move toasts a nudge; the two free-play lessons complete on any terminal state (or a win).

**Journey.** 48 stages in six chapters of eight (`js/content/journey.js`): The Garden Gate (Novice), The Hedges (chains), The Fountain Court (crowning), The Rose Walk (Adept tactics), The Old Walls (endgames), The Throne Walk (Master, grand court). Stage 8 of each chapter is a mastery trial on the standard layout. Generated stages describe material as `{ w: [men, crowns], b: [men, crowns], capture? }`, are resolved deterministically from the stage seed, and "win in N plies" puzzles are proven by the exact solver to have a forced win with a unique first move; the results are baked into `js/content/baked.js` and verified by `tests/content.test.mjs`. Unlocking (`stageUnlocked`): stage n needs stage n−1 of the chapter; chapter n needs stage 8 of chapter n−1. Stars (`starsForResult`): 1 for the win, +1 at or under par, +1 without assists; a goal with `maxPlies` failing ends the round without completion. Themes rotate per chapter.

**Mastery track and cosmetics (`js/content/themes.js`).** Total journey stars unlock, in order: Garden Guest title (5), Jade Inlay material (12), Ember Sparks trail (20), Lantern Walk surround (30), Laurel Flourish (40), Amber Glass (55), Snowfall trail (70), Maze Walls surround (85), Crown Flourish (100), Moonstone (120), Keeper of the Court title (144). Cosmetics are chosen in Profile and only tint the ivory material, colour the move trail, or change the garden surround.

**Daily Court (`js/content/daily.js`).** For UTC date key `d`: ruleset `['duel','duel','grand'][day % 3]`, opponent `['apprentice','apprentice','adept','adept','master','novice','adept'][day % 7]`, theme `themes[floor(day/2) % 5]`, a move limit (80 duel / 120 grand) when `day % 7 === 3`, par 70 (110 on grand). The first play of a day is ranked: it writes the daily record, extends or resets the streak, and moves the ruleset rating by Elo against the level's rating; later plays are unranked. A day can be flagged `excluded` in progress and is then shown as excluded from ranking. The countdown uses platform time when synced.

**Challenges (`js/content/challenges.js`).** Ten authored: Sprint Crown (win ≤48 plies), Blitz Garden (90 s clocks), Surgical Strike (five-ply puzzle, no undo/hints), Thin Ice, Cornered (two pieces down), Trial of Crowns (crowns only), Royal Rumble (local melee), Perfection (lose ≤2 pieces), The Long Game (grand vs Adept), Master Trial. Constraints (`clockMs`, `noUndo`, `noHints`, `localMultiplayer`) and goals (`maxPlies`, `maxLost`) are read by `Session`, never hard-coded.

**Achievements (`js/content/achievements.js`).** Stable lowercase keys, evaluated idempotently from progress: `first_completion`, `mechanic_mastery` (all 8 lessons), `sustained_streak` (5 daily wins), `difficult_milestone` (ch6-s8), `long_term_goal` (100 rounds), `first_crown`, `triple_chain`, `master_beaten`.

## 5. Controls and interaction

**Pointer and touch (3D board).** `native/main.ts` queues presses and decides them after the frame's UI is built, so a press over a widget (`ui.pointerOver`) is the widget's. A release resolves to `pickCell(x, y)`: the pointer's ray against the board's top plane (`native/render.ts`); a release off the board clears the selection. A cell press goes through `GameController.onCell(r, c)`: own piece → select (gold ring, lift, ghosts); a lit square → advance the chain one landing; another own piece → reselect; enemy piece or dead square → explanation toast. Mouse hover shows a faint ring on the hovered cell; a touch never hovers.

**Semantic board.** A `starhermit:ui` grid of square widgets (`role` button for the dark squares), shown with B, the "HTML board" action, the "Always show HTML board" setting, or the first arrow press in a round; it sits bottom centre (above the tray on compact layouts, smaller on upright phones so the 3D board stays in view). Squares are named for screen readers and play scripts: `b3: Guest Gardener piece, selected` / `d5: empty — legal destination`; they draw the house shapes (ivory disc, onyx ring, jade diamond, ember triangle, gold crown for crowned pieces) with legal targets green (blue in the deuteranopia/protanopia palettes), capture landings orange, the selection gold and the cursor blue.

**Actions** (`starhermit.txt` `control.*` and `engine.gamepad.*`; players rebind keys and pads in the runtime's Options › Controls).

| Action | Keys | Gamepad |
|---|---|---|
| Confirm / select | Enter, Space | South |
| Cancel / back | Escape | East |
| Cursor up / down / left / right | Arrows, WASD | D-pad, left stick |
| Pause | P | Start |
| Undo / Hint | U / H | West / North |
| Camera cycle | C | Left stick press |
| Mute (the game's own sound) | M | — |
| Toggle HTML board | B | Select |
| Help | / (F1 is the runtime's Options) | — |
| Skip animation | F | Right shoulder |

Up and Down move the cursor to the neighbouring row (the square in the same column, else the one beside it); Left and Right to the next dark square of the row. Enter, Space or South on a focused widget is the widget's (the game's confirm waits); arrows in a round move the cursor and focus its square. Escape cancels a selection, then opens the pause card; on menus it goes back (setups → modes → title). While a dialog is open it has the keys; while a text field has focus the keyboard presses no actions. The runtime's own UI navigation (Tab, arrows, Enter, Escape, D-pad, South, East) works on every screen.

**Input locking.** `GameController.busy` is set while the move animation plays (capped at 900 ms) and cleared on skip; presses are ignored while busy, during the AI's turn, when it is not the local seat's turn in hosted play, during the countdown (session paused) and after the round ends. Commands carry ids; duplicates are idempotent.

**Feedback per input.** Select → `piece-lift` + ring + ghosts; chain landing → `chain-step` + remaining ghosts + "Chain continues — n follow-up jumps"; commit → slide/capture/multi-jump/crown clips, particles, log entry, screen-reader announcement, a phone vibration on captures (Haptics); cancel → `piece-set-down`; invalid → `ui-error` or `mandatory-capture-alert`, toast, assertive announcement; cursor move → `ui-scroll-tick`; camera → `camera-move` + toast.

## 6. Screens and UI flow

`go(screen)` (`native/app.ts`) switches the screen `native/screens.ts` draws next frame, clears focus and announces the screen to screen readers.

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
overlays: pause · settings · profile · help · confirm dialogs · session expired · consent banner · countdown · toasts
```

**Wide windows (≥1024 logical px, not short landscape).** Scene full-bleed. Top bar: objective title and subtitle left; turn banner (house-coloured bar), clocks, thinking indicator and Pause right. Left rail (250 px): lesson coach, Progress card (par, move limit, piece cap, draw clock), Moves log (scrolls to its end). Right rail (230 px): Actions (Undo, Hint, Offer draw, Resign, Camera, HTML board), Houses (house dot, name, pieces and crowns, active highlight), Chat when hosted. Menus are centred scrolling columns (title 420, modes 960, setups 560 px at most) over the live scene, vertically centred when shorter than the window. Left-handed mode swaps the rails and mirrors the tray.

**Compact windows (narrower than 1024, or under 560 tall in landscape).** Rails become drawers opened by the tray's Info and Actions (they scroll when taller than the room between the top bar and the tray); the bottom tray holds Info, Undo, Hint, Draw, Pause, Actions (wrapping into rows); the lesson coach docks under the top bar (top-left in short landscape).

**Upright phones (narrower than 760).** The tray takes two rows; the turn banner wraps between the title and Pause; mode cards show name and meta only; the journey grid is 4 columns; the title scales as the browser build's `clamp(2.4rem, 7vw, 4.4rem)`; clocks move under the top bar. The camera rig pulls back with `fitScale` so the whole board fits any aspect.

**Sizes.** Everything is laid out in logical pixels from the runtime's interface scale (`ui.preferences().scale`, the player's interface and text size included) within the window's safe area; long text wraps (`ui.paragraph`); dialogs scroll their body inside 86 % of the window with the action row pinned. Must never be cut off: the turn banner, Pause, the whole board, the tray, the results headline and total row, the lesson coach text and Continue button, dialog action rows.

## 7. Art direction

**Palette (style tokens from `tools/ui-style.css` and scene constants).** Ink `#f2ecdc`, dim ink `#c9c0a8`, panel `rgba(24,28,20,.82)` / solid `#1c2119`, page ground `#10130d`, accent gold `#d4af37`, accent blue `#7fb2e0`, ok `#8fd18a`, warn `#e8b45a`, danger `#e06a5a`. Pieces: ivory `#ece2c8`, onyx `#4c5468`, jade `#54a078`, ember `#c05c40`; crowns `#d4af37` with emissive `#332200`. Markers: selection ring `#ffd873`, legal ghosts `#a8e890`, capture rings `#ff9a5c`, last-move discs white at 28 %. Theme keys (`THEMES`): Royal Garden sky `#7fb2e0`→`#f6e3c0`, stone `#d9cdb4`/`#4a4f58`, frame `#8a7a5c`, hedge `#3f6032`; Dusk Conservatory violet `#2c2547`/`#c96f4a` with lanterns; Ember Court `#8a5a3a`/`#e8b46a` with torches and ember drift; Frost Arbor `#9ab8d8`/`#e8f0f8` with snow; Tide Terrace `#5aa8c8`/`#e8e0c0` with a fountain and no trees.

**Shape language.** Everything is turned or carved: pieces are lathe profiles with a lip and a shallow dome, crowns a smaller lathe, the board a stepped slab with raised rails and four sphere finials, cells 0.955-unit boxes with the dark cells 8 mm proud. The garden is round: a circular lawn, a cylindrical terrace, a ring of hedges with a gate toward the camera, icosahedral trees and flowers.

**Typography.** Headings in the generic `serif` face (600); UI in `system-ui`. Title 7 % of the window width between 38.4 and 70.4 px, in gold with a soft shadow. Long copy wraps to its column.

**Hero and hierarchy.** The board is the hero; menus are translucent panels that let the scene show through. Event tiers (`FxPool`): ack 4 particles < move 8 < capture 26 / crown 40 < round end 90, with a small camera shake for multi-jumps and a big one at round end.

**Motion.** Camera moves are critically damped springs (`CameraRig`), never per-frame lerps; presets classic / low / top, `fov 33`, distance scaled by board size. Piece hops are 0.22 s per landing with a 0.35 lift, crowning scales 1.18 with an ease-out-back, captures lift and shrink over 0.3 s. Skip (F) settles every tween into the exact state. Decorative motion: water bob, flame flicker, idle camera sway, drifting petals/snow/embers.

**Reduced motion.** Camera snaps to presets, no shake, focus or sway; particles are capped at 4 per emit; UI transitions are instant (the runtime's reduced motion); the countdown steps faster. Reduced motion (the runtime's setting) also holds the garden still: no water bob, lantern shimmer, canopy sway, crown glint or ambient drift.

**Graphics.** The scene renders with ACES filmic tone mapping (exposure 1.12). Lighting is a theme-coloured sun (shadows over the board and terrace), a hemisphere sky fill and a faint ambient term, at three.js r160's intensities divided by π (the engine's convention); with reflections on, a prefiltered `RoomEnvironment(renderer)` (PMREM) adds image-based light — a faint wash on the garden (`environmentIntensity` 0.22) and per-material `envMap` strengths on the board (pieces 0.35, onyx 0.2, crowns 0.9, light cells 0.22, dark cells 0.12), with clearcoat on the physical materials. Detailed tiers bump the stone with its own maps. Post effects are the runtime's: GTAO (`renderer.ao`), HDR-threshold bloom (`renderer.bloom`, threshold 2.4: lanterns, torches and crown glints), the display-space grade with a soft vignette (`renderer.grade`) and FXAA / SMAA / MSAA (`renderer.antialias`). The sky is a vertex-coloured dome with the old shader's elevation gradient.

**Textures.** The browser build painted marble, slate, grass and hedge per pixel at start; the engine's interpreter is far too slow for that, so `tools/bake-textures.mjs` bakes the same seeded noise once into grey factor maps (`assets/tex/*.png`, 256 px; the hedge 128) and each material's colour carries the theme's tint times the map's gain. One map serves every theme and seed (the browser build varied the grain per session seed).

**Graphics levels.** The runtime owns Auto and the level choice, render scale, the pixel-ratio cap, adaptive resolution, the frame-rate limit and readout, and the shadow map size (Options › Graphics). `native/quality.ts` maps its quality tier (`frame().quality`) to the browser build's preset rows and budgets, with grass tufts and drifting particles scaled within the tier by the level (`frame().levelIndex`, at most 2×):

| Budget | Low | Balanced | High | Ultra |
|---|---|---|---|---|
| Shadows / AO / bloom / grade / antialias | off / off / off / off / MSAA | 1024 / off / on / on / FXAA | 2048 / on / on / on / SMAA | 4096 / high / on / on / MSAA |
| Reflections, particles, detail | off, low, plain | on, high, detailed | on, high, detailed | on, high, detailed |
| Materials (cells, pieces, crowns, garden) | Lambert | Standard | Physical (clearcoat) | Physical |
| Piece / crown lathe segments | 16 / 12 | 24 / 16 | 40 / 28 | 64 / 40 |
| Grass tufts (detail) | 0 | 160 | 420 | 700 |
| Ambient petals/snow/embers (snow ×1.86) | 40 | 80 | 140 | 220 |
| Bloom / GTAO resolution | ½ / ½ | ½ / ½ | ½ / ½ | full / full |
| Frosted backdrop blur behind HUD rails and setup panels | off | off | on | on |

**Visual assets the design calls for.** A cover image for the platform catalogue (`coverart.png`, 1200×675), a title emblem (`assets/title-emblem.webp`, 512², shown above the title in a gold-ringed circle), and two results illustrations (`assets/results-victory.webp`, `assets/results-defeat.webp`, 896×384) chosen by outcome — a truce shows none. All three images are decorative (`alt=""`) and remove themselves on load error. No 3D model is called for: pieces and cells are instanced per house colour from procedural geometry, which a single GLB could not replace without breaking instancing and the cosmetic material tints.

## 8. Audio direction

**Mix.** The runtime's Options › Audio owns the volumes, mute and voice limit (the browser build's four bus sliders and its sound panel). Cues play on the engine mixer at the browser build's default bus levels: event cues on `effects` (0.9), interface cues on `interface`, the win / lose / draw fanfares and the pad on `music` (0.7), the ambience bed on `music` at 0.6 × 0.35. M silences the game's own sound (saved). Clips (`sfx/<name>.opus`) load once the mixer runs (natively at once, in a browser after the first press), a couple at a time; a cue before its clip is loaded is silent (the browser build's synthesized stand-ins are not ported: every cue has a visible twin).

**Music.** A generative pad: four chords over the theme's root and tempo, two detuned sines per note, 8-second swells, each chord rendered once into a clip and played every 6 / (tempo × 10) s. **Ambience.** The authored `amb-<theme>.opus` bed loops while that theme shows (the browser build's synthesized wind, birds and fountain under it are not ported).

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

Nine locales ship: **en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT**, for every player-facing string — menus, setups, the journey map (chapters, 48 stage names and blurbs), lessons, challenges, achievements, themes and cosmetics, the HUD, move log and announcements, dialogs, toasts, the semantic board's square names and the StarHermit strings. "Crown Draughts" stays untranslated.

- **Strings.** Code calls `T('US-English text', { vars })` (`js/i18n/index.js`); `locales/*.js` map that text to each language (en-GB lists only the spelling changes, es-ES and fr-CA only their differences from es-419 and fr-FR). Content tables keep English source text and are translated at display time; the engine's move descriptions and reason texts go through the translator `native/i18n.ts` installs (`setTextTranslator`). The StarHermit strings live in `js/ui/platform-i18n.js`.
- **Resolution.** The game follows the runtime's interface language (`preferences().language`: the player's choice in Options › Language, else the device's), mapped to the nearest shipped locale (`es-MX → es-419`, `en-AU → en-GB`, `pt-PT → pt-BR`). The browser build's own Language selector, `?lang=` override and account lookup are the runtime's now.
- **Live switching.** A change applies on the next frame everywhere (the UI is immediate mode): setup choices, chat, the move log (whose lines re-describe themselves), the coach and open dialogs keep their state.

## 10. Accessibility

- **Keyboard and pad path:** every screen is `starhermit:ui` widgets with the runtime's focus navigation (Tab, arrows, Enter, Escape; D-pad, South, East): title → Play → mode card → setup radio groups (one stop each, arrows choose) → primary button → board via arrows and Enter on the semantic board (shown on the first arrow press) → Pause with P / Escape → results buttons. Dialogs are modal, close on Escape / East (never on the Escape that opened them) and keep focus inside.
- **Screen readers:** the UI's accessibility tree names every widget; the semantic board's squares read their piece and state; announcements (`ui.announce`) carry screen changes, move descriptions ("Ivory piece b3 to d5, capturing Onyx piece at c4"), chain continuation, hints and lesson text (polite) and invalid-move explanations and the results headline (assertive). The browser build's optional spoken announcements (the device's speech voice) are the screen reader's now.
- **Colour and shape:** each house has a shape (disc, ring, diamond, triangle) and crowned pieces a gold crown on the semantic board; the Houses list and the turn banner carry the house colour. Palettes for deuteranopia, protanopia and tritanopia re-tint accent / ok / warn tokens and the legal-target squares. High contrast, text size, interface size and reduced motion are the runtime's settings (Options › Accessibility) and apply to every screen; reduced motion also holds the camera and garden still (§7).
- **Timing and hands:** timing assistance gives the human 1.5× clock in solo clocked rounds; left-handed mode mirrors the tray and rails; haptics can be turned off.
- **Targets:** buttons at least 44 logical px tall, tabs 40 px, board squares sized from min(92 % of the width, 46 % of the height) (62 % / 30 % on upright phones).

## 11. StarHermit integration

The game is a StarHermit engine script game; all platform I/O goes through the runtime's modules (`starhermit:platform`, `starhermit:storage`), which hold the player's credentials (no token ever reaches the game).

- **Packaging:** `starhermit.txt` (§ header) with one `control.<action>` and `engine.gamepad.<action>` line per action (§5). `npm run package` (`starhermit package --web .`) writes the loader `index.html` and `starhermit-files.json`; `.starhermitignore` leaves out `tests/`, `tools/`, `spec.md`, `knownissues.md`, `coverart.png`, `leaderboards.json` (`server.js` ships: the platform provisions it from the package).
- **Player and sign-in:** `player()` is the signed-in player or a guest. Signed in, the account's display name replaces the local profile name (shown as "Playing as …" on the title). Guests see "Sign in with StarHermit", which opens the runtime's Account dialog (`requestSignIn`). When the session ends (`onSessionEnded`) the game says so (signed out: a toast; expired, revoked or terms pending: a dialog with "Keep playing here" and "Sign in") and plays on as a guest.
- **Time:** the Daily Court and its countdown use the platform's clock (`serverNow()`), else the device's.
- **Progress (cloud save):** the progress document is the game's save (`saves`), kept on the device and, signed in, in the account's slot; two devices' saves are merged on a conflict (`saves.onConflict` → `mergeProgress`: completions OR-ed with the better stars, best plies and score; lessons, achievements and mastery united; counters at their maximum; the later daily's streak). The browser build's cloud save (the JS SDK slot `game:<slug>`, a versioned FNV-checksummed document) shows as a foreign save: it is read (`fromBrowserCloudSave`), merged into this device's progress and replaces the slot once (`replaceForeign`). Guests' old browser localStorage progress cannot migrate.
- **Options and profile:** the game's own options (theme, cosmetics, camera, colour palette, left-handed, always-show board, timing assistance, haptics, telemetry consent, M-key mute) and the profile (name, avatar colour, ratings) are `settings` keys, synced with the account. The browser build's per-player settings keys (audio, graphics, accessibility, camera, theme, cosmetics, gamepad) are migrated where the game still has the option (`migrateLegacySetting`) and removed. The round in progress (Resume) stays on the device (`storage`).
- **Invite link:** signed in, the title shows "Invite a friend", which copies `inviteLink()` (the clipboard capability) and confirms with a toast, or shows the link.
- **Hosted tables (realtime rooms, refereed by `server.js`):** `native/platform.ts` `roomsAdapter` gives `js/core/hosted.js` the platform surface. Lobby: the host `rooms.create`s (one team, a seat per house, metadata with the ruleset and optional turn deadline, no AI backfill) and `rooms.open`s when listed; the table room lists friends (`friends.list`, online first, display names) with an Invite button each (`rooms.invite`). Guests `rooms.quickJoin` or accept an incoming invite (`rooms.invites`, `rooms.acceptInvite`). The room's socket (`rooms.connect`) carries only the roster (seats, status, `gameSessionId`). The room starts when every seat is taken or when the host presses Start (`rooms.start`); the platform then binds a session to it, and `server.js` referees the round: every client opens that session's game socket (`connectGame`), sends `{ type: 'act', action }` / `{ type: 'chat', text }` / `{ type: 'sync' }` commands, and replays the `{ type: 'table' }` broadcasts (the seats and the move log) through the same rules, animating the new entries. The script seats the roster in order, checks every command against the rules for the seat of the sender the platform names (payload seats and players are ignored, clients cannot send timeouts or results), plays empty seats (a one-ply greedy house, one move per tick, 600 ms after its turn begins), answers a draw offer when every other house is the AI, times out the player to move after the optional deadline (90 s from the setup, clamped to 30 s–10 min), forfeits a player who leaves the room (and abandons the round when everyone does), and ends it with `result` (stored on the room, which then closes): `{ kind: win | draw | abandoned, winner, winnerUserId, reason, ruleset, plies, elapsedMs, ranked, seats }`. With at least two humans seated the round is ranked: the winner's running total goes to the `hosted-wins` board (`scores`), and a two-human two-house table moves both Elo ratings (`eloUpdates`, kept in `playerStates`). A room that starts without its session (the script failed) is unavailable; a round never runs on a client.
- **Leaderboard:** signed in, every finished solo round against the AI (Journey, Daily, Practice, Challenge — not lessons, Pass & Play or hosted tables) posts the breakdown total through `server.js` (a practice session whose game socket carries `{ type: 'result', scores: { 'high-score': n } }`; the script range-checks it and posts it to the `high-score` board: integer, higher is better, 0–20,000 — `hosted-wins` cannot be posted), and the results show "Leaderboard rank: #N" (or posted / not posted).
- **Runtime features:** sound, graphics, language, controls, text size, high contrast, reduced motion, bug reports and the account are the runtime's Options (F1); Settings links to them ("StarHermit Options").
- **Not used:** platform achievements (achievements, solo ratings and mastery are progress), voice rooms, matchmaking queues, session invites. The anonymous-stats consent is kept, but nothing is transmitted (there is no telemetry endpoint).

## 12. Technical architecture

- **Command pipeline.** UI → `GameController` → `Session.submit(action, seat)` → seat/turn binding → `validateAction` → `apply` (immutable clone) → hash → events `action`, `state`, `snapshot-request`, then `over` or AI drive. Nothing mutates `state` outside `apply`; the renderer and the semantic board read snapshots.
- **Determinism and replay.** `Session.replayEnvelope()` = schema, engine and content versions, ruleset, seed, setup, players, initial hash, ordered commands, per-command hashes, result; `verifyReplay` re-applies and compares every hash. Round clocks and play time run on the game clock (`setSessionClock(() => frame().time * 1000)`), which pauses while suspended and advances one fixed step a frame in checks; the AI's search deadline stays on the monotonic clock.
- **Frame.** `onUpdate`: the look for the frame's graphics level (`applyLook`, cheap when unchanged), the audio poll, countdown and toasts, the camera aspect, rig, tweens, garden and bursts. `onRender`: every screen and dialog (`drawScreens`), then the queued pointer presses. Actions that end a round from inside the UI (the lesson's last Continue) run after the frame's UI (`queueMicrotask`).
- **Budgets (as built).** Cells: 2 instanced draws; pieces: 1 body + 1 crown instanced draw per house colour; particles ≤2000 (high) / 300 (low); ambient drift per tier; one shadowed directional light.

## 13. Testing and acceptance criteria

`npm test` runs the `node --test` suites, then `tests/native.mjs`:
- **engine** — initial counts, opening move count, mandatory capture, maximal chains and `incomplete-chain`, crowning ends a chain, crowns and men capture backward, elimination, immobilization, move-limit and repetition draws, draw offers, timeouts, invalid reasons, melee geometry and elimination, serialize round-trip, v0 migration, in-place undo hash restore, replay determinism.
- **ai** — legal at every level, deterministic per seed, takes a mate-in-one, Adept beats random, Master never loses to Novice, hints legal, grand court legality, hash unchanged after timeout.
- **content** — 48 stages / 8 lessons / 10 challenges / 5 themes, unique ids and seeds, baked layouts legal and identical to live regeneration, puzzle proofs unique, daily determinism, lesson solvability, achievement idempotence, cosmetic monotonicity, unlock chain, star rules.
- **session** — golden human-vs-AI game verifies its replay, snapshot/restore, assists, AI continues after undo, AI answers draw offers, undo refusal, clock timeout, move-limit failure, duplicate command ids, invalid counting.
- **server** — `server.js` run as the platform runs it (`tests/fake-platform.mjs`: a fresh context per invocation, JSON in and out): the RULES block is current and the boards match `leaderboards.json`; a whole two-human duel refereed to its recorded result (the clients' replayed log equals the script's game; ratings, `hosted-wins`, player docs); illegal, out-of-turn, opponent-piece, malformed, forged-seat, client timeout, forged result and unseated commands rejected with the state unchanged, a forged `player` resigning only the sender; chat attribution and caps; sync to the sender only; a lone human against three AI houses (unranked); the AI's delay and draw answers; leavers forfeit, everyone leaving abandons; the turn deadline; ruleset fallback and roster seating; practice-session score posting range-checked.
- **jint** — `server.js` in the platform's own script worker (Platform.ScriptRunner, Jint, strict) under the default budgets (250 ms, 32 MB, 5M statements): a two-human duel and a grand court against the AI seat played to their results, every invocation under 200 ms (skipped where the worker is not built).
- **storage** — the browser build's cloud save read back as progress (damaged, newer and foreign documents refused), legacy settings keys mapped, settings defaults, two devices' progress merged.
- **hosted** — `js/core/hosted.js` over the fake platform with `server.js` as the referee: host creates and opens, a guest quick-joins, the full room starts by itself and both play a whole duel over the game socket to the script's recorded result; out-of-turn, forged-seat and forged-result commands refused; an underfilled melee started by the host with the script playing three AI houses; a guest leaving forfeits; a room without its session is unavailable.
- **i18n** — every key used in code (`T`/`N`/`tr` calls in `js/` and `native/`) and every content display field exists in all nine locales with the same placeholders; no stale keys; seat-name mapping.
- **native** (`tests/native.mjs`) — the committed web index matches the files; `tsc` (TypeScript 5.9, no `skipLibCheck`); `starhermit check .` with no warnings; each `tests/native/*.play` as a signed-out `--render-check` run driving the real UI: `passplay.play` (a whole Pass & Play duel on the semantic board, generated from the rules by `tools/gen-play.mjs`: 43 plies, Ivory wins, to the results and back to the title), `lesson.play` (the first lesson's reading and move steps, to "Lesson complete"), `practice.play` (Practice against the Novice set up by keys, a cursor move, resignation from the Actions drawer, to Defeat).

**Browser checks** (Chrome on the machine's GPU through `~/games/tools/gpu-chrome.mjs`): `node ~/games/tools/engine-web-smoke.mjs .` loads the packaged loader at 1366×768 and 390×844 with no console errors or warnings; `npm run test:browser` (`tools/browser-play.mjs`) plays it at 1366×768, 390×844 and 844×390: Practice opened by keys, the semantic board shown, a piece moved with the arrows and Enter, the AI's reply, the Actions drawer by a tap, the pause card — no console errors or warnings.

QA bar (checkable): every mode reachable from the visible UI on desktop and phone; no console errors across a full playthrough; text and controls never clipped at 1366×768, 390×844 portrait and 844×390 landscape; every audio event has a visible twin; `npm run check` clean.

## 14. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `coverart.png` (1200×675) | platform catalogue cover: stone board, crowned ivory piece, fountain garden | FLUX.2 klein, seed 20260908, 1200×672, palette-PNG | generated in this pass (replaced the geometric placeholder) |
| `assets/title-emblem.webp` (512²) | crowned stone piece emblem above the title | FLUX.2 klein, seed 4102 | generated in this pass, shown on the title |
| `assets/results-victory.webp` (896×384) | results illustration for wins | FLUX.2 klein, seed 7301 | generated in this pass, shown on the results |
| `assets/results-defeat.webp` (896×384) | results illustration for losses and missed goals | FLUX.2 klein, seed 7302 | generated in this pass, shown on the results |
| `icon.png` (256²), `cover.jpg` | platform icon and catalogue cover | authored | shipped |
| `assets/tex/*.png` | baked grey factor maps of the procedural stone, grass and hedge | `tools/bake-textures.mjs` | generated |
| `sfx/*.opus` — 36 clips listed in §8 | UI, board and results events | MOSS-SoundEffect v2.0 | shipped, all bound (`clockWarn`, `scrollTick` newly wired) |
| `sfx/chain-step.opus`, `piece-set-down.opus`, `draw-offer.opus`, `house-fall.opus`, `camera-move.opus`, `mastery-unlock.opus` | new board and results events | MOSS-SoundEffect v2.0, 100 steps | generated in this pass, wired with synth fallbacks |
| `sfx/amb-{royal-garden,dusk-conservatory,ember-court,frost-arbor,tide-terrace}.opus` (12 s) | per-theme ambience beds | MOSS-SoundEffect v2.0, 100 steps | generated in this pass, looped by `_startAmbienceLoop` |
| `sfx/manifest.txt` / `manifest.json` / `manifest.md` | canonical binding / generator input / generator output | authored | shipped |
| 3D models, character animation | — | — | not called for: procedural instanced geometry, no humanoids |

## 15. Known limitations

- **Hosted tables** cannot be played against the live platform here (the script runs in the platform's own sandbox and against a fake platform in tests); report-a-player has no rooms equivalent; a table does not survive a reload; a draw offer between humans has no answer in the UI (it lapses with the next move); the script's AI seats are weaker than the client's Apprentice (the platform's per-invocation budgets do not fit the alpha-beta search).
- **Signed-in paths** (foreign save migration, legacy settings, score posting, rooms) are covered by unit tests, not live runs.
- **Textures** are one baked map per material kind: the browser build's per-seed grain variation and its 128 / 512 px sizes per preset are gone (256 px everywhere).
- **Move-limit failure reads as a truce.** `Session._forceEnd(null, 'move-limit-failed')` has no `TERMINAL_REASON_TEXT` entry, so results show "A Truce" with the draw sound; progress correctly records no completion.
- **Achievement name mismatch:** "Seven Sunrises" unlocks at five daily wins.
- **Men capture backward** by design (international-style capture); Help does not say so explicitly.
- **Draws are silent illustrations** on results (no truce image), and the emblem/banner images are decorative only.
- **Guests' browser progress** (the old build's localStorage) cannot migrate; signed-in players' cloud saves do.

## Design intent not yet implemented

- Platform achievement submission; voice rooms.
- A truce illustration on results; `TERMINAL_REASON_TEXT['move-limit-failed']` with `levelFail`.
- A dedicated authored intensity stem for endgames.
