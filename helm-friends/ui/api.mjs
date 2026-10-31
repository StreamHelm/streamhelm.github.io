// The cloud API client (CONTRACTS §6.1). One instance per page; the auth provider decides the Authorization header:
//   web app  → "Session <token>"   (auth.mjs, from the login handoff)
//   panel    → "Extension <jwt>"   (ext-auth.mjs, from Twitch.ext.onAuthorized)
//   StreamHelm (Sky, local) → none (the local server forwards as Sky through /m/as)

import { errText } from '../core/index.mjs';

/** A failed call: `code` is a CONTRACTS §9 ErrCode ('OFFLINE' when the server can't be reached at all). */
export class ApiError extends Error {
  constructor(status, code, message, body) {
    super(message || code);
    this.status = status; this.code = code; this.body = body || null;
  }
}

/** UI wording for an error code (the chat templates without the "@user" part). */
export function uiError(code, vars = {}) {
  if (code === 'OFFLINE') return "Can't reach the Helm Friends server right now.";
  const t = errText(code, { user: '', ...vars }).replace(/^@\s*/, '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : 'Something went wrong.';
}

/** A fresh idempotency key (CONTRACTS §6.3: the server namespaces it). */
export function newIdem() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {{ base:string, auth?:{ header():string|null }, fetchFn?:typeof fetch, timeoutMs?:number }} opts
 *   base = 'https://<cloud-host>/hf/v1' (no trailing slash)
 */
export function createApi({ base, auth = null, fetchFn = (...a) => fetch(...a), timeoutMs = 15000 }) {
  const root = String(base).replace(/\/+$/, '');
  const etags = new Map();   // path → { etag, body } for /catalog and /rewards

  async function call(method, path, body, { etag = false, authed = true } = {}) {
    const headers = { Accept: 'application/json' };
    const a = authed && auth ? auth.header() : null;
    if (a) headers.Authorization = a;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const cached = etag ? etags.get(path) : null;
    if (cached) headers['If-None-Match'] = cached.etag;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetchFn(root + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl && ctl.signal, credentials: 'omit', cache: 'no-store' });
    } catch (e) {
      throw new ApiError(0, 'OFFLINE', uiError('OFFLINE'));
    } finally { if (timer) clearTimeout(timer); }
    if (res.status === 304 && cached) return cached.body;
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok || !data || data.ok === false) {
      const code = (data && data.code) || (res.status === 401 ? 'LINK_REQUIRED' : res.status === 404 ? 'NOT_FOUND' : res.status === 429 ? 'RATE_LIMIT' : 'INTERNAL');
      // the server's own message is the most precise one (it knows the names: "Carol already has a challenge waiting.")
      const msg = data && typeof data.message === 'string' && data.message.trim() ? data.message.trim() : uiError(code, data || {});
      throw new ApiError(res.status, code, msg, data);
    }
    const tag = res.headers.get('ETag');
    if (etag && tag) etags.set(path, { etag: tag, body: data });
    return data;
  }

  const q = (o) => { const p = Object.entries(o).filter(([, v]) => v != null && v !== ''); return p.length ? '?' + p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : ''; };

  return {
    base: root,
    call,
    health: () => call('GET', '/health', undefined, { authed: false }),
    config: () => call('GET', '/config', undefined, { authed: false }),
    // auth (web app only)
    loginUrl: (returnUrl) => root + '/auth/twitch/start' + q({ return: returnUrl }),
    handoff: (handoff) => call('POST', '/auth/handoff', { handoff }, { authed: false }),
    logout: () => call('POST', '/auth/logout', {}),
    // me
    me: () => call('GET', '/me'),
    ledger: (before, limit = 50) => call('GET', '/me/ledger' + q({ before, limit })),
    settings: (patch) => call('PATCH', '/me/settings', patch),
    deleteMe: () => call('DELETE', '/me', { confirm: 'DELETE' }),
    // character + unlocks
    catalog: () => call('GET', '/catalog', undefined, { etag: true, authed: false }),
    unlocks: () => call('GET', '/me/unlocks'),
    unlock: (itemId, idem = newIdem()) => call('POST', '/me/unlocks', { itemId, idem }),
    character: () => call('GET', '/me/character'),
    saveCharacter: (spec, rev) => call('PUT', '/me/character', { spec, rev }),
    // channel unlocks
    rewards: () => call('GET', '/rewards', undefined, { etag: true, authed: false }),
    redeem: (id, input, idem = newIdem()) => call('POST', `/rewards/${encodeURIComponent(id)}/redeem`, input ? { input, idem } : { idem }),
    // predictions
    currentPrediction: () => call('GET', '/predictions/current', undefined, { authed: false }),
    bet: (predId, outcome, amount, idem = newIdem()) => call('POST', `/predictions/${encodeURIComponent(predId)}/bets`, { outcome, amount, idem }),
    // v1.11: daily check-in, open lobbies, joining one (heist: { amount, role })
    checkin: (idem = newIdem()) => call('POST', '/me/checkin', { idem }),
    lobbies: () => call('GET', '/lobbies', undefined, { authed: false }),
    joinGame: (id, body = {}, idem = newIdem()) => call('POST', `/games/${encodeURIComponent(id)}/join`, { ...body, idem }),
    // v1.14: challenges (fight / arm wrestle / Gleep Race) from the app; they run the same rules as the chat commands
    people: () => call('GET', '/stage/people'),
    challenges: () => call('GET', '/me/challenges'),
    challenge: (game, target, amount, idem = newIdem()) => call('POST', '/challenges', { game, target, amount: amount || null, idem }),
    answer: (id, op, idem = newIdem()) => call('POST', `/challenges/${encodeURIComponent(id)}/${op === 'accept' ? 'accept' : 'decline'}`, { idem }),
    leaderboard: (stat = 'earned', n = 10) => call('GET', '/leaderboard' + q({ stat, n }), undefined, { authed: false }),
    // realtime
    streamTicket: () => call('POST', '/stream/ticket', {}),
    streamUrl: (ticket) => root + '/stream' + q({ ticket }),
  };
}
