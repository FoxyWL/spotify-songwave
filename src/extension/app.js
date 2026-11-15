// Прикладной слой расширения: связывает вход, API, движок рекомендаций и плеер в одно состояние для интерфейса.
// Интерфейс ничего не знает про Spotify и движок: он читает app.state и вызывает действия.
import { createApi } from '../spotify/api.js';
import { createStore } from '../core/store.js';
import { createEngine } from '../core/engine/index.js';
import { createPlayback } from '../core/playback.js';
import { createConnectBackend } from '../core/backends/connect.js';
import { MOODS, MODES } from '../core/engine/settings.js';

/** Пресеты из дизайна. Spotify не отдаёт энергию/настроение треков (audio features закрыты), поэтому
 * «Спокойнее» и «Энергичнее» опираются на жанровые наборы настроений, а не на измеренную энергичность. */
export const PRESETS = [
  { id: 'balanced', label: 'Баланс', hint: 'Знакомое и новое примерно поровну', patch: { mode: 'wave', discovery: 0.35, mood: null } },
  { id: 'familiar', label: 'Больше знакомого', hint: 'Любимые артисты и жанры чаще', patch: { mode: 'wave', discovery: 0.1, mood: null } },
  { id: 'discovery', label: 'Больше нового', hint: 'Чаще артисты, которых ты ещё не слушал', patch: { mode: 'wave', discovery: 0.8, mood: null } },
  { id: 'calm', label: 'Спокойнее', hint: 'Мягкие жанры: chill, acoustic, dream pop', patch: { mode: 'wave', mood: 'chill' } },
  { id: 'energy', label: 'Энергичнее', hint: 'Жанры для движения: edm, hip hop, dance', patch: { mode: 'wave', mood: 'workout' } },
];

export function activePreset(settings) {
  const near = (a, b) => Math.abs(a - b) < 0.03;
  return PRESETS.find((p) => Object.entries(p.patch).every(([k, v]) => (k === 'discovery' ? near(settings.discovery, v) : settings[k] === v)))?.id ?? null;
}

const errText = (e) => (e?.message || String(e)).slice(0, 200);

