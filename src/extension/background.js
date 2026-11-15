// Service worker: вход в Spotify, токены и сетевые запросы к Web API. Страница open.spotify.com токенов не видит.
import { API_BASE } from '../config.js';
import { createAuth, AuthError } from './auth.js';

const chromeStorage = {
  get: async (k) => (await chrome.storage.local.get(k))[k],
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
  remove: (k) => chrome.storage.local.remove(k),
};

const auth = createAuth({
  storage: chromeStorage,
  launchWebAuthFlow: (o) => chrome.identity.launchWebAuthFlow(o),
  redirectUri: chrome.identity.getRedirectURL(),
});

const serializeError = (e) => ({ message: e?.message || String(e), code: e?.code || 'ERROR' });

async function apiFetch({ url, init = {} }) {
  if (typeof url !== 'string' || !url.startsWith(`${API_BASE}/`)) throw new AuthError('Запрос вне Spotify Web API отклонён', 'FORBIDDEN');
  const send = async (token) => fetch(url, {
    method: init.method || 'GET',
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    body: init.body,
  });
  let res = await send(await auth.token());
  if (res.status === 401) res = await send(await auth.token(true)); // токен мог протухнуть раньше срока
  const headers = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return { status: res.status, headers, text: await res.text() };
}

const handlers = {
  'auth/status': () => auth.status(),
  'auth/login': ({ clientId }) => keepAlive(() => auth.login(clientId)),
  'auth/logout': () => auth.logout(),
  'api/fetch': apiFetch,
  // service worker засыпает через ~30 с простоя; во время ожидания входа поддерживаем его живым
  'ping': () => true,
};

async function keepAlive(fn) {
  const t = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
  try { return await fn(); } finally { clearInterval(t); }
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  const h = handlers[msg?.t];
  if (!h) return false;
  Promise.resolve().then(() => h(msg)).then((data) => send({ ok: true, data }), (e) => send({ ok: false, error: serializeError(e) }));
  return true;
});

// Открыть/закрыть «Мою волну» на вкладке Spotify: кнопка расширения и горячая клавиша.
async function toggle() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith('https://open.spotify.com/')) {
    try { await chrome.tabs.sendMessage(tab.id, { t: 'toggle-overlay' }); return; } catch { /* content script ещё не загружен */ }
  }
  const [existing] = await chrome.tabs.query({ url: 'https://open.spotify.com/*' });
  if (existing) { await chrome.tabs.update(existing.id, { active: true }); await chrome.windows.update(existing.windowId, { focused: true }); try { await chrome.tabs.sendMessage(existing.id, { t: 'toggle-overlay', open: true }); } catch { /* ignore */ } return; }
  await chrome.tabs.create({ url: 'https://open.spotify.com/' });
}
chrome.action.onClicked.addListener(() => toggle());
chrome.commands.onCommand.addListener((c) => { if (c === 'toggle-wave') toggle(); });
