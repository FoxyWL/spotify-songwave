// Профиль вкуса: аффинити артистов/жанров, контексты (будни/выходные × время суток), история, исключения.
import { clamp, norm, contextKey, trackKey, DAY } from './util.js';
import { mergeSettings } from './settings.js';

const MIN = -5;
const MAX = 8;
const HALF_LIFE_DAYS = 45;
const MAX_ARTISTS = 700;
const MAX_HISTORY = 300;
const MAX_LOG = 120;

export function createProfile(now = Date.now()) {
  return {
    v: 2, createdAt: now, updatedAt: now, decayedAt: now, seeded: false, counter: 0,
    artists: {}, genres: {}, contexts: {}, tracks: {},
    excludedArtists: {}, excludedTracks: {}, unavailable: {},
    history: [], log: [], ranker: null,
    settings: mergeSettings(),
  };
}

export function migrateProfile(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return createProfile(now);
  const base = createProfile(now);
  const p = { ...base, ...raw, settings: mergeSettings(raw.settings) };
  for (const k of ['artists', 'genres', 'contexts', 'tracks', 'excludedArtists', 'excludedTracks', 'unavailable']) {
    p[k] = raw[k] && typeof raw[k] === 'object' ? raw[k] : {};
  }
  p.history = Array.isArray(raw.history) ? raw.history : [];
  p.log = Array.isArray(raw.log) ? raw.log : [];
  p.counter = Number(raw.counter) || 0;
  return p;
}

export function ensureArtist(p, a, genres = []) {
  if (!a?.id) return null;
  const e = (p.artists[a.id] ||= { name: a.name, score: 0, plays: 0, likes: 0, dislikes: 0, skips: 0, completes: 0, lastPlayed: 0, lastIdx: -1e9, genres: [], known: false });
  if (a.name) e.name = a.name;
  for (const g of genres) {
    const n = norm(g);
    if (n && !e.genres.includes(n) && e.genres.length < 8) e.genres.push(n);
  }
  return e;
}

export function addGenre(p, g, delta, ctxKey) {
  const n = norm(g);
  if (!n || !delta) return;
  p.genres[n] = clamp((p.genres[n] || 0) + delta, MIN, MAX);
  if (ctxKey) {
    const c = (p.contexts[ctxKey] ||= {});
    c[n] = clamp((c[n] || 0) + delta, MIN, MAX);
  }
}

export function applyDecay(p, now = Date.now()) {
  const days = (now - p.decayedAt) / DAY;
  if (days < 0.25) return p;
  const f = 0.5 ** (days / HALF_LIFE_DAYS);
  for (const [id, a] of Object.entries(p.artists)) {
    a.score *= f;
    if (Math.abs(a.score) < 0.05 && !a.plays && !a.known) delete p.artists[id];
  }
  for (const [g, v] of Object.entries(p.genres)) { p.genres[g] = v * f; if (Math.abs(p.genres[g]) < 0.03) delete p.genres[g]; }
  for (const c of Object.values(p.contexts)) for (const [g, v] of Object.entries(c)) { c[g] = v * f; if (Math.abs(c[g]) < 0.03) delete c[g]; }
  p.decayedAt = now;
  return p;
}

function prune(p) {
  const ids = Object.keys(p.artists);
  if (ids.length <= MAX_ARTISTS) return;
  ids.sort((a, b) => Math.abs(p.artists[a].score) + p.artists[a].plays - (Math.abs(p.artists[b].score) + p.artists[b].plays));
  for (const id of ids.slice(0, ids.length - MAX_ARTISTS)) if (!p.excludedArtists[id]) delete p.artists[id];
}

// ---------- стартовое обучение по библиотеке Spotify ----------
const RANGE_W = { short_term: 1.0, medium_term: 0.8, long_term: 0.6 };
const rankW = (i, n) => 0.4 + 1.2 * (1 - i / Math.max(1, n));
const gShare = (n) => 1 / Math.sqrt(Math.max(1, n));

