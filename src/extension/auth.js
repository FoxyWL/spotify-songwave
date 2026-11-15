// Авторизация Spotify для расширения: Authorization Code + PKCE через chrome.identity.launchWebAuthFlow.
// Работает в service worker. Client secret не нужен и не хранится; токены живут только в chrome.storage.local
// и никогда не передаются в страницу Spotify или в content script.
import { SCOPES, AUTH_BASE } from '../config.js';

export class AuthError extends Error {
  constructor(message, code = 'AUTH') { super(message); this.name = 'AuthError'; this.code = code; }
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a).slice(0, n); };
const challengeOf = async (v) => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));

export const isClientId = (v) => /^[a-f0-9]{32}$/i.test(String(v || '').trim());

/**
 * storage: { get(key) → Promise<any>, set(key, value) → Promise, remove(key) → Promise }
 * launchWebAuthFlow: ({ url, interactive }) → Promise<string> (итоговый redirect URL)
 */
export function createAuth({ storage, launchWebAuthFlow, redirectUri, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), scopes = SCOPES }) {
  let refreshing = null;

  const read = async () => (await storage.get('mw.auth')) || null;
  const clientId = async () => (await storage.get('mw.cid')) || '';

  async function tokenRequest(params) {
    const r = await fetchImpl(`${AUTH_BASE}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.error === 'invalid_grant') await storage.remove('mw.auth');
      throw new AuthError(`Spotify отклонил вход: ${j.error_description || j.error || r.status}`, j.error === 'invalid_grant' ? 'EXPIRED' : 'AUTH');
    }
    const prev = (await read()) || {};
    const saved = {
      access: j.access_token,
      refresh: j.refresh_token || prev.refresh,
      exp: now() + Math.max(30, (j.expires_in || 3600) - 60) * 1000,
      scope: j.scope || prev.scope || '',
    };
    await storage.set('mw.auth', saved);
    return saved;
  }

  return {
    async status() {
      const a = await read();
      const granted = new Set((a?.scope || '').split(' ').filter(Boolean));
      return {
        clientId: await clientId(),
        authed: !!a?.refresh,
        redirectUri,
        missingScopes: a ? scopes.filter((s) => !granted.has(s)) : [],
      };
    },

    async login(rawClientId) {
      const cid = String(rawClientId || '').trim();
      if (!isClientId(cid)) throw new AuthError('Client ID — это 32 символа из Spotify Dashboard', 'BAD_CLIENT_ID');
      await storage.set('mw.cid', cid);
      const verifier = rand(96);
      const state = rand(16);
      const params = new URLSearchParams({
        client_id: cid,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: scopes.join(' '),
        code_challenge_method: 'S256',
        code_challenge: await challengeOf(verifier),
        state,
      });
      let back;
      try {
        back = await launchWebAuthFlow({ url: `${AUTH_BASE}/authorize?${params}`, interactive: true });
      } catch (e) {
        throw new AuthError(/closed|cancel|did not approve|user/i.test(String(e?.message)) ? 'Вход отменён' : `Не удалось открыть вход Spotify: ${e?.message || e}`, 'CANCELLED');
      }
      const q = new URL(back).searchParams;
      if (q.get('error')) throw new AuthError(q.get('error') === 'access_denied' ? 'Доступ не разрешён' : `Spotify вернул ошибку: ${q.get('error')}`, 'DENIED');
      if (q.get('state') !== state) throw new AuthError('Не совпал state — начни вход заново', 'STATE');
      await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri, client_id: cid, code_verifier: verifier });
      return this.status();
    },

    /** Действующий access token; при необходимости обновляет его. force — после 401. */
    async token(force = false) {
      const a = await read();
      if (!a?.refresh) throw new AuthError('Нужно войти заново', 'EXPIRED');
      if (!force && a.access && now() < a.exp) return a.access;
      if (!refreshing) {
        const cid = await clientId();
        // присваиваем синхронно после await, чтобы параллельные вызовы не создали второй запрос
        refreshing ||= tokenRequest({ grant_type: 'refresh_token', refresh_token: a.refresh, client_id: cid }).finally(() => { refreshing = null; });
      }
      return (await refreshing).access;
    },

    async logout() { await storage.remove('mw.auth'); },
  };
}
