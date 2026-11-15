// Движок подборок «Моя волна». Конвейер повторяет схему Яндекса:
//   селекторы кандидатов → фильтры → ранжирование формулой (pairwise-обучение на событиях) → диверсификация.
// После каждого отзыва профиль и формула обновляются; план треков пересобирается без сетевых запросов.
import {
  migrateProfile, applyDecay, applySeed, applyOnboarding, applyFeedback, topGenres, topArtists, hasTaste,
  resetProfile, ensureArtist, isKnownArtist,
} from './profile.js';
import { createPool, SELECTORS, MIN_STOCK, minStock } from './candidates.js';
import { buildContext, explain, FEATURES } from './features.js';
import { createRanker, gradesFor } from './ranker.js';
import { pickBatch, isEligible } from './selector.js';
import { mergeSettings } from './settings.js';
import { contextKey, DAY, norm } from './util.js';

const LIB_TTL = DAY;

export function createEngine({ api, store, rng = Math.random, now = () => Date.now(), providerFactory = null } = {}) {
  let profile = migrateProfile(store.load('profile'), now());
  let library = store.load('library');
  const meta = store.load('meta') || { expandedAt: {}, similar: {} };
  meta.expandedAt ||= {};
  meta.similar ||= {};
  let ranker = createRanker(profile.ranker);
  profile.ranker = ranker.state;
  let libraryIds = idsOf(library);
  const pool = createPool();
  const impressions = new Map(); // trackId → { x, mode, source }
  const closed = [];
  let open = null;
  let refillPromise = null;
  let needForce = false;
  const lastTry = {};
  let lastWarn = 0;
  const subs = new Set();

  const emit = (e) => subs.forEach((f) => { try { f(e); } catch { /* ignore */ } });
  const on = (f) => { subs.add(f); return () => subs.delete(f); };
  const save = () => { store.save('profile', profile); store.save('meta', meta); };
  const ctxNow = () => buildContext(profile, profile.settings, now(), { libraryIds });

  function idsOf(lib) {
    if (!lib) return null;
    const s = new Set();
    Object.values(lib.topTracks || {}).flat().forEach((t) => s.add(t.id));
    (lib.saved || []).forEach((t) => s.add(t.id));
    (lib.recent || []).forEach((r) => s.add(r.track.id));
    return s;
  }

  // ---------- библиотека и посев ----------
  async function loadLibrary({ onProgress } = {}) {
    const calls = [
      ['Топ артистов (месяц)', () => api.topArtists('short_term'), 'topArtists', 'short_term'],
      ['Топ артистов (полгода)', () => api.topArtists('medium_term'), 'topArtists', 'medium_term'],
      ['Топ артистов (всё время)', () => api.topArtists('long_term'), 'topArtists', 'long_term'],
      ['Топ треков (месяц)', () => api.topTracks('short_term'), 'topTracks', 'short_term'],
      ['Топ треков (полгода)', () => api.topTracks('medium_term'), 'topTracks', 'medium_term'],
      ['Топ треков (всё время)', () => api.topTracks('long_term'), 'topTracks', 'long_term'],
      ['Любимые треки', () => api.savedTracks({ limit: 50, offset: 0 }), 'saved'],
      ['Любимые треки', () => api.savedTracks({ limit: 50, offset: 50 }), 'saved'],
      ['Любимые треки', () => api.savedTracks({ limit: 50, offset: 100 }), 'saved'],
      ['Любимые треки', () => api.savedTracks({ limit: 50, offset: 150 }), 'saved'],
      ['Подписки', () => api.followedArtists(), 'followed'],
      ['Недавнее', () => api.recentlyPlayed(), 'recent'],
    ];
    let done = 0;
    const res = await Promise.all(calls.map(async ([label, fn, key, sub]) => {
      try { return { key, sub, value: await fn() }; } catch (error) { return { key, sub, error }; } finally { onProgress?.({ done: ++done, total: calls.length, label }); }
    }));
    const lib = { ts: now(), topArtists: {}, topTracks: {}, saved: [], followed: [], recent: [] };
    for (const r of res) {
      if (r.error) continue;
      if (r.sub) lib[r.key][r.sub] = r.value;
      else if (r.key === 'saved') lib.saved.push(...r.value);
      else lib[r.key] = r.value;
    }
    const failed = res.filter((r) => r.error);
    if (failed.length === res.length) throw failed[0].error;
    lib.errors = failed.length;
    return lib;
  }

  async function ensureSeeded({ onProgress } = {}) {
    if (!profile.seeded || !library) {
      library = await loadLibrary({ onProgress });
      store.save('library', library);
      libraryIds = idsOf(library);
      if (!profile.seeded) applySeed(profile, library, now());
      save();
      emit({ type: 'profile' });
    } else if (now() - (library.ts || 0) > LIB_TTL) {
      loadLibrary().then((lib) => { library = lib; store.save('library', lib); libraryIds = idsOf(lib); }).catch(() => {});
    }
    return hasTaste(profile);
  }

  function onboard(sel) {
    applyOnboarding(profile, sel);
    save();
    emit({ type: 'profile' });
  }

  // ---------- пополнение пула ----------
  async function refill({ force = false } = {}) {
    if (refillPromise) return refillPromise;
    refillPromise = (async () => {
      const counts = pool.counts();
      const errors = [];
      const env = {
        api, profile, library, rng, now, settings: profile.settings, meta,
        provider: profile.settings.similarProvider === 'lastfm' && profile.settings.lastfmKey && providerFactory
          ? providerFactory({ apiKey: profile.settings.lastfmKey }) : null,
        onError: (e, name) => errors.push({ e, name }),
      };
      const jobs = [];
      const names = [];
      for (const src of Object.keys(MIN_STOCK)) {
        const min = minStock(src, ctxNow().d);
        if (src === 'similar' && !env.provider) continue;
        const lt = lastTry[src];
        const cooling = lt && now() - lt.at < 20_000 && lt.added < 3; // источник ничего не дал — не долбим API
        if (force || ((counts[src] || 0) < min && !cooling)) { jobs.push(SELECTORS[src](env)); names.push(src); }
      }
      const lists = await Promise.all(jobs);
      const ctx = ctxNow();
      let added = 0;
      lists.forEach((l, i) => {
        const n = pool.addMany(l.filter((c) => isEligible(c, profile, ctx)));
        lastTry[names[i]] = { at: now(), added: n };
        added += n;
      });
      store.save('meta', meta);
      if (errors.length && now() - lastWarn > 20_000) {
        lastWarn = now();
        emit({ type: 'warn', error: errors[0].e, source: errors[0].name, added });
      }
      return added;
    })().finally(() => { refillPromise = null; });
    return refillPromise;
  }

  // ---------- выдача ----------
  function toRec(pk, ctx) {
    const { c } = pk;
    impressions.set(c.track.id, { x: pk.x, mode: ctx.mode, source: c.source });
    if (impressions.size > 300) impressions.delete(impressions.keys().next().value);
    return { track: c.track, source: c.source, genres: c.genres, score: pk.score, why: explain(c, pk.values, pk.contribs, profile), _c: c };
  }

  /** Жанры в треках поиска не приходят (только у артистов), поэтому для выбранных треков уточняем их по артисту: 1 кэшируемый GET на трек. */
  async function enrich(recs) {
    await Promise.all(recs.map(async (r) => {
      const id = r.track.artists[0]?.id;
      if (!id || profile.artists[id]?.genres?.length) { if (id && profile.artists[id]?.genres?.length) r.genres = [...new Set([...profile.artists[id].genres, ...r.genres])].slice(0, 4); return; }
      try {
        const a = await api.artist(id);
        if (a?.genres?.length) r.genres = [...new Set([...a.genres.map(norm), ...r.genres])].slice(0, 4);
      } catch { /* жанры — улучшение, не необходимость */ }
    }));
    return recs;
  }

  function select(n, extraRecent) {
    const ctx = ctxNow();
    const eligible = pool.all().filter((c) => isEligible(c, profile, ctx));
    const picks = pickBatch(eligible, n, profile, ctx, ranker, rng, { extraRecent });
    return picks.map((pk) => { pool.remove(pk.c); return toRec(pk, ctx); });
  }

  /** after — уже запланированные записи (текущий, очередь, резерв): учитываем их в диверсификации. */
  async function next(n = 1, { after = [] } = {}) {
    const extra = after.filter(Boolean).map((r) => ({ artists: r.track.artists.map((a) => a.id), album: r.track.album.id, genres: r.genres || [] }));
    if (pool.size() < n + 8 || needForce || starving()) { const f = needForce; needForce = false; await refill({ force: f }); }
    let picks = select(n, extra);
    if (picks.length < n) {
      await refill({ force: true });
      picks = picks.concat(select(n - picks.length, extra.concat(picks.map((r) => ({ artists: r.track.artists.map((a) => a.id), album: r.track.album.id, genres: r.genres })))));
    }
    if (!picks.length) throw Object.assign(new Error('Не нашёл подходящих треков'), { code: 'NO_CANDIDATES' });
    return enrich(picks);
  }

  /** Какой-то источник опустел ниже половины запаса — пора доливать именно его (а не ждать пустого пула). */
  function starving() {
    const c = pool.counts();
    const d = ctxNow().d;
    return Object.keys(MIN_STOCK).some((src) => {
      if (src === 'similar' || (src === 'familiar' && !library)) return false;
      return (c[src] || 0) < Math.ceil(minStock(src, d) / 2);
    });
  }

  const release = (recs) => { for (const r of recs || []) if (r?._c && !profile.excludedTracks[r.track.id]) pool.add(r._c); };

  // ---------- обратная связь и обучение формулы ----------
  function closeOpen() {
    if (!open || !open.grade) { open = null; return; }
    const G = gradesFor(open.mode);
    const g = G[open.grade];
    for (const prev of closed.slice(-2)) {
      if (prev.mode !== open.mode) continue;
      const gp = G[prev.grade];
      const gap = Math.abs(g - gp);
      if (gap < 0.3) continue; // пары одинаковых исходов не обучают (как в Яндексе: Play–Play не берём)
      const [hi, lo] = g > gp ? [open, prev] : [prev, open];
      ranker.update(open.mode, hi.x, lo.x, gap);
    }
    closed.push(open);
    if (closed.length > 6) closed.shift();
    open = null;
  }

  function feedback(ev) {
    const t = ev.track;
    if (!t) return;
    const info = applyFeedback(profile, ev, now());
    const mine = open && open.id === t.id;
    switch (ev.type) {
      case 'play': {
        closeOpen();
        const imp = impressions.get(t.id);
        open = imp ? { id: t.id, ...imp, grade: null, novel: info.novel } : null;
        break;
      }
      case 'like': case 'replay': if (mine && open.grade !== 'dislike') open.grade = 'like'; break;
      case 'unlike': if (mine && open.grade === 'like') open.grade = 'play'; break;
      case 'dislike': case 'excludeArtist': case 'excludeTrack': if (mine) open.grade = 'dislike'; break;
      case 'skip': if (mine && !open.grade) open.grade = 'skip'; break;
      case 'complete': if (mine && !open.grade) open.grade = 'play'; break;
      default: break;
    }
    if (['dislike', 'excludeArtist', 'excludeTrack'].includes(ev.type)) pool.purge((c) => !isEligible(c, profile, ctxNow()));
    save();
    emit({ type: 'profile' });
  }

  const savedIds = () => new Set((library?.saved || []).map((t) => t.id));
  const isLiked = (id) => !!profile.tracks[id]?.liked;
  const isBlocked = (track) => !!profile.excludedTracks[track.id] || track.artists.some((a) => profile.excludedArtists[a.id]);

  function markUnavailable(id) {
    profile.unavailable[id] = now();
    pool.purge((c) => c.track.id === id);
    save();
  }

  /** «Встряхнуть»: новые кандидаты, вкус сохраняется. */
  async function refresh() {
    pool.clear();
    meta.expandedAt = {};
    await refill({ force: true });
  }

  function setSettings(patch) {
    const before = profile.settings;
    profile.settings = mergeSettings({ ...before, ...patch });
    if (before.mood !== profile.settings.mood) pool.dropSources(['genre', 'discovery', 'wildcard', 'recent']);
    if (before.mode !== profile.settings.mode) needForce = true;
    save();
    emit({ type: 'settings' });
  }

  function unexcludeArtist(id) { delete profile.excludedArtists[id]; save(); emit({ type: 'profile' }); }

  function reset(opts = {}) {
    profile = resetProfile(profile, { ...opts, now: now() });
    ranker = createRanker(null);
    profile.ranker = ranker.state;
    pool.clear();
    closed.length = 0;
    open = null;
    impressions.clear();
    meta.expandedAt = {};
    meta.similar = {};
    store.remove('library');
    library = null;
    libraryIds = null;
    save();
    emit({ type: 'profile' });
  }

  // ---------- метрики качества (как иерархия метрик Яндекса: Like prob, Play prob, разнообразие, серендипность) ----------
  function metrics(window = 50) {
    const h = profile.history.slice(-window);
    const recentLog = profile.log.slice(-window * 2);
    const count = (t) => recentLog.filter((l) => l.type === t).length;
    const completes = count('complete');
    const skips = count('skip');
    const likes = count('like');
    const finished = completes + skips;
    return {
      plays: h.length,
      likeRate: h.length ? likes / h.length : 0,
      playRate: finished ? completes / finished : 0,
      skipRate: finished ? skips / finished : 0,
      noveltyShare: h.length ? h.filter((x) => x.novel).length / h.length : 0,
      uniqueArtists: new Set(h.map((x) => x.artistIds[0])).size,
      uniqueGenres: new Set(h.flatMap((x) => x.genres || [])).size,
    };
  }

  function view() {
    const w = ranker.weights(profile.settings.mode);
    return {
      topGenres: topGenres(profile, 10, contextKey(now())),
      topArtists: topArtists(profile, 10),
      excludedArtists: Object.entries(profile.excludedArtists).map(([id, name]) => ({ id, name })),
      excludedTracks: Object.keys(profile.excludedTracks).length,
      knownArtists: Object.values(profile.artists).filter(isKnownArtist).length,
      log: profile.log.slice(-15).reverse(),
      settings: profile.settings,
      metrics: metrics(),
      learnedPairs: ranker.state.n[profile.settings.mode] || 0,
      weights: FEATURES.map((f, i) => ({ name: f, w: w[i] })).filter((x) => !x.name.startsWith('src_')),
      pool: pool.counts(),
      hasTaste: hasTaste(profile),
    };
  }

  const exportProfile = () => JSON.stringify({ app: 'my-wave', version: 2, exportedAt: now(), profile }, null, 2);
  function importProfile(text) {
    const j = JSON.parse(text);
    if (j.app !== 'my-wave' || !j.profile) throw new Error('Это не файл профиля Моей волны');
    profile = migrateProfile(j.profile, now());
    ranker = createRanker(profile.ranker);
    profile.ranker = ranker.state;
    pool.clear();
    save();
    emit({ type: 'profile' });
  }

  return {
    on, loadLibrary, ensureSeeded, onboard, refill, next, release, feedback, isLiked, savedIds, isBlocked, markUnavailable,
    refresh, setSettings, unexcludeArtist, reset, metrics, view, exportProfile, importProfile,
    init() { applyDecay(profile, now()); save(); },
    hasTaste: () => hasTaste(profile),
    getProfile: () => profile, // для тестов и отладки
    getRanker: () => ranker,
    pool,
    ensureArtist: (a, g) => ensureArtist(profile, a, g),
  };
}
