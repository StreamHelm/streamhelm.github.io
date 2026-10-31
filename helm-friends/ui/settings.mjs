// Settings (DESIGN §10): show/hide my character on stream, "always show me" for lurkers, log out, delete my data.

import { PSD } from '../core/index.mjs';
import { h, mount } from './h.mjs';
import { renderKeepingFocus } from './a11y.mjs';
import { confirmDialog } from './dialog.mjs';
import { toast } from './toast.mjs';

export function createSettings({ store, api, actions, mode }) {
  const el = h('section', { 'aria-labelledby': 'set-title' });

  function render() {
    const st = store.get(), me = st.me, f = (me && me.flags) || {};
    renderKeepingFocus(el, () => mount(el,
      h('h2', { class: 'page-title', id: 'set-title' }, 'Settings'),
      !st.loggedIn ? h('div', { class: 'card' }, h('p', null, mode === 'ext' ? 'Connect your Twitch name to change your settings.' : 'Log in to change your settings.'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => actions.login() }, mode === 'ext' ? 'Connect my Twitch name' : 'Log in with Twitch')) : [
        h('div', { class: 'card' },
          h('p', { class: 'muted small' }, `Logged in as ${me ? me.displayName : '…'}`),
          toggle('show', 'Show my character on stream', !f.hidden, (on) => ({ hidden: !on }),
            'When this is off, your character never appears (same as typing !hide in chat).'),
          toggle('always', 'Always show me, even when I just watch', !!f.alwaysShow, (on) => ({ alwaysShow: on }),
            'Normally your character appears when you chat. Turn this on to walk around while you lurk too.')),
        h('div', { class: 'card' },
          mode === 'web' ? h('button', { type: 'button', class: 'btn block', 'data-fk': 'logout', onclick: () => actions.logout() }, 'Log out') : null,
          h('button', { type: 'button', class: 'btn danger block', 'data-fk': 'delete', onclick: del }, 'Delete my data'),
          h('p', { class: 'small muted' }, `Deleting removes your name, character and unlocks. Your ${PSD} history is kept only without your name, so the channel's books still add up.`)),
      ]));
  }

  function toggle(key, label, on, patch, help) {
    const id = 'set-' + key;
    return h('div', null,
      h('label', { class: 'switch', for: id }, h('span', null, label),
        h('input', { type: 'checkbox', id, role: 'switch', checked: on, 'aria-describedby': id + '-d', 'data-fk': id,
          onchange: async (e) => {
            const want = e.target.checked;
            try { const r = await api.settings(patch(want)); if (r.me) store.set({ me: r.me }); toast('Saved.'); } catch (err) { e.target.checked = !want; toast(err.message, { kind: 'error' }); }
          } })),
      h('p', { class: 'small muted', id: id + '-d' }, help));
  }

  async function del() {
    const ok = await confirmDialog({
      title: 'Delete my data?', danger: true, confirmLabel: 'Delete my data', typeToConfirm: 'DELETE',
      body: ['This removes your name, your character and your unlocks from Helm Friends. It can\'t be undone.'],
    });
    if (!ok) return;
    try { await api.deleteMe(); toast('Your data was deleted.'); await actions.logout(true); } catch (e) { toast(e.message, { kind: 'error' }); }
  }

  store.subscribe((s, keys) => { if (keys.some((k) => ['me', 'loggedIn'].includes(k))) render(); });
  render();
  return { el };
}
