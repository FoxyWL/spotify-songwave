// Мелкие общие части интерфейса: иконки, форматирование, хуки.
import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';

const P = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  next: 'M6 18l8.5-6L6 6v12zM16 6h2v12h-2z',
  prev: 'M18 6v12l-8.5-6L18 6zM6 6h2v12H6z',
  heart: 'M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.4 5 6.5 5c2 0 3.7 1.1 5.5 3.3C13.8 6.1 15.5 5 17.5 5c3.1 0 5 3 3.8 6.3-1.8 4.6-9.3 9.2-9.3 9.2z',
  thumbDown: 'M10 15H5.5a2 2 0 0 1-2-2.4l1.2-5.6A2 2 0 0 1 6.7 5.5H17v9.2l-3.4 5.3a1.6 1.6 0 0 1-3-.9V15z M17 5.5h3v9h-3',
  minus: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12h8',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13a7.7 7.7 0 0 0 .1-2l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.5 7.5 0 0 0-1.7 1l-2.3-.9-2 3.4 2 1.5a7.700 7.700 0 0 0 0 2l-2 1.5 2 3.400 2.300-.9c.5.4 1.100.7 1.700 1l.4 2.500h4l.4-2.500c.6-.3 1.200-.6 1.700-1l2.300.9 2-3.400-2-1.500z',
  device: 'M4 5h16v11H4zM8 20h8M12 16v4',
  volume: 'M4 9.500v5h4l5 4v-13l-5 4H4zM16.500 8.500a5 5 0 0 1 0 7',
  queue: 'M4 6h12M4 11h12M4 16h7M17 14v6l5-3z',
  refresh: 'M20 11a8 8 0 0 0-14.500-4M4 4v4h4M4 13a8 8 0 0 0 14.500 4M20 20v-4h-4',
  spark: 'M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800z',
  back: 'M15 5l-7 7 7 7',
  userX: 'M15 19v-1.500a4 4 0 0 0-4-4H6.500a4 4 0 0 0-4 4V19M9 10.500a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM17 8l5 5M22 8l-5 5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  bolt: 'M13 3L5 13.500h6L10 21l8-10.500h-6z',
  copy: 'M9 9h10v11H9zM5 15V4h10',
};

export const Icon = ({ n, fill = false, size }) => html`<svg viewBox="0 0 24 24" width=${size} height=${size} fill=${fill ? 'currentColor' : 'none'} stroke=${fill ? 'none' : 'currentColor'} stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${P[n]} /></svg>`;

export const Mark = ({ className = 'mark' }) => html`<svg class=${className} viewBox="0 0 128 128" aria-hidden="true">
  <defs><linearGradient id="swg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1ED760"/><stop offset="1" stop-color="#A58AFF"/></linearGradient></defs>
  <circle cx="64" cy="64" r="60" fill="url(#swg)"/>
  <path d="M22 66c9-22 20-22 29 0s20 22 29 0 14-15 21-6" fill="none" stroke="#101010" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const Eq = () => html`<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>`;

/** Декоративная пластинка в hero. Не связана со звуком, только крутится, пока играет волна. */
export const Record = () => html`<svg viewBox="0 0 300 300" aria-hidden="true">
  <defs>
    <radialGradient id="rg" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#232323"/><stop offset="1" stop-color="#0b0b0b"/></radialGradient>
    <linearGradient id="rl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A58AFF"/><stop offset="1" stop-color="#9CF3D0"/></linearGradient>
  </defs>
  <circle cx="150" cy="150" r="146" fill="url(#rg)" stroke="#2c2c2c" stroke-width="2"/>
  ${[128, 112, 96, 80].map((r) => html`<circle cx="150" cy="150" r=${r} fill="none" stroke="#1a1a1a" stroke-width="1.5"/>`)}
  <path d="M60 150c14-34 30-34 45 0s30 34 45 0 30-34 45 0 30 34 45 0" fill="none" stroke="url(#rl)" stroke-width="5" stroke-linecap="round" opacity=".8"/>
  <circle cx="150" cy="150" r="46" fill="url(#rl)"/>
  <circle cx="150" cy="150" r="7" fill="#101010"/>
</svg>`;

export const fmt = (ms) => {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const yearOf = (t) => (t?.album?.releaseDate || '').slice(0, 4);
export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '♪';
const COLORS = ['#a58aff', '#9cf3d0', '#ffb27a', '#7ab8ff', '#1ed760'];
export const colorOf = (id = '') => COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
export const dotClass = (id) => ['', 'mint', 'orange', 'blue'][[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % 4];

export const Cover = ({ track, cls = 'cover', small = false }) => {
  const src = small ? track?.album?.imageSmall || track?.album?.image : track?.album?.image;
  return html`<div class=${cls}>${src ? html`<img src=${src} alt="" loading="lazy" referrerpolicy="no-referrer" />` : html`<span class="ph">${initials(track?.artists?.[0]?.name)}</span>`}</div>`;
};

/** Перерисовка по подписке на app. Все изменения состояния приходят через emit() и сливаются в один кадр. */
export function useApp(app) {
  const [, set] = useState(0);
  useEffect(() => {
    let raf = 0;
    const off = app.subscribe(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; set((n) => n + 1); }); });
    return () => { off(); cancelAnimationFrame(raf); };
  }, [app]);
}

/** Позиция трека: тикает локально, источник истины — плеер. */
export function useClock(playback, active) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => set((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [playback, active]);
  return playback.position();
}

// Escape обрабатывает только самый верхний слой (меню, затем диалог, затем оверлей).
const escStack = [];
let escBound = false;
function bindEsc() {
  if (escBound) return;
  escBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !escStack.length) return;
    e.stopPropagation();
    escStack[escStack.length - 1]();
  }, true);
}
export function useEscape(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    bindEsc();
    const h = () => ref.current();
    escStack.push(h);
    return () => { const i = escStack.indexOf(h); if (i >= 0) escStack.splice(i, 1); };
  }, []);
}

/** Закрыть всплывающее меню по клику вне и по Escape. */
export function usePopover(onClose) {
  const ref = useRef(null);
  useEscape(onClose);
  useEffect(() => {
    const down = (e) => { if (ref.current && !e.composedPath().includes(ref.current)) onClose(); };
    const t = setTimeout(() => document.addEventListener('pointerdown', down, true), 0);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', down, true); };
  }, [onClose]);
  return ref;
}

export const Modal = ({ title, onClose, wide, children }) => {
  const ref = useRef(null);
  useEscape(onClose);
  useEffect(() => { const prev = document.activeElement; ref.current?.querySelector('button, input')?.focus(); return () => prev?.focus?.(); }, []);
  return html`<div class="scrim" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class=${`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label=${title} ref=${ref}>
      <header><h2>${title}</h2><button class="icon-btn" aria-label="Закрыть" onClick=${onClose}><${Icon} n="close" /></button></header>
      <div class="body">${children}</div>
    </div>
  </div>`;
};
