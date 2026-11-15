// Связь content script ↔ service worker. Страница Spotify к этому каналу доступа не имеет.
async function send(t, payload = {}) {
  let r;
  try {
    r = await chrome.runtime.sendMessage({ t, ...payload });
  } catch (e) {
    const gone = /context invalidated|Receiving end/i.test(String(e?.message));
    throw Object.assign(new Error(gone ? 'Расширение обновилось. Перезагрузи вкладку Spotify.' : String(e?.message || e)), { code: gone ? 'RELOAD' : 'BRIDGE' });
  }
  if (!r?.ok) throw Object.assign(new Error(r?.error?.message || 'Нет ответа от расширения'), { code: r?.error?.code || 'BRIDGE' });
  return r.data;
}

export const chromeBridge = {
  status: () => send('auth/status'),
  login: (clientId) => send('auth/login', { clientId }),
  logout: () => send('auth/logout'),
  apiFetch: (url, init) => send('api/fetch', { url, init }),
};

/** Профиль и кэш в chrome.storage.local с синхронным чтением (движок читает данные синхронно при создании). */
export async function chromeBackend(prefix = 'mywave.') {
  const all = await chrome.storage.local.get(null);
  const cache = new Map(Object.entries(all).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
  return {
    get: (k) => cache.get(k) ?? null,
    set: (k, v) => { cache.set(k, v); chrome.storage.local.set({ [prefix + k]: v }).catch(() => {}); },
    del: (k) => { cache.delete(k); chrome.storage.local.remove(prefix + k).catch(() => {}); },
  };
}
