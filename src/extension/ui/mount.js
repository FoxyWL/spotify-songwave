// Монтирование интерфейса в Shadow DOM: стили Spotify не влияют на нас, наши не влияют на Spotify.
import { render } from 'preact';
import { html } from 'htm/preact';
import css from './styles.css';
import { Root } from './root.js';

const FONTS = [
  { family: 'Songwave Manrope', file: 'fonts/manrope-latin-wght-normal.woff2', range: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
  { family: 'Songwave Manrope', file: 'fonts/manrope-cyrillic-wght-normal.woff2', range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
  { family: 'Songwave DM Sans', file: 'fonts/dm-sans-latin-wght-normal.woff2', range: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
];

/** Шрифты грузим как бинарные данные: так CSP страницы Spotify (font-src) их не блокирует. Без них работает системный шрифт. */
async function loadFonts() {
  await Promise.all(FONTS.map(async (f) => {
    try {
      const buf = await (await fetch(chrome.runtime.getURL(f.file))).arrayBuffer();
      const face = new FontFace(f.family, buf, { weight: '200 800', unicodeRange: f.range, display: 'swap' });
      document.fonts.add(await face.load());
    } catch { /* системный шрифт */ }
  }));
}

export function mountUi({ app, doc = document }) {
  const host = doc.createElement('div');
  host.id = 'songwave-root';
  host.style.setProperty('all', 'initial', 'important');
  const shadow = host.attachShadow({ mode: 'open' });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css); // конструируемые стили не подпадают под style-src страницы
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const st = doc.createElement('style'); st.textContent = css; shadow.appendChild(st);
  }
  const mount = doc.createElement('div');
  mount.className = 'sw';
  shadow.appendChild(mount);
  // Spotify слушает горячие клавиши на document; не даём нашим нажатиям дойти до них
  for (const ev of ['keydown', 'keyup', 'keypress']) host.addEventListener(ev, (e) => e.stopPropagation());
  doc.documentElement.appendChild(host);
  loadFonts();

  const subs = new Set();
  const ui = {
    app, open: false, onOpen: null,
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    setOpen(v) { ui.open = !!v; subs.forEach((f) => f(ui)); if (v) ui.opened?.(); },
  };
  render(html`<${Root} ui=${ui} />`, mount);
  return { ui, host, shadow };
}
