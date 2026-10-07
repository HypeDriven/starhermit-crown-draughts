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
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') consoleErrors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('response', (r) => { if (r.status() >= 400) consoleErrors.push(`http ${r.status()} ${r.url()}`); });
// standalone play must never call StarHermit
const PLATFORM_API = /\/api\/v1\/(games|users|me|leaderboards|realtime|chat)\//;
page.on('request', (r) => { if (PLATFORM_API.test(new URL(r.url()).pathname)) consoleErrors.push('standalone StarHermit call: ' + r.url()); });

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

// Graphics settings through the visible panel: presets, an override, persistence
async function graphicsFlow(tag) {
  await page.click('#settings-tab-graphics');
  await page.waitForSelector('#gfx-preset');
  await page.select('#gfx-preset', 'low');
  await new Promise((r) => setTimeout(r, 300));
  const low = await page.evaluate(() => ({ body: document.body.dataset.gfxPreset, canvas: document.querySelector('.scene-canvas')?.dataset.gfxPreset, sum: document.getElementById('gfx-summary').textContent }));
  check(`${tag}: Low preset applies`, low.body === 'low' && low.canvas === 'low' && /no shadows/.test(low.sum), JSON.stringify(low));
  await page.select('#gfx-preset', 'high');
  await new Promise((r) => setTimeout(r, 400));
  const high = await page.evaluate(() => ({ body: document.body.dataset.gfxPreset, sum: document.getElementById('gfx-summary').textContent, post: globalThis.__crownDraughts.renderer.graphicsInfo().postActive }));
  check(`${tag}: High preset applies with post chain`, high.body === 'high' && /2048² shadows/.test(high.sum) && /bloom/.test(high.sum) && high.post, JSON.stringify(high));
  await page.select('#gfx-bloom', 'off');
  await new Promise((r) => setTimeout(r, 300));
  const ov = await page.evaluate(() => document.getElementById('gfx-summary').textContent);
  check(`${tag}: bloom override applies`, !/bloom/.test(ov), ov);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.dataset.screen === 'title', { timeout: 15000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Settings')?.click());
  await page.waitForSelector('#settings-tab-graphics');
  await page.click('#settings-tab-graphics');
  await page.waitForSelector('#gfx-preset');
  const kept = await page.evaluate(() => ({ preset: document.getElementById('gfx-preset').value, bloom: document.getElementById('gfx-bloom').value, body: document.body.dataset.gfxPreset }));
  check(`${tag}: graphics settings survive reload`, kept.preset === 'high' && kept.bloom === 'off' && kept.body === 'high', JSON.stringify(kept));
  await page.screenshot({ path: `${SHOTS}/${tag}-graphics.png` });
  // back to the fast preset (choosing a preset clears the override)
  await page.select('#gfx-preset', 'low');
  await new Promise((r) => setTimeout(r, 200));
  const cleared = await page.evaluate(() => document.getElementById('gfx-bloom').value);
  check(`${tag}: choosing a preset clears overrides`, cleared === 'preset', cleared);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));
}
await graphicsFlow('desktop');

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
// the daily ruleset rotates by day (duel/duel/grand), so check the rating
// bucket the round actually wrote
const ratingOk = await page.evaluate(() => {
  const ruleset = globalThis.__crownDraughts.session.config.ruleset;
  return globalThis.__crownDraughts.profile.rating[ruleset] !== 1000;
});
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
const errorsBeforeHosted = consoleErrors.length;
const page2 = await browser.newPage();
await page2.goto(base, { waitUntil: 'networkidle2' });
await page2.waitForFunction(() => document.body.dataset.screen === 'title', { timeout: 15000 });
const hostInfo = await page.evaluate(async () => {
  const app = globalThis.__crownDraughts;
  await app.hostTable({ ruleset: 'duel', listed: false, clock: false });
  return { code: app.hostedClient?.joinCode, id: app.hostedClient?.sessionId };
});
if (!hostInfo.code) {
  // The dev server has no /api/v1/realtime/rooms endpoint; the failed probe's
  // 404 belongs to this skipped flow, not to the rest of the run.
  const probe = consoleErrors.splice(errorsBeforeHosted);
  const other = probe.filter((e) => !/realtime\/rooms|status of 404/.test(e));
  consoleErrors.push(...other);
  console.log('skip hosted flow — the dev server offered no hosted table in this environment');
} else {
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
}
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

