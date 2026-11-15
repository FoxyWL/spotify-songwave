// Вторая и третья ступени: фильтры (как в Яндексе: артист не повторяется 25 треков, «Незнакомое» отбрасывает знакомое)
// и ранжирование «формулой» с диверсификацией.
import { DAY, HOUR, trackKey } from './util.js';
import { extractFeatures, instrumentalScore, FEATURES } from './features.js';
import { isKnownArtist } from './profile.js';

const SRC_PRIOR = 0.9;

export function isEligible(c, p, ctx) {
  const t = c.track;
  if (!t?.id || t.playable === false) return false;
  if (p.excludedTracks[t.id]) return false;
  if (p.unavailable[t.id] && ctx.now - p.unavailable[t.id] < 30 * DAY) return false;
  if (t.artists.some((a) => p.excludedArtists[a.id])) return false;
  if (!ctx.settings.allowExplicit && t.explicit) return false;
  const rec = p.tracks[t.id];
  if (rec?.lastPlayed && ctx.now - rec.lastPlayed < (rec.liked ? 48 * HOUR : 14 * DAY)) return false;
  const key = trackKey(t);
  if (p.history.slice(-60).some((h) => h.key === key)) return false;
  const ea = p.artists[t.artists[0]?.id];
  if (ctx.mode === 'unfamiliar') {
    // v1-фильтр «Незнакомого» из статьи Яндекса: без слышанных треков и артистов, которых слушали больше 5 раз
    if (rec?.plays || ctx.libraryIds?.has(t.id) || (ea && ea.plays > 5)) return false;
  }
  if (ctx.mode === 'favorite' && !isKnownArtist(ea)) return false;
  if (ctx.mode === 'instrumental' && instrumentalScore(c) < 1) return false;
  return true;
}

export function sourceTargets(mode, d, m = 1, mood = null) {
  const t = baseTargets(mode, d, m);
  if (!mood) return t;
  // активность/настроение: источник жанров (под настроение) главный, привычное уходит на второй план
  return { ...t, genre: t.genre * 3, discovery: t.discovery * 1.5, familiar: t.familiar * 0.5, expand: t.expand * 0.5, recent: t.recent * 0.5 };
}

function baseTargets(mode, d, m) {
  switch (mode) {
    case 'favorite': return { familiar: 0.5, expand: 0.25, recent: 0.1, genre: 0.12, similar: 0.03, discovery: 0, wildcard: 0 };
    case 'unfamiliar': return { familiar: 0, expand: 0.08, recent: 0.12, genre: 0.25, similar: 0.2, discovery: 0.25, wildcard: 0.1 };
    case 'instrumental': return { familiar: 0.2, expand: 0.1, recent: 0.1, genre: 0.4, similar: 0.05, discovery: 0.15, wildcard: 0 };
    default: return {
      familiar: (0.45 * (1 - d) ** 1.5 + 0.015) * m, expand: 0.16 * m, recent: 0.12 * m, genre: 0.18 * (1 + 2 * (1 - m)),
      similar: 0.02 + 0.1 * d, discovery: (0.01 + 0.7 * d * d) * (0.3 + 0.7 * m), wildcard: (0.002 + 0.12 * d * d) * m,
    };
  }
}

/** Оценка кандидатов формулой: score = w·x. contribs нужны для объяснений «почему этот трек». */
export function rankCandidates(cands, p, ctx, ranker, rng, noise = 0.15) {
  const w = ranker.weights(ctx.mode);
  return cands.map((c) => {
    const f = extractFeatures(c, p, ctx);
    const contribs = {};
    let s = 0;
    f.x.forEach((v, i) => { contribs[FEATURES[i]] = w[i] * v; s += w[i] * v; });
    return { c, x: f.x, values: f.values, contribs, score: s + rng() * noise };
  });
}

/**
 * Выбор n треков подряд. extraRecent — уже запланированные, но ещё не сыгранные треки (для диверсификации).
 * Окно артиста = settings.artistCooldown (25), при нехватке кандидатов окно ужимается ступенями.
 */
export function pickBatch(cands, n, p, ctx, ranker, rng, { extraRecent = [] } = {}) {
  const scored = rankCandidates(cands, p, ctx, ranker, rng);
  const bySource = new Map();
  for (const s of scored) { if (!bySource.has(s.c.source)) bySource.set(s.c.source, []); bySource.get(s.c.source).push(s); }
  const targets = sourceTargets(ctx.mode, ctx.d, ctx.maturity ?? 1, ctx.settings.mood);
  const K = ctx.settings.artistCooldown;
  const recent = [
    ...p.history.slice(-K).map((h) => ({ artists: h.artistIds, album: h.albumId, genres: h.genres })),
    ...extraRecent,
  ];
  const perArtist = new Map();
  const picked = [];

  for (let i = 0; i < n; i++) {
    let av = new Map();
    let window = new Set();
    for (const w of [K, 12, 6, 3, 0]) {
      window = new Set((w ? recent.slice(-w) : []).flatMap((h) => h.artists));
      const lastAlbum = recent.at(-1)?.album;
      av = new Map();
      for (const [src, list] of bySource) {
        const ok = list.filter((s) => !s.used
          && !s.c.track.artists.some((a) => window.has(a.id))
          && (w === 0 || (s.c.track.album.id !== lastAlbum && (perArtist.get(s.c.track.artists[0]?.id) || 0) < 2)));
        if (ok.length) av.set(src, ok);
      }
      if (av.size) break;
    }
    if (!av.size) break;
    // Все доступные кандидаты ранжируются вместе (как в Яндексе), а доли источников — мягкий приор в логарифмической шкале:
    // так обученная формула реально влияет на выбор, а ползунок новизны сдвигает состав, не ломая ранжирование.
    const genreCount = {};
    for (const h of recent.slice(-5)) for (const g of h.genres || []) genreCount[g] = (genreCount[g] || 0) + 1;
    const adj = (s) => s.score
      + SRC_PRIOR * Math.log((targets[s.c.source] ?? 0.03) + 0.02)
      - 0.25 * ((s.c.genres || []).reduce((a, g) => a + (genreCount[g] || 0), 0) / Math.max(1, (s.c.genres || []).length));
    const list = [...av.values()].flat().sort((a, b) => adj(b) - adj(a));
    const choice = rng() < ctx.settings.exploration ? list[Math.floor(rng() * Math.min(8, list.length))] : list[0];
    choice.used = true;
    picked.push(choice);
    recent.push({ artists: choice.c.track.artists.map((a) => a.id), album: choice.c.track.album.id, genres: choice.c.genres || [] });
    const a0 = choice.c.track.artists[0]?.id;
    perArtist.set(a0, (perArtist.get(a0) || 0) + 1);
  }
  return picked;
}
