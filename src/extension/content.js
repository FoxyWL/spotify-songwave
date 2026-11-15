// Content script на open.spotify.com: поднимает интерфейс и связывает его с приложением.
// Звук играет сам Spotify Web Player; мы управляем им через Connect, второго плеера нет.
import { createApp } from './app.js';
import { chromeBridge, chromeBackend } from './bridge.js';
import { mountUi } from './ui/mount.js';

if (!window.__songwave) {
  window.__songwave = true;
  boot();
}

async function boot() {
  const storage = await chromeBackend();
  const app = createApp({ bridge: chromeBridge, storage });
  const { ui } = mountUi({ app });
  let started = false;
  let lockHeld = false;

  /** Волна живёт в одной вкладке: профиль и очередь Spotify общие, две копии начали бы спорить. */
  async function startOnce() {
    if (started) return;
    started = true;
    if (navigator.locks) {
      await new Promise((resolve) => {
        navigator.locks.request('songwave-host', { ifAvailable: true }, (lock) => {
          if (!lock) { resolve(false); return undefined; }
          lockHeld = true; resolve(true);
          return new Promise(() => {}); // держим замок, пока открыта вкладка
        });
      });
      if (!lockHeld) { app.setFatal('Волна уже запущена в другой вкладке Spotify. Закрой её или переключись туда.'); started = false; return; }
    }
    app.actions.init();
  }
  ui.opened = startOnce;

  chrome.runtime.onMessage.addListener((m) => {
    if (m?.t === 'toggle-overlay') ui.setOpen(m.open === true ? true : !ui.open);
  });
  if (location.hash === '#songwave') ui.setOpen(true);
}
