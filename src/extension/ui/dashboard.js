// Главный экран «Моей волны»: hero, текущий трек, баланс вкуса, очередь, пресеты.
import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { effectiveDiscovery } from '../../core/engine/features.js';
import { Icon, Cover, Record, fmt, yearOf, initials, colorOf, dotClass, usePopover } from './kit.js';

export const Notice = ({ app }) => {
  const n = app.state.notice;
  if (!n) return null;
  const danger = n.kind === 'premium' || n.kind === 'network';
  return html`<div class=${`notice${danger ? ' danger' : ''}`} role="alert">
    <p>${n.text}</p>
    ${n.retry && html`<button class="btn ghost small" onClick=${() => app.actions.retry()}>Повторить</button>`}
    <button class="icon-btn" aria-label="Скрыть" onClick=${() => app.actions.dismissNotice()}><${Icon} n="close" /></button>
  </div>`;
};

function statusOf(pv, notice) {
  if (notice?.kind === 'device') return { cls: 'warn', text: 'Нет активного устройства Spotify' };
  if (pv.status === 'starting') return { cls: 'busy', text: 'Подбираю треки' };
  if (pv.status === 'playing') return { cls: 'live', text: 'Волна играет' };
  if (pv.status === 'paused') return { cls: '', text: 'Волна на паузе' };
  if (pv.status === 'no-device') return { cls: 'warn', text: 'Нет активного устройства Spotify' };
  if (pv.status === 'error') return { cls: 'warn', text: 'Волна остановлена из-за ошибки' };
  return { cls: '', text: 'Волна не запущена' };
}

export const Hero = ({ app, pv }) => {
  const st = statusOf(pv, app.state.notice);
  const playing = pv.status === 'playing';
  const busy = pv.status === 'starting';
  return html`<section class="hero" aria-labelledby="hero-title">
    <div>
      <p class=${`status ${st.cls}`} role="status"><span class="dot"></span>${st.text}</p>
      <h1 id="hero-title">Твоя волна.</h1>
      <p class="lead">Бесконечный поток из знакомого и нового. Звук играет Spotify, а волна учится на твоих лайках и пропусках.</p>
      <div class="hero-actions">
        <button class="btn primary play-hero" disabled=${busy} onClick=${() => app.actions.toggle()}>
          <${Icon} n=${playing ? 'pause' : 'play'} fill=${true} /><span>${playing ? 'Пауза' : pv.status === 'paused' ? 'Продолжить' : 'Слушать волну'}</span>
        </button>
        <button class="btn ghost" onClick=${() => app.actions.shake()} disabled=${!pv.current && pv.reserved.length === 0}><${Icon} n="refresh" />Обновить поток</button>
      </div>
    </div>
    <div class="record"><${Record} /></div>
  </section>`;
};

const TrackSkeleton = () => html`<div class="now" aria-busy="true" aria-label="Загрузка трека">
  <div class="cover skeleton"></div>
  <div><div class="skeleton sk-line" style="width:40%"></div><div class="skeleton sk-line" style="height:30px;width:80%"></div><div class="skeleton sk-line" style="width:50%"></div><div class="skeleton sk-line" style="width:70%;margin-top:22px"></div></div>
</div>`;

