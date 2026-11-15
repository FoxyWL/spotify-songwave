// Прикладной слой расширения: фазы, вход, потеря сессии, баннеры квоты. Сеть — мок Spotify через «мост» service worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSpotify } from '../mock/spotify-mock.js';
import { memoryBackend } from '../../src/core/store.js';
import { createApp, PRESETS, activePreset } from '../../src/extension/app.js';
import { mulberry32 } from '../../src/core/engine/util.js';

function rig({ authed = true, genres = ['indie rock', 'shoegaze', 'dream pop'] } = {}) {
  let t = Date.UTC(2026, 10, 14, 12);
  const now = () => t;
  const mock = new MockSpotify({ seed: 7, now });
  if (genres) mock.setUser({ genres });
  const st = { authed, clientId: authed ? 'a'.repeat(32) : '', redirectUri: 'https://x.chromiumapp.org/', missingScopes: [] };
  const calls = { login: 0 };
  const bridge = {
    status: async () => ({ ...st }),
    login: async (cid) => { calls.login++; if (cid === 'bad') throw Object.assign(new Error('Доступ не разрешён'), { code: 'DENIED' }); st.authed = true; st.clientId = cid; return { ...st }; },
    logout: async () => { st.authed = false; },
    apiFetch: async (url, init) => {
      const u = new URL(url);
      const r = mock.handle({ method: init.method || 'GET', path: u.pathname.replace(/^\/v1/, ''), query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : undefined, token: 'x' });
      return { status: r.status, headers: Object.fromEntries(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v])), text: r.json == null ? '' : JSON.stringify(r.json) };
    },
  };
  const timers = [];
  const app = createApp({ bridge, storage: memoryBackend(), now, rng: mulberry32(3), schedule: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clear: () => {} });
  return { app, mock, bridge, st, calls, timers, tick: (ms) => { t += ms; } };
}

test('без токенов — экран входа; вход переводит в загрузку и готовую волну', async () => {
  const r = rig({ authed: false });
  await r.app.actions.init();
  assert.equal(r.app.state.phase, 'login');
  assert.equal(r.app.state.auth.redirectUri, 'https://x.chromiumapp.org/');
  await r.app.actions.login('c'.repeat(32));
  assert.equal(r.app.state.phase, 'ready');
  assert.ok(r.app.view().player);
});

test('ошибка входа остаётся на экране входа с текстом', async () => {
  const r = rig({ authed: false });
  await r.app.actions.init();
  await r.app.actions.login('bad');
  assert.equal(r.app.state.phase, 'login');
  assert.match(r.app.state.loginError, /Доступ не разрешён/);
  assert.equal(r.app.state.loginBusy, false);
});

test('пустая история Spotify → онбординг; после выбора жанров — готово', async () => {
  const r = rig({ genres: null });
  await r.app.actions.init();
  assert.equal(r.app.state.phase, 'onboarding');
  await r.app.actions.finishOnboarding({ genres: ['jazz', 'bossa nova', 'ambient'] });
  assert.equal(r.app.state.phase, 'ready');
});

test('запуск волны и пресеты: настройки движка меняются, активный пресет определяется по ним', async () => {
  const r = rig();
  await r.app.actions.init();
  await r.app.actions.start();
  await r.app.playback._idle();
  assert.ok(r.mock.p.current, 'трек играет');
  await r.app.actions.applyPreset('discovery');
  assert.equal(r.app.view().preset, 'discovery');
  assert.equal(r.app.view().settings.discovery, 0.8);
  await r.app.actions.applyPreset('energy');
  assert.equal(r.app.view().settings.mood, 'workout');
  assert.equal(r.app.view().preset, 'energy');
  assert.equal(activePreset({ mode: 'wave', discovery: 0.55, mood: null }), null, 'ручные значения — не пресет');
  assert.equal(PRESETS.length, 5);
});

test('401 от Spotify: сессия считается потерянной, показывается вход', async () => {
  const r = rig();
  await r.app.actions.init();
  const orig = r.bridge.apiFetch;
  r.bridge.apiFetch = async () => ({ status: 401, headers: {}, text: JSON.stringify({ error: { status: 401, message: 'The access token expired' } }) });
  await r.app.actions.start();
  assert.equal(r.app.state.phase, 'login');
  assert.match(r.app.state.loginError, /Войди снова/);
  r.bridge.apiFetch = orig;
});

test('нет устройства: баннер с повтором, интерфейс не падает', async () => {
  const r = rig();
  await r.app.actions.init();
  r.mock.devices = [];
  await r.app.actions.start();
  assert.equal(r.app.state.notice?.kind, 'device');
  assert.equal(r.app.state.notice?.retry, 'start');
  r.mock.devices = [{ id: 'webplayer', name: 'Web Player (Chrome)', type: 'Computer' }];
  await r.app.actions.retry();
  await r.app.playback._idle();
  assert.ok(r.mock.p.current);
  assert.equal(r.app.state.notice, null);
});

test('квота Spotify: показывается баннер, действия не бросают исключений', async () => {
  const r = rig();
  await r.app.actions.init();
  await r.app.actions.start();
  r.mock.exhaustQuota(60_000);
  await r.app.actions.shake();
  assert.equal(r.app.state.notice?.kind, 'quota');
  await assert.doesNotReject(r.app.actions.next());
});

test('выход возвращает на экран входа', async () => {
  const r = rig();
  await r.app.actions.init();
  await r.app.actions.logout();
  assert.equal(r.app.state.phase, 'login');
  assert.equal(r.app.view(), null);
});
