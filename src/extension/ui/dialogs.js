// Диалоги: настройки, профиль вкуса, очередь, поиск.
import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Modal, Icon, Cover, fmt } from './kit.js';
import { Queue } from './dashboard.js';

export const Settings = ({ app, view, onClose }) => {
  const s = view.settings;
  const fileRef = useRef(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const download = () => {
    const blob = new Blob([app.actions.exportProfile()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `songwave-profile-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const upload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { app.actions.importProfile(await f.text()); } catch (err) { app.toast('warn', err.message || 'Не удалось прочитать файл'); }
    e.target.value = '';
  };
  return html`<${Modal} title="Настройки волны" onClose=${onClose}>
    <div class="sect"><h3>Режим</h3><p class="sub">Как волна выбирает музыку.</p>
      <div class="radio-grid">${Object.entries(view.modes).map(([id, m]) => html`<button class="opt" aria-pressed=${s.mode === id} onClick=${() => app.actions.setSettings({ mode: id })}><b>${m.label}</b><small>${m.hint}</small></button>`)}</div>
    </div>
    <div class="sect"><h3>Настроение</h3><p class="sub">Жанровый набор под занятие. Spotify не отдаёт энергичность треков, поэтому это приближение по жанрам.</p>
      <div class="presets">
        <button class="chip" aria-pressed=${!s.mood} onClick=${() => app.actions.setSettings({ mood: null })}>Без настроения</button>
        ${Object.entries(view.moods).map(([id, m]) => html`<button class="chip" aria-pressed=${s.mood === id} onClick=${() => app.actions.setSettings({ mood: id })}>${m.label}</button>`)}
      </div>
    </div>
    <div class="sect"><h3>Фильтры</h3>
      <label class="switch"><span>Показывать треки с пометкой Explicit</span><input type="checkbox" checked=${s.allowExplicit} onChange=${(e) => app.actions.setSettings({ allowExplicit: e.target.checked })} /></label>
    </div>
    <div class="sect"><h3>Исключённые артисты</h3>
      ${view.taste.excludedArtists.length === 0 ? html`<p class="sub" style="margin:0">Пока никого. Исключить артиста можно в меню трека.</p>`
        : html`<div class="pill-list">${view.taste.excludedArtists.map((a) => html`<span class="pill">${a.name}<button aria-label=${`Вернуть ${a.name}`} title="Вернуть в волну" onClick=${() => app.actions.unexcludeArtist(a.id)}><${Icon} n="close" size="12" /></button></span>`)}</div>`}
    </div>
    <div class="sect"><h3>Профиль вкуса</h3><p class="sub">Хранится только в этом браузере. Можно сохранить и перенести.</p>
      <div class="presets">
        <button class="btn ghost small" onClick=${download}>Скачать профиль</button>
        <button class="btn ghost small" onClick=${() => fileRef.current.click()}>Загрузить профиль</button>
        <input ref=${fileRef} type="file" accept="application/json" hidden onChange=${upload} />
        ${confirmReset
          ? html`<button class="btn danger small" onClick=${() => { setConfirmReset(false); onClose(); app.actions.resetProfile(); }}>Точно сбросить вкус</button>`
          : html`<button class="btn quiet small" onClick=${() => setConfirmReset(true)}>Сбросить вкус</button>`}
      </div>
    </div>
    <div class="sect"><h3>Аккаунт</h3><p class="sub">Вход выполнен через Spotify. Токены лежат в расширении, страница Spotify их не видит.</p>
      <button class="btn ghost small" onClick=${() => { onClose(); app.actions.logout(); }}>Выйти</button>
    </div>
  <//>`;
};

const pct = (x) => `${Math.round(x * 100)}%`;

export const TasteProfile = ({ view, onClose }) => {
  const t = view.taste;
  const m = t.metrics;
  const maxG = Math.max(0.01, ...t.topGenres.map((g) => g.score));
  const labels = { complete: 'дослушал', skip: 'пропустил', like: 'лайк', unlike: 'снял лайк', dislike: 'дизлайк', excludeArtist: 'исключил артиста', excludeTrack: 'убрал трек', more: 'больше такого', less: 'меньше такого', replay: 'повтор' };
  return html`<${Modal} title="Профиль вкуса" onClose=${onClose} wide=${true}>
    <div class="sect"><h3>Недавние прослушивания${m.plays ? ` (${m.plays})` : ''}</h3>
      <div class="stats">
        <div class="stat"><b>${pct(m.playRate)}</b><small>дослушано</small></div>
        <div class="stat"><b>${pct(m.skipRate)}</b><small>пропущено</small></div>
        <div class="stat"><b>${pct(m.likeRate)}</b><small>с лайком</small></div>
        <div class="stat"><b>${pct(m.noveltyShare)}</b><small>новых артистов</small></div>
      </div>
    </div>
    <div class="sect"><h3>Любимые жанры</h3><p class="sub">С поправкой на текущее время суток.</p>
      ${t.topGenres.length === 0 ? html`<p class="sub">Пока нет данных.</p>` : html`<div class="bars">${t.topGenres.map((g) => html`<div class="bar-row"><span>${g.name}</span><div class="meter"><i style=${`width:${(g.score / maxG) * 100}%`}></i></div><b>${g.score.toFixed(1)}</b></div>`)}</div>`}
    </div>
    <div class="sect"><h3>Любимые артисты</h3>
      ${t.topArtists.length === 0 ? html`<p class="sub">Пока нет данных.</p>` : html`<div class="pill-list">${t.topArtists.map((a) => html`<span class="pill" style="padding-right:12px">${a.name}</span>`)}</div>`}
    </div>
    <div class="sect"><h3>Как волна учится</h3>
      <p class="sub">Формула ранжирования дообучается на парах «что понравилось лучше, чем что». Сейчас накоплено пар: ${t.learnedPairs}. Веса ниже показывают, что для тебя важнее всего.</p>
      <div class="bars">${[...t.weights].sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 6).map((w) => html`<div class="bar-row"><span>${w.name}</span><div class="meter"><i style=${`width:${Math.min(100, Math.abs(w.w) * 40)}%`}></i></div><b>${w.w.toFixed(1)}</b></div>`)}</div>
    </div>
    <div class="sect"><h3>Последние события</h3>
      ${t.log.length === 0 ? html`<p class="sub">Событий пока нет.</p>` : html`<ul class="log">${t.log.map((l) => html`<li><b>${labels[l.type] || l.type}</b>: ${l.name}${l.artist ? ` — ${l.artist}` : ''}</li>`)}</ul>`}
    </div>
  <//>`;
};

export const QueueDialog = ({ app, view, openDialog, onClose }) => html`<${Modal} title="Очередь" onClose=${onClose} wide=${true}>
  <p class="sub" style="color:var(--muted);margin:10px 0 6px">Треки, которые уже стоят в очереди Spotify, перестроить нельзя. Остальные волна пересобирает после твоих оценок.</p>
  <${Queue} app=${app} view=${view} openDialog=${openDialog} full=${true} />
<//>`;

export const Search = ({ app, onClose }) => {
  const [tab, setTab] = useState('search');
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [saved, setSaved] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(0);
  useEffect(() => {
    clearTimeout(timer.current);
    if (tab !== 'search' || q.trim().length < 2) { setRes(null); return undefined; }
    timer.current = setTimeout(async () => {
      setBusy(true); setErr(null);
      try { setRes(await app.actions.search(q)); } catch (e) { setErr(app.describeApiError(e).text); } finally { setBusy(false); }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [q, tab]);
  useEffect(() => {
    if (tab !== 'saved' || saved) return;
    setBusy(true); setErr(null);
    app.actions.savedTracks().then(setSaved).catch((e) => setErr(app.describeApiError(e).text)).finally(() => setBusy(false));
  }, [tab]);
  const list = tab === 'search' ? res : saved;
  const play = (t) => { onClose(); app.actions.playTrack(t); };
  return html`<${Modal} title="Найти трек" onClose=${onClose}>
    <div class="tabs" role="tablist">
      <button class="chip" role="tab" aria-pressed=${tab === 'search'} onClick=${() => setTab('search')}>Поиск</button>
      <button class="chip" role="tab" aria-pressed=${tab === 'saved'} onClick=${() => setTab('saved')}>Из медиатеки</button>
    </div>
    ${tab === 'search' && html`<div class="search-box field"><${Icon} n="search" /><input class="input" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Трек или артист" aria-label="Поиск" autofocus /></div>`}
    ${err && html`<p class="err" role="alert">${err}</p>`}
    ${busy && html`<p class="sub" style="color:var(--muted)">Ищу…</p>`}
    ${!busy && list && list.length === 0 && html`<div class="empty"><p>Ничего не нашлось.</p></div>`}
    ${!busy && tab === 'search' && !res && !err && html`<p class="sub" style="color:var(--muted)">Выбранный трек заиграет сразу, а дальше продолжится волна.</p>`}
    ${list && list.length > 0 && html`<div class="rows" role="list">${list.map((t) => html`<div class="track-row" style="grid-template-columns:minmax(0,1fr) 46px 34px" role="listitem" tabindex="0" onClick=${() => play(t)} onKeyDown=${(e) => { if (e.key === 'Enter') play(t); }}>
      <div class="t-cell"><${Cover} track=${t} cls="thumb" small=${true} /><div style="min-width:0"><b>${t.name}</b><small>${t.artists.map((a) => a.name).join(', ')}</small></div></div>
      <span class="t-dur">${fmt(t.durationMs)}</span>
      <span class="icon-btn" style="width:32px;height:32px" aria-hidden="true"><${Icon} n="play" fill=${true} size="16" /></span>
    </div>`)}</div>`}
  <//>`;
};
