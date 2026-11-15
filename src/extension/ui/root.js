// Корень интерфейса: кнопка запуска и оверлей «Моя волна».
import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon, Mark, Eq, useApp, useEscape } from './kit.js';
import { Login, Loading, Onboarding, Fatal } from './screens.js';
import { Notice, Hero, CurrentTrack, Taste, Queue, Presets } from './dashboard.js';
import { Player } from './player.js';
import { Settings, TasteProfile, QueueDialog, Search } from './dialogs.js';

const Toasts = ({ app }) => html`<div class="toasts" role="status" aria-live="polite">${app.state.toasts.map((t) => html`<div class=${`toast ${t.kind}`}>${t.text}</div>`)}</div>`;

function Dashboard({ app, view, openDialog, dialog, closeDialog }) {
  const pv = view.player;
  return html`<div class="overlay-body">
    <${Notice} app=${app} />
    <${Hero} app=${app} pv=${pv} />
    <div class="grid">
      <div class="stack"><${CurrentTrack} app=${app} view=${view} /><${Taste} app=${app} view=${view} openDialog=${openDialog} /></div>
      <div class="stack"><${Queue} app=${app} view=${view} openDialog=${openDialog} /><${Presets} app=${app} view=${view} openDialog=${openDialog} /></div>
    </div>
    ${dialog === 'settings' && html`<${Settings} app=${app} view=${view} onClose=${closeDialog} />`}
    ${dialog === 'taste' && html`<${TasteProfile} view=${view} onClose=${closeDialog} />`}
    ${dialog === 'queue' && html`<${QueueDialog} app=${app} view=${view} openDialog=${openDialog} onClose=${closeDialog} />`}
    ${dialog === 'search' && html`<${Search} app=${app} onClose=${closeDialog} />`}
  </div>`;
}

export function Root({ ui }) {
  const { app } = ui;
  useApp(app);
  useApp(ui);
  const [dialog, setDialog] = useState(null);
  const openDialog = (d) => setDialog(d);
  const closeDialog = () => setDialog(null);
  const overlayRef = useRef(null);
  const view = app.view();
  const phase = app.state.phase;
  const ready = phase === 'ready' && view;

  useEffect(() => { if (ui.open && ui.onOpen) ui.onOpen(); }, [ui.open]);

  // Горячие клавиши работают, пока фокус внутри оверлея (он забирает фокус сам), и не доходят до Spotify.
  const onKeyDown = (e) => {
    const tag = e.composedPath()[0]?.tagName || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if (dialog || e.ctrlKey || e.metaKey || e.altKey || !ready) return;
    const k = e.key.toLowerCase();
    if (e.key === ' ' && !/BUTTON|^A$/.test(tag)) { e.preventDefault(); app.actions.toggle(); }
    else if (k === 'n') app.actions.next();
    else if (k === 'l') app.actions.like();
    else if (k === 'd') app.actions.dislike();
    else if (k === '/') { e.preventDefault(); setDialog('search'); }
  };
  const grabFocus = (e) => {
    if (!e.composedPath().some((n) => /^(BUTTON|INPUT|A|SELECT|TEXTAREA)$/.test(n.tagName || '') || n.getAttribute?.('tabindex') === '0')) overlayRef.current?.focus();
  };
  useEffect(() => { if (ui.open) setTimeout(() => overlayRef.current?.focus(), 0); }, [ui.open]);

  const close = () => ui.setOpen(false);
  if (!ui.open) {
    const live = ready && view.player.status === 'playing';
    return html`<button class=${`launcher${live ? ' live' : ''}`} aria-label="Открыть Мою волну" onClick=${() => ui.setOpen(true)}><${Mark} />Моя волна${live && html`<${Eq} />`}</button>`;
  }
  return html`<div class=${`overlay${ready && view.player.status === 'playing' ? ' is-playing' : ''}`} role="dialog" aria-label="Моя волна" ref=${overlayRef} data-phase=${phase} tabindex="-1" onKeyDown=${onKeyDown} onPointerDown=${grabFocus}>
    <${OverlayKeys} dialog=${dialog} close=${close} />
    <header class="topbar">
      <button class="back" onClick=${close} aria-label="Вернуться в Spotify"><${Icon} n="back" /><span>Spotify</span></button>
      <div class="brand"><${Mark} />Моя волна</div>
      <div class="spacer"></div>
      ${ready && html`<button class="icon-btn" aria-label="Найти трек" title="Найти трек (/)" onClick=${() => setDialog('search')}><${Icon} n="search" /></button>
      <button class="icon-btn" aria-label="Настройки" onClick=${() => setDialog('settings')}><${Icon} n="gear" /></button>`}
    </header>
    <main class="scroll"><div class="page">
      ${phase === 'boot' && html`<${Loading} app=${app} />`}
      ${phase === 'login' && html`<${Login} app=${app} />`}
      ${phase === 'loading' && html`<${Loading} app=${app} />`}
      ${phase === 'onboarding' && html`<${Onboarding} app=${app} />`}
      ${phase === 'fatal' && html`<${Fatal} app=${app} />`}
      ${ready && html`<${Dashboard} app=${app} view=${view} openDialog=${openDialog} dialog=${dialog} closeDialog=${closeDialog} />`}
    </div></main>
    ${ready ? html`<${Player} app=${app} view=${view} openDialog=${openDialog} />` : html`<div></div>`}
    <${Toasts} app=${app} />
  </div>`;
}

/** Escape закрывает оверлей, если открыт не диалог (диалоги ловят Escape сами). */
function OverlayKeys({ dialog, close }) {
  useEscape(dialog ? () => {} : close);
  return null;
}
