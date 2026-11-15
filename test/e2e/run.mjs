// E2E в настоящем Chromium: тестовая сборка расширения + локальный мок Spotify + поддельная open.spotify.com.
// Проверяет нашу логику и интерфейс. Реальный Spotify не затрагивается: живая проверка остаётся за spike (docs/SPIKE.md).
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { MockSpotify } from '../mock/spotify-mock.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(root, 'test/e2e/out');
const shots = resolve(out, 'shots');
const PORT = 9911;
const PAGE_PORT = PORT + 1;
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

rmSync(out, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });
execFileSync('node', ['scripts/build.mjs', '--test', `--port=${PORT}`], { cwd: root, stdio: 'inherit' });

// ---------- мок Spotify ----------
const mock = new MockSpotify({ seed: 7, timeScale: 1 }).setUser({ genres: ['indie rock', 'shoegaze', 'dream pop', 'post-punk', 'synthwave', 'lo-fi'] });
const apiServer = createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || 'null') : undefined;
    const path = u.pathname.replace(/^\/v1/, '');
    const r = mock.handle({ method: req.method, path, query: Object.fromEntries(u.searchParams), body, token: 'x' });
    res.writeHead(r.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...(r.headers || {}) });
    res.end(r.json == null ? '' : JSON.stringify(r.json));
  });
});

// ---------- поддельная «open.spotify.com»: враждебные стили и свои горячие клавиши ----------
const fakePage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Spotify – Web Player (fake)</title>
<style>*{color:#f0f !important;font-size:31px !important;font-family:Papyrus,fantasy !important;letter-spacing:5px !important}
body{margin:0;background:#121212;height:2000px}button{all:unset}</style></head>
<body><h1>Fake Spotify page</h1><script>
window.__keys = 0; document.addEventListener('keydown', () => { window.__keys++; });
</script></body></html>`;
const pageServer = createServer((req, res) => {
  if (req.url.startsWith('/image')) { res.writeHead(200); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fakePage);
});
await new Promise((r) => apiServer.listen(PORT, '127.0.0.1', r));
await new Promise((r) => pageServer.listen(PAGE_PORT, '127.0.0.1', r));

// ---------- проверки ----------
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const ctx = await chromium.launchPersistentContext(resolve(out, 'profile'), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${resolve(out, 'ext')}`, `--load-extension=${resolve(out, 'ext')}`],
});
// обложки: у Spotify это i.scdn.co, у нас — генерируемые градиенты
await ctx.route('https://i.scdn.co/**', (route) => {
  const id = route.request().url().split('/image/')[1] || 'x';
  const h = [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},60%,45%)"/><stop offset="1" stop-color="hsl(${(h + 70) % 360},55%,22%)"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>` });
});

let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const extId = new URL(sw.url()).host;
check('service worker расширения запущен, ID совпадает с ключом из манифеста', extId === 'jnnecfapddigjjfgddampilmakglkidf', extId);

const ALL_SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing user-top-read user-read-recently-played user-library-read user-library-modify user-follow-read playlist-read-private playlist-modify-private';
const seedAuth = () => sw.evaluate((scope) => chrome.storage.local.set({ 'mw.cid': 'a'.repeat(32), 'mw.auth': { access: 'at', refresh: 'rt', exp: Date.now() + 3600e3, scope } }), ALL_SCOPES);
const clearAll = () => sw.evaluate(() => chrome.storage.local.clear());

const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const url = `http://127.0.0.1:${PAGE_PORT}/`;
const q = (sel) => page.locator(sel);
const shot = (name) => page.screenshot({ path: resolve(shots, `${name}.png`) });
const text = async (sel) => (await q(sel).first().textContent({ timeout: 8000 }))?.trim();
const waitFor = async (fn, ms = 10000, step = 150) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch { /* ждём */ } await sleep(step); } return false; };

