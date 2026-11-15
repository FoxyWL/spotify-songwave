// Селекторы кандидатов (первая ступень конвейера, как в Моей волне: «треки артистов, которых лайкал»,
// «похожие на последние пять прослушанных» и т.д.). Каждый селектор независим и безопасен к ошибкам API.
import { norm, pick, shuffle, weightedPick, DAY, HOUR } from './util.js';
import { MOODS, WILDCARD_GENRES, INSTRUMENTAL_HINTS } from './settings.js';
import { isKnownArtist, genreAffinity } from './profile.js';

export const makeCandidate = (track, source, genres = [], meta = {}, now = Date.now()) => ({
  id: track.id, track, source, genres: [...new Set(genres.map(norm).filter(Boolean))], meta, addedAt: now,
});

export function createPool() {
  const m = new Map();
  return {
    add(c) { if (m.has(c.track.id)) return false; m.set(c.track.id, c); return true; },
    addMany(cs) { let n = 0; for (const c of cs) if (this.add(c)) n++; return n; },
    remove(c) { m.delete(c.track.id); },
    has: (id) => m.has(id),
    all: () => [...m.values()],
    purge(fn) { for (const [k, c] of m) if (fn(c)) m.delete(k); },
    dropSources(list) { this.purge((c) => list.includes(c.source)); },
    clear() { m.clear(); },
    size: () => m.size,
    counts() { const o = {}; for (const c of m.values()) o[c.source] = (o[c.source] || 0) + 1; return o; },
  };
}

const INSTRUMENTAL_SEEDS = ['ambient', 'classical', 'post-rock', 'piano', 'lo-fi', 'instrumental', 'downtempo', 'new age', 'minimal'];
const OFFSETS = [0, 10, 20, 30, 40];

function genreArtists(p, a) { return p.artists[a.id]?.genres ?? []; }

/** Жанры для поиска: веса профиля + настроение + режим «Без слов». */
export function pickGenres(env, n) {
  const { profile: p, rng, settings } = env;
  const pos = Object.keys(p.genres).map((g) => [g, genreAffinity(p, g)]).filter(([, s]) => s > 0.2);
  const out = [];
  const moodList = settings.mood && MOODS[settings.mood]?.genres;
  for (let i = 0; i < n * 8 && out.length < n; i++) {
    let g;
    if (settings.mode === 'instrumental') {
      const mine = pos.filter(([k]) => INSTRUMENTAL_HINTS.some((h) => k.includes(h)));
      g = rng() < 0.6 && mine.length ? weightedPick(mine, ([, s]) => s, rng)[0] : pick(INSTRUMENTAL_SEEDS, rng);
    } else if (moodList && rng() < 0.5) g = pick(moodList, rng);
    else if (pos.length) g = weightedPick(pos, ([, s]) => s, rng)[0];
    else g = pick(WILDCARD_GENRES, rng);
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

/** Жанры-соседи: часто встречаются у любимых артистов вместе с топ-жанрами, но сами пока слабы. */
export function neighborGenres(p, rng, n = 3) {
  const top = new Set(Object.entries(p.genres).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g));
  const co = {};
  for (const a of Object.values(p.artists)) {
    if (a.score <= 0.3 || a.genres.length < 2) continue;
    for (const g of a.genres) {
      if (!top.has(g)) continue;
      for (const h of a.genres) if (h !== g && !top.has(h) && (p.genres[h] || 0) < 0.8) co[h] = (co[h] || 0) + a.score;
    }
  }
  const list = Object.entries(co);
  const out = [];
  for (let i = 0; i < n * 8 && out.length < n && list.length; i++) {
    const g = weightedPick(list, ([, w]) => w, rng)[0];
    if (!out.includes(g)) out.push(g);
  }
  return out;
}

function yearClause(env) {
  if (env.rng() >= 0.35) return '';
  const thisYear = new Date(env.now()).getFullYear();
  const a = 1980 + Math.floor(env.rng() * (thisYear - 7 - 1980));
  return ` year:${a}-${a + 7}`;
}

async function searchGenre(env, g, source, meta = {}) {
  const q = `genre:"${g}"${yearClause(env)}`;
  const offset = pick(OFFSETS, env.rng);
  let { tracks } = await env.api.search(q, { type: 'track', limit: 10, offset });
  if (!tracks.length && offset > 0) ({ tracks } = await env.api.search(q, { type: 'track', limit: 10, offset: 0 }));
  return tracks.map((t) => makeCandidate(t, source, [g], meta, env.now()));
}

/** Перебирает жанры, пока не наберёт min кандидатов: пустой жанр не должен оставлять источник без треков. */
async function collect(env, genres, source, { min = 8, max = 5, filter = null, meta = {} } = {}) {
  const out = [];
  let used = 0;
  for (let i = 0; i < genres.length && used < max && out.length < min;) {
    const batch = genres.slice(i, i + 2);
    i += batch.length;
    used += batch.length;
    const res = await Promise.all(batch.map((g) => searchGenre(env, g, source, meta).catch((e) => { env.onError?.(e, source); return []; })));
    for (const r of res) for (const c of r) if (!filter || filter(c)) out.push(c);
  }
  return out;
}

/** Граф жанров по данным самого Spotify: у артистов из поиска есть список жанров → соседи по совместной встречаемости. */
async function graphNeighbors(env, g) {
  const cache = (env.meta.genreGraph ||= {});
  if (cache[g]) return cache[g];
  const { artists } = await env.api.search(`genre:"${g}"`, { type: 'artist', limit: 10 });
  const co = {};
  for (const a of artists) for (const h of a.genres) if (h !== g && !h.includes(g) && !g.includes(h)) co[h] = (co[h] || 0) + 1;
  cache[g] = Object.entries(co).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h]) => h);
  return cache[g];
}

