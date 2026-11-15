// Мок Spotify Web API в границах Development Mode (по документации, февраль 2026):
// нет recommendations / audio-features / related-artists / top-tracks / batch-GET, search ≤ 10, нет popularity, followers, product.
// Это МОДЕЛЬ документированного поведения: она проверяет нашу логику, но не заменяет прогон на живом Spotify.
import { mulberry32 } from '../../src/core/engine/util.js';

export const GENRES = ['indie rock', 'shoegaze', 'dream pop', 'synthwave', 'techno', 'house', 'ambient', 'lo-fi', 'hip hop', 'trap', 'jazz', 'bossa nova', 'metal', 'post-punk', 'k-pop', 'city pop', 'classical', 'folk'];
const ADJ = {
  'indie rock': ['indie pop', 'post-punk'], shoegaze: ['dream pop', 'indie rock'], 'dream pop': ['shoegaze', 'indie pop'],
  synthwave: ['city pop', 'electronic'], techno: ['house', 'electronic'], house: ['techno', 'disco'], ambient: ['lo-fi', 'classical'],
  'lo-fi': ['ambient', 'hip hop'], 'hip hop': ['trap', 'lo-fi'], trap: ['hip hop', 'phonk'], jazz: ['bossa nova', 'lo-fi'],
  'bossa nova': ['jazz', 'chill'], metal: ['post-punk', 'hard rock'], 'post-punk': ['indie rock', 'metal'], 'k-pop': ['city pop', 'dance pop'],
  'city pop': ['synthwave', 'k-pop'], classical: ['ambient', 'piano'], folk: ['indie rock', 'acoustic'],
};
const A = ['Silent', 'Neon', 'Paper', 'Velvet', 'Hollow', 'Golden', 'Lunar', 'Amber', 'Static', 'Crimson', 'Pale', 'Wild', 'Quiet', 'Electric', 'Salt', 'Glass', 'Northern', 'Faded', 'Iron', 'Tidal', 'Soft', 'Ghost', 'Bright', 'Dusty'];
const N = ['Harbor', 'Echoes', 'Garden', 'Signal', 'Tigers', 'Letters', 'Orbit', 'Rivers', 'Machine', 'Season', 'Choir', 'Parade', 'Lights', 'Animals', 'Voices', 'Station', 'Bloom', 'Engine', 'Atlas', 'Mirrors', 'Theory', 'Summer', 'Pilots', 'Fields'];
const W = ['Night', 'Rain', 'Glow', 'Drift', 'Fire', 'Dream', 'Tide', 'Haze', 'Blue', 'Run', 'Light', 'Wave', 'Heart', 'Moon', 'Sky', 'Dust'];

const mkId = (p, n) => (p + n.toString(36).padStart(21, '0')).slice(0, 22);
const norm = (s) => String(s ?? '').trim().toLowerCase();

export function buildCatalog(seed = 7) {
  const rng = mulberry32(seed);
  const artists = [];
  const albums = [];
  const tracks = [];
  let ai = 0;
  for (const g of GENRES) {
    for (let k = 0; k < 6; k++, ai++) {
      const genres = [g];
      if (k % 2 === 0) genres.push(ADJ[g][k % 2 === 0 ? (k / 2) % 2 : 0]);
      const artist = { id: mkId('a', ai), name: `${A[ai % A.length]} ${N[(ai * 7) % N.length]}`, genres, primary: g, idx: ai };
      artists.push(artist);
      for (let b = 0; b < 3; b++) {
        const album = { id: mkId('b', albums.length), name: `${W[(ai + b * 5) % W.length]} ${['Sessions', 'Letters', 'EP', 'Tapes'][b % 4]}`, artistId: artist.id, year: 1985 + ((b * 7 + ai * 3) % 40), type: b === 2 ? 'single' : 'album', trackIds: [] };
        albums.push(album);
        for (let t = 0; t < 8; t++) {
          const tr = {
            id: mkId('t', tracks.length), name: `${W[(t + ai) % W.length]} ${W[(t * 3 + b) % W.length]} ${t + 1}`,
            artistIds: [artist.id], albumId: album.id, durationMs: 150_000 + Math.floor(rng() * 150_000), explicit: rng() < 0.1,
          };
          tracks.push(tr);
          album.trackIds.push(tr.id);
        }
      }
    }
  }
  const byId = (arr) => new Map(arr.map((x) => [x.id, x]));
  return { artists, albums, tracks, artistById: byId(artists), albumById: byId(albums), trackById: byId(tracks) };
}

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const img = (id) => [640, 300, 64].map((w) => ({ url: `https://i.scdn.co/image/${id}?w=${w}`, width: w, height: w }));

