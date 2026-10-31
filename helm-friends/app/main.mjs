// Web app entry (GitHub Pages, and StreamHelm's embedded copy with auth 'local').

import { CONFIG } from './config.mjs';
import { createSessionAuth } from './auth.mjs';
import { mountApp, fatal } from '../ui/app-core.mjs';
import { toast } from '../ui/toast.mjs';

const root = document.getElementById('app');

(async () => {
  const returnUrl = CONFIG.pagesUrl || location.origin + location.pathname;
  const auth = createSessionAuth({ apiBase: CONFIG.apiBase, returnUrl, mode: CONFIG.auth === 'local' ? 'local' : 'web' });
  const login = await auth.init();
  const app = mountApp(root, {
    auth,
    config: {
      ...CONFIG,
      links: { privacy: 'legal/privacy.html', terms: 'legal/terms.html' },
    },
  });
  window.__hf = app;   // for the tests and for poking around in devtools
  if (login.me) toast(`Welcome, ${login.me.displayName}!`, { kind: 'win' });
  if (login.error) toast("The Twitch login didn't finish. Please try again.", { kind: 'error' });
})().catch((e) => fatal(root, 'Helm Friends could not start: ' + (e && e.message)));
