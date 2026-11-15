// Экраны до готовой волны: вход, загрузка, первый вкус, ошибка.
import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { Icon, Mark } from './kit.js';

export const Login = ({ app }) => {
  const { auth, loginBusy, loginError } = app.state;
  const [cid, setCid] = useState(auth.clientId || '');
  const [copied, setCopied] = useState(false);
  const valid = /^[a-f0-9]{32}$/i.test(cid.trim());
  const copy = async () => { try { await navigator.clipboard.writeText(auth.redirectUri); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* буфер недоступен */ } };
  const expired = loginError && /истек|не принял/i.test(loginError);
  return html`<div class="stage"><form class="panel" onSubmit=${(e) => { e.preventDefault(); if (valid && !loginBusy) app.actions.login(cid.trim()); }}>
    <${Mark} className="mark" />
    <h1 style="margin-top:14px">${expired ? 'Нужно войти заново' : 'Подключи Spotify'}</h1>
    <p>Songwave подбирает музыку по тому, что ты слушаешь, а играет её твой Spotify. Для входа нужен Client ID приложения из Spotify Dashboard (режим разработки, Premium).</p>
    <ol class="steps">
      <li>Создай приложение на <a class="link" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com/dashboard</a>.</li>
      <li>Добавь в Redirect URIs этот адрес:</li>
    </ol>
    <div class="copy"><code>${auth.redirectUri || '…'}</code><button type="button" class="btn ghost small" onClick=${copy}>${copied ? 'Скопировано' : 'Копировать'}</button></div>
    <div class="field">
      <label for="cid">Client ID</label>
      <input id="cid" class="input" value=${cid} onInput=${(e) => setCid(e.target.value)} placeholder="32 символа" autocomplete="off" spellcheck="false" />
    </div>
    ${loginError && html`<p class="err" role="alert">${loginError}</p>`}
    <div class="foot"><span>Секрет приложения не нужен.</span><button class="btn primary" type="submit" disabled=${!valid || loginBusy}>${loginBusy ? 'Жду окно Spotify…' : 'Войти через Spotify'}</button></div>
  </form></div>`;
};

export const Loading = ({ app }) => {
  const p = app.state.progress || { done: 0, total: 12, label: '' };
  const pct = Math.round((p.done / Math.max(1, p.total)) * 100);
  return html`<div class="stage"><div class="panel" role="status" aria-live="polite">
    <${Mark} className="mark" />
    <h1 style="margin-top:14px">Узнаю твой вкус</h1>
    <p>Читаю топ артистов, любимые треки и недавние прослушивания. Это разовая настройка.</p>
    <div class="progress"><i style=${`width:${pct}%`}></i></div>
    <p style="margin:0;font-size:13px">${p.label || 'Подключаюсь к Spotify'}</p>
  </div></div>`;
};

const GENRES = ['indie rock', 'indie pop', 'shoegaze', 'dream pop', 'post-punk', 'alternative', 'electronic', 'house', 'techno', 'ambient', 'lo-fi', 'synthwave', 'hip hop', 'r&b', 'soul', 'jazz', 'classical', 'folk', 'rock', 'metal', 'pop', 'k-pop', 'city pop', 'bossa nova', 'funk', 'disco', 'reggae', 'punk'];

export const Onboarding = ({ app }) => {
  const [picked, setPicked] = useState([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [artists, setArtists] = useState([]);
  const toggle = (g) => setPicked((p) => (p.includes(g) ? p.filter((x) => x !== g) : [...p, g]));
  const search = async (v) => {
    setQ(v);
    if (v.trim().length < 2) { setFound([]); return; }
    try { setFound((await app.actions.searchArtists(v)).slice(0, 5)); } catch { setFound([]); }
  };
  const ok = picked.length + artists.length >= 3;
  return html`<div class="stage"><div class="panel wide">
    <h1>Что тебе нравится?</h1>
    <p>В Spotify пока мало истории прослушиваний. Выбери хотя бы три жанра или артиста, и волна начнёт с них, а дальше научится на твоих лайках и пропусках.</p>
    <div class="genre-grid" role="group" aria-label="Жанры">
      ${GENRES.map((g) => html`<button type="button" class="chip" aria-pressed=${picked.includes(g)} onClick=${() => toggle(g)}>${g}</button>`)}
    </div>
    <div class="field"><label for="aq">Или найди артиста</label><input id="aq" class="input" value=${q} onInput=${(e) => search(e.target.value)} placeholder="Например, Massive Attack" /></div>
    <div class="pill-list">${found.map((a) => html`<button type="button" class="chip" onClick=${() => { setArtists((x) => (x.some((y) => y.id === a.id) ? x : [...x, a])); setQ(''); setFound([]); }}>＋ ${a.name}</button>`)}</div>
    ${artists.length > 0 && html`<div class="pill-list" style="margin-top:12px">${artists.map((a) => html`<span class="pill">${a.name}<button type="button" aria-label=${`Убрать ${a.name}`} onClick=${() => setArtists((x) => x.filter((y) => y.id !== a.id))}><${Icon} n="close" size="12" /></button></span>`)}</div>`}
    <div class="foot"><span>Выбрано: ${picked.length + artists.length}. Нужно минимум 3.</span><button class="btn primary" disabled=${!ok} onClick=${() => app.actions.finishOnboarding({ genres: picked, artists })}>Начать волну</button></div>
  </div></div>`;
};

export const Fatal = ({ app }) => html`<div class="stage"><div class="panel" role="alert">
  <h1>Не получилось подключиться</h1>
  <p>${app.state.fatal || 'Что-то пошло не так.'}</p>
  <div class="foot"><button class="btn ghost" onClick=${() => app.actions.logout()}>Войти заново</button><button class="btn primary" onClick=${() => app.actions.retryLoad()}>Повторить</button></div>
</div></div>`;
