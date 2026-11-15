import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, isClientId } from '../../src/extension/auth.js';

const CID = 'a'.repeat(32);
const REDIRECT = 'https://abc.chromiumapp.org/';

function rig({ now = 1_000_000 } = {}) {
  const data = {};
  let t = now;
  const calls = [];
  const storage = { get: async (k) => data[k], set: async (k, v) => { data[k] = v; }, remove: async (k) => { delete data[k]; } };
  const fetchImpl = async (url, init) => {
    const body = new URLSearchParams(init.body);
    calls.push({ url, body });
    if (body.get('grant_type') === 'refresh_token' && body.get('refresh_token') === 'dead') return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
    return { ok: true, status: 200, json: async () => ({ access_token: `at${calls.length}`, refresh_token: body.get('grant_type') === 'authorization_code' ? 'rt1' : undefined, expires_in: 3600, scope: 'user-top-read user-library-read' }) };
  };
  const launched = [];
  const launchWebAuthFlow = async ({ url }) => {
    const u = new URL(url);
    launched.push(u);
    return `${REDIRECT}?code=thecode&state=${u.searchParams.get('state')}`;
  };
  const auth = createAuth({ storage, launchWebAuthFlow, redirectUri: REDIRECT, fetchImpl, now: () => t });
  return { auth, data, calls, launched, advance: (ms) => { t += ms; }, launchWebAuthFlow };
}

test('Client ID: ровно 32 hex-символа', () => {
  assert.ok(isClientId(CID));
  assert.ok(!isClientId('abc'));
  assert.ok(!isClientId(`${CID}x`));
});

test('вход: PKCE S256, redirect расширения, state проверяется, code меняется на токены', async () => {
  const r = rig();
  const st = await r.auth.login(CID);
  const u = r.launched[0];
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(u.searchParams.get('client_id'), CID);
  assert.ok(!u.searchParams.get('scope').includes('streaming'));
  const ex = r.calls[0].body;
  assert.equal(ex.get('grant_type'), 'authorization_code');
  assert.equal(ex.get('code'), 'thecode');
  // verifier соответствует challenge
  const { createHash } = await import('node:crypto');
  assert.equal(createHash('sha256').update(ex.get('code_verifier')).digest('base64url'), u.searchParams.get('code_challenge'));
  assert.ok(st.authed);
  assert.equal(st.clientId, CID);
  assert.ok(st.missingScopes.includes('user-modify-playback-state'), 'недодали права — об этом узнаём');
});

test('неверный Client ID не открывает окно входа', async () => {
  const r = rig();
  await assert.rejects(r.auth.login('нет'), (e) => e.code === 'BAD_CLIENT_ID');
  assert.equal(r.launched.length, 0);
});

test('подмена state отклоняется', async () => {
  const r = rig();
  const auth = createAuth({ storage: { get: async () => undefined, set: async () => {}, remove: async () => {} }, launchWebAuthFlow: async () => `${REDIRECT}?code=x&state=чужой`, redirectUri: REDIRECT, fetchImpl: r.calls.push.bind(r.calls) });
  await assert.rejects(auth.login(CID), (e) => e.code === 'STATE');
});

test('отказ пользователя и закрытое окно дают понятные ошибки', async () => {
  const mk = (flow) => createAuth({ storage: { get: async () => undefined, set: async () => {}, remove: async () => {} }, launchWebAuthFlow: flow, redirectUri: REDIRECT });
  await assert.rejects(mk(async () => `${REDIRECT}?error=access_denied`).login(CID), /Доступ не разрешён/);
  await assert.rejects(mk(async () => { throw new Error('The user did not approve access.'); }).login(CID), (e) => e.code === 'CANCELLED');
});

test('token: кэш до истечения, затем обновление; параллельные вызовы делят один запрос', async () => {
  const r = rig();
  await r.auth.login(CID);
  const n = r.calls.length;
  const a = await r.auth.token();
  assert.equal(r.calls.length, n, 'свежий токен не запрашивается заново');
  r.advance(3600 * 1000);
  const [x, y] = await Promise.all([r.auth.token(), r.auth.token()]);
  assert.equal(x, y);
  assert.equal(r.calls.length, n + 1);
  assert.notEqual(x, a);
  assert.equal(r.data['mw.auth'].refresh, 'rt1', 'refresh token сохраняется, если Spotify не прислал новый');
});

test('token(force) после 401 обновляет даже свежий токен', async () => {
  const r = rig();
  await r.auth.login(CID);
  const n = r.calls.length;
  await r.auth.token(true);
  assert.equal(r.calls.length, n + 1);
});

test('refresh token отозван: статус «не вошёл», ошибка EXPIRED', async () => {
  const r = rig();
  await r.auth.login(CID);
  r.data['mw.auth'].refresh = 'dead';
  r.advance(3600 * 1000);
  await assert.rejects(r.auth.token(), (e) => e.code === 'EXPIRED');
  assert.equal((await r.auth.status()).authed, false);
});

test('выход стирает токены, Client ID остаётся', async () => {
  const r = rig();
  await r.auth.login(CID);
  await r.auth.logout();
  const st = await r.auth.status();
  assert.equal(st.authed, false);
  assert.equal(st.clientId, CID);
});
