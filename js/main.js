// Bootstrap: host handshake, capability detection, lifecycle, first paint.

import { App } from './ui/app.js';
import { T } from './i18n/index.js';

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
      boot.replaceChildren();
      const box = document.createElement('div');
      box.className = 'boot-error';
      const h1 = document.createElement('h1'); h1.textContent = 'Crown Draughts';
      const p = document.createElement('p'); p.textContent = T('Something went wrong while loading. Please reload — your progress is stored locally.');
      const detail = document.createElement('p'); detail.className = 'mono'; detail.textContent = String(e?.message || e);
      box.append(h1, p, detail);
      boot.appendChild(box);
    }
    app.platform.track('error', { category: 'boot' });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
