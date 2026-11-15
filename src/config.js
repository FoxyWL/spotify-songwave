// __API_BASE__/__AUTH_BASE__ подставляет только тестовая сборка (локальный мок Spotify); в боевой сборке их нет.
/* global __API_BASE__, __AUTH_BASE__ */
export const API_BASE = typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : 'https://api.spotify.com/v1';
export const AUTH_BASE = typeof __AUTH_BASE__ !== 'undefined' ? __AUTH_BASE__ : 'https://accounts.spotify.com';

// Только то, что реально нужно расширению. `streaming` не запрашиваем: звук играет сам Spotify Web Player,
// мы лишь управляем им через Connect.
export const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-top-read',
  'user-read-recently-played',
  'user-library-read',
  'user-library-modify',
  'user-follow-read',
  'playlist-read-private',
  'playlist-modify-private',
];
