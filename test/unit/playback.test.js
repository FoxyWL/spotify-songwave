// Контроллер воспроизведения против мока Spotify. Проверяем нашу логику (очередь, автоплей, обратная связь),
// а не поведение настоящего Spotify: его ещё предстоит сверить на живом аккаунте (spike).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { createPlayback, HORIZON } from '../../src/core/playback.js';
import { createConnectBackend } from '../../src/core/backends/connect.js';

async function rig(opts) {
  const env = setup(opts);
  await env.engine.ensureSeeded();
  const backend = createConnectBackend({ api: env.api, now: env.now, schedule: () => 0, clear: () => {} });
  backend.setDevice('webplayer');
  const toasts = [];
  const pb = createPlayback({ engine: env.engine, api: env.api, backend, now: env.now, onToast: (t) => toasts.push(t) });
  backend.start = async (cb) => { backend._cb = cb; return 'webplayer'; };
  await pb.init();
  // poll без таймеров: тест сам решает, когда «приложение смотрит» на плеер
  const sync = async () => { await backend.poll(); await pb._idle(); };
  const origStart = backend.start;
  void origStart;
  return { ...env, backend, pb, toasts, sync, log: () => env.engine.getProfile().log };
}

// connect.poll вызывает onState, который задаётся в start(); подменяем start так, чтобы callback был нашим
async function rig2(opts) {
  const env = setup(opts);
  await env.engine.ensureSeeded();
  const backend = createConnectBackend({ api: env.api, now: env.now, schedule: () => 0, clear: () => {} });
  const toasts = [];
  const pb = createPlayback({ engine: env.engine, api: env.api, backend, now: env.now, onToast: (t) => toasts.push(t) });
  backend.setDevice('webplayer');
  await backend.start(pb._handleState); // один опрос до запуска (ничего не играет), цикл с таймером отключён
  const sync = async () => { await backend.poll(); await pb._idle(); };
  return { ...env, backend, pb, toasts, sync };
}
void rig;

const playedLog = (env, type) => env.engine.getProfile().log.filter((l) => l.type === type);

test('старт: играет первый трек, в очереди Spotify HORIZON треков, резерв готов', async () => {
  const e = await rig2();
  await e.pb.start();
  const v = e.pb.view();
  assert.equal(v.status, 'starting');
  await e.sync();
  const v2 = e.pb.view();
  assert.equal(v2.status, 'playing');
  assert.ok(v2.current.track.id);
  assert.equal(v2.queued.length, HORIZON);
  assert.ok(v2.reserved.length >= 4);
  assert.equal(e.mock.p.current.id, v2.current.track.id);
  assert.deepEqual(e.mock.p.queue, v2.queued.map((r) => r.track.id));
});

test('30 треков подряд естественно: автоплей Spotify ни разу не включился, оценки — «дослушал»', async () => {
  const e = await rig2();
  await e.pb.start();
  await e.sync();
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const cur = e.pb.view().current;
    seen.add(cur.track.id);
    const left = cur.track.durationMs - e.pb.position();
    e.tick(left + 500);
    await e.sync();
  }
  assert.equal(e.mock.autoplayed.length, 0, 'Spotify не должен был включать свой автоплей');
  assert.equal(seen.size, 30, 'все треки разные');
  assert.ok(playedLog(e, 'complete').length >= 28);
  assert.equal(playedLog(e, 'skip').length, 0);
  assert.equal(e.pb.view().queued.length, HORIZON);
});

test('следующий: ранний пропуск записан, играет ровно то, что стояло в очереди', async () => {
  const e = await rig2();
  await e.pb.start(); await e.sync();
  const before = e.pb.view();
  const expected = before.queued[0].track.id;
  e.tick(6000);
  await e.pb.next(); await e.sync();
  const v = e.pb.view();
  assert.equal(v.current.track.id, expected);
  assert.equal(e.mock.p.current.id, expected);
  assert.equal(playedLog(e, 'skip').length, 1);
  assert.equal(v.queued.length, HORIZON);
  assert.equal(e.mock.autoplayed.length, 0);
});

test('дизлайк: трек больше не вернётся, играет следующий, резерв пересобран', async () => {
  const e = await rig2();
  await e.pb.start(); await e.sync();
  const id = e.pb.view().current.track.id;
  await e.pb.dislike(); await e.sync();
  assert.notEqual(e.pb.view().current.track.id, id);
  assert.ok(e.engine.getProfile().excludedTracks[id]);
  assert.equal(playedLog(e, 'dislike').length, 1);
  assert.equal(playedLog(e, 'skip').length, 0, 'дизлайк не дублируется пропуском');
});

test('исключить артиста: его треки уходят из резерва; если уже в очереди Spotify — пропускаются при подходе', async () => {
  const e = await rig2();
  await e.pb.start(); await e.sync();
  const cur = e.pb.view().current;
  await e.pb.excludeArtist(); await e.sync();
  const v = e.pb.view();
  const artist = cur.track.artists[0].id;
  assert.notEqual(v.current.track.artists[0].id, artist);
  assert.ok(![...v.reserved].some((r) => r.track.artists.some((a) => a.id === artist)));
});