export function applySeed(p, lib, now = Date.now()) {
  for (const [range, list] of Object.entries(lib.topArtists || {})) {
    const rw = RANGE_W[range] ?? 0.6;
    list.forEach((a, i) => {
      const e = ensureArtist(p, a, a.genres);
      if (!e) return;
      const d = rw * rankW(i, list.length);
      e.score = clamp(e.score + d, MIN, MAX);
      e.known = true;
      (a.genres || []).forEach((g) => addGenre(p, g, d * 0.5 * gShare(a.genres.length)));
    });
  }
  for (const [range, list] of Object.entries(lib.topTracks || {})) {
    const rw = RANGE_W[range] ?? 0.6;
    list.forEach((t, i) => {
      const d = 0.15 * rw * rankW(i, list.length);
      (t.artists || []).forEach((a, j) => {
        const e = ensureArtist(p, a);
        if (!e) return;
        e.score = clamp(e.score + (j ? 0.5 : 1) * d, MIN, MAX);
        e.known = true;
      });
    });
  }
  const perArtist = {};
  for (const t of lib.saved || []) {
    const a = t.artists?.[0];
    const e = ensureArtist(p, a);
    if (!e) continue;
    perArtist[a.id] = (perArtist[a.id] || 0) + 1;
    if (perArtist[a.id] <= 12) e.score = clamp(e.score + 0.12, MIN, MAX);
    e.known = true;
  }
  for (const a of lib.followed || []) {
    const e = ensureArtist(p, a, a.genres);
    if (!e) continue;
    e.score = clamp(e.score + 0.6, MIN, MAX);
    e.known = true;
    (a.genres || []).forEach((g) => addGenre(p, g, 0.3 * gShare(a.genres.length)));
  }
  for (const r of lib.recent || []) {
    const e = ensureArtist(p, r.track?.artists?.[0]);
    if (!e) continue;
    e.score = clamp(e.score + 0.08, MIN, MAX);
    e.known = true;
    const ck = contextKey(r.playedAt ? Date.parse(r.playedAt) : now);
    e.genres.forEach((g) => addGenre(p, g, 0.12 * gShare(e.genres.length), ck));
  }
  p.seeded = true;
  p.updatedAt = now;
  prune(p);
  return p;
}

/** Холодный старт как у Яндекса: пользователь называет жанры (и артистов) при знакомстве. */
export function applyOnboarding(p, { genres = [], artists = [] } = {}) {
  for (const g of genres) addGenre(p, g, 1.5);
  for (const a of artists) {
    const e = ensureArtist(p, a, a.genres);
    if (!e) continue;
    e.score = clamp(e.score + 1.5, MIN, MAX);
    e.known = true;
    (a.genres || []).forEach((g) => addGenre(p, g, 0.6 * gShare(a.genres.length)));
  }
  p.seeded = true;
  return p;
}

// ---------- обратная связь ----------
// a — артист, g — жанры, c — контекст. Пропуск трактуем мягче дизлайка: он может значить «не сейчас», а не «не люблю»
// (в Яндексе так же: пропуск — не обязательно нелюбовь). Поэтому глобально он слабый, а в текущем контексте сильнее.
export const EFFECT = {
  complete: { a: 0.2, g: 0.12, c: 0.2 },
  skipEarly: { a: -0.2, g: -0.12, c: -0.3 },
  skipLate: { a: -0.08, g: -0.05, c: -0.15 },
  like: { a: 1.0, g: 0.6, c: 0.5 },
  unlike: { a: -1.0, g: -0.6, c: -0.5 },
  dislike: { a: -1.5, g: -0.9, c: -0.6 },
  replay: { a: 0.4, g: 0.25, c: 0.3 },
  more: { a: 0.6, g: 0.9, c: 0.3 },
  less: { a: -0.6, g: -0.9, c: -0.3 },
  excludeArtist: { a: -1.0, g: -0.3, c: 0 },
  excludeTrack: { a: -0.2, g: -0.1, c: 0 },
};

const isEarlySkip = (ev) => ev.playedMs < 30_000 || (ev.durationMs > 0 && ev.playedMs / ev.durationMs < 0.15);

