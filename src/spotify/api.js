// Клиент Web API: кэш, дедупликация, лимит параллельных запросов, 429/квота, retry.
// Использует только эндпоинты, которые остаются доступны в Development Mode (см. февральский changelog 2026).
import { API_BASE } from '../config.js';

export class SpotifyError extends Error {
  constructor(status, message, { reason = null, retryAfter = null, path = '' } = {}) {
    super(message || `HTTP ${status}`);
    this.name = 'SpotifyError';
    this.status = status;
    this.reason = reason;
    this.retryAfter = retryAfter;
    this.path = path;
  }
  get isQuota() { return this.status === 429 && this.reason === 'QUOTA_EXCEEDED'; }
  get isRateLimit() { return this.status === 429 && !this.isQuota; }
  get isNoDevice() { return this.reason === 'NO_ACTIVE_DEVICE' || /no active device/i.test(this.message); }
  get isPremium() { return this.reason === 'PREMIUM_REQUIRED'; }
}

// ---------- нормализация ----------
export function normArtist(a) {
  if (!a || !a.id) return null;
  return {
    id: a.id,
    name: a.name,
    genres: (a.genres || []).map((g) => String(g).toLowerCase()),
    image: (a.images?.[1] || a.images?.[0])?.url ?? null,
  };
}

export function normAlbum(al) {
  if (!al || !al.id) return null;
  const imgs = al.images || [];
  return {
    id: al.id,
    name: al.name,
    image: (imgs[1] || imgs[0])?.url ?? null,
    imageSmall: imgs.length ? imgs[imgs.length - 1].url : null,
    releaseDate: al.release_date ?? null,
    type: al.album_type ?? null,
    totalTracks: al.total_tracks ?? null,
  };
}

export function normTrack(t, albumFallback = null) {
  if (!t || !t.id || t.is_local || (t.type && t.type !== 'track')) return null;
  const album = t.album ? normAlbum(t.album) : albumFallback;
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: (t.artists || []).filter((a) => a.id).map((a) => ({ id: a.id, name: a.name })),
    album: album || { id: null, name: '', image: null, imageSmall: null },
    durationMs: t.duration_ms ?? 0,
    explicit: !!t.explicit,
    playable: t.is_playable !== false,
  };
}

const TTL = { short: 30_000, mid: 10 * 60_000, long: 6 * 3_600_000 };

