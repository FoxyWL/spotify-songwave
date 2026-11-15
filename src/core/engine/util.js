export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const norm = (s) => String(s ?? '').trim().toLowerCase();
export const sigmoid = (z) => 1 / (1 + Math.exp(-z));
export const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

export function mulberry32(seed) {
  let a = seed | 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function weightedPick(items, weightOf, rng) {
  let total = 0;
  const ws = items.map((it) => { const w = Math.max(0, weightOf(it)); total += w; return w; });
  if (!items.length) return undefined;
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function timeBucket(ts) {
  const h = new Date(ts).getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'day';
  if (h >= 17 && h < 23) return 'evening';
  return 'night';
}
export const isWeekend = (ts) => { const d = new Date(ts).getDay(); return d === 0 || d === 6; };
/** Контекст слушания: будни/выходные × время суток (аналог «гиперконтекста» Яндекса, без данных об устройстве). */
export const contextKey = (ts) => `${isWeekend(ts) ? 'we' : 'wd'}-${timeBucket(ts)}`;

/** Ключ «той же песни»: без ремастеров/live/remix-хвостов, чтобы одна и та же песня с разных альбомов не повторялась. */
export function trackKey(t) {
  const name = norm(t.name).replace(/\s*[-–(\[]\s*(\d{4}\s*)?(remaster(ed)?|remix|live|mono|stereo|radio edit|edit|version|deluxe|bonus).*$/i, '');
  return `${name}|${t.artists?.[0]?.id ?? norm(t.artists?.[0]?.name)}`;
}
