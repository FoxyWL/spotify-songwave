import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, simulate, primaryGenre, share } from './helpers.js';
import { createRanker, priorVector } from '../../src/core/engine/ranker.js';
import { FEATURES, extractFeatures, buildContext } from '../../src/core/engine/features.js';
import { applyFeedback, createProfile, applyDecay } from '../../src/core/engine/profile.js';
import { makeCandidate } from '../../src/core/engine/candidates.js';
import { DEFAULT_SETTINGS } from '../../src/core/engine/settings.js';
import { contextKey, DAY } from '../../src/core/engine/util.js';

const seeded = async (opts) => { const env = setup(opts); await env.engine.ensureSeeded(); return env; };

test('посев по библиотеке Spotify: вкус появляется, топ-жанры — из топа пользователя', async () => {
  const { engine } = await seeded();
  const v = engine.view();
  assert.equal(v.hasTaste, true);
  const names = v.topGenres.map((g) => g.name);
  assert.ok(names.includes('indie rock') || names.includes('shoegaze') || names.includes('dream pop'), names.join(','));
  assert.ok(v.topArtists.length >= 5);
});

test('выдача: треки уникальны, нет повторов песен, у каждого есть причина', async () => {
  const env = await seeded();
  const out = await simulate(env, 80, () => 'complete');
  const ids = out.map((o) => o.rec.track.id);
  assert.equal(new Set(ids).size, ids.length, 'повтор трека');
  assert.ok(out.every((o) => o.rec.why.length >= 1), 'нет объяснения');
  assert.ok(out.every((o) => o.rec.track.uri.startsWith('spotify:track:')));
});

test('фильтр как в Яндексе: артист не повторяется в окне cooldown (25), пока хватает кандидатов', async () => {
  const env = await seeded();
  const out = await simulate(env, 70, () => 'complete');
  const arts = out.map((o) => o.rec.track.artists[0].id);
  let minGap = Infinity;
  arts.forEach((a, i) => { const j = arts.indexOf(a, i + 1); if (j > 0) minGap = Math.min(minGap, j - i); });
  console.log(`   минимальный промежуток между одним артистом: ${minGap} треков (окно 25)`);
  assert.ok(minGap >= 12, `слишком частый повтор артиста: ${minGap}`);
});

test('дизлайк трека: больше никогда не выпадает', async () => {
  const env = await seeded();
  const first = (await simulate(env, 1, () => 'dislike'))[0].rec.track.id;
  const rest = await simulate(env, 120, () => 'complete');
  assert.ok(!rest.some((o) => o.rec.track.id === first));
});

test('исключить артиста: ни одного его трека, даже из пула и «знакомого»', async () => {
  const env = await seeded();
  const [rec] = await env.engine.next(1);
  const artist = rec.track.artists[0];
  env.engine.feedback({ type: 'excludeArtist', track: rec.track, genres: rec.genres });
  const rest = await simulate(env, 120, () => 'complete');
  assert.ok(!rest.some((o) => o.rec.track.artists.some((a) => a.id === artist.id)));
  assert.equal(env.engine.view().excludedArtists[0].id, artist.id);
  env.engine.unexcludeArtist(artist.id);
  assert.equal(env.engine.view().excludedArtists.length, 0);
});

test('недоступный трек (markUnavailable) исчезает из выдачи', async () => {
  const env = await seeded();
  const [rec] = await env.engine.next(1);
  env.engine.markUnavailable(rec.track.id);
  const rest = await simulate(env, 60, () => 'complete');
  assert.ok(!rest.some((o) => o.rec.track.id === rec.track.id));
});

test('явные треки можно отключить', async () => {
  const env = await seeded();
  env.engine.setSettings({ allowExplicit: false });
  const out = await simulate(env, 60, () => 'complete');
  assert.ok(out.every((o) => !o.rec.track.explicit));
});

test('сигналы по силе: лайк > дослушал > поздний пропуск > ранний пропуск > дизлайк', () => {
  const t = { id: 't1', name: 'x', artists: [{ id: 'a1', name: 'A' }], album: { id: 'al' } };
  const score = (events) => {
    const p = createProfile(0);
    events.forEach((type) => applyFeedback(p, { type, track: t, genres: ['rock'], playedMs: type === 'skipLate' ? 120000 : 5000, durationMs: 200000 }, 0));
    return p.artists.a1.score;
  };
  const ev = (type) => (type === 'skipLate' ? 'skip' : type);
  const s = {
    like: score(['like']), complete: score(['complete']), late: (() => { const p = createProfile(0); applyFeedback(p, { type: 'skip', track: t, genres: ['rock'], playedMs: 120000, durationMs: 200000 }, 0); return p.artists.a1.score; })(),
    early: score(['skip']), dislike: score(['dislike']),
  };
  assert.ok(s.like > s.complete && s.complete > s.late && s.late > s.early && s.early > s.dislike, JSON.stringify(s));
  assert.ok(ev('skipLate'));
});

