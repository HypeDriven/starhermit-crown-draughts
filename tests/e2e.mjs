// Browser smoke test (not part of node --test; run directly):
//   node tests/e2e.mjs
// Serves the game, drives a real headless Chrome through the core flows, and
// captures fixed-view screenshots for visual validation.
import { startDevServer } from '../server.js';
import puppeteer from '/tmp/cd-e2e/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const SHOTS = '/tmp/cd-shots';
import { mkdirSync } from 'node:fs';
mkdirSync(SHOTS, { recursive: true });

const server = await startDevServer({ port: 0, dataFile: '/tmp/cd-e2e-data.json', quiet: true });
const base = `http://localhost:${server.port}`;

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800'],
  defaultViewport: { width: 1280, height: 800 },
});

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(base, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForFunction(() => document.body.dataset.screen === 'title', { timeout: 15000 });
check('boots to title screen', true);
// dismiss the first-boot consent dialog for clean captures
await page.evaluate(() => [...document.querySelectorAll('.modal button, .consent-banner button')].find((b) => b.textContent === 'No thanks')?.click());
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: `${SHOTS}/01-title.png` });

const webglOk = await page.evaluate(() => !!document.querySelector('.scene-canvas'));
check('WebGL canvas mounted', webglOk);

// title -> modes
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Play')?.click());
await page.waitForFunction(() => document.body.dataset.screen === 'modes');
check('mode select opens', true);

// practice setup -> game
await page.evaluate(() => [...document.querySelectorAll('.mode-card')].find((c) => c.textContent.includes('Practice'))?.click());
await page.waitForFunction(() => document.body.dataset.screen === 'practice');
await page.screenshot({ path: `${SHOTS}/02-practice-setup.png` });
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Take your seat')?.click());
await page.waitForFunction(() => document.body.dataset.screen === 'game', { timeout: 10000 });
check('practice round starts', true);
await new Promise((r) => setTimeout(r, 1600));
await page.screenshot({ path: `${SHOTS}/03-game.png` });

// pin the DOM board and play a move through it
await page.keyboard.press('KeyB');
await page.waitForFunction(() => document.querySelector('#dom-board-container')?.classList.contains('pinned'));
const moved = await page.evaluate(() => {
  const app = globalThis.__crownDraughts;
  const st = app.session.state;
  const acts = app.session.legalTargets();
  if (!acts.length) return { ok: false, why: 'no legal actions' };
  const a = acts[0];
  const piece = st.pieces[a.piece];
  const gc = app.game;
  gc.onCell(piece.r, piece.c);           // select
  gc.onCell(a.path[0][0], a.path[0][1]); // destination
  return { ok: true, ply: app.session.state.ply };
});
check('DOM-board move applies (ply=1)', moved.ok && moved.ply === 1, JSON.stringify(moved));