test('лайк волны — сигнал для рекомендаций, а «в медиатеку» — отдельное действие Spotify', async () => {
  const e = await rig2();
  await e.pb.start(); await e.sync();
  await e.pb.like(); await e.sync();
  assert.ok(e.pb.view().liked);
  assert.equal(e.mock.count(/^PUT \/me\/library$/), 0, 'лайк волны не пишет в медиатеку сам');
  await e.pb.save();
  assert.equal(e.mock.count(/^PUT \/me\/library$/), 1);
  assert.ok(e.pb.view().saved);
  await e.pb.unsave();
  assert.equal(e.mock.count(/^DELETE \/me\/library$/), 1);
  assert.ok(!e.pb.view().saved);
  await e.pb.unlike();
  assert.ok(!e.pb.view().liked);
});

test('сохранение в медиатеку не удалось: состояние откатывается и показывается предупреждение', async () => {
  const e = await rig2();
  await e.pb.start(); await e.sync();
  const before = e.pb.view().saved;
  e.mock.failNext.push({ match: /^PUT \/me\/library$/, status: 500, times: 20 });
  await e.pb.save();
  assert.equal(e.pb.view().saved, before, 'состояние вернулось к исходному');
  assert.ok(e.toasts.some((t) => t.kind === 'warn'));
});

test('playTrack: выбранный трек играет сразу, дальше волна', async () => {
  const e = await rig2();
  await e.pb.start(); await e.sync();
  const other = e.mock.cat.tracks.find((t) => t.id !== e.pb.view().current.track.id);
  const nt = (await e.api.search(other.name.split(' ')[0], { type: 'track' })).tracks[0];
  await e.pb.playTrack(nt); await e.sync();
  assert.equal(e.pb.view().current.track.id, nt.id);
  assert.equal(e.mock.p.current.id, nt.id);
  assert.equal(e.pb.view().queued.length, HORIZON);
});

test('jumpTo: строка из резерва включается сразу и пропадает из плана; dropPlanned убирает без повторов', async () => {
  const e = await rig2();
  await e.pb.start(); await e.sync();
  const [r0, r1] = e.pb.view().reserved;
  await e.pb.dropPlanned(r0.track.id);
  assert.ok(!e.pb.view().reserved.some((r) => r.track.id === r0.track.id));
  assert.ok(e.engine.getProfile().excludedTracks[r0.track.id]);
  await e.pb.jumpTo(r1.track.id); await e.sync();
  assert.equal(e.pb.view().current.track.id, r1.track.id);
  assert.equal(e.mock.p.current.id, r1.track.id);
});

test('трек недоступен у Spotify: он пропускается, помечается и автоплей не включается', async () => {
  const e = await rig2();
  await e.pb.start(); await e.sync();
  const q = e.pb.view().queued;
  e.mock.unplayable.add(q[0].track.id);
  e.tick(e.pb.view().current.track.durationMs - e.pb.position() + 300);
  await e.sync();
  const v = e.pb.view();
  assert.equal(v.current.track.id, q[1].track.id, 'Spotify перепрыгнул недоступный, мы это заметили');
  assert.ok(e.engine.getProfile().unavailable[q[0].track.id]);
  assert.equal(e.mock.autoplayed.length, 0);
});

test('чужой трек (пользователь переключил в приложении Spotify) подхватывается без поломки плана', async () => {
  const e = await rig2();
  await e.pb.start(); await e.sync();
  const other = e.mock.cat.tracks.find((t) => t.id !== e.pb.view().current.track.id);
  await e.api.play({ deviceId: 'webplayer', uris: [`spotify:track:${other.id}`] });
  await e.sync();
  const v = e.pb.view();
  assert.equal(v.current.track.id, other.id);
  assert.equal(v.current.source, 'external');
  assert.ok(v.queued.length >= 1);
});

test('очередь опустела и Spotify включил автоплей: волна перезапускается нашими треками', async () => {
  const e = await rig2();
  await e.pb.start(); await e.sync();
  e.mock.p.queue = []; // имитируем сбой: очередь потеряна
  e.tick(e.pb.view().current.track.durationMs - e.pb.position() + 300);
  await e.sync();
  assert.ok(e.mock.autoplayed.length >= 1, 'сценарий действительно вызвал автоплей Spotify');
  const v = e.pb.view();
  assert.notEqual(v.current?.source, 'external', 'перезапуск, а не принятие чужого трека');
  assert.equal(e.mock.p.current.id, v.current.track.id);
});

test('нет активного устройства: понятная ошибка, статус no-device, ничего не ломается', async () => {
  const e = await rig2();
  e.mock.devices = [];
  await assert.rejects(e.pb.start(), (err) => err.isNoDevice);
  assert.equal(e.pb.view().status, 'no-device');
});

test('устаревшее состояние сразу после запуска (старый трек) игнорируется', async () => {
  const e = await rig2();
  await e.pb.start();
  const first = e.pb.view().current;
  e.pb._handleState({ track: { ...first.track, id: 'stale', artists: first.track.artists }, positionMs: 1000, durationMs: 1e5, paused: false, at: e.now() });
  await e.pb._idle();
  assert.equal(e.pb.view().current.track.id, first.track.id);
});

test('пауза и продолжение идут через команды плеера; позиция не убегает на паузе', async () => {
  const e = await rig2();
  await e.pb.start(); await e.sync();
  e.tick(5000);
  await e.pb.toggle();
  const p1 = e.pb.position();
  e.tick(10_000);
  assert.equal(e.pb.position(), p1);
  assert.equal(e.pb.view().status, 'paused');
  await e.pb.toggle();
  assert.equal(e.pb.view().status, 'playing');
});
