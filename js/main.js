// Bootstrap: host handshake, capability detection, lifecycle, first paint.

import { App } from './ui/app.js';

async function main() {
  const app = new App();
  globalThis.__crownDraughts = app; // console debugging / host shell hook
  try {
    await app.boot();
  } catch (e) {
    console.error('boot failed', e);
    const boot = document.querySelector('[data-screen="boot"]');
    if (boot) {
      boot.hidden = false;
      boot.innerHTML = `<div class="boot-error"><h1>Crown Draughts</h1><p>Something went wrong while loading. Please reload — your progress is stored locally.</p><p class="mono">${String(e?.message || e)}</p></div>`;
    }
    app.platform.track('error', { category: 'boot' });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
