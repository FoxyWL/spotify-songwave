// Опциональный внешний источник «похожих артистов» (Last.fm). Нужен только ключ API; воспроизведение — всегда Spotify.
// Условия Last.fm и политика Spotify (передача данных во внешние сервисы) — на ответственности владельца приложения.
export function createLastFm({ apiKey, fetchImpl }) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  return {
    id: 'lastfm',
    async similarArtists(name, limit = 8) {
      const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(name)}&api_key=${encodeURIComponent(apiKey)}&format=json&limit=${limit}&autocorrect=1`;
      const r = await doFetch(url);
      if (!r.ok) throw new Error(`Last.fm ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(`Last.fm: ${j.message}`);
      return (j.similarartists?.artist || []).map((a) => ({ name: a.name, match: Number(a.match) || 0 }));
    },
  };
}