/** ev: { type, track, genres?, playedMs?, durationMs? }. Возвращает { novel } для события 'play'. */
export function applyFeedback(p, ev, now = Date.now()) {
  const t = ev.track;
  const out = { novel: false };
  if (!t?.id) return p && out;
  const primary = t.artists?.[0];
  const prim = primary ? ensureArtist(p, primary) : null;
  const genres = (ev.genres?.length ? ev.genres : prim?.genres) || [];
  if (prim && ev.genres?.length && !prim.genres.length) ensureArtist(p, primary, ev.genres);
  const rec = (p.tracks[t.id] ||= { plays: 0, completes: 0, skips: 0, replays: 0, liked: false, disliked: false, lastPlayed: 0 });
  const ck = contextKey(now);
  let eff = null;

  switch (ev.type) {
    case 'play': {
      out.novel = !(prim && (prim.known || prim.plays > 0 || prim.score > 0.3));
      p.counter++;
      rec.plays++;
      rec.lastPlayed = now;
      for (const a of t.artists || []) {
        const e = ensureArtist(p, a);
        if (!e) continue;
        e.plays++;
        e.lastPlayed = now;
        e.lastIdx = p.counter;
      }
      p.history.push({ trackId: t.id, key: trackKey(t), artistIds: (t.artists || []).map((a) => a.id), albumId: t.album?.id ?? null, genres: [...genres], at: now, src: ev.source ?? null, novel: out.novel });
      if (p.history.length > MAX_HISTORY) p.history.splice(0, p.history.length - MAX_HISTORY);
      break;
    }
    case 'complete': rec.completes++; if (prim) prim.completes++; eff = EFFECT.complete; break;
    case 'skip': {
      rec.skips++;
      if (prim) prim.skips++;
      eff = isEarlySkip(ev) ? EFFECT.skipEarly : EFFECT.skipLate;
      break;
    }
    case 'like': if (!rec.liked) { rec.liked = true; rec.disliked = false; if (prim) prim.likes++; eff = EFFECT.like; } break;
    case 'unlike': if (rec.liked) { rec.liked = false; if (prim) prim.likes = Math.max(0, prim.likes - 1); eff = EFFECT.unlike; } break;
    case 'dislike': rec.disliked = true; rec.liked = false; if (prim) prim.dislikes++; p.excludedTracks[t.id] = true; eff = EFFECT.dislike; break;
    case 'replay': rec.replays++; eff = EFFECT.replay; break;
    case 'more': eff = EFFECT.more; break;
    case 'less': eff = EFFECT.less; break;
    case 'excludeArtist': if (primary) p.excludedArtists[primary.id] = primary.name; eff = EFFECT.excludeArtist; break;
    case 'excludeTrack': p.excludedTracks[t.id] = true; eff = EFFECT.excludeTrack; break;
    default: break;
  }

  // статистика исходов по жанру: частые ранние пропуски в жанре перевешивают старый накопленный вкус
  if (['complete', 'skip', 'like', 'dislike'].includes(ev.type)) {
    const gs = (p.genreStats ||= {});
    const bad = ev.type === 'dislike' || (ev.type === 'skip' && isEarlySkip(ev));
    for (const g of genres) {
      const n = norm(g);
      if (!n) continue;
      const e = (gs[n] ||= { n: 0, bad: 0 });
      e.n = e.n * 0.97 + 1;
      e.bad = e.bad * 0.97 + (bad ? 1 : 0);
    }
  }

  if (eff) {
    (t.artists || []).forEach((a, i) => {
      const e = ensureArtist(p, a);
      if (e) e.score = clamp(e.score + eff.a * (i ? 0.5 : 1), MIN, MAX);
    });
    const share = gShare(genres.length);
    for (const g of genres) addGenre(p, g, eff.g * share, null);
    // контекстный сигнал — отдельно, чтобы он не удваивал глобальный
    for (const g of genres) {
      const n = norm(g);
      if (!n) continue;
      const c = (p.contexts[ck] ||= {});
      c[n] = clamp((c[n] || 0) + eff.c * share, MIN, MAX);
    }
  }
  if (ev.type !== 'play') {
    p.log.push({ at: now, type: ev.type, trackId: t.id, name: t.name, artist: primary?.name ?? '' });
    if (p.log.length > MAX_LOG) p.log.splice(0, p.log.length - MAX_LOG);
  }
  p.updatedAt = now;
  prune(p);
  return out;
}

// ---------- чтение профиля ----------
export function topGenres(p, n = 10, ck = null) {
  const ctx = (ck && p.contexts[ck]) || {};
  return Object.entries(p.genres)
    .map(([name, s]) => ({ name, score: s + 0.5 * (ctx[name] || 0) }))
    .filter((g) => g.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

export function topArtists(p, n = 10) {
  return Object.entries(p.artists)
    .map(([id, a]) => ({ id, name: a.name, score: a.score, plays: a.plays, likes: a.likes }))
    .filter((a) => a.score > 0.1 && !p.excludedArtists[a.id])
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

export const isKnownArtist = (e) => !!e && (e.known || e.plays > 0 || e.score > 0.3);

export function hasTaste(p) {
  return Object.values(p.artists).some((a) => a.score > 0.3) || Object.values(p.genres).some((v) => v > 0.5);
}

export function resetProfile(p, { keepSettings = true, keepExclusions = false, now = Date.now() } = {}) {
  const fresh = createProfile(now);
  if (keepSettings) fresh.settings = p.settings;
  if (keepExclusions) { fresh.excludedArtists = p.excludedArtists; fresh.excludedTracks = p.excludedTracks; }
  return fresh;
}

/** Вкус к жанру с поправкой на недавние исходы: если жанр почти всегда пропускают, старый накопленный балл не спасает. */
export function genreAffinity(p, g) {
  const base = p.genres[g] || 0;
  const e = p.genreStats?.[g];
  if (!e || e.n < 3) return base;
  const rate = e.bad / e.n;
  return base - 4 * Math.max(0, rate - 0.4) * Math.min(1, e.n / 6);
}