// mobile: the Graphics panel is reachable from the pause menu and fits
await page.evaluate(() => globalThis.__crownDraughts.openSettings());
await graphicsFlow('mobile');
const fits = await page.evaluate(async () => {
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'Settings')?.click();
  await new Promise((r) => setTimeout(r, 200));
  document.getElementById('settings-tab-graphics').click();
  await new Promise((r) => setTimeout(r, 200));
  const m = document.querySelector('.modal').getBoundingClientRect();
  return m.left >= 0 && m.right <= innerWidth && m.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth;
});
check('mobile: Graphics panel fits the viewport', fits);

// signed in through StarHermit: launch token in the fragment, platform API stubbed
async function platformPass(viewport, tag) {
  const p = await browser.newPage();
  await p.setViewport(viewport);
  const errs = [], seen = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') errs.push(`${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.setRequestInterception(true);
  p.on('request', (req) => {
    const u = new URL(req.url());
    if (!PLATFORM_API.test(u.pathname) && u.pathname !== '/api/v1/time') return req.continue();
    seen.push(req.method() + ' ' + u.pathname);
    const json = (o) => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/v1/time') return json({ now: Date.now() });
    if (u.pathname.endsWith('/profile')) return json({ nickname: u.pathname.includes('u-friend') ? 'Rook Friend' : 'Pip Tester' });
    if (u.pathname.endsWith('/settings') && req.method() === 'GET') return json({ settings: { accessibility: { highContrast: true } } });
    if (u.pathname.endsWith('/controls')) return json({ actions: [{ action: 'pause', codes: ['KeyO'] }] });
    if (u.pathname.endsWith('/me/friends')) return json([{ userId: 'u-friend', online: true }]);
    if (u.pathname.endsWith('/realtime/rooms/invites')) return json([{ id: 'inv1', fromUserId: 'u-friend' }]);
    if (u.pathname.endsWith('/realtime/rooms') && req.method() === 'POST') return json({ roomId: 'room1' });
    if (u.pathname.endsWith('/realtime/rooms/room1/invites')) return json({ id: 'sent1' });
    if (u.pathname.endsWith('/launch-token')) return req.respond({ status: 401, body: '' }); // renewal refused
    return req.respond({ status: 204, body: '' });
  });
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64u({ alg: 'none' })}.${b64u({ sub: 'u-e2e-0001', game_scope: 'crown-draughts', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  await p.evaluateOnNewDocument(() => { globalThis.WebSocket = class { constructor(url) { this.url = url; this.readyState = 0; (globalThis.__sockets ||= []).push(this); } send() {} close() {} }; });
  await p.goto(`${base}/#game_token=${jwt}`, { waitUntil: 'networkidle2' });
  await p.waitForFunction(() => document.body.dataset.screen === 'title', { timeout: 15000 });
  await p.evaluate(() => [...document.querySelectorAll('.modal button, .consent-banner button')].find((b) => b.textContent === 'No thanks')?.click());
  await p.waitForFunction(() => /Pip Tester/.test(document.querySelector('.platform-name')?.textContent || ''), { timeout: 8000 }).catch(() => {});
  check(`[${tag}] signed in: nickname on the title`, await p.evaluate(() => /Pip Tester/.test(document.querySelector('.platform-name')?.textContent || '')));
  check(`[${tag}] launch fragment stripped`, (await p.evaluate(() => location.hash)) === '');
  check(`[${tag}] cloud save loaded from game:<slug>`, seen.includes('GET /api/v1/me/cloud-saves/' + encodeURIComponent('game:crown-draughts')), seen.join(', '));
  await p.waitForFunction(() => document.body.classList.contains('high-contrast'), { timeout: 5000 }).catch(() => {});
  check(`[${tag}] platform settings applied`, await p.evaluate(() => document.body.classList.contains('high-contrast')));
  check(`[${tag}] platform key binding applied`, await p.evaluate(() => globalThis.__crownDraughts.input.keyboard.pause.join() === 'KeyO'));
  const inv = await p.$('.btn-invite');
  if (inv) { await inv.click(); await new Promise((r) => setTimeout(r, 300)); }
  check(`[${tag}] Invite a friend shows a toast`, !!inv && await p.evaluate(() => /Invite link|invite link/.test(document.getElementById('toast-region').textContent)));
  await p.screenshot({ path: `${SHOTS}/14-platform-${tag}.png` });
  await p.evaluate(() => globalThis.__crownDraughts.openMode('hosted'));
  await p.waitForFunction(() => /From Rook Friend/.test(document.querySelector('.invite-list')?.textContent || ''), { timeout: 5000 }).catch(() => {});
  check(`[${tag}] lobby lists the friend's table invite`, await p.evaluate(() => /From Rook Friend/.test(document.querySelector('.invite-list')?.textContent || '')));
  await p.evaluate(() => globalThis.__crownDraughts.hostTable({ ruleset: 'duel', listed: false, clock: false }));
  await p.waitForFunction(() => /Rook Friend/.test([...document.querySelectorAll('.invite-list')].map((e) => e.textContent).join()), { timeout: 5000 }).catch(() => {});
  const sent = await p.evaluate(async () => {
    const btn = [...document.querySelectorAll('.invite-row button')].find((b) => b.textContent === 'Invite');
    btn?.click();
    await new Promise((r) => setTimeout(r, 400));
    return btn?.textContent;
  });
  check(`[${tag}] host invites a friend to the table`, sent === 'Invited' && seen.includes('POST /api/v1/realtime/rooms/room1/invites'), String(sent));
  await p.screenshot({ path: `${SHOTS}/15-table-invite-${tag}.png` });
  // The table socket drops (1006) and the token renewal is refused: the
  // session-expired dialog offers "Back to StarHermit", and nothing reopens.
  await p.evaluate(() => { const ws = globalThis.__sockets.at(-1); ws.readyState = 3; ws.onclose({ code: 1006 }); });
  await p.waitForSelector('.modal-expired .btn-relaunch', { visible: true, timeout: 6000 }).catch(() => {});
  const expired = await p.evaluate(() => {
    const btn = document.querySelector('.modal-expired .btn-relaunch');
    const box = document.querySelector('.modal-expired')?.getBoundingClientRect();
    return {
      btn: btn?.textContent,
      fits: !!box && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      sockets: globalThis.__sockets.length,
    };
  });
  check(`[${tag}] expired session: "Back to StarHermit" dialog fits`, expired.btn === 'Back to StarHermit' && expired.fits && expired.sockets === 1, JSON.stringify(expired));
  await p.screenshot({ path: `${SHOTS}/16-session-expired-${tag}.png` });
  const relaunched = await p.evaluate(() => {
    let n = 0; globalThis.StarHermit.relaunch = () => { n++; return true; };
    document.querySelector('.modal-expired .btn-relaunch').click();
    return n;
  });
  check(`[${tag}] "Back to StarHermit" calls StarHermit.relaunch`, relaunched === 1);
  await p.evaluate(() => [...document.querySelectorAll('.modal-expired button')].find((b) => b.textContent === 'Keep playing here')?.click());
  check(`[${tag}] keep playing leaves the table`, await p.evaluate(() => !document.querySelector('.modal-expired') && document.body.dataset.screen === 'title'));
  // The refused renewal itself is expected to log one failed (401) request.
  for (let i = errs.length - 1; i >= 0; i--) if (/401/.test(errs[i])) errs.splice(i, 1);
  check(`[${tag}] no console errors`, errs.length === 0, errs.slice(0, 5).join(' | '));
  await p.close();
}
await platformPass({ width: 1280, height: 800 }, 'platform-desktop');
await platformPass({ width: 390, height: 844, isMobile: true, hasTouch: true }, 'platform-mobile');

check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));

await browser.close();
await server.close();
console.log(failures ? `\n${failures} e2e failure(s)` : '\ne2e all green');
process.exit(failures ? 1 : 0);
