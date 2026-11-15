// Симуляция качества подборок: «виртуальный слушатель» с известным вкусом оценивает выдачу, как реальный человек.
// Тест измеряет, становится ли волна лучше со временем, и печатает числа. Это проверка на моке, не на живом Spotify.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, simulate, share, primaryGenre } from './helpers.js';

const LOVE = ['indie rock', 'shoegaze', 'dream pop'];
const LIKE = ['post-punk', 'synthwave', 'lo-fi', 'folk', 'ambient'];
const HATE = ['techno', 'trap', 'metal', 'hip hop', 'house'];

function listener(env, seed = 1) {
  let s = seed;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return (rec) => {
    const g = primaryGenre(env.mock, rec);
    if (LOVE.includes(g)) return r() < 0.25 ? 'like' : r() < 0.85 ? 'complete' : 'skipLate';
    if (LIKE.includes(g)) return r() < 0.6 ? 'complete' : 'skipLate';
    if (HATE.includes(g)) return r() < 0.15 ? 'dislike' : 'skipEarly';
    return r() < 0.35 ? 'complete' : 'skipEarly';
  };
}

const windows = (out, size, pred) => Array.from({ length: Math.floor(out.length / size) }, (_, i) => share(out.slice(i * size, (i + 1) * size), pred));
const pct = (x) => `${Math.round(x * 100)}%`;

async function session({ learn, n = 200, discovery = 0.5 }) {
  const env = setup({ rngSeed: 3, genres: ['indie rock', 'shoegaze', 'dream pop', 'post-punk'] });
  await env.engine.ensureSeeded();
  env.engine.setSettings({ discovery });
  if (!learn) env.engine.getRanker().update = () => {}; // «замороженная» формула: только априорные веса
  const truth = listener(env);
  const out = await simulate(env, n, (rec) => truth(rec));
  return { env, out };
}

test('качество волны: доля нелюбимого падает, любимого растёт; метрики честно печатаются', async () => {
  const { env, out } = await session({ learn: true });
  const loved = (o) => LOVE.includes(primaryGenre(env.mock, o.rec));
  const hated = (o) => HATE.includes(primaryGenre(env.mock, o.rec));
  const L = windows(out, 50, loved);
  const H = windows(out, 50, hated);
  const good = (o) => o.outcome === 'like' || o.outcome === 'complete';
  const G = windows(out, 50, good);
  const m = env.engine.metrics();
  console.log(`   любимое по окнам 50: ${L.map(pct).join(' → ')}`);
  console.log(`   ненавистное по окнам 50: ${H.map(pct).join(' → ')}`);
  console.log(`   дослушали или лайк: ${G.map(pct).join(' → ')}`);
  console.log(`   метрики движка: ${JSON.stringify(m)}`);
  const artists = out.map((o) => o.rec.track.artists[0].id);
  const dupSongs = out.length - new Set(out.map((o) => o.rec.track.name + '|' + o.rec.track.artists[0].id)).size;
  console.log(`   уникальных артистов: ${new Set(artists).size} из ${out.length}, повторов песен: ${dupSongs}`);
  assert.ok(H.at(-1) <= H[0] + 0.05, 'нелюбимое не должно расти');
  assert.ok(H.at(-1) < 0.2, `нелюбимого в последнем окне ${pct(H.at(-1))}`);
  assert.ok(L.at(-1) >= 0.4, `любимого в последнем окне ${pct(L.at(-1))}`);
  assert.equal(dupSongs, 0);
  // окно артиста 25 при малом каталоге мока (≈25 «своих» артистов) ужимается ступенями; жёсткий пол — не подряд и не чаще, чем через 3
  const gaps = [];
  const last = new Map();
  artists.forEach((a, i) => { if (last.has(a)) gaps.push(i - last.get(a)); last.set(a, i); });
  const viol = gaps.filter((g) => g < 25).length;
  console.log(`   интервал между повторами артиста: мин ${Math.min(...gaps)}, медиана ${gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]}; короче 25: ${viol} из ${gaps.length}`);
  assert.ok(Math.min(...gaps) >= 3);
});

test('обучаемая формула не хуже замороженной по доле «дослушали или лайк»', async () => {
  const a = await session({ learn: true });
  const b = await session({ learn: false });
  const good = (o) => o.outcome === 'like' || o.outcome === 'complete';
  const tail = (x) => share(x.out.slice(-100), good);
  console.log(`   последние 100: обучаемая ${pct(tail(a))}, замороженная ${pct(tail(b))}`);
  assert.ok(tail(a) >= tail(b) - 0.03);
});