export const CurrentTrack = ({ app, view }) => {
  const pv = view.player;
  const rec = pv.current;
  const [menu, setMenu] = useState(false);
  if (!rec && pv.status === 'starting') return html`<section class="card"><${TrackSkeleton} /></section>`;
  if (!rec) {
    return html`<section class="card"><div class="empty">
      <h3>${view.taste.hasTaste ? 'Волна ещё не запущена' : 'Пока нечего подбирать'}</h3>
      <p>${view.taste.hasTaste ? 'Нажми «Слушать волну», и первый трек заиграет в твоём Spotify.' : 'Выбери жанры в настройках, чтобы волна поняла, с чего начать.'}</p>
      <button class="btn primary" onClick=${() => app.actions.start()}><${Icon} n="play" fill=${true} />Слушать волну</button>
    </div></section>`;
  }
  const t = rec.track;
  const genre = rec.genres?.[0];
  const mood = view.settings.mood ? view.moods[view.settings.mood]?.label : null;
  const reason = rec.source !== 'external' ? rec.why?.[0] : null;
  const year = yearOf(t);
  return html`<section class="card" aria-label="Сейчас играет">
    <div class="now">
      <${Cover} track=${t} />
      <div style="min-width:0">
        ${(genre || year) && html`<p class="overline">${[genre, year].filter(Boolean).join(' · ')}</p>`}
        <h2 id="current-track">${t.name}</h2>
        <p class="artist" id="current-artist">${t.artists.map((a) => a.name).join(', ')}</p>
        <div class="tags">
          ${genre && html`<span class="tag">${genre}</span>`}
          ${mood && html`<span class="tag">${mood}</span>`}
          ${t.explicit && html`<span class="tag">Explicit</span>`}
        </div>
        ${reason && html`<p class="reason" id="track-reason"><${Icon} n="spark" />${reason}</p>`}
        <div class="actions" role="group" aria-label="Оценка трека">
          <button class=${`act round${pv.liked ? ' on' : ''}`} aria-pressed=${pv.liked} aria-label="Нравится" title="Нравится (L)" onClick=${() => app.actions.like()}><${Icon} n="heart" fill=${pv.liked} /></button>
          <button class="act round" aria-label="Не нравится" title="Не нравится, следующий (D)" onClick=${() => app.actions.dislike()}><${Icon} n="thumbDown" /></button>
          <button class="act" title="Слабый сигнал: такого станет меньше, но без дизлайка" onClick=${() => app.actions.less()}><${Icon} n="minus" />Меньше такого</button>
          <button class=${`act${pv.saved ? ' on' : ''}`} aria-pressed=${pv.saved} onClick=${() => (pv.saved ? app.actions.unsave() : app.actions.save())}><${Icon} n=${pv.saved ? 'check' : 'plus'} />${pv.saved ? 'В медиатеке' : 'В медиатеку'}</button>
          <span style="position:relative">
            <button class="act round" aria-label="Другие действия" aria-haspopup="menu" aria-expanded=${menu} onClick=${() => setMenu((m) => !m)}><${Icon} n="more" /></button>
            ${menu && html`<${CurrentMenu} app=${app} rec=${rec} onClose=${() => setMenu(false)} />`}
          </span>
        </div>
      </div>
    </div>
  </section>`;
};

