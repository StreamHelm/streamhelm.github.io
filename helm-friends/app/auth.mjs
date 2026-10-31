// Web app login (DESIGN §1.3): the cloud does Twitch's authorization-code flow and sends the browser back here with
// a one-time handoff in the hash (#hf=…). We trade it for our own opaque session token (POST /auth/handoff) and keep
// only that, in localStorage. No Twitch token ever reaches this page.

import { createApi } from '../ui/api.mjs';
import { safeStorage } from '../ui/store.mjs';

const KEY = 'hf.session';

/**
 * @param {{ apiBase:string, returnUrl:string, fetchFn?:typeof fetch, mode?:'web'|'local' }} o
 */
export function createSessionAuth({ apiBase, returnUrl, fetchFn, mode = 'web' }) {
  let token = mode === 'local' ? 'local' : safeStorage.get(KEY);
  const listeners = new Set();
  const api = createApi({ base: apiBase, fetchFn, auth: { header: () => (token && mode !== 'local' ? 'Session ' + token : null) } });

  return {
    mode,
    header: () => (token && mode !== 'local' ? 'Session ' + token : null),
    loggedIn: () => !!token,
    /** Handles a login handoff in the URL, if any. Returns { me } on a fresh login, or { error }. */
    async init() {
      const m = /[#&]hf=([A-Za-z0-9_\-.~]{16,128})/.exec(location.hash);
      if (!m || mode === 'local') return {};
      history.replaceState(null, '', location.pathname + location.search + '#/character');   // the handoff is single use: never leave it in the URL
      try {
        const r = await api.handoff(m[1]);
        token = r.session;
        safeStorage.set(KEY, token);
        return { me: r.me };
      } catch (e) { return { error: e }; }
    },
    login() {
      if (mode === 'local') return;
      location.assign(api.loginUrl(returnUrl));
    },
    async logout(wiped = false) {
      if (mode === 'local') return;
      if (!wiped) { try { await api.logout(); } catch { /* the session dies on the server anyway after 30 days */ } }
      token = null; safeStorage.del(KEY);
      for (const fn of listeners) fn();
    },
    /** The server said the session is no longer valid. */
    lost() { if (mode === 'local') return; token = null; safeStorage.del(KEY); },
    onChange(fn) { listeners.add(fn); },
  };
}
