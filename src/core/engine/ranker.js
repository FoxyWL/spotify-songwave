// «Формула» ранжирования. Яндекс обучает CatBoost на парах соседних событий разного типа
// (Play, Skip, Like, Dislike) и в режиме «Незнакомое» использует отдельную формулу с другими весами.
// Здесь то же самое в малом: линейная pairwise-модель (RankNet), которая дообучается онлайн на твоих событиях,
// отдельный набор весов на каждый режим, априорные веса — чтобы волна работала с первого трека.
import { FEATURES } from './features.js';
import { clamp, dot, sigmoid } from './util.js';

const PRIOR = {
  artist: 1.2, genre: 0.9, track: 0.8, novelty: 1.4, familiarity: 0.2, recency: -1.5, context: 0.5, mood: 1.6,
  continuity: 0.4, likedArtist: 0.4, skipRate: -0.8, instrumental: 0,
  src_familiar: 0, src_expand: 0.1, src_recent: 0.15, src_genre: 0, src_discovery: 0, src_similar: 0.1, src_wildcard: -0.2,
};
const MODE_PRIOR = {
  wave: {},
  favorite: {},
  unfamiliar: { familiarity: -0.4, artist: 0.7, likedArtist: 0.1, novelty: 1.6 },
  instrumental: { instrumental: 2.5 },
};

export const priorVector = (mode) => FEATURES.map((f) => MODE_PRIOR[mode]?.[f] ?? PRIOR[f] ?? 0);

// Оценки исходов (чем больше — тем лучше). Для «Незнакомого» лайк весит сильнее, а пропуск/дизлайк «дешевле» —
// пользователь сознательно идёт за открытиями (так в статье Яндекса про режим «Незнакомое»).
export const GRADES = {
  default: { dislike: 0, skip: 1, play: 2, like: 3 },
  unfamiliar: { dislike: 0.8, skip: 1.4, play: 2, like: 3.5 },
};
export const gradesFor = (mode) => (mode === 'unfamiliar' ? GRADES.unfamiliar : GRADES.default);

export function createRanker(saved) {
  const names = FEATURES.join(',');
  const st = saved && saved.names === names ? saved : { names, w: {}, n: {} };
  const wOf = (mode) => (st.w[mode] ||= priorVector(mode));
  return {
    state: st,
    score: (x, mode) => dot(x, wOf(mode)),
    weights: wOf,
    /** Шаг SGD по паре: xHi предпочтительнее xLo на величину gap. Возвращает отступ до обновления. */
    update(mode, xHi, xLo, gap, { lr = 0.05, l2 = 0.002 } = {}) {
      const w = wOf(mode);
      const w0 = priorVector(mode);
      const diff = xHi.map((v, i) => v - xLo[i]);
      const margin = dot(diff, w);
      const g = (1 - sigmoid(margin)) * Math.min(gap, 3);
      for (let i = 0; i < w.length; i++) w[i] = clamp(w[i] + lr * g * diff[i] - l2 * (w[i] - w0[i]), -4, 4);
      st.n[mode] = (st.n[mode] || 0) + 1;
      return margin;
    },
  };
}