const CurrentMenu = ({ app, rec, onClose }) => {
  const ref = usePopover(onClose);
  const artist = rec.track.artists[0];
  return html`<div class="pop" role="menu" ref=${ref} style="position:absolute;right:0;top:46px;z-index:10">
    ${artist && html`<button class="item danger" role="menuitem" onClick=${() => { onClose(); app.actions.excludeArtist(); }}><${Icon} n="userX" />Не играть ${artist.name}</button>`}
    <button class="item" role="menuitem" onClick=${() => { onClose(); app.actions.more(); }}><${Icon} n="bolt" />Больше такого</button>
    <div class="sep"></div>
    <a class="item" role="menuitem" href=${`https://open.spotify.com/track/${rec.track.id}`} target="_blank" rel="noreferrer"><${Icon} n="external" />Открыть в Spotify</a>
  </div>`;
};

export const Taste = ({ app, view, openDialog }) => {
  const s = view.settings;
  const d = effectiveDiscovery(s);
  const dis = Math.round(d * 100);
  const wave = s.mode === 'wave';
  const top = view.taste.topArtists.slice(0, 4);
  const explain = {
    wave: 'Доли показывают политику подбора. Это не прогноз для каждого трека.',
    favorite: 'Режим «Любимое»: только артисты, которых ты уже знаешь.',
    unfamiliar: 'Режим «Незнакомое»: только то, чего ты ещё не слушал.',
    instrumental: 'Режим «Без слов»: ищем по жанрам и названиям, точных данных у Spotify нет.',
  }[s.mode];
  return html`<section class="card" aria-label="Баланс вкуса">
    <div class="card-head"><h2>Баланс вкуса</h2><button class="btn quiet" onClick=${() => openDialog('taste')}>Профиль вкуса</button></div>
    <div class="balance">
      <div class="meter-row"><span>Знакомое</span><div class="meter"><i class="fam" style=${`width:${100 - dis}%`}></i></div><b id="familiar-value">${100 - dis}%</b></div>
      <div class="meter-row"><span>Новое</span><div class="meter"><i class="dis" style=${`width:${dis}%`}></i></div><b id="discovery-value">${dis}%</b></div>
    </div>
    ${wave && html`<input class="range" type="range" min="0" max="100" step="5" value=${Math.round(s.discovery * 100)} aria-label="Доля нового" onChange=${(e) => app.actions.setSettings({ discovery: Number(e.target.value) / 100 })} />`}
    <p class="explain">${explain}</p>
    <div class="avatars">
      ${top.map((a) => html`<span class="av" title=${a.name} style=${`background:${colorOf(a.id)}`}>${initials(a.name)}</span>`)}
      <span class="t">${view.taste.knownArtists > 0 ? `${view.taste.knownArtists} знакомых артистов в профиле` : 'Профиль пока пуст'}</span>
    </div>
  </section>`;
};

export const RowMenu = ({ app, rec, locked, onClose, pos }) => {
  const ref = usePopover(onClose);
  const artist = rec.track.artists[0];
  return html`<div class="pop" role="menu" ref=${ref} style=${`top:${pos.top}px;left:${pos.left}px`}>
    <button class="item" role="menuitem" onClick=${() => { onClose(); app.actions.jumpTo(rec.track.id); }}><${Icon} n="play" fill=${true} />Играть сейчас</button>
    ${locked
      ? html`<p style="margin:6px 12px;color:var(--faint);font-size:12px;max-width:230px">Уже в очереди Spotify, убрать отсюда нельзя.</p>`
      : html`<button class="item" role="menuitem" onClick=${() => { onClose(); app.actions.dropPlanned(rec.track.id); }}><${Icon} n="minus" />Не хочу этот трек</button>`}
    ${artist && html`<button class="item danger" role="menuitem" onClick=${() => { onClose(); app.actions.excludeArtistOf(rec); }}><${Icon} n="userX" />Не играть ${artist.name}</button>`}
    <div class="sep"></div>
    <a class="item" role="menuitem" href=${`https://open.spotify.com/track/${rec.track.id}`} target="_blank" rel="noreferrer"><${Icon} n="external" />Открыть в Spotify</a>
  </div>`;
};

export const Queue = ({ app, view, openDialog, limit = 6, full = false }) => {
  const pv = view.player;
  const items = [...pv.queued.map((r) => ({ r, locked: true })), ...pv.reserved.map((r) => ({ r, locked: false }))].slice(0, full ? 50 : limit);
  const [menu, setMenu] = useState(null);
  const open = (e, it) => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); setMenu({ it, pos: { top: Math.min(b.bottom + 4, window.innerHeight - 220), left: Math.max(8, b.right - 230) } }); };
  return html`<section class=${full ? '' : 'card'} aria-label="Дальше">
    ${!full && html`<div class="card-head"><h2>Дальше</h2><span class="count" id="queue-count">${String(items.length).padStart(2, '0')}</span></div>`}
    ${items.length === 0
      ? html`<div class="empty"><h3>${pv.current ? 'Волна набирает следующий трек' : 'Очередь пуста'}</h3><p>${pv.current ? 'Подборка ещё не готова. Обнови поток или подожди пару секунд.' : 'Запусти волну, и здесь появятся следующие треки.'}</p><button class="btn ghost small" onClick=${() => (pv.current ? app.actions.shake() : app.actions.start())}>${pv.current ? 'Обновить поток' : 'Слушать волну'}</button></div>`
      : html`<div class="rows" role="list">${items.map(({ r, locked }, i) => html`
        <div class=${`track-row${i === 0 ? ' next-up' : ''}`} role="listitem" tabindex="0" aria-label=${`Играть ${r.track.name}`} data-track=${r.track.id}
          onClick=${() => app.actions.jumpTo(r.track.id)} onKeyDown=${(e) => { if (e.key === 'Enter') app.actions.jumpTo(r.track.id); }}>
          <span class="num">${String(i + 1).padStart(2, '0')}</span>
          <div class="t-cell"><${Cover} track=${r.track} cls="thumb" small=${true} /><div style="min-width:0"><b>${r.track.name}</b><small>${r.track.artists.map((a) => a.name).join(', ')}</small></div></div>
          <span class="t-reason">${r.why?.[0] && html`<i class=${`dot-c ${dotClass(r.source)}`}></i><span class="txt">${r.why[0]}</span>`}</span>
          <span class="t-dur">${fmt(r.track.durationMs)}</span>
          <button class="row-more" aria-label="Действия с треком" aria-haspopup="menu" onClick=${(e) => open(e, { r, locked })}>···</button>
        </div>`)}</div>`}
    ${menu && html`<${RowMenu} app=${app} rec=${menu.it.r} locked=${menu.it.locked} pos=${menu.pos} onClose=${() => setMenu(null)} />`}
    ${!full && items.length > 0 && html`<p class="locked-hint">Первые ${pv.queued.length} уже стоят в очереди Spotify. Остальное волна пересоберёт после твоих оценок. <button class="link" onClick=${() => openDialog('queue')}>Вся очередь</button></p>`}
  </section>`;
};

export const Presets = ({ app, view, openDialog }) => {
  const active = view.presets.find((p) => p.id === view.preset);
  return html`<section class="card" aria-label="Настройка волны">
    <div class="card-head"><h2>Настроить волну</h2><button class="btn quiet" onClick=${() => openDialog('settings')}><${Icon} n="gear" size="16" />Все настройки</button></div>
    <div class="presets" role="group" aria-label="Пресеты">
      ${view.presets.map((p, i) => html`<button class=${`chip${i === 2 ? ' violet' : ''}`} aria-pressed=${view.preset === p.id} onClick=${() => app.actions.applyPreset(p.id)}>${p.label}</button>`)}
    </div>
    <p class="preset-hint">${active ? active.hint : 'Свои настройки: меняй доли и режим во всех настройках.'}</p>
  </section>`;
};