export function createApp({ bridge, storage, now = () => Date.now(), rng = Math.random, schedule = setTimeout, clear = clearTimeout } = {}) {
  const subs = new Set();
  const s = {
    phase: 'boot', // boot | login | loading | onboarding | ready | fatal
    auth: { clientId: '', redirectUri: '', missingScopes: [] },
    loginBusy: false,
    loginError: null,
    progress: null,
    fatal: null,
    notice: null, // { kind: 'quota' | 'ratelimit' | 'network' | 'premium' | 'device' | 'auth', text, retry? }
    toasts: [],
    devices: [],
    version: 0,
  };
  let api = null;
  let store = null;
  let engine = null;
  let playback = null;
  let toastId = 0;
  let noticeTimer = null;

  const emit = () => { s.version++; subs.forEach((f) => { try { f(s); } catch { /* ignore */ } }); };
  const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };

  function toast(kind, text) {
    const id = ++toastId;
    s.toasts = [...s.toasts, { id, kind, text }].slice(-3);
    emit();
    schedule(() => { s.toasts = s.toasts.filter((t) => t.id !== id); emit(); }, kind === 'warn' ? 5200 : 3200);
  }

  function setNotice(n, ms = 0) {
    clear(noticeTimer);
    s.notice = n;
    if (n && ms) noticeTimer = schedule(() => { if (s.notice === n) { s.notice = null; emit(); } }, ms);
    emit();
  }
  const clearNotice = () => { if (s.notice) setNotice(null); };

  // ---------- сеть: запросы идут через service worker, токен остаётся там ----------
  const fetchImpl = async (url, init = {}) => {
    let r;
    try {
      r = await bridge.apiFetch(url, { method: init.method, headers: init.headers, body: init.body });
    } catch (e) {
      if (e?.code === 'EXPIRED') { authLost('Сессия Spotify истекла. Войди снова.'); throw e; }
      throw Object.assign(new TypeError(errText(e)), { code: e?.code });
    }
    if (r.status === 401) authLost('Spotify не принял токен. Войди снова.');
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: (k) => r.headers?.[String(k).toLowerCase()] ?? null }, text: async () => r.text };
  };

  function authLost(text) {
    if (s.phase === 'login') return;
    playback?.stop();
    s.phase = 'login';
    s.loginError = text;
    emit();
  }

  function describeApiError(e) {
    if (e?.isQuota) return { kind: 'quota', text: 'Исчерпана квота запросов Spotify для режима разработки. Волна продолжит из того, что уже подобрано.' };
    if (e?.isRateLimit) return { kind: 'ratelimit', text: 'Spotify просит подождать. Повторю автоматически.' };
    if (e?.isPremium) return { kind: 'premium', text: 'Для управления воспроизведением нужен Spotify Premium.' };
    if (e?.isNoDevice) return { kind: 'device', text: 'Нет активного устройства Spotify. Открой Spotify Web Player или выбери устройство.' };
    if (e instanceof TypeError || e?.status === undefined) return { kind: 'network', text: 'Нет связи со Spotify. Проверь интернет и попробуй ещё раз.' };
    return { kind: 'network', text: errText(e) };
  }

  // ---------- сессия ----------
  async function readStatus() {
    const st = await bridge.status();
    s.auth = { clientId: st.clientId || '', redirectUri: st.redirectUri, missingScopes: st.missingScopes || [] };
    return st;
  }

  async function init() {
    try {
      const st = await readStatus();
      if (!st.authed) { s.phase = 'login'; emit(); return; }
      await startSession();
    } catch (e) {
      s.phase = 'fatal'; s.fatal = errText(e); emit();
    }
  }

  async function login(clientId) {
    s.loginBusy = true; s.loginError = null; emit();
    try {
      const st = await bridge.login(clientId);
      s.auth = { clientId: st.clientId, redirectUri: st.redirectUri, missingScopes: st.missingScopes || [] };
      s.loginBusy = false;
      await startSession();
    } catch (e) {
      s.loginBusy = false;
      s.loginError = errText(e);
      if (s.phase !== 'login') s.phase = 'login';
      emit();
    }
  }

  async function logout() {
    playback?.stop();
    await bridge.logout();
    playback = null; engine = null; api = null;
    s.phase = 'login'; s.loginError = null; emit();
  }

  function buildCore() {
    store = createStore(storage, { delay: 500 });
    api = createApi({ getToken: async () => 'sw', fetchImpl, now });
    api.on((e) => {
      if (e.type === 'quota') setNotice({ kind: 'quota', text: describeApiError({ isQuota: true }).text }, Math.max(5000, (e.until || 0) - now()));
      else if (e.type === 'ratelimit') setNotice({ kind: 'ratelimit', text: describeApiError({ isRateLimit: true }).text }, Math.max(3000, (e.until || 0) - now()));
    });
    engine = createEngine({ api, store, rng, now });
    engine.on((e) => {
      if (e.type === 'warn') {
        const d = describeApiError(e.error);
        if (d.kind !== 'quota' && d.kind !== 'ratelimit') setNotice({ ...d, retry: 'refill' });
      } else emit();
    });
    const backend = createConnectBackend({ api, now, schedule, clear });
    playback = createPlayback({ engine, api, backend, now, onToast: ({ kind, text }) => toast(kind, text) });
    playback.on((e) => {
      if (e.type === 'error' && e.error) {
        const d = describeApiError(e.error);
        if (d.kind === 'device' || d.kind === 'premium') setNotice({ ...d, retry: 'start' });
        else if (d.kind !== 'quota' && d.kind !== 'ratelimit') setNotice({ ...d, retry: 'start' });
      }
      emit();
    });
    return backend;
  }

  async function startSession() {
    s.phase = 'loading'; s.progress = { done: 0, total: 12, label: 'Подключаюсь к Spotify' }; emit();
    const backend = buildCore();
    try {
      const hasTaste = await engine.ensureSeeded({ onProgress: (p) => { s.progress = p; emit(); } });
      await backend.start((st, meta) => playback._handleState(st, meta));
      s.phase = hasTaste ? 'ready' : 'onboarding';
      emit();
    } catch (e) {
      if (s.phase === 'login') return;
      const d = describeApiError(e);
      if (d.kind === 'quota' || d.kind === 'ratelimit') { s.phase = 'fatal'; s.fatal = d.text; }
      else { s.phase = 'fatal'; s.fatal = d.text; }
      emit();
    }
  }

  const retryLoad = () => startSession();

  // ---------- действия интерфейса ----------
  const run = (fn) => async (...a) => {
    try { return await fn(...a); } catch (e) {
      if (e?.code === 'EXPIRED') return undefined;
      const d = describeApiError(e);
      if (d.kind === 'device' || d.kind === 'premium') { setNotice({ ...d, retry: 'start' }); return undefined; }
      if (d.kind === 'quota' || d.kind === 'ratelimit') return undefined; // баннер уже показан событием api
      setNotice({ ...d, retry: 'start' });
      return undefined;
    }
  };

  async function finishOnboarding({ genres = [], artists = [] }) {
    engine.onboard({ genres, artists });
    s.phase = 'ready'; emit();
  }

  const actions = {
    init, login, logout, retryLoad, finishOnboarding,
    start: run(async () => { clearNotice(); await playback.start(); }),
    toggle: run(async () => { clearNotice(); await playback.toggle(); }),
    next: run(() => playback.next()),
    previous: run(() => playback.previous()),
    seek: run((ms) => playback.seek(ms)),
    like: run(() => (playback.view().liked ? playback.unlike() : playback.like())),
    save: run(() => playback.save()),
    unsave: run(() => playback.unsave()),
    dislike: run(() => playback.dislike()),
    less: run(async () => { await playback.less(); toast('ok', 'Понял, такого будет меньше'); }),
    more: run(async () => { await playback.more(); toast('ok', 'Понял, такого будет больше'); }),
    excludeArtist: run(async () => { const a = playback.view().current?.track.artists[0]?.name; await playback.excludeArtist(); toast('ok', `${a || 'Артист'} больше не появится в волне`); }),
    excludeArtistOf: run(async (rec) => { engine.feedback({ type: 'excludeArtist', track: rec.track, genres: rec.genres }); await playback.replan(); toast('ok', `${rec.track.artists[0]?.name || 'Артист'} больше не появится в волне`); }),
    playTrack: run((t) => playback.playTrack(t)),
    jumpTo: run((id) => playback.jumpTo(id)),
    dropPlanned: run((id) => playback.dropPlanned(id)),
    excludeTrackLater: run(async (rec) => { engine.feedback({ type: 'excludeTrack', track: rec.track, genres: rec.genres }); await playback.replan(); }),
    setVolume: (v) => playback?.setVolume(v),
    shake: run(async () => { await playback.shake(); toast('ok', 'Волна обновлена, текущий трек остался'); }),
    retry: run(async () => {
      const kind = s.notice?.retry;
      clearNotice();
      if (kind === 'refill') { await engine.refill({ force: true }); await playback.replan(); } else await playback.start();
    }),
    dismissNotice: clearNotice,

    applyPreset: run(async (id) => {
      const p = PRESETS.find((x) => x.id === id);
      if (!p) return;
      engine.setSettings(p.patch);
      await playback.replan();
    }),
    setSettings: run(async (patch) => { engine.setSettings(patch); await playback.replan(); }),
    unexcludeArtist: (id) => engine.unexcludeArtist(id),
    resetProfile: () => { engine.reset({ keepSettings: true }); s.phase = 'onboarding'; emit(); },
    exportProfile: () => engine.exportProfile(),
    importProfile: (text) => { engine.importProfile(text); toast('ok', 'Профиль загружен'); emit(); },
    async loadDevices() { try { s.devices = await api.devices(); } catch (e) { s.devices = []; toast('warn', describeApiError(e).text); } emit(); },
    selectDevice: run(async (id) => { await playback.selectDevice(id); await actions.loadDevices(); }),
    search: async (q) => {
      const query = String(q || '').trim();
      if (query.length < 2) return [];
      const { tracks } = await api.search(query, { type: 'track', limit: 10 });
      return tracks;
    },
    searchArtists: async (q) => (await api.search(String(q).trim(), { type: 'artist', limit: 10 })).artists,
    savedTracks: async () => (await api.savedTracks({ limit: 30 })).filter(Boolean),
    async saveSessionPlaylist(name) {
      const h = engine.getProfile().history.slice(-50);
      if (!h.length) { toast('warn', 'В волне пока нет прослушанных треков'); return null; }
      try {
        const pl = await api.createPlaylist(name || `Моя волна, ${new Date(now()).toLocaleDateString('ru-RU')}`, 'Собрано Songwave из прослушанного в волне');
        const uris = h.map((x) => `spotify:track:${x.trackId}`);
        for (let i = 0; i < uris.length; i += 50) await api.addToPlaylist(pl.id, uris.slice(i, i + 50));
        toast('ok', `Плейлист «${pl.name}» создан в Spotify`);
        return pl;
      } catch (e) { toast('warn', describeApiError(e).text); return null; }
    },
  };

  return {
    state: s,
    subscribe,
    actions,
    get engine() { return engine; },
    get playback() { return playback; },
    /** Срез для интерфейса: всё, что нужно отрисовать про плеер и вкус. */
    view() {
      if (!playback || !engine) return null;
      const pv = playback.view();
      const ev = engine.view();
      return { player: pv, taste: ev, settings: ev.settings, preset: activePreset(ev.settings), moods: MOODS, modes: MODES, presets: PRESETS };
    },
    toast,
    describeApiError,
    setFatal(text) { s.phase = 'fatal'; s.fatal = text; emit(); },
    flush: () => store?.flush(),
  };
}