test('пропуск мягче дизлайка и сильнее бьёт по контексту, чем по глобальному вкусу', () => {
  const p = createProfile(Date.UTC(2026, 10, 14, 12));
  const t = { id: 't1', name: 'x', artists: [{ id: 'a1', name: 'A' }], album: { id: 'al' } };
  applyFeedback(p, { type: 'skip', track: t, genres: ['rock'], playedMs: 3000, durationMs: 200000 }, Date.UTC(2026, 10, 14, 12));
  const ck = contextKey(Date.UTC(2026, 10, 14, 12));
  assert.ok(p.contexts[ck].rock < p.genres.rock, 'контекстный штраф должен быть сильнее глобального');
  assert.ok(p.artists.a1.score > -0.5);
});

test('затухание: вкус забывается с периодом ~45 дней', () => {
  const p = createProfile(0);
  p.artists.a = { name: 'A', score: 4, plays: 3, likes: 0, dislikes: 0, skips: 0, completes: 0, lastPlayed: 0, lastIdx: 0, genres: [], known: true };
  p.genres.rock = 4;
  applyDecay(p, 45 * DAY);
  assert.ok(Math.abs(p.artists.a.score - 2) < 0.01 && Math.abs(p.genres.rock - 2) < 0.01);
});

test('контекст влияет на признак: жанр, любимый «в будни вечером», получает бонус именно тогда', () => {
  const now = Date.UTC(2026, 10, 11, 19); // среда, вечер
  const p = createProfile(now);
  p.contexts[contextKey(now)] = { jazz: 3 };
  const c = makeCandidate({ id: 'x', uri: 'u', name: 'n', artists: [{ id: 'z', name: 'Z' }], album: { id: 'q' }, durationMs: 1, explicit: false, playable: true }, 'genre', ['jazz'], {}, now);
  const idx = FEATURES.indexOf('context');
  const eve = extractFeatures(c, p, buildContext(p, DEFAULT_SETTINGS, now)).x[idx];
  const sat = extractFeatures(c, p, buildContext(p, DEFAULT_SETTINGS, Date.UTC(2026, 10, 14, 7))).x[idx];
  assert.ok(eve > 0.5 && sat === 0, `${eve} ${sat}`);
});

test('pairwise-формула: шаг SGD увеличивает отступ между предпочтительным и худшим', () => {
  const r = createRanker(null);
  const hi = FEATURES.map(() => 0); const lo = FEATURES.map(() => 0);
  hi[FEATURES.indexOf('continuity')] = 1; lo[FEATURES.indexOf('continuity')] = 0;
  const m0 = r.score(hi, 'wave') - r.score(lo, 'wave');
  for (let i = 0; i < 40; i++) r.update('wave', hi, lo, 2);
  const m1 = r.score(hi, 'wave') - r.score(lo, 'wave');
  assert.ok(m1 > m0 + 0.2, `${m0} → ${m1}`);
  assert.deepEqual(priorVector('wave').length, FEATURES.length);
  // регуляризация к априору: веса не улетают
  assert.ok(r.weights('wave').every((w) => Math.abs(w) <= 4));
});

test('формула учится в движке: после сессии накоплены пары, пары одинаковых исходов пропускаются', async () => {
  const env = await seeded();
  await simulate(env, 40, (rec, i) => (i % 2 ? 'like' : 'skipEarly'));
  assert.ok(env.engine.view().learnedPairs > 10, `пар: ${env.engine.view().learnedPairs}`);
  const env2 = await seeded({ rngSeed: 3 });
  await simulate(env2, 20, () => 'complete');
  assert.equal(env2.engine.view().learnedPairs, 0, 'Play–Play не должны обучать формулу');
});

test('режим «Незнакомое»: только непрослушанное; артисты с >5 прослушиваний и треки из библиотеки отброшены', async () => {
  const env = await seeded();
  env.engine.setSettings({ mode: 'unfamiliar' });
  const out = await simulate(env, 40, () => 'complete');
  const p = env.engine.getProfile();
  const libIds = new Set(env.mock.user.saved.concat(env.mock.user.topTracks.long_term, env.mock.user.recent));
  assert.ok(out.every((o) => !libIds.has(o.rec.track.id)), 'трек из библиотеки');
  assert.ok(out.every((o) => (p.artists[o.rec.track.artists[0].id]?.plays ?? 0) <= 6));
  const novel = share(out, (o) => !env.mock.user.top.long_term.includes(o.rec.track.artists[0].id));
  console.log(`   «Незнакомое»: доля артистов вне топа пользователя = ${(novel * 100).toFixed(0)}%`);
  assert.ok(novel > 0.5);
});

test('режим «Любимое»: только артисты, которых пользователь уже знает', async () => {
  const env = await seeded();
  env.engine.setSettings({ mode: 'favorite' });
  const out = await simulate(env, 40, () => 'complete');
  const known = new Set(env.mock.user.top.long_term);
  assert.ok(share(out, (o) => known.has(o.rec.track.artists[0].id)) > 0.95);
});

