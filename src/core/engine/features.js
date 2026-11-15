// Признаки для ранжирования. В Яндексе их ~2000 (CatBoost); у нас — компактный набор, который реально
// можно посчитать на данных, доступных в Spotify Development Mode (нет popularity, audio features, recommendations).
import { contextKey } from './util.js';
import { MOODS, INSTRUMENTAL_HINTS } from './settings.js';
import { isKnownArtist, genreAffinity } from './profile.js';

export const SOURCES = ['familiar', 'expand', 'recent', 'genre', 'discovery', 'similar', 'wildcard'];

export const FEATURES = [
  'artist', 'genre', 'track', 'novelty', 'familiarity', 'recency', 'context', 'mood', 'continuity',
  'likedArtist', 'skipRate', 'instrumental',
  ...SOURCES.map((s) => `src_${s}`),
];

export const effectiveDiscovery = (s) => (s.mode === 'favorite' ? 0.05 : s.mode === 'unfamiliar' ? 0.95 : s.discovery);

export function buildContext(p, settings, now, extra = {}) {
  const last5 = p.history.slice(-5);
  return {
    now,
    ctxKey: contextKey(now),
    counter: p.counter,
    settings,
    mode: settings.mode,
    d: effectiveDiscovery(settings),
    recentGenres: new Set(last5.flatMap((h) => h.genres || [])),
    libraryIds: extra.libraryIds ?? null,
    // «зрелость» вкуса: пока артистов почти нет (холодный старт), опираемся на заявленные жанры
    maturity: Math.min(1, Object.values(p.artists).filter(isKnownArtist).length / 10),
  };
}

const tanh = Math.tanh;
const mean = (arr, f) => (arr.length ? arr.reduce((a, v) => a + f(v), 0) / arr.length : 0);

export function instrumentalScore(c) {
  if ((c.genres || []).some((g) => INSTRUMENTAL_HINTS.some((k) => g.includes(k)))) return 1;
  return /instrumental|\(inst\.?\)|\bscore\b/i.test(c.track.name || '') ? 1 : 0;
}

/** Возвращает вектор признаков в порядке FEATURES и именованные значения (для объяснений). */
export function extractFeatures(c, p, ctx) {
  const t = c.track;
  const gs = c.genres || [];
  const ea = p.artists[t.artists[0]?.id];
  const others = t.artists.slice(1).map((a) => p.artists[a.id]).filter(Boolean);
  const aScore = Math.max(ea ? ea.score : -Infinity, others.length ? Math.max(...others.map((o) => o.score)) * 0.5 : -Infinity);
  const tr = p.tracks[t.id];
  const known = isKnownArtist(ea);
  const cg = p.contexts[ctx.ctxKey] || {};
  const mood = ctx.settings.mood ? MOODS[ctx.settings.mood] : null;

  const v = {
    artist: Number.isFinite(aScore) ? tanh(aScore / 2.5) : 0,
    genre: mean(gs, (g) => tanh(genreAffinity(p, g) / 3)),
    track: tr ? (tr.liked ? 1 : Math.min(tr.completes, 3) * 0.1 - Math.min(tr.skips, 3) * 0.2) : 0,
    novelty: (known ? 0 : 1) * (2 * ctx.d - 1),
    familiarity: ea ? Math.log1p(ea.plays) / 3 : 0,
    recency: ea && ea.plays > 0 ? Math.exp(-(ctx.counter - ea.lastIdx) / Math.max(1, ctx.settings.artistCooldown)) : 0,
    context: mean(gs, (g) => tanh((cg[g] || 0) / 2)),
    mood: mood && gs.some((g) => mood.genres.some((m) => g.includes(m))) ? 1 : 0,
    continuity: gs.length ? gs.filter((g) => ctx.recentGenres.has(g)).length / gs.length : 0,
    likedArtist: ea?.likes > 0 ? 1 : 0,
    skipRate: ea ? Math.min(1, (ea.skips + 2 * ea.dislikes) / (ea.plays + 2)) : 0,
    instrumental: ctx.mode === 'instrumental' ? instrumentalScore(c) : 0,
  };
  for (const s of SOURCES) v[`src_${s}`] = c.source === s ? 1 : 0;
  return { x: FEATURES.map((f) => v[f]), values: v, known };
}

/** Короткие причины для интерфейса («почему этот трек»). */
export function explain(c, values, contribs, p) {
  const out = [];
  const name = c.track.artists[0]?.name;
  const best = Object.entries(contribs).filter(([k, v]) => v > 0.12 && !k.startsWith('src_')).sort((a, b) => b[1] - a[1]);
  const g = (c.genres || [])[0];
  for (const [k] of best) {
    if (out.length >= 2) break;
    if (k === 'track' && values.track >= 1) out.push('Ты уже лайкал этот трек');
    else if (k === 'likedArtist') out.push(`Тебе нравится ${name}`);
    else if (k === 'artist' && values.artist > 0.2) out.push(`Ты часто слушаешь ${name}`);
    else if (k === 'genre' && g) out.push(`Твой жанр: ${g}`);
    else if (k === 'novelty') out.push('Новый артист для тебя');
    else if (k === 'context') out.push('Подходит под это время');
    else if (k === 'mood') out.push(`Под настроение «${MOODS[p.settings.mood]?.label ?? ''}»`);
    else if (k === 'continuity') out.push('Продолжает предыдущие треки');
    else if (k === 'instrumental') out.push('Без слов');
  }
  if (out.length < 2) {
    if (c.source === 'wildcard') out.push('Неожиданный выбор');
    else if (c.source === 'similar' && c.meta?.similarTo) out.push(`Похоже на ${c.meta.similarTo}`);
    else if (c.source === 'expand') out.push(`Ещё от ${name}`);
    else if (c.source === 'discovery' && g) out.push(`Рядом с твоим вкусом: ${g}`);
  }
  if (!out.length) {
    if (c.source === 'familiar') out.push('Из твоей музыки');
    else if (c.source === 'recent') out.push('Продолжает предыдущие треки');
    else if (c.source === 'genre' && g) out.push(`Твой жанр: ${g}`);
    else if (c.source === 'discovery') out.push('Рядом с твоим вкусом');
    else out.push(`Подобрано для тебя`);
  }
  return [...new Set(out)].slice(0, 2);
}