export class MockSpotify {
  constructor({ seed = 7, now = () => Date.now(), timeScale = 1, requireAuth = false, clearQueueOnPlay = false } = {}) {
    this.cat = buildCatalog(seed);
    this.clock = now;
    this.timeScale = timeScale;
    this.requireAuth = requireAuth;
    this.clearQueueOnPlay = clearQueueOnPlay;
    this.rng = mulberry32(seed + 1);
    this.log = [];
    this.tokens = new Set();
    this.user = { id: 'maxim', name: 'Тестовый слушатель', top: { short_term: [], medium_term: [], long_term: [] }, topTracks: { short_term: [], medium_term: [], long_term: [] }, saved: [], recent: [], followed: [] };
    this.library = new Set();
    this.playlists = [{ id: mkId('p', 1), name: 'Мой плейлист', owner: 'maxim', items: [] }];
    this.unplayable = new Set();
    this.quota = { left: Infinity, resetAt: 0 };
    this.rateLimit = { left: 0, retryAfter: 1 };
    this.failNext = [];
    this.autoplayed = [];
    this.playbackErrors = [];
    this.devices = [{ id: 'webplayer', name: 'Web Player (Chrome)', type: 'Computer' }];
    this.p = { deviceId: null, current: null, context: [], ctxIdx: 0, queue: [], pos: 0, playing: false, ts: this.clock(), volume: 50 };
  }

  // ---------- настройка пользователя ----------
  setUser({ genres, savedCount = 40, recentCount = 20 }) {
    const { artists, tracks } = this.cat;
    const mine = artists.filter((a) => a.genres.some((g) => genres.includes(g)));
    const ordered = [...mine].sort((a, b) => hash(a.id) - hash(b.id));
    this.user.top.short_term = ordered.slice(0, 12).map((a) => a.id);
    this.user.top.medium_term = ordered.slice(0, 18).map((a) => a.id);
    this.user.top.long_term = ordered.slice(0, 24).map((a) => a.id);
    const mt = tracks.filter((t) => this.user.top.long_term.includes(t.artistIds[0])).sort((a, b) => hash(a.id) - hash(b.id));
    for (const r of Object.keys(this.user.topTracks)) this.user.topTracks[r] = mt.slice(0, 20).map((t) => t.id);
    this.user.saved = mt.slice(20, 20 + savedCount).map((t) => t.id);
    this.user.recent = mt.slice(20 + savedCount, 20 + savedCount + recentCount).map((t) => t.id);
    this.user.followed = ordered.slice(0, 6).map((a) => a.id);
    return this;
  }

  // ---------- сериализация ----------
  artistObj(a, full = true) {
    return full ? { id: a.id, name: a.name, type: 'artist', uri: `spotify:artist:${a.id}`, genres: a.genres, images: img(a.id) } : { id: a.id, name: a.name, type: 'artist', uri: `spotify:artist:${a.id}` };
  }
  albumObj(al, simple = true) {
    return { id: al.id, name: al.name, type: 'album', album_type: al.type, release_date: `${al.year}-01-01`, total_tracks: al.trackIds.length, images: img(al.id), artists: [this.artistObj(this.cat.artistById.get(al.artistId), false)] };
  }
  trackObj(t, withAlbum = true) {
    const o = {
      id: t.id, uri: `spotify:track:${t.id}`, name: t.name, type: 'track', duration_ms: t.durationMs, explicit: t.explicit, is_local: false,
      artists: t.artistIds.map((id) => this.artistObj(this.cat.artistById.get(id), false)),
    };
    if (withAlbum) o.album = this.albumObj(this.cat.albumById.get(t.albumId));
    return o;
  }
  page(items, offset, limit, key) {
    return { href: '', items: items.slice(offset, offset + limit), limit, offset, total: items.length, next: null, previous: null, ...(key ? {} : {}) };
  }

