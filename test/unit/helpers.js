import { MockSpotify, mockFetch } from '../mock/spotify-mock.js';
import { createApi } from '../../src/spotify/api.js';
import { createStore, memoryBackend } from '../../src/core/store.js';
import { createEngine } from '../../src/core/engine/index.js';
import { mulberry32 } from '../../src/core/engine/util.js';

export function setup({ genres = ['indie rock', 'shoegaze', 'dream pop'], seed = 7, rngSeed = 1, start = Date.UTC(2026, 10, 14, 12), seedLibrary = true } = {}) {
  let t = start;
  const now = () => t;
  const mock = new MockSpotify({ seed, now });
  if (genres) mock.setUser({ genres });
  const api = createApi({ getToken: async () => 'tok', fetchImpl: mockFetch(mock), sleep: async () => {}, now });
  const store = createStore(memoryBackend(), { delay: 1e9 });
  const engine = createEngine({ api, store, rng: mulberry32(rngSeed), now });
  return { mock, api, store, engine, now, tick: (ms) => { t += ms; }, seedLibrary };
}

export const primaryGenre = (mock, rec) => mock.cat.artistById.get(rec.track.artists[0].id).primary;

/**
 * Прогоняет n прослушиваний. truth(rec, i) → 'like' | 'complete' | 'skipEarly' | 'skipLate' | 'dislike'.
 * Для каждого трека шлёт те же события, что шлёт плеер: play → (like) → complete/skip/dislike.
 */
export async function simulate(env, n, truth, { after = [] } = {}) {
  const { engine, tick } = env;
  const out = [];
  let prev = [...after];
  for (let i = 0; i < n; i++) {
    const [rec] = await engine.next(1, { after: prev.slice(-1) });
    const dur = rec.track.durationMs;
    engine.feedback({ type: 'play', track: rec.track, genres: rec.genres, source: rec.source });
    const o = truth(rec, i);
    const base = { track: rec.track, genres: rec.genres, durationMs: dur };
    if (o === 'like') { engine.feedback({ ...base, type: 'like' }); engine.feedback({ ...base, type: 'complete', playedMs: dur }); }
    else if (o === 'complete') engine.feedback({ ...base, type: 'complete', playedMs: dur });
    else if (o === 'skipEarly') engine.feedback({ ...base, type: 'skip', playedMs: 8000 });
    else if (o === 'skipLate') engine.feedback({ ...base, type: 'skip', playedMs: Math.floor(dur * 0.6) });
    else if (o === 'dislike') engine.feedback({ ...base, type: 'dislike', playedMs: 5000 });
    tick(o === 'complete' || o === 'like' ? dur : 20_000);
    out.push({ rec, outcome: o });
    prev = [rec];
  }
  return out;
}

export const share = (arr, pred) => (arr.length ? arr.filter(pred).length / arr.length : 0);
