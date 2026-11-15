// Нижняя панель: управляет тем же Spotify-плеером, не создаёт второй.
import { html } from 'htm/preact';
import { useRef, useState } from 'preact/hooks';
import { Icon, Cover, fmt, useClock, usePopover } from './kit.js';

const Seek = ({ app, pv }) => {
  const rail = useRef(null);
  const pos = useClock(app.playback, pv.status === 'playing');
  const dur = pv.duration || 0;
  const ratio = dur ? Math.min(1, pos / dur) : 0;
  const seekTo = (clientX) => {
    const r = rail.current.getBoundingClientRect();
    app.actions.seek(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * dur);
  };
  const key = (e) => {
    if (!dur) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); app.actions.seek(Math.min(dur, pos + 5000)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); app.actions.seek(Math.max(0, pos - 5000)); }
  };
  return html`<div class="seek">
    <span id="elapsed-time">${fmt(pos)}</span>
    <div class="rail" ref=${rail} role="slider" tabindex=${dur ? 0 : -1} aria-label="Позиция в треке" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(ratio * 100)} aria-valuetext=${`${fmt(pos)} из ${fmt(dur)}`}
      onClick=${(e) => dur && seekTo(e.clientX)} onKeyDown=${key}>
      <i id="progress-fill" style=${`width:${ratio * 100}%`}></i><b class="knob" style=${`left:${ratio * 100}%`}></b>
    </div>
    <span id="duration-time">${fmt(dur)}</span>
  </div>`;
};

const Devices = ({ app, onClose }) => {
  const ref = usePopover(onClose);
  const list = app.state.devices;
  return html`<div class="pop" role="menu" ref=${ref} style="position:absolute;right:0;bottom:48px;min-width:260px">
    <h4>Устройства Spotify</h4>
    ${list.length === 0 && html`<p style="margin:6px 12px 10px;color:var(--muted);font-size:13px;max-width:240px">Устройств не видно. Открой Spotify Web Player или приложение на любом устройстве и обнови список.</p>`}
    ${list.map((d) => html`<button class=${`dev${d.active ? ' active' : ''}`} role="menuitem" onClick=${() => { onClose(); app.actions.selectDevice(d.id); }}><${Icon} n="device" /><span>${d.name}<small>${d.active ? 'Играет здесь' : d.type}</small></span></button>`)}
    <div class="sep"></div>
    <button class="item" role="menuitem" onClick=${() => app.actions.loadDevices()}><${Icon} n="refresh" />Обновить список</button>
  </div>`;
};

export const Player = ({ app, view, openDialog }) => {
  const pv = view.player;
  const rec = pv.current;
  const [devOpen, setDevOpen] = useState(false);
  const [vol, setVol] = useState(65);
  const active = app.state.devices.find((d) => d.active);
  const playing = pv.status === 'playing';
  return html`<footer class="player" aria-label="Плеер">
    <div class="p-left">
      ${rec ? html`<${Cover} track=${rec.track} cls="thumb" small=${true} /><div class="meta"><b id="player-track-title">${rec.track.name}</b><small id="player-track-artist">${rec.track.artists.map((a) => a.name).join(', ')}</small></div>
        <button class=${`icon-btn${pv.liked ? ' on' : ''}`} aria-label="Нравится" aria-pressed=${pv.liked} onClick=${() => app.actions.like()}><${Icon} n="heart" fill=${pv.liked} /></button>`
        : html`<div class="meta"><small>Волна ещё не запущена</small></div>`}
    </div>
    <div class="p-mid">
      <div class="ctrls">
        <button class="ctrl" aria-label="В начало трека" disabled=${!rec} onClick=${() => app.actions.previous()}><${Icon} n="prev" fill=${true} /></button>
        <button class="ctrl play" aria-label=${playing ? 'Пауза' : 'Воспроизвести'} disabled=${pv.status === 'starting'} data-action="toggle-play" onClick=${() => app.actions.toggle()}><${Icon} n=${playing ? 'pause' : 'play'} fill=${true} /></button>
        <button class="ctrl" aria-label="Следующий трек" disabled=${!rec} onClick=${() => app.actions.next()}><${Icon} n="next" fill=${true} /></button>
      </div>
      <${Seek} app=${app} pv=${pv} />
    </div>
    <div class="p-right">
      ${active && html`<span class="dev-chip" title=${active.name}>${active.name}</span>`}
      <button class="icon-btn" aria-label="Очередь" onClick=${() => openDialog('queue')}><${Icon} n="queue" /></button>
      <span style="position:relative">
        <button class=${`icon-btn${devOpen ? ' on' : ''}`} aria-label="Устройства" aria-haspopup="menu" aria-expanded=${devOpen} onClick=${() => { if (!devOpen) app.actions.loadDevices(); setDevOpen((o) => !o); }}><${Icon} n="device" /></button>
        ${devOpen && html`<${Devices} app=${app} onClose=${() => setDevOpen(false)} />`}
      </span>
      <div class="vol"><${Icon} n="volume" size="18" /><input type="range" min="0" max="100" value=${vol} aria-label="Громкость" onInput=${(e) => setVol(Number(e.target.value))} onChange=${(e) => app.actions.setVolume(Number(e.target.value))} /></div>
    </div>
  </footer>`;
};