  // ---------- поиск ----------
  search(q, type, limit, offset) {
    const f = {};
    const rest = q.replace(/(genre|artist|year|album|track):(?:"([^"]+)"|(\S+))/gi, (_, k, a, b) => { f[k.toLowerCase()] = norm(a ?? b); return ''; }).trim().toLowerCase();
    const artistOk = (a) => (!f.genre || a.genres.some((g) => g.includes(f.genre))) && (!f.artist || norm(a.name) === f.artist || norm(a.name).includes(f.artist)) && (!rest || norm(a.name).includes(rest));
    const out = {};
    if (type.includes('artist')) {
      const arr = this.cat.artists.filter(artistOk).sort((a, b) => hash(q + a.id) - hash(q + b.id));
      out.artists = { ...this.page(arr.map((a) => this.artistObj(a)), offset, limit), total: arr.length };
    }
    if (type.includes('track')) {
      let yr = null;
      if (f.year) { const [a, b] = f.year.split('-').map(Number); yr = [a, b || a]; }
      const arr = this.cat.tracks.filter((t) => {
        const a = this.cat.artistById.get(t.artistIds[0]);
        const al = this.cat.albumById.get(t.albumId);
        if (!artistOk({ ...a, name: f.artist || rest ? a.name : a.name }) && (f.genre || f.artist)) return false;
        if (yr && (al.year < yr[0] || al.year > yr[1])) return false;
        if (rest && !norm(t.name).includes(rest) && !norm(a.name).includes(rest)) return false;
        return true;
      }).sort((a, b) => hash(q + a.id) - hash(q + b.id));
      out.tracks = { ...this.page(arr.map((t) => this.trackObj(t)), offset, limit), total: arr.length };
    }
    return out;
  }

  // ---------- плеер ----------
  _dur() { return this.p.current ? this.p.current.durationMs : 0; }
  sync() {
    const t = this.clock();
    const elapsed = (t - this.p.ts) * this.timeScale;
    this.p.ts = t;
    if (this.p.playing && this.p.current) this.step(elapsed);
  }
  step(ms) {
    while (ms > 0 && this.p.playing && this.p.current) {
      const remain = this._dur() - this.p.pos;
      if (ms < remain) { this.p.pos += ms; return; }
      ms -= remain;
      this.goNext();
    }
  }
  _begin(track, pos = 0) {
    this.p.current = track; this.p.pos = pos; this.p.playing = !!track;
    if (track && this.unplayable.has(track.id)) { this.playbackErrors.push(track.id); this.goNext(); }
  }
  goNext() {
    const qid = this.p.queue.shift();
    if (qid) return this._begin(this.cat.trackById.get(qid));
    if (this.p.ctxIdx + 1 < this.p.context.length) { this.p.ctxIdx++; return this._begin(this.cat.trackById.get(this.p.context[this.p.ctxIdx])); }
    // Контекст закончился: Spotify включил бы свой автоплей. Фиксируем — наше приложение не должно к этому приводить.
    const pool = this.cat.tracks.filter((t) => !this.unplayable.has(t.id));
    const t = pool[Math.floor(this.rng() * pool.length)];
    this.autoplayed.push(t.id);
    this.p.context = [t.id]; this.p.ctxIdx = 0;
    this._begin(t);
  }
  reg(name) { if (!this.devices.find((d) => d.name === name)) this.devices.push({ id: `sdk-${this.devices.length}`, name, type: 'Computer' }); return this.devices.find((d) => d.name === name); }
  deviceState() { const d = this.devices.find((x) => x.id === this.p.deviceId); return d ? { id: d.id, name: d.name, type: d.type, is_active: true, volume_percent: this.p.volume } : null; }