const guarded = (env, name, fn) => fn().catch((e) => { env.onError?.(e, name); return []; });

// ---------- селекторы ----------
export const SELECTORS = {
  /** Знакомое: топ, медиатека, недавнее. Запросов к API нет. */
  familiar(env) {
    const lib = env.library;
    if (!lib) return Promise.resolve([]);
    const tops = Object.values(lib.topTracks || {}).flat();
    const all = [...tops, ...shuffle(lib.saved || [], env.rng).slice(0, 60), ...(lib.recent || []).map((r) => r.track)];
    const seen = new Set();
    const out = [];
    for (const t of shuffle(all, env.rng)) {
      if (!t?.id || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(makeCandidate(t, 'familiar', genreArtists(env.profile, t.artists[0] ?? {}), {}, env.now()));
      if (out.length >= 60) break;
    }
    return Promise.resolve(out);
  },

  /** Треки артистов, которых пользователь лайкал/слушает: их альбомы → треки. */
  expand(env) {
    return guarded(env, 'expand', async () => {
      const { profile: p, rng, meta } = env;
      const t0 = env.now();
      const arts = Object.entries(p.artists)
        .filter(([id, a]) => a.score > 0.3 && !p.excludedArtists[id] && t0 - (meta.expandedAt[id] || 0) > 6 * HOUR)
        .map(([id, a]) => ({ id, ...a }));
      const chosen = [];
      for (let i = 0; i < 2 && arts.length; i++) {
        const a = weightedPick(arts, (x) => x.score + 1.5 * x.likes, rng);
        chosen.push(a);
        arts.splice(arts.indexOf(a), 1);
      }
      const out = [];
      await Promise.all(chosen.map(async (a) => {
        meta.expandedAt[a.id] = t0;
        const albums = shuffle(await env.api.artistAlbums(a.id, { limit: 10 }), rng).slice(0, 2);
        for (const al of albums) {
          const tracks = await env.api.albumTracks(al.id, al);
          for (const t of shuffle(tracks, rng).slice(0, 6)) out.push(makeCandidate(t, 'expand', a.genres, {}, env.now()));
        }
      }));
      return out;
    });
  },

  /** «Похожие на последние пять»: жанры недавних прослушиваний — для плавного потока. */
  recent(env) {
    return guarded(env, 'recent', async () => {
      const last = env.profile.history.slice(-5);
      const w = {};
      last.forEach((h, i) => (h.genres || []).forEach((g) => { w[g] = (w[g] || 0) + (i + 1); }));
      const list = Object.entries(w);
      if (!list.length) return [];
      const gs = [];
      for (let i = 0; i < 6 && gs.length < 2; i++) { const g = weightedPick(list, ([, v]) => v, env.rng)[0]; if (!gs.includes(g)) gs.push(g); }
      return collect(env, gs, 'recent', { min: 8, max: 3 });
    });
  },

  genre(env) {
    return guarded(env, 'genre', () => collect(env, pickGenres(env, 6), 'genre', { min: 14, max: 5 }));
  },

  /** Новое: соседние жанры; знакомые артисты отфильтровываются. */
  discovery(env) {
    return guarded(env, 'discovery', async () => {
      const p = env.profile;
      const mine = Object.keys(p.genres).map((g) => [g, genreAffinity(p, g)]).filter(([, s]) => s > 0.2).sort((a, b) => b[1] - a[1]).map(([g]) => g);
      let gs = neighborGenres(p, env.rng, 4);
      if (gs.length < 3) {
        for (const g of mine.slice(0, 2)) {
          const nb = await graphNeighbors(env, g).catch(() => []);
          for (const h of nb) if (!gs.includes(h) && !mine.includes(h)) gs.push(h);
        }
      }
      const top = new Set(mine);
      gs = gs.concat(shuffle(WILDCARD_GENRES.filter((g) => !top.has(g) && !gs.includes(g)), env.rng));
      return collect(env, gs, 'discovery', { min: 10, max: 8, filter: (c) => !isKnownArtist(p.artists[c.track.artists[0]?.id]) });
    });
  },

  wildcard(env) {
    return guarded(env, 'wildcard', async () => {
      const top = new Set(Object.entries(env.profile.genres).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([g]) => g));
      const gs = shuffle(WILDCARD_GENRES.filter((x) => !top.has(x)), env.rng);
      return collect(env, gs, 'wildcard', { min: 6, max: 6 });
    });
  },

  /** Внешний граф похожих артистов (Last.fm). Воспроизведение остаётся в Spotify. */
  similar(env) {
    return guarded(env, 'similar', async () => {
      if (!env.provider) return [];
      const { profile: p, rng, meta } = env;
      const arts = Object.entries(p.artists).filter(([id, a]) => a.score > 0.5 && !p.excludedArtists[id]).map(([id, a]) => ({ id, ...a }));
      const out = [];
      for (let i = 0; i < 2 && arts.length; i++) {
        const seed = weightedPick(arts, (x) => x.score, rng);
        arts.splice(arts.indexOf(seed), 1);
        let names = meta.similar[seed.id];
        if (!names || env.now() - names.at > 7 * DAY) {
          names = { at: env.now(), list: (await env.provider.similarArtists(seed.name, 8)).map((s) => s.name) };
          meta.similar[seed.id] = names;
        }
        for (const nm of shuffle(names.list, rng).slice(0, 3)) {
          const { tracks } = await env.api.search(`artist:"${nm}"`, { type: 'track', limit: 5 });
          for (const t of tracks) {
            if (norm(t.artists[0]?.name) !== norm(nm)) continue;
            out.push(makeCandidate(t, 'similar', seed.genres, { similarTo: seed.name }, env.now()));
          }
        }
      }
      return out;
    });
  },
};

/** Минимальный запас кандидатов на источник: ниже — доливаем. */
export const MIN_STOCK = { familiar: 12, expand: 6, recent: 4, genre: 12, discovery: 8, similar: 4, wildcard: 3 };

/** Запас зависит от ползунка новизны: чем выше, тем больше «нового» держим наготове. */
export const minStock = (src, d = 0.45) => (src === 'discovery' ? Math.round(MIN_STOCK.discovery * (0.5 + 2 * d)) : src === 'wildcard' ? Math.round(MIN_STOCK.wildcard * (0.5 + 2 * d)) : MIN_STOCK[src]);