export function createApi({
  getToken,
  fetchImpl,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxConcurrent = 3,
  quotaPauseMs = 60_000,
  base = API_BASE,
} = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const cache = new Map();
  const inflight = new Map();
  const listeners = new Set();
  const stats = { total: 0, cacheHits: 0, rateLimited: 0, quotaHits: 0, errors: 0, byPath: {} };
  let pausedUntil = 0; // rate limit: ждут все
  let quotaUntil = 0; // квота: низкий приоритет отваливается сразу
  let active = 0;
  const waiters = [];

  const emit = (e) => listeners.forEach((f) => { try { f(e); } catch { /* ignore */ } });
  const on = (f) => { listeners.add(f); return () => listeners.delete(f); };

  async function acquire() {
    if (active < maxConcurrent) { active++; return; }
    await new Promise((r) => waiters.push(r)); // слот передаётся без изменения active
  }
  function release() {
    const w = waiters.shift();
    if (w) w(); else active--;
  }

  const normPath = (p) => p.replace(/\/[A-Za-z0-9]{22}(?=\/|$)/g, '/:id');

  async function once(method, url, body, token) {
    const res = await doFetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    return { res, data };
  }

  async function request(method, path, { query, body, ttl = 0, priority = 'low', retries = 3 } = {}) {
    const qs = query
      ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString()
      : '';
    const url = base + path + (qs ? '?' + qs : '');
    const key = method === 'GET' ? url : null;

    if (key && ttl > 0) {
      const c = cache.get(key);
      if (c && c.exp > now()) { stats.cacheHits++; return c.value; }
    }
    if (key && inflight.has(key)) return inflight.get(key);

    const run = async () => {
      let attempt = 0;
      let refreshed = false;
      for (;;) {
        if (priority === 'low' && quotaUntil > now()) {
          throw new SpotifyError(429, 'Квота Spotify исчерпана, жду', { reason: 'QUOTA_EXCEEDED', path, retryAfter: Math.ceil((quotaUntil - now()) / 1000) });
        }
        const wait = pausedUntil - now();
        if (wait > 0) await sleep(wait);
        if (priority === 'low') await acquire();
        let out;
        try {
          out = await once(method, url, body, await getToken());
        } finally {
          if (priority === 'low') release();
        }
        const { res, data } = out;
        stats.total++;
        const np = `${method} ${normPath(path)}`;
        stats.byPath[np] = (stats.byPath[np] || 0) + 1;

        if (res.ok) {
          const value = res.status === 204 ? null : data;
          if (key && ttl > 0) cache.set(key, { exp: now() + ttl, value });
          return value;
        }
        const reason = data?.error?.reason ?? null;
        const message = data?.error?.message ?? (typeof data === 'string' ? data : '');

        if (res.status === 401 && !refreshed) { refreshed = true; await getToken(true); continue; }

        if (res.status === 429) {
          stats.rateLimited++;
          const ra = Number(res.headers.get('Retry-After'));
          if (reason === 'QUOTA_EXCEEDED') {
            stats.quotaHits++;
            quotaUntil = Math.max(quotaUntil, now() + quotaPauseMs);
            emit({ type: 'quota', until: quotaUntil });
            throw new SpotifyError(429, message || 'Quota exceeded', { reason, path, retryAfter: quotaPauseMs / 1000 });
          }
          if (attempt >= retries) throw new SpotifyError(429, message || 'Rate limited', { reason, path, retryAfter: ra || null });
          const waitS = Number.isFinite(ra) && ra > 0 ? ra : Math.min(30, 2 ** attempt);
          pausedUntil = Math.max(pausedUntil, now() + waitS * 1000);
          emit({ type: 'ratelimit', until: pausedUntil });
          attempt++;
          continue;
        }
        if ([500, 502, 503, 504].includes(res.status) && attempt < retries && (method === 'GET' || method === 'PUT')) {
          attempt++;
          await sleep(300 * 2 ** attempt);
          continue;
        }
        stats.errors++;
        throw new SpotifyError(res.status, message, { reason, path });
      }
    };

    const p = run();
    if (key) {
      inflight.set(key, p);
      p.finally(() => inflight.delete(key)).catch(() => {});
    }
    return p;
  }

  const get = (path, opts) => request('GET', path, opts);
  const hi = { priority: 'high' };

  return {
    request, on, stats,
    status: () => ({ paused: pausedUntil > now() || quotaUntil > now(), quota: quotaUntil > now(), until: Math.max(pausedUntil, quotaUntil) }),
    clearCache: () => cache.clear(),

    // --- профиль и слушательские данные ---
    me: () => get('/me', { ttl: TTL.mid }),
    async topArtists(range = 'medium_term', limit = 50) {
      const d = await get('/me/top/artists', { query: { time_range: range, limit }, ttl: TTL.long });
      return (d?.items || []).map(normArtist).filter(Boolean);
    },
    async topTracks(range = 'medium_term', limit = 50) {
      const d = await get('/me/top/tracks', { query: { time_range: range, limit }, ttl: TTL.long });
      return (d?.items || []).map((t) => normTrack(t)).filter(Boolean);
    },
    async recentlyPlayed(limit = 50) {
      const d = await get('/me/player/recently-played', { query: { limit }, ttl: TTL.short });
      return (d?.items || []).map((i) => ({ track: normTrack(i.track), playedAt: i.played_at })).filter((i) => i.track);
    },
    async savedTracks({ limit = 50, offset = 0 } = {}) {
      const d = await get('/me/tracks', { query: { limit, offset }, ttl: TTL.long });
      return (d?.items || []).map((i) => normTrack(i.track)).filter(Boolean);
    },
    async followedArtists(limit = 50) {
      const d = await get('/me/following', { query: { type: 'artist', limit }, ttl: TTL.long });
      return (d?.artists?.items || []).map(normArtist).filter(Boolean);
    },

    // --- каталог ---
    async search(q, { type = 'track', limit = 10, offset = 0 } = {}) {
      const d = await get('/search', { query: { q, type, limit: Math.min(10, limit), offset }, ttl: TTL.mid });
      return {
        tracks: (d?.tracks?.items || []).map((t) => normTrack(t)).filter(Boolean),
        artists: (d?.artists?.items || []).map(normArtist).filter(Boolean),
      };
    },
    async artistAlbums(id, { limit = 10, offset = 0 } = {}) {
      const d = await get(`/artists/${id}/albums`, { query: { include_groups: 'album,single', limit, offset }, ttl: TTL.long });
      return (d?.items || []).map(normAlbum).filter(Boolean);
    },
    async albumTracks(albumId, album = null) {
      const d = await get(`/albums/${albumId}/tracks`, { query: { limit: 50 }, ttl: TTL.long });
      return (d?.items || []).map((t) => normTrack(t, album)).filter(Boolean);
    },
    async artist(id) { return normArtist(await get(`/artists/${id}`, { ttl: TTL.long })); },

    // --- плеер (высокий приоритет: не ждёт очередь и не блокируется квотой кандидатов) ---
    async devices() {
      const d = await get('/me/player/devices', hi);
      return (d?.devices || []).map((x) => ({ id: x.id, name: x.name, type: x.type, active: x.is_active, restricted: x.is_restricted }));
    },
    playerState: () => get('/me/player', hi),
    getQueue: () => get('/me/player/queue', hi),
    play: ({ deviceId, uris, positionMs }) =>
      request('PUT', '/me/player/play', { ...hi, query: { device_id: deviceId }, body: { uris, ...(positionMs ? { position_ms: Math.round(positionMs) } : {}) } }),
    resume: (deviceId) => request('PUT', '/me/player/play', { ...hi, query: { device_id: deviceId } }),
    pause: (deviceId) => request('PUT', '/me/player/pause', { ...hi, query: { device_id: deviceId } }),
    next: (deviceId) => request('POST', '/me/player/next', { ...hi, query: { device_id: deviceId } }),
    seek: (positionMs, deviceId) => request('PUT', '/me/player/seek', { ...hi, query: { position_ms: Math.round(positionMs), device_id: deviceId } }),
    queueAdd: (uri, deviceId) => request('POST', '/me/player/queue', { ...hi, query: { uri, device_id: deviceId } }),
    volume: (percent, deviceId) => request('PUT', '/me/player/volume', { ...hi, query: { volume_percent: Math.max(0, Math.min(100, Math.round(percent))), device_id: deviceId } }),
    transfer: (deviceId, play = false) => request('PUT', '/me/player', { ...hi, body: { device_ids: [deviceId], play } }),

    // --- библиотека и плейлисты ---
    saveToLibrary: (uris) => request('PUT', '/me/library', { ...hi, query: { uris: uris.join(',') } }),
    removeFromLibrary: (uris) => request('DELETE', '/me/library', { ...hi, query: { uris: uris.join(',') } }),
    async myPlaylists({ limit = 50, offset = 0 } = {}) {
      const [me, d] = await Promise.all([get('/me', { ttl: TTL.mid, priority: 'high' }), get('/me/playlists', { query: { limit, offset }, priority: 'high' })]);
      return (d?.items || [])
        .filter((p) => p && (p.owner?.id === me.id || p.collaborative))
        .map((p) => ({ id: p.id, name: p.name, image: p.images?.[0]?.url ?? null }));
    },
    createPlaylist: (name, description = '') => request('POST', '/me/playlists', { ...hi, body: { name, description, public: false } }),
    addToPlaylist: (id, uris) => request('POST', `/playlists/${id}/items`, { ...hi, body: { uris } }),
  };
}
