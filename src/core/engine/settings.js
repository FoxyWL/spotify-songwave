// Режимы повторяют те, что у Моей волны подтверждены источниками: основной поток, «Незнакомое», «Без слов».
// «Любимое» — наш аналог «только знакомое». Занятие/настроение — гиперконтекст (в Яндексе по времени, дню, устройству).
export const MODES = {
  wave: { label: 'Моя волна', hint: 'Баланс знакомого и нового' },
  favorite: { label: 'Любимое', hint: 'Артисты и жанры, которые ты уже любишь' },
  unfamiliar: { label: 'Незнакомое', hint: 'Только то, чего ты ещё не слышал' },
  instrumental: { label: 'Без слов', hint: 'Фон для работы и отдыха' },
};

export const MOODS = {
  focus: { label: 'Фокус', genres: ['ambient', 'lo-fi', 'instrumental', 'classical', 'post-rock', 'piano', 'minimal'] },
  workout: { label: 'Тренировка', genres: ['edm', 'hip hop', 'trap', 'drum and bass', 'metal', 'hard rock', 'dance', 'techno', 'phonk'] },
  chill: { label: 'Спокойно', genres: ['chill', 'downtempo', 'acoustic', 'indie folk', 'lo-fi', 'bossa nova', 'soft rock', 'dream pop'] },
  party: { label: 'Вечеринка', genres: ['dance pop', 'house', 'pop', 'reggaeton', 'funk', 'disco', 'edm', 'latin'] },
  sleep: { label: 'Сон', genres: ['ambient', 'sleep', 'piano', 'new age', 'classical', 'drone'] },
};

// У Spotify нет instrumentalness (audio features закрыты), поэтому «Без слов» опирается на жанры и название.
export const INSTRUMENTAL_HINTS = ['ambient', 'instrumental', 'classical', 'post-rock', 'piano', 'lo-fi', 'lofi', 'drone', 'new age', 'minimal', 'soundtrack', 'orchestral', 'study', 'sleep', 'downtempo', 'math rock'];

export const WILDCARD_GENRES = [
  'pop', 'rock', 'hip hop', 'indie', 'indie rock', 'indie pop', 'electronic', 'house', 'techno', 'jazz', 'classical', 'r&b', 'soul',
  'funk', 'disco', 'metal', 'punk', 'folk', 'country', 'blues', 'reggae', 'latin', 'k-pop', 'j-pop', 'synthwave', 'ambient', 'lo-fi',
  'shoegaze', 'post-punk', 'drum and bass', 'dubstep', 'trap', 'bossa nova', 'afrobeats', 'city pop', 'dream pop', 'alternative',
  'grunge', 'new wave', 'psychedelic rock', 'art pop', 'trip hop', 'downtempo', 'chillwave', 'vaporwave', 'math rock', 'post-rock', 'emo',
];

export const DEFAULT_SETTINGS = {
  mode: 'wave',
  discovery: 0.45, // 0 — только знакомое, 1 — максимум нового (действует в режиме «Моя волна»)
  exploration: 0.06, // доля случайного выбора среди лучших
  allowExplicit: true,
  mood: null,
  artistCooldown: 25, // как в Яндексе: артист не повторяется 25 треков
  similarProvider: 'none', // 'none' | 'lastfm' (внешний граф похожих артистов, опционально)
  lastfmKey: '',
};

export function mergeSettings(saved) {
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  if (!MODES[s.mode]) s.mode = 'wave';
  if (s.mood && !MOODS[s.mood]) s.mood = null;
  return s;
}
