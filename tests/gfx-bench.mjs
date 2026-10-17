// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts a Practice game against the AI and keeps playing legal moves by clicking the pieces and
// their destinations on the 3D board (piece hops, capture/crown particles, garden motion, post chain).
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

const clickButton = (page, text) => page.getByRole('button', { name: text, exact: true }).first().click({ timeout: 5000 });

export async function setPreset(page, preset) {
  await page.waitForFunction(() => document.body.dataset.screen === 'title', null, { timeout: 20000 });
  // first-boot consent dialog
  const no = page.getByRole('button', { name: 'No thanks', exact: true });
  if (await no.count()) await no.first().click().catch(() => {});
  await clickButton(page, 'Settings');
  await page.click('#settings-tab-graphics');
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.modal'));
}

async function move(page) {
  // Where the human's next legal move is on screen (piece, then destination), from the canvas projection.
  const pts = await page.evaluate(() => {
    const app = globalThis.__crownDraughts;
    if (document.body.dataset.screen !== 'game') return { screen: document.body.dataset.screen };
    const acts = app.session.legalTargets();
    if (!acts.length) return { wait: true };
    const a = acts[Math.floor(Math.random() * acts.length)];
    const p = app.session.state.pieces[a.piece];
    const from = app.renderer.projectCell(p.r, p.c), to = app.renderer.projectCell(a.path[0][0], a.path[0][1]);
    return from && to ? { from, to } : { wait: true };
  });
  if (pts.screen === 'results') { await clickButton(page, 'Play again').catch(() => page.keyboard.press('Escape')); return; }
  if (!pts.from) return;
  await page.mouse.click(pts.from.x, pts.from.y);
  await page.waitForTimeout(120);
  await page.mouse.click(pts.to.x, pts.to.y);
}

export async function start(page) {
  await clickButton(page, 'Play');
  await page.waitForFunction(() => document.body.dataset.screen === 'modes');
  await page.locator('.mode-card', { hasText: 'Practice' }).first().click();
  await page.waitForFunction(() => document.body.dataset.screen === 'practice');
  await clickButton(page, 'Take your seat');
  await page.waitForFunction(() => document.body.dataset.screen === 'game', null, { timeout: 15000 });
  let open = true;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try { await move(page); } catch { if (!open) return; }
      await new Promise((r) => setTimeout(r, 400));
    }
  })();
  await page.waitForTimeout(500);
}
