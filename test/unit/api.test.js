import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSpotify, mockFetch } from '../mock/spotify-mock.js';
import { createApi, SpotifyError } from '../../src/spotify/api.js';

function mk(opts = {}) {
  let t = 1_000_000;
  const mock = new MockSpotify({ now: () => t });
  mock.setUser({ genres: ['indie rock'] });
  const sleeps = [];
  const api = createApi({ getToken: opts.getToken || (async () => 'tok'), fetchImpl: mockFetch(mock), sleep: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t, ...opts });
  return { mock, api, sleeps, tick: (ms) => { t += ms; } };
}

test('search ограничивает limit десятью (иначе dev mode вернёт 400)', async () => {
  const { api, mock } = mk();
  const r = await api.search('genre:"indie rock"', { type: 'track', limit: 50 });
  assert.equal(r.tracks.length, 10);
  assert.equal(mock.log.at(-1).query.limit, '10');
});

test('удалённые эндпоинты возвращают 403 и ошибка типизирована', async () => {
  const { api } = mk();
  for (const path of ['/recommendations', '/audio-features/abc', '/browse/new-releases']) {
    await assert.rejects(api.request('GET', path), (e) => e instanceof SpotifyError && e.status === 403);
  }
});

test('нормализация: нет popularity/followers, у артистов есть genres', async () => {
  const { api } = mk();
  const arts = await api.topArtists('medium_term');
  assert.ok(arts.length > 0 && arts.every((a) => a.genres.length > 0));
  const tr = (await api.search('genre:"shoegaze"', { type: 'track' })).tracks[0];
  assert.ok(tr.id && tr.uri && tr.artists[0].id && tr.album.id && !('popularity' in tr));
});

test('GET-кэш и дедупликация: одинаковые запросы = один сетевой вызов', async () => {
  const { api, mock } = mk();
  await Promise.all([api.topArtists('long_term'), api.topArtists('long_term')]);
  await api.topArtists('long_term');
  assert.equal(mock.count(/GET \/me\/top\/artists/), 1);
  assert.ok(api.stats.cacheHits >= 1);
});

test('429 rate limit: ждём Retry-After и повторяем', async () => {
  const { api, mock, sleeps } = mk();
  mock.rateLimit = { left: 2, retryAfter: 3 };
  const me = await api.me();
  assert.equal(me.id, 'maxim');
  assert.ok(sleeps.some((s) => s >= 3000), `ждали: ${sleeps}`);
  assert.equal(api.stats.rateLimited, 2);
});

test('QUOTA_EXCEEDED: ошибка распознаётся, низкий приоритет больше не бьёт в сеть, плеер-команды проходят', async () => {
  const { api, mock } = mk();
  const events = [];
  api.on((e) => events.push(e.type));
  await api.topArtists('short_term'); // прогрев устройства не нужен
  mock.exhaustQuota(60_000);
  await assert.rejects(api.search('genre:"jazz"'), (e) => e.isQuota);
  const before = mock.log.length;
  await assert.rejects(api.search('genre:"folk"'), (e) => e.isQuota);
  assert.equal(mock.log.length, before, 'после квоты низкоприоритетные запросы не уходят в сеть');
  assert.ok(events.includes('quota'));
  assert.equal(api.status().quota, true);
  mock.restoreQuota();
  // высокий приоритет (команды плеера) не блокируется
  const devs = await api.devices();
  assert.ok(devs.length >= 1);
});

test('401: токен принудительно обновляется и запрос повторяется', async () => {
  let calls = 0;
  let current = 'stale';
  // как настоящий auth.getToken: после принудительного обновления токен лежит в хранилище
  const { api, mock } = mk({ getToken: async (force) => { if (force) { calls++; current = 'fresh'; } return current; } });
  mock.requireAuth = true;
  mock.tokens.add('fresh');
  const me = await api.me();
  assert.equal(me.id, 'maxim');
  assert.equal(calls, 1);
});

test('5xx на GET: повтор с backoff', async () => {
  const { api, mock } = mk();
  mock.failNext.push({ match: /GET \/me$/, status: 502, times: 2 });
  assert.equal((await api.me()).id, 'maxim');
  assert.equal(mock.count(/GET \/me$/), 3);
});

test('библиотека и плейлисты: форматы запросов по документации', async () => {
  const { api, mock } = mk();
  const t = (await api.search('genre:"jazz"')).tracks[0];
  await api.saveToLibrary([t.uri]);
  assert.ok(mock.library.has(t.id));
  const lists = await api.myPlaylists();
  assert.equal(lists.length, 1);
  await api.addToPlaylist(lists[0].id, [t.uri]);
  assert.deepEqual(mock.playlists[0].items, [t.uri]);
  const created = await api.createPlaylist('Моя волна');
  assert.ok(created.id);
});