  sdkState(deviceId) {
    this.sync();
    if (this.p.deviceId !== deviceId || !this.p.current) return null;
    const t = this.p.current;
    const nextIds = [...this.p.queue, ...this.p.context.slice(this.p.ctxIdx + 1)].slice(0, 2);
    const o = (x) => { const s = this.trackObj(x); return { ...s, album: { ...s.album, uri: `spotify:album:${s.album.id}` }, artists: s.artists, linked_from: { uri: null, id: null } }; };
    return { paused: !this.p.playing, position: Math.floor(this.p.pos), duration: t.durationMs, loading: false, timestamp: this.clock(), track_window: { current_track: o(t), next_tracks: nextIds.map((id) => o(this.cat.trackById.get(id))), previous_tracks: [] } };
  }

  // ---------- HTTP-слой ----------
  /** req: { method, path (без /v1), query (obj), body, token } → { status, json, headers } */
  handle(req) {
    const { method, path, query = {}, body } = req;
    this.log.push({ method, path, query, t: this.clock() });
    const err = (status, message, reason, headers = {}) => ({ status, json: { error: { status, message, ...(reason ? { reason } : {}) } }, headers });
    const ok = (json = null, status = 200) => ({ status: json === null && status === 200 ? 204 : status, json, headers: {} });

    if (this.requireAuth && !this.tokens.has(req.token)) return err(401, 'The access token expired');
    const inj = this.failNext.findIndex((f) => f.match.test(`${method} ${path}`));
    if (inj >= 0) { const f = this.failNext[inj]; if (--f.times <= 0) this.failNext.splice(inj, 1); return err(f.status, f.message || 'Injected', f.reason); }
    if (this.rateLimit.left > 0) { this.rateLimit.left--; return err(429, 'API rate limit exceeded', null, { 'Retry-After': String(this.rateLimit.retryAfter) }); }
    if (!path.startsWith('/__mock')) {
      if (this.quota.left <= 0 && this.clock() < this.quota.resetAt) return { status: 429, json: { error: { status: 429, message: 'Too many requests', reason: 'QUOTA_EXCEEDED' } }, headers: {} };
      if (Number.isFinite(this.quota.left)) this.quota.left--;
    }
    this.sync();
    const lim = (d) => Math.min(50, Number(query.limit ?? d));
    const off = Number(query.offset ?? 0);
    const m = (re) => path.match(re);

    // --- удалённые для dev mode эндпоинты ---
    if (/^\/(recommendations|audio-features|audio-analysis|browse\/|markets)/.test(path) || /\/(related-artists|top-tracks)$/.test(path)
      || (method === 'GET' && /^\/(tracks|artists|albums)$/.test(path))) return err(403, 'Forbidden');

    if (path === '/me' && method === 'GET') return ok({ id: this.user.id, display_name: this.user.name, uri: `spotify:user:${this.user.id}`, images: [], account_id: 'acc-1' });
    if (path === '/me/top/artists') return ok(this.page(this.user.top[query.time_range || 'medium_term'].map((id) => this.artistObj(this.cat.artistById.get(id))), off, lim(20)));
    if (path === '/me/top/tracks') return ok(this.page(this.user.topTracks[query.time_range || 'medium_term'].map((id) => this.trackObj(this.cat.trackById.get(id))), off, lim(20)));
    if (path === '/me/tracks') return ok(this.page([...this.user.saved, ...this.library].filter((x, i, a) => a.indexOf(x) === i).map((id) => ({ added_at: '2026-01-01T00:00:00Z', track: this.trackObj(this.cat.trackById.get(id)) })), off, lim(20)));
    if (path === '/me/following') return ok({ artists: { items: this.user.followed.map((id) => this.artistObj(this.cat.artistById.get(id))), total: this.user.followed.length } });
    if (path === '/me/player/recently-played') return ok({ items: this.user.recent.map((id, i) => ({ track: this.trackObj(this.cat.trackById.get(id)), played_at: new Date(this.clock() - i * 3_600_000).toISOString() })) });

    if (path === '/search') {
      const limit = Number(query.limit ?? 5);
      if (limit > 10 || limit < 0) return err(400, 'Invalid limit');
      return ok(this.search(query.q || '', query.type || 'track', limit, off));
    }
    let r;
    if ((r = m(/^\/artists\/([A-Za-z0-9]+)\/albums$/))) {
      const arr = this.cat.albums.filter((al) => al.artistId === r[1]);
      return ok(this.page(arr.map((al) => this.albumObj(al)), off, lim(20)));
    }
    if ((r = m(/^\/artists\/([A-Za-z0-9]+)$/)) && method === 'GET') { const a = this.cat.artistById.get(r[1]); return a ? ok(this.artistObj(a)) : err(404, 'Not found'); }
    if ((r = m(/^\/albums\/([A-Za-z0-9]+)\/tracks$/))) {
      const al = this.cat.albumById.get(r[1]);
      if (!al) return err(404, 'Not found');
      return ok(this.page(al.trackIds.map((id) => this.trackObj(this.cat.trackById.get(id), false)), off, lim(20)));
    }
    if ((r = m(/^\/tracks\/([A-Za-z0-9]+)$/))) { const t = this.cat.trackById.get(r[1]); return t ? ok(this.trackObj(t)) : err(404, 'Not found'); }

    // --- библиотека и плейлисты ---
    if (path === '/me/library' && (method === 'PUT' || method === 'DELETE')) {
      const uris = String(query.uris || '').split(',').filter(Boolean);
      if (!uris.length || uris.length > 40) return err(400, 'Invalid uris');
      for (const u of uris) { const id = u.split(':').pop(); if (method === 'PUT') this.library.add(id); else this.library.delete(id); }
      return { status: 200, json: null, headers: {} };
    }
    if (path === '/me/playlists' && method === 'GET') return ok(this.page(this.playlists.map((p) => ({ id: p.id, name: p.name, collaborative: false, owner: { id: p.owner }, images: [] })), off, lim(20)));
    if (path === '/me/playlists' && method === 'POST') {
      const p = { id: mkId('p', this.playlists.length + 1), name: body?.name || 'Playlist', owner: this.user.id, items: [] };
      this.playlists.push(p);
      return { status: 201, json: { id: p.id, name: p.name }, headers: {} };
    }
    if ((r = m(/^\/playlists\/([A-Za-z0-9]+)\/items$/)) && method === 'POST') {
      const p = this.playlists.find((x) => x.id === r[1]);
      if (!p) return err(404, 'Not found');
      p.items.push(...(body?.uris || []));
      return { status: 201, json: { snapshot_id: 's' + p.items.length }, headers: {} };
    }

    // --- плеер ---
    if (path === '/me/player/devices') return ok({ devices: this.devices.map((d) => ({ id: d.id, name: d.name, type: d.type, is_active: d.id === this.p.deviceId, is_restricted: false })) });
    if (path === '/me/player' && method === 'GET') {
      if (!this.p.current) return { status: 204, json: null, headers: {} };
      return ok({ device: this.deviceState(), is_playing: this.p.playing, progress_ms: Math.floor(this.p.pos), item: this.trackObj(this.p.current), currently_playing_type: 'track' });
    }
    if (path === '/me/player' && method === 'PUT') { const id = body?.device_ids?.[0]; if (!this.devices.find((d) => d.id === id)) return err(404, 'Device not found'); this.p.deviceId = id; if (body.play) this.p.playing = !!this.p.current; return { status: 204, json: null, headers: {} }; }
    if (path.startsWith('/me/player/') && !path.endsWith('/devices') && !path.endsWith('/recently-played') && !path.endsWith('/queue') || (path === '/me/player/queue')) {
      const dev = query.device_id || this.p.deviceId;
      if (!this.devices.find((d) => d.id === dev)) return err(404, 'Player command failed: No active device found', 'NO_ACTIVE_DEVICE');
      if (path === '/me/player/queue' && method === 'GET') {
        const rest = this.p.context.slice(this.p.ctxIdx + 1);
        return ok({ currently_playing: this.p.current ? this.trackObj(this.p.current) : null, queue: [...this.p.queue, ...rest].slice(0, 20).map((id) => this.trackObj(this.cat.trackById.get(id))) });
      }
      this.p.deviceId = dev;
      const none = { status: 204, json: null, headers: {} };
      if (path === '/me/player/play') {
        if (body?.uris?.length) {
          const t = this.cat.trackById.get(String(body.uris[0]).split(':').pop());
          if (!t) return err(404, 'Not found');
          if (this.unplayable.has(t.id)) return err(403, 'Player command failed: Restriction violated', 'UNKNOWN');
          this.p.context = body.uris.map((u) => u.split(':').pop()); this.p.ctxIdx = 0;
          if (this.clearQueueOnPlay) this.p.queue = [];
          this._begin(t, body.position_ms || 0);
        } else this.p.playing = !!this.p.current;
        return none;
      }
      if (path === '/me/player/pause') { this.p.playing = false; return none; }
      if (path === '/me/player/next') { this.goNext(); return none; }
      if (path === '/me/player/previous') { this.p.pos = 0; return none; }
      if (path === '/me/player/seek') { this.p.pos = Math.min(Number(query.position_ms) || 0, this._dur()); return none; }
      if (path === '/me/player/volume') { this.p.volume = Number(query.volume_percent); return none; }
      if (path === '/me/player/queue' && method === 'POST') {
        const t = this.cat.trackById.get(String(query.uri || '').split(':').pop());
        if (!t) return err(400, 'Invalid track uri');
        this.p.queue.push(t.id);
        return none;
      }
    }

    // --- служебные ручки мока для фейкового SDK в e2e ---
    if (path === '/__mock/sdk/connect') { const d = this.reg(body?.name || 'My Wave'); return ok({ device_id: d.id }); }
    if (path === '/__mock/sdk/state') { const s = this.sdkState(query.device_id); return ok(s ?? { none: true }); }
    if (path === '/__mock/sdk/cmd') {
      const c = body?.cmd;
      if (c === 'toggle') this.p.playing = this.p.current ? !this.p.playing : false;
      else if (c === 'pause') this.p.playing = false;
      else if (c === 'resume') this.p.playing = !!this.p.current;
      else if (c === 'seek') this.p.pos = Math.min(body.ms, this._dur());
      else if (c === 'next') this.goNext();
      else if (c === 'prev') this.p.pos = 0;
      return ok({ ok: true });
    }
    return err(404, `Unknown mock route ${method} ${path}`);
  }

  // ---------- управление сценариями ----------
  /** Следующие n запросов (кроме служебных) завершатся 429 QUOTA_EXCEEDED до resetAt. */
  exhaustQuota(forMs = 60_000) { this.quota = { left: 0, resetAt: this.clock() + forMs }; }
  restoreQuota() { this.quota = { left: Infinity, resetAt: 0 }; }
  /** Принудительно продвинуть виртуальное время плеера (для детерминированных тестов). */
  advance(ms) { this.sync(); this.step(ms); }
  count(re) { return this.log.filter((l) => re.test(`${l.method} ${l.path}`)).length; }
}

/** fetch-совместимая обёртка над моком — для юнит-тестов с настоящим createApi. */
export function mockFetch(mock) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v1/, '');
    const query = Object.fromEntries(u.searchParams);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const token = (init.headers?.Authorization || '').replace('Bearer ', '');
    const r = mock.handle({ method: init.method || 'GET', path, query, body, token });
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (k) => r.headers?.[k] ?? r.headers?.[Object.keys(r.headers || {}).find((x) => x.toLowerCase() === k.toLowerCase())] ?? null },
      text: async () => (r.json == null ? '' : JSON.stringify(r.json)),
    };
  };
}