// AI replies within a few seconds
const aiReplied = await page.waitForFunction(() => globalThis.__crownDraughts.session.state.ply >= 2, { timeout: 15000 }).then(() => true).catch(() => false);
check('AI replies', aiReplied);
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${SHOTS}/04-after-ai.png` });

// keyboard cursor + invalid action explanation
await page.keyboard.press('ArrowUp');
const hudOk = await page.evaluate(() => {
  const banner = document.getElementById('turn-banner');
  return banner && banner.textContent.length > 3;
});
check('HUD turn banner updates', hudOk);

// undo (practice allows it)
const undone = await page.evaluate(() => {
  const app = globalThis.__crownDraughts;
  const before = app.session.state.ply;
  app.game.requestUndo();
  return { before, after: app.session.state.ply };
});
check('undo works in practice', undone.after < undone.before, JSON.stringify(undone));

// pause overlay
await page.keyboard.press('KeyP');
const paused = await page.waitForFunction(() => !!document.querySelector('.modal'), { timeout: 5000 }).then(() => true).catch(() => false);
check('pause overlay opens', paused);
await page.screenshot({ path: `${SHOTS}/05-pause.png` });
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 300));

// resign -> results screen with breakdown
await page.evaluate(() => {
  const app = globalThis.__crownDraughts;
  app.session.submit({ type: 'resign', player: 0 }, 0);
});
await page.waitForFunction(() => document.body.dataset.screen === 'results', { timeout: 8000 });
check('results screen shows', true);
const breakdownOk = await page.evaluate(() => !!document.querySelector('.breakdown .total'));
check('score breakdown present', breakdownOk);
await page.screenshot({ path: `${SHOTS}/06-results.png` });

// journey map renders 48 stages
await page.evaluate(() => globalThis.__crownDraughts.exitToTitle('journey'));
await page.waitForFunction(() => document.body.dataset.screen === 'journey');
const stageCount = await page.evaluate(() => document.querySelectorAll('.stage-cell').length);
check('journey map lists 48 stages', stageCount === 48, String(stageCount));
await page.screenshot({ path: `${SHOTS}/07-journey.png` });

// learn flow: first lesson first actionable step
await page.evaluate(() => globalThis.__crownDraughts.startLesson('first-steps'));
await page.waitForFunction(() => document.body.dataset.screen === 'game');
const lessonOk = await page.evaluate(() => {
  const app = globalThis.__crownDraughts;
  const coach = document.getElementById('lesson-coach');
  return coach && !coach.hidden && coach.textContent.includes('First Steps');
});
check('lesson coach shows', lessonOk);

// complete the first lesson's action step through the real input path
const lessonDone = await page.evaluate(async () => {
  const app = globalThis.__crownDraughts;
  const st = app.session.state;
  const a = app.session.legalTargets()[0];
  const p = st.pieces[a.piece];
  app.game.onCell(p.r, p.c);
  app.game.onCell(a.path[0][0], a.path[0][1]);
  await new Promise((r) => setTimeout(r, 300));
  return document.getElementById('lesson-coach')?.textContent.includes('Well played');
});
check('lesson step completes and celebrates', lessonDone);

// help + settings modals
await page.evaluate(() => globalThis.__crownDraughts.openHelp());
const helpOk = await page.evaluate(() => document.querySelector('.modal')?.textContent.includes('Capturing'));
check('help overlay renders rule cards', !!helpOk);
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => globalThis.__crownDraughts.openSettings());
const settingsOk = await page.evaluate(() => document.querySelectorAll('.settings-tabs .tab').length >= 5);
check('settings overlay renders tabs', settingsOk);
await page.screenshot({ path: `${SHOTS}/08-settings.png` });

// daily + journey stage + challenge flows
await page.evaluate(() => globalThis.__crownDraughts.startDaily());
await page.waitForFunction(() => document.body.dataset.screen === 'game');
const dailyOk = await page.evaluate(() => {
  const c = globalThis.__crownDraughts.session.config;
  return c.mode === 'daily' && c.ranked === true;
});
check('daily starts ranked', dailyOk);
await page.evaluate(() => { globalThis.__crownDraughts.session.submit({ type: 'resign', player: 0 }, 0); });
await page.waitForFunction(() => document.body.dataset.screen === 'results', { timeout: 8000 });
const ratingOk = await page.evaluate(() => globalThis.__crownDraughts.profile.rating.duel !== 1000);
check('daily result changes rating', ratingOk);

// journey stage 1 starts with its authored content id
await page.evaluate(async () => {
  const mod = await import('/js/content/index.js');
  globalThis.__crownDraughts.startJourneyStage(mod.JOURNEY_STAGES[0]);
});
await page.waitForFunction(() => document.body.dataset.screen === 'game');
const journeyOk = await page.evaluate(() => globalThis.__crownDraughts.session.config.contentId === 'ch1-s1');
check('journey stage starts', journeyOk);

// melee pass & play on the 10x10 court
await page.evaluate(() => {
  const app = globalThis.__crownDraughts;
  app.startLocal({ ruleset: 'melee', names: ['A', 'B', 'C', 'D'], count: 4 });
});
await new Promise((r) => setTimeout(r, 1500));
const meleeOk = await page.evaluate(() => {
  const st = globalThis.__crownDraughts.session.state;
  return st.players.length === 4 && st.pieces.length === 24 && st.size === 10;
});
check('melee starts with 4 houses / 24 pieces', meleeOk);
await page.screenshot({ path: `${SHOTS}/11-melee.png` });

// alternate theme capture (frost)
await page.evaluate(() => {
  const app = globalThis.__crownDraughts;
  app.settings.theme = 'frost-arbor';
  app.applyTheme();
});
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: `${SHOTS}/12-frost.png` });
await page.evaluate(() => {
  const app = globalThis.__crownDraughts;
  app.settings.theme = 'royal-garden';
  app.applyTheme();
});

// NOTE: switching to mobile emulation reloads the page in headless Chrome —
// so the mobile block runs last and re-navigates from a fresh boot.

// canvas picking: clicking the board selects a piece and shows ghosts
await page.evaluate(() => {
  const app = globalThis.__crownDraughts;
  app.startPractice({ ruleset: 'duel', level: 'novice', side: 0 });
});
await page.waitForFunction(() => document.body.dataset.screen === 'game');
await new Promise((r) => setTimeout(r, 1800)); // countdown + camera settle
const picked = await page.evaluate(() => {
  const app = globalThis.__crownDraughts;
  const st = app.session.state;
  const a = app.session.legalTargets()[0];
  const p = st.pieces[a.piece];
  const pt = app.renderer.projectCell(p.r, p.c);
  return { x: pt.x, y: pt.y, r: p.r, c: p.c };
});
await page.mouse.click(picked.x, picked.y);
await new Promise((r) => setTimeout(r, 250));
const selOk = await page.evaluate(() => globalThis.__crownDraughts.game.selected != null);
check('canvas click selects a piece', selOk);

// hosted flow: two browser contexts through the dev server
const page2 = await browser.newPage();
await page2.goto(base, { waitUntil: 'networkidle2' });
await page2.waitForFunction(() => document.body.dataset.screen === 'title', { timeout: 15000 });
const hostInfo = await page.evaluate(async () => {
  const app = globalThis.__crownDraughts;
  await app.hostTable({ ruleset: 'duel', listed: false, clock: false });
  return { code: app.hostedClient?.joinCode, id: app.hostedClient?.sessionId };
});
check('host table created with join code', !!hostInfo.code, JSON.stringify(hostInfo));
await page2.evaluate(async (code) => {
  const app = globalThis.__crownDraughts;
  await app.joinByCode(code);
}, hostInfo.code);
await new Promise((r) => setTimeout(r, 600));
const roster2 = await page2.evaluate(() => globalThis.__crownDraughts.hostedClient?.players?.length);
check('guest sees both players in roster', roster2 === 2, String(roster2));
await page.evaluate(() => globalThis.__crownDraughts.hostedClient.startGame());
await page.waitForFunction(() => document.body.dataset.screen === 'game', { timeout: 8000 });
await page2.waitForFunction(() => document.body.dataset.screen === 'game', { timeout: 8000 });
check('both clients enter the hosted game', true);
// host (seat 0) moves; guest should see the ply advance
const hostMoved = await page.evaluate(() => {
  const app = globalThis.__crownDraughts;
  const a = app.session.legalTargets()[0];
  return app.session.submit(a).then((r) => r.ok);
});
await page2.waitForFunction(() => globalThis.__crownDraughts.session?.state?.ply >= 1, { timeout: 8000 }).catch(() => {});
const guestSaw = await page2.evaluate(() => globalThis.__crownDraughts.session?.state?.ply);
check('guest received the move via events', hostMoved && guestSaw === 1, `ply=${guestSaw}`);
// guest chat reaches host
await page2.evaluate(() => globalThis.__crownDraughts.hostedClient.sendChat('gl hf'));
await page.waitForFunction(() => document.querySelector('#chat-log')?.textContent.includes('gl hf'), { timeout: 8000 }).catch(() => {});
const chatOk = await page.evaluate(() => document.querySelector('#chat-log')?.textContent.includes('gl hf'));
check('hosted chat delivered', !!chatOk);
await page.screenshot({ path: `${SHOTS}/13-hosted.png` });
await page2.close();

await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.waitForFunction(() => ['title', 'boot'].includes(document.body.dataset.screen), { timeout: 15000 });
await page.waitForFunction(() => document.body.dataset.screen === 'title', { timeout: 15000 });
await page.evaluate(() => [...document.querySelectorAll('.modal button, .consent-banner button')].find((b) => b.textContent === 'No thanks')?.click());
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${SHOTS}/09-mobile-portrait.png` });
const trayVisible = await page.evaluate(() => {
  const tray = document.getElementById('tray-bottom');
  return tray && getComputedStyle(tray).display !== 'none';
});
check('portrait tray visible', !!trayVisible);

// portrait: start a fresh round and confirm the board fits the frame
await page.evaluate(() => {
  const app = globalThis.__crownDraughts;
  app.startPractice({ ruleset: 'duel', level: 'novice', side: 0 });
});
await page.waitForFunction(() => document.body.dataset.screen === 'game');
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${SHOTS}/10-portrait-game.png` });

check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));

await browser.close();
await server.close();
console.log(failures ? `\n${failures} e2e failure(s)` : '\ne2e all green');
process.exit(failures ? 1 : 0);
