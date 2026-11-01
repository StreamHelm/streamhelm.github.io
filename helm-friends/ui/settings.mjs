// Settings (DESIGN §10): show/hide my character on stream, "always show me" for lurkers, log out, delete my data.

import { PSD, psd, fmt, nameOptions, hasNameTags, tagOfSpec } from '../core/index.mjs';
import { h, icon, mount } from './h.mjs';
import { renderKeepingFocus, announce } from './a11y.mjs';
import { confirmDialog } from './dialog.mjs';
import { toast } from './toast.mjs';
import { ApiError } from './api.mjs';
import { coinImg } from './shell.mjs';

export function createSettings({ store, api, actions, mode }) {
  let busyTag = false;
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
        nameCard(st, me, f),
        h('div', { class: 'card' },
          mode === 'web' ? h('button', { type: 'button', class: 'btn block', 'data-fk': 'logout', onclick: () => actions.logout() }, 'Log out') : null,
          h('button', { type: 'button', class: 'btn danger block', 'data-fk': 'delete', onclick: del }, 'Delete my data'),
          h('p', { class: 'small muted' }, `Deleting removes your name, character and unlocks. Your ${PSD} history is kept only without your name, so the channel's books still add up.`)),
      ]));
  }

  /**
   * v1.18 "Name & chat": hide my name / hide my chat bubbles (account flags, PATCH /me/settings) + my name colour, text box
   * shape and font = the character's `tag` (art v1.18 slots nameColor / tag / font), saved with the character (PUT
   * /me/character; a locked one is unlocked first, like the editor's "Unlock & save"). Live preview on top.
   */
  function nameCard(st, me, f) {
    const flags = { unlockAll: !!f.unlockAll, unique: (me && me.unique) || null };
    const spec = st.character && st.character.spec, cur = tagOfSpec(spec);
    const opts = nameOptions(st.catalog || { items: [] }, new Set(st.owned || []), flags);
    const color = opts.colors.find((c) => c.id === cur.name) || null, shape = opts.shapes.find((c) => c.id === cur.shape) || null;
    const tag = h('span', { class: ['name-tag', 'shape-' + String(cur.shape).replace(/^tag\./, ''), color && color.fx ? 'fx-' + color.fx : null, 'fx-' + String(cur.name).replace(/^nameColor\./, '')],
      'data-testid': 'name-preview-tag', 'data-shape': cur.shape, 'data-color': cur.name, 'data-font': cur.font }, (me && me.displayName) || 'You');
    if (color && color.css) tag.style.color = color.css;
    if (f.hideName) tag.style.opacity = '0.35';
    const pick = (key, list, curId, what) => h('div', { class: 'swatch-list', role: 'group', 'aria-label': what }, list.map((o) => {
      const dot = key === 'name' ? h('span', { class: 'swatch-dot', 'aria-hidden': 'true' }) : null;
      if (dot) dot.style.background = o.css || 'linear-gradient(90deg,#ff3b3b,#ffcf3f,#1fe20e,#3b7bff,#c98cf0)';
      return h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(o.id === curId), 'data-fk': `tag-${key}-${o.id}`, 'data-locked': o.locked ? '1' : null, disabled: busyTag,
        'aria-label': `${o.name}${o.locked ? `, locked, ${psd(o.price)}` : ''}`,
        onclick: () => setTag(key, o, what),
      }, dot, h('span', { class: 'sw-name' }, o.name), o.locked ? h('span', { class: 'sw-price' }, icon('lock'), fmt(o.price), coinImg('coin-sm')) : null);
    }));
    const pickers = st.loggedIn && hasNameTags(st.catalog) && spec ? [
      h('p', { class: 'small' }, 'Name colour'), pick('name', opts.colors, cur.name, 'Name colour'),
      h('p', { class: 'small' }, 'Text box shape'), pick('shape', opts.shapes, cur.shape, 'Text box shape'),
      opts.fonts.length ? [h('p', { class: 'small' }, 'Font'), pick('font', opts.fonts, cur.font, 'Font')] : null,
      h('p', { class: 'small muted' }, `The special colours and boxes (rainbow, glitter, neon…) cost ${PSD}; tap one to unlock it.`)]
      : h('p', { class: 'small muted', 'data-note': 'name-tags-soon' }, 'Name colours and box shapes are coming with the next art update.');
    void shape;
    return h('div', { class: 'card', 'data-card': 'name-chat' },
      h('h3', null, 'Name & chat'),
      h('div', { class: 'name-preview', 'aria-label': 'How your name looks on stream' }, tag),
      toggle('hidename', 'Hide my name on stream', !!f.hideName, (on) => ({ hideName: on }), 'Your Helm Friend still walks around, just without the name over its head.'),
      toggle('hidechat', 'Hide my chat bubbles', !!f.hideChat, (on) => ({ hideChat: on }), 'Your messages stay in Twitch chat but don\'t pop up over your Helm Friend.'),
      pickers);
  }

  /** Puts a name colour / box / font on the character (unlocking it first when it's locked) and saves the character. */
  async function setTag(key, o, what) {
    const st = store.get(), ch = st.character;
    if (!ch || !ch.spec || busyTag) return;
    if (o.locked) {
      const ok = await confirmDialog({ title: `Unlock ${o.name}?`, body: [`This spends ${psd(o.price)}. It stays yours for this season.`], confirmLabel: `Unlock (${fmt(o.price)}) & use` });
      if (!ok) return;
    }
    busyTag = true; render();
    try {
      if (o.locked) { const u = await api.unlock(o.id); actions.setData({ me: u.me || store.get().me, owned: u.owned || [...(store.get().owned || []), o.id] }); }
      const spec = { ...ch.spec, tag: { ...tagOfSpec(ch.spec), [key]: o.id } };
      const r = await api.saveCharacter(spec, ch.rev);
      actions.setData({ character: { spec: r.spec, rev: r.rev } });
      toast('Saved.'); announce(`${what}: ${o.name}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE') { await actions.reloadCharacter(); toast('Your character changed somewhere else - try again.', { kind: 'error' }); }
      else toast(e.message || 'Saving failed.', { kind: 'error' });
    } finally { busyTag = false; render(); }
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

  store.subscribe((s, keys) => { if (keys.some((k) => ['me', 'loggedIn', 'catalog', 'owned', 'character'].includes(k))) render(); });
  render();
  return { el };
}