try {
  // ===== A. вход =====
  console.log('\nВход');
  await clearAll();
  await page.goto(url);
  await q('.launcher').waitFor({ timeout: 10000 });
  check('кнопка «Моя волна» появилась поверх страницы', await q('.launcher').isVisible());
  const fontSize = await q('.launcher').evaluate((el) => getComputedStyle(el).fontSize);
  const ls = await q('.launcher').evaluate((el) => getComputedStyle(el).letterSpacing);
  check('стили страницы (font-size, letter-spacing через *) не просачиваются в Shadow DOM', parseFloat(fontSize) < 20 && ls === 'normal', `font-size=${fontSize}, letter-spacing=${ls}`);
  await q('.launcher').click();
  await q('.panel h1').waitFor();
  check('показан экран входа с адресом перенаправления расширения', /chromiumapp\.org/.test(await text('.copy code')), await text('.copy code'));
  check('кнопка входа неактивна без корректного Client ID', await q('button[type=submit]').isDisabled());
  await shot('01-login');

  // ===== B. запуск =====
  console.log('\nЗапуск');
  await seedAuth();
  await page.reload();
  await q('.launcher').click();
  const ready = await waitFor(async () => (await q('.hero h1').count()) > 0, 20000);
  check('после входа загружена волна и показан главный экран', ready);
  await shot('02-ready-idle');
  check('статус честный: волна не запущена', /не запущена/.test(await text('.status')), await text('.status'));

  await q('.play-hero').click();
  const playing = await waitFor(async () => /Волна играет/.test(await text('.status')), 15000);
  check('«Слушать волну» запускает воспроизведение на устройстве Spotify', playing, await text('.status'));
  const cur = mock.p.current;
  check('в мок-Spotify реально играет трек, выбранный волной', !!cur);
  check('название трека на экране совпадает с тем, что играет в Spotify', (await text('#current-track')) === cur?.name, `${await text('#current-track')} / ${cur?.name}`);
  check('в очереди Spotify ровно 2 следующих трека', mock.p.queue.length === 2, String(mock.p.queue.length));
  check('нижний плеер показывает тот же трек', (await text('#player-track-title')) === cur?.name);
  await sleep(600);
  await shot('03-playing');

  // ===== C. управление =====
  console.log('\nУправление');
  const first = cur.id;
  await q('.player [aria-label="Следующий трек"]').click();
  check('«Следующий» переключает на трек из очереди Spotify', await waitFor(async () => mock.p.current.id !== first && (await text('#current-track')) === mock.p.current.name, 8000), mock.p.current?.name);
  check('автоплей Spotify не включался', mock.autoplayed.length === 0);

  await q('.actions [aria-label="Нравится"]').click();
  check('лайк переключает кнопку', await waitFor(async () => (await q('.actions [aria-label="Нравится"]').getAttribute('aria-pressed')) === 'true', 3000));
  check('лайк записан в профиль вкуса (chrome.storage)', await waitFor(async () => {
    const prof = await sw.evaluate(() => chrome.storage.local.get('mywave.profile'));
    return JSON.parse(prof['mywave.profile'] || '{}').log?.some((l) => l.type === 'like');
  }, 4000));
  check('лайк волны не пишет в медиатеку Spotify сам', mock.count(/^PUT \/me\/library$/) === 0);

  await q('.actions .act:has-text("В медиатеку")').click();
  check('«В медиатеку» отправляет PUT /me/library', await waitFor(async () => mock.count(/^PUT \/me\/library$/) === 1, 4000));
  check('кнопка показывает сохранённое состояние', await waitFor(async () => /В медиатеке/.test(await text('.actions .act[aria-pressed]:nth-of-type(4), .actions .act:has-text("В медиатеке")')), 3000));

  const prevTitle = await text('#current-track');
  await q('.actions [aria-label="Не нравится"]').click();
  check('дизлайк пропускает трек и играет следующий', await waitFor(async () => (await text('#current-track')) !== prevTitle, 8000));

  await q('.row-more').first().click();
  check('меню строки очереди открывается', await q('.pop [role=menuitem]').first().isVisible());
  await shot('04-row-menu');
  await page.keyboard.press('Escape');
  check('Escape закрывает меню, но не оверлей', (await q('.pop').count()) === 0 && (await q('.overlay').count()) === 1);

  // ===== D. пресеты и настройки =====
  console.log('\nНастройка волны');
  await q('.chip:has-text("Больше нового")').click();
  check('пресет «Больше нового» выбран (single-select)', await waitFor(async () => (await q('.chip:has-text("Больше нового")').getAttribute('aria-pressed')) === 'true' && (await q('.presets .chip[aria-pressed=true]').count()) === 1, 4000));
  check('доли «знакомое/новое» пересчитались из политики подбора', (await text('#discovery-value')) === '80%', await text('#discovery-value'));
  await q('[aria-label="Настройки"]').click();
  await q('.modal').waitFor();
  check('диалог настроек открыт и имеет роль dialog', (await q('.modal').getAttribute('role')) === 'dialog');
  await shot('05-settings');
  await q('.opt:has-text("Незнакомое")').click();
  check('режим «Незнакомое» применяется', await waitFor(async () => (await q('.opt:has-text("Незнакомое")').getAttribute('aria-pressed')) === 'true', 4000));
  await q('.modal [aria-label="Закрыть"]').click();
  await q('.card-head button:has-text("Профиль вкуса")').click();
  await q('.modal h2:has-text("Профиль вкуса")').waitFor();
  await shot('06-taste-profile');
  await page.keyboard.press('Escape');

  // ===== E. поиск =====
  console.log('\nПоиск');
  await q('[aria-label="Найти трек"]').click();
  const target = mock.cat.tracks[40];
  await q('.modal input').fill(target.name.split(' ')[0]);
  const found = await waitFor(async () => (await q('.modal .track-row').count()) > 0, 6000);
  check('поиск возвращает треки Spotify (limit ≤ 10)', found && (await q('.modal .track-row').count()) <= 10);
  await shot('07-search');
  const pickName = await text('.modal .track-row b');
  await q('.modal .track-row').first().click();
  check('выбранный в поиске трек заиграл, дальше волна', await waitFor(async () => (await text('#current-track')) === pickName, 8000), pickName);

  // ===== F. клавиатура и изоляция =====
  console.log('\nКлавиатура');
  const before = await page.evaluate(() => window.__keys);
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await q('.hero h1').click();
  await page.keyboard.press('Space');
  await sleep(700);
  const after = await page.evaluate(() => window.__keys);
  check('Space ставит на паузу', await waitFor(async () => mock.p.playing === false, 4000));
  check('нажатия клавиш не уходят в горячие клавиши Spotify', after === before, `${before} → ${after}`);
  await page.keyboard.press('Space');
  check('Space продолжает воспроизведение', await waitFor(async () => mock.p.playing === true, 4000));

  // ===== G. естественная смена треков =====
  console.log('\nСмена треков без автоплея');
  mock.timeScale = 90;
  const seen = new Set([mock.p.current.id]);
  const t0 = Date.now();
  while (Date.now() - t0 < 22000 && seen.size < 8) { seen.add(mock.p.current.id); await sleep(300); }
  mock.timeScale = 1;
  check('волна сменила несколько треков подряд', seen.size >= 5, `${seen.size} треков`);
  check('Spotify ни разу не включил свой автоплей', mock.autoplayed.length === 0, `autoplay=${mock.autoplayed.length}`);
  check('заголовок на экране следует за тем, что играет', await waitFor(async () => (await text('#current-track')) === mock.p.current.name, 6000));
  await shot('08-after-autoadvance');

  // ===== H. квота =====
  console.log('\nОшибки и лимиты');
  mock.exhaustQuota(60_000);
  await q('.hero-actions .btn.ghost').click();
  check('квота Spotify показана баннером, интерфейс жив', await waitFor(async () => (await q('.notice').count()) > 0 && /квот/i.test(await text('.notice')), 8000), await text('.notice').catch(() => ''));
  await shot('09-quota');
  mock.restoreQuota();
  await q('.notice [aria-label="Скрыть"]').click();
  check('баннер можно скрыть', await waitFor(async () => (await q('.notice').count()) === 0, 3000), await text('.notice').catch(() => ''));

  // ===== I. адаптив =====
  console.log('\nАдаптив');
  await page.setViewportSize({ width: 1000, height: 800 }); await sleep(300); await shot('10-tablet');
  check('на 1000px карточки в одну колонку', (await q('.grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)) === 1);
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(300); await shot('11-mobile');
  check('на 390px нет горизонтальной прокрутки', await q('main').evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  check('на 390px колонка причин скрыта', !(await q('.t-reason').first().isVisible()));
  await page.setViewportSize({ width: 1440, height: 900 });

  // ===== J. закрытие =====
  console.log('\nЗакрытие');
  await q('.back').click();
  check('«Назад в Spotify» закрывает оверлей, волна продолжает играть', await waitFor(async () => (await q('.overlay').count()) === 0, 3000) && mock.p.playing === true);
  check('на кнопке видна активность волны', await waitFor(async () => (await q('.launcher.live').count()) === 1, 3000));
  await shot('12-closed');
  await q('.launcher').click();
  check('повторное открытие не перезапускает волну', (await waitFor(async () => (await q('.hero h1').count()) === 1, 3000)) && mock.autoplayed.length === 0 && mock.count(/^PUT \/me\/player\/play$/) < 6);

  // ===== K. нет устройства =====
  console.log('\nНет устройства');
  await page.reload();
  mock.p.current = null; mock.p.playing = false; mock.p.deviceId = null;
  const savedDevices = mock.devices; mock.devices = [];
  await q('.launcher').click();
  await q('.play-hero').waitFor({ timeout: 20000 });
  await q('.play-hero').click();
  check('без устройства показано понятное сообщение с повтором', await waitFor(async () => (await q('.notice').count()) > 0 && /устройств/i.test(await text('.notice')), 8000), await text('.notice').catch(() => ''));
  await shot('13-no-device');
  mock.devices = savedDevices;
  await q('.notice .btn').click();
  check('после появления устройства «Повторить» запускает волну', await waitFor(async () => !!mock.p.current, 10000));

  // ===== L. истёкшая сессия =====
  console.log('\nСессия');
  await sw.evaluate(() => chrome.storage.local.remove('mw.auth'));
  await page.reload();
  await q('.launcher').click();
  check('без токенов снова экран входа', await waitFor(async () => (await q('.panel h1').count()) > 0 && /Подключи Spotify|заново/.test(await text('.panel h1')), 10000));
} catch (e) {
  check('сценарий завершился без исключений', false, e.message.split('\n')[0]);
  await page.screenshot({ path: resolve(shots, 'failure.png') }).catch(() => {});
}

const real = errors.filter((e) => !/Failed to load resource|favicon|net::ERR/i.test(e));
check('в консоли нет ошибок JavaScript', real.length === 0, real.slice(0, 3).join(' | '));
writeFileSync(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
await ctx.close();
apiServer.close(); pageServer.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено. Скриншоты: ${shots}`);
process.exit(failed.length ? 1 : 0);