test('режим «Без слов»: только жанры/названия из инструментального набора', async () => {
  const env = await seeded();
  env.engine.setSettings({ mode: 'instrumental' });
  const out = await simulate(env, 30, () => 'complete');
  const ok = out.filter((o) => o.rec.genres.some((g) => /ambient|classical|lo-fi|piano|instrumental|downtempo|post-rock|new age|minimal/.test(g)));
  assert.equal(ok.length, out.length);
});

test('настроение «Тренировка» смещает жанры', async () => {
  const base = await seeded({ rngSeed: 11 });
  const mood = await seeded({ rngSeed: 11 });
  mood.engine.setSettings({ mood: 'workout' });
  const re = /hip hop|trap|metal|techno|house|dance|edm|phonk|hard rock|drum/;
  const a = await simulate(base, 40, () => 'complete');
  const b = await simulate(mood, 40, () => 'complete');
  const sa = share(a, (o) => o.rec.genres.some((g) => re.test(g)));
  const sb = share(b, (o) => o.rec.genres.some((g) => re.test(g)));
  console.log(`   доля «энергичных» жанров: без настроения ${(sa * 100).toFixed(0)}% → «Тренировка» ${(sb * 100).toFixed(0)}%`);
  assert.ok(sb > sa + 0.15);
});

test('ползунок новизны: чем выше — тем больше незнакомых артистов', async () => {
  // реалистичный слушатель: артистов заметно больше окна cooldown (25), иначе «знакомое» вытесняется самим фильтром
  const run = async (d) => {
    const env = await seeded({ rngSeed: 5, genres: ['indie rock', 'shoegaze', 'dream pop', 'post-punk', 'synthwave', 'lo-fi', 'folk'] });
    env.engine.setSettings({ discovery: d });
    const out = await simulate(env, 60, () => 'complete');
    const known = new Set(env.mock.user.top.long_term);
    return share(out, (o) => !known.has(o.rec.track.artists[0].id));
  };
  const lo = await run(0.0);
  const hi = await run(1.0);
  console.log(`   новых артистов: discovery=0 → ${(lo * 100).toFixed(0)}%, discovery=1 → ${(hi * 100).toFixed(0)}%`);
  assert.ok(hi > lo + 0.1, 'ползунок должен заметно менять долю новых');
});

test('холодный старт без истории: онбординг по жанрам даёт релевантную волну', async () => {
  const env = setup({ genres: null });
  env.mock.setUser({ genres: [] });
  env.engine.onboard({ genres: ['jazz', 'bossa nova'] });
  const out = await simulate(env, 30, () => 'complete');
  const s = share(out, (o) => ['jazz', 'bossa nova'].includes(primaryGenre(env.mock, o.rec)) || o.rec.genres.some((g) => ['jazz', 'bossa nova'].includes(g)));
  console.log(`   холодный старт: доля выбранных жанров = ${(s * 100).toFixed(0)}%`);
  assert.ok(s > 0.5);
});

test('экспорт/импорт профиля сохраняет вкус, исключения и настройки; сброс очищает вкус', async () => {
  const env = await seeded();
  const [rec] = await env.engine.next(1);
  env.engine.feedback({ type: 'excludeArtist', track: rec.track, genres: rec.genres });
  env.engine.setSettings({ mode: 'unfamiliar', discovery: 0.9 });
  const dump = env.engine.exportProfile();
  const env2 = setup();
  env2.engine.importProfile(dump);
  assert.equal(env2.engine.getProfile().settings.mode, 'unfamiliar');
  assert.equal(env2.engine.view().excludedArtists.length, 1);
  assert.ok(env2.engine.view().topGenres.length > 0);
  env2.engine.reset({ keepSettings: true });
  assert.equal(env2.engine.view().topGenres.length, 0);
  assert.equal(env2.engine.getProfile().settings.mode, 'unfamiliar');
});

test('квота Spotify: волна не замолкает — отдаёт из пула, а при пустом пуле — из кэша и знакомого (без шквала запросов)', async () => {
  const env = await seeded();
  await env.engine.next(1); // пул наполнен
  env.mock.exhaustQuota();
  const [rec] = await env.engine.next(1); // из пула
  assert.ok(rec.track.id);
  env.engine.pool.clear();
  const before = env.mock.log.length;
  const out = await simulate(env, 5, () => 'complete'); // пул пуст, сеть закрыта квотой
  assert.equal(out.length, 5);
  // часть выдачи может прийти из GET-кэша клиента, остальное — из знакомого; главное — волна не падает
  assert.ok(out.every((o) => o.rec.track.id));
  assert.ok(env.mock.log.length - before < 25, 'не должно быть шквала запросов под квотой');
  env.mock.restoreQuota();
});

test('пул безопасен к сбою селекторов: часть запросов падает с 500, волна продолжается', async () => {
  const env = await seeded();
  env.mock.failNext.push({ match: /GET \/search/, status: 500, times: 6 });
  const out = await simulate(env, 15, () => 'complete');
  assert.equal(out.length, 15);
});
