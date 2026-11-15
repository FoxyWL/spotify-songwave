// Персистентность: JSON в localStorage с отложенной записью. Для тестов — memoryBackend.
const PREFIX = 'mywave.';

export function localBackend() {
  return {
    get(k) { try { return localStorage.getItem(PREFIX + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(PREFIX + k, v); } catch { /* квота браузера */ } },
    del(k) { try { localStorage.removeItem(PREFIX + k); } catch { /* ignore */ } },
  };
}

export function memoryBackend(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => { m.set(k, v); },
    del: (k) => { m.delete(k); },
    dump: () => Object.fromEntries([...m].map(([k, v]) => [k, JSON.parse(v)])),
  };
}

export function createStore(backend = localBackend(), { delay = 400 } = {}) {
  const pending = new Map();
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    for (const [k, v] of pending) backend.set(k, JSON.stringify(v));
    pending.clear();
  };
  return {
    load(k, fallback = null) {
      if (pending.has(k)) return pending.get(k);
      try {
        const raw = backend.get(k);
        return raw == null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    save(k, v) {
      pending.set(k, v);
      if (!timer) { timer = setTimeout(flush, delay); timer?.unref?.(); }
    },
    remove(k) { pending.delete(k); backend.del(k); },
    flush,
  };
}
