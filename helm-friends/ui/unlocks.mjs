// "Channel unlocks" (DESIGN §10, §7.3): Dollah rewards you can redeem here, channel-point rewards listed with
// "Redeem on Twitch" (an extension can't spend channel points), and the item shop with slot / rarity / "can afford"
// filters. The list follows Sky's rewards automatically (the `rewards` realtime event refetches it).

import { fmt, isUnlocked, PSD, psd } from '../core/index.mjs';
import { h, icon, mount } from './h.mjs';
import { renderKeepingFocus, announce } from './a11y.mjs';
import { coinImg } from './shell.mjs';
import { confirmDialog } from './dialog.mjs';
import { toast } from './toast.mjs';

const SLOT_NAMES = { hat: 'Hats', eyewear: 'Glasses', ear: 'Ear piercings', nose: 'Nose piercings', shirt: 'Shirts', pants: 'Pants', shoes: 'Shoes',
  hair: 'Hair', hairfx: 'Hair effects', facialHair: 'Facial hair', eyes: 'Eyes', breed: 'Coats & breeds', ears: 'Ears, face shapes, extras', wings: 'Wings', brows: 'Eyebrows', pet: 'Pets',
  'car.body': 'Getaway car', 'car.wheels': 'Car wheels', 'car.decal': 'Car decals', 'ufo.hull': 'UFO hulls', 'ufo.dome': 'UFO domes', 'ufo.lights': 'UFO lights', 'ufo.trail': 'UFO trails' };
const PAGE = 120;
/** v1.16: shop categories over the catalog slots. */
const SHOP_GROUPS = [['', 'All'], ['clothes', 'Clothes'], ['hair', 'Hair & face'], ['body', 'Coats & features'], ['pet', 'Pets'], ['rides', 'Car & UFO']];
const groupOf = (slot) => (['hat', 'eyewear', 'ear', 'nose', 'shirt', 'pants', 'shoes'].includes(slot) ? 'clothes' : ['hair', 'hairfx', 'facialHair', 'eyes', 'brows'].includes(slot) ? 'hair'
  : ['breed', 'ears', 'wings'].includes(slot) ? 'body' : slot === 'pet' ? 'pet' : /^(car|ufo)\./.test(slot) ? 'rides' : 'clothes');
const RARITIES = [['common', 'Common'], ['rare', 'Rare'], ['epic', 'Epic'], ['legendary', 'Legendary']];

/**
 * @param {{ store:Object, api:Object, actions:Object, art:{ previewUrl:(item:Object)=>string } , twitchChannel:string }} o
 */
export function createUnlocks({ store, api, actions, previews, twitchUrl }) {
  const filters = { group: '', slot: '', rarity: '', afford: false, q: '' };
  let shown = PAGE;   // v1.16: the shop pages through ~400 items (Show more), with category tabs + search
  const inputs = new Map();   // reward id → typed text (kept across re-renders)
  const pendingRedeem = new Set();
  const el = h('section', { 'aria-labelledby': 'un-title' });

  function render() {
    renderKeepingFocus(el, () => mount(el,
      h('h2', { class: 'page-title', id: 'un-title' }, 'Channel unlocks'),
      rewardsSection(), shopSection()));
  }

  // ---------- rewards
  function rewardsSection() {
    const st = store.get(), list = (st.rewards || []).filter((r) => r.enabled !== false);
    const d = list.filter((r) => r.currency === 'dollahs'), p = list.filter((r) => r.currency !== 'dollahs');
    return [
      h('h3', { class: 'section-title' }, `Spend ${PSD} on the stream`),
      d.length ? d.map(dollahReward) : h('p', { class: 'empty' }, `No rewards for ${PSD} yet. New ones show up here by themselves.`),
      p.length ? [h('h3', { class: 'section-title' }, 'Channel-point rewards'),
        h('p', { class: 'small muted' }, 'These cost channel points, so they are redeemed on Twitch itself.'), p.map(pointsReward)] : null,
    ];
  }

  function dollahReward(r) {
    const st = store.get(), me = st.me;
    const liveBlocked = r.liveOnly && st.live === false;
    const short = me && me.balance !== -1 && me.balance < r.cost;
    const why = !st.loggedIn ? (st.mode === 'ext' ? 'Connect your Twitch name to redeem.' : 'Log in to redeem.')
      : r.paused ? 'Paused by Sky for now.' : liveBlocked ? 'Only while Sky is live.' : short ? `You need ${psd(r.cost - me.balance)} more.` : null;
    const inputId = 'rw-in-' + r.id;
    const input = r.inputRequired ? h('label', { class: 'field' }, h('span', null, r.prompt || 'Your message'),
      h('input', { type: 'text', id: inputId, maxlength: 200, value: inputs.get(r.id) || '', 'data-fk': inputId, oninput: (e) => inputs.set(r.id, e.target.value) })) : null;
    const dot = h('span', { class: 'reward-dot', 'aria-hidden': 'true' });
    if (r.color) dot.style.background = r.color;
    return h('article', { class: 'card reward', 'data-reward': r.id },
      h('div', { class: 'reward-head' }, h('h3', null, dot, ' ', r.title),
        h('span', { class: 'cost', 'aria-label': psd(r.cost) }, fmt(r.cost), coinImg('coin-sm'))),
      r.prompt && !r.inputRequired ? h('p', { class: 'small' }, r.prompt) : null,
      r.liveOnly ? h('span', { class: 'badge live' }, icon('clock'), 'Live only') : null,
      input,
      h('button', {
        type: 'button', class: 'btn solid block', 'data-fk': 'redeem-' + r.id, disabled: !!why && st.loggedIn || pendingRedeem.has(r.id),
        'aria-describedby': why ? 'why-' + r.id : null,
        onclick: () => (st.loggedIn ? redeem(r) : actions.login()),
      }, st.loggedIn ? `Redeem for ${fmt(r.cost)}` : st.mode === 'ext' ? 'Connect to redeem' : 'Log in to redeem'),
      why ? h('p', { class: 'small muted', id: 'why-' + r.id }, why) : null);
  }

  function pointsReward(r) {
    return h('article', { class: 'card reward', 'data-reward': r.id },
      h('div', { class: 'reward-head' }, h('h3', null, r.title), h('span', { class: 'cost pts' }, `${fmt(r.cost)} ${store.get().pointsName || 'channel points'}`)),
      r.prompt ? h('p', { class: 'small' }, r.prompt) : null,
      h('a', { class: 'btn block', href: twitchUrl, target: '_blank', rel: 'noopener' }, icon('link'), 'Redeem on Twitch'));
  }

  async function redeem(r) {
    const text = (inputs.get(r.id) || '').trim();
    if (r.inputRequired && !text) { toast('This one needs your message first.', { kind: 'error' }); return; }
    const ok = await confirmDialog({ title: `Redeem "${r.title}"?`, body: `This spends ${psd(r.cost)}.`, confirmLabel: `Redeem (${fmt(r.cost)})` });
    if (!ok) return;
    pendingRedeem.add(r.id); render();
    try {
      const res = await api.redeem(r.id, r.inputRequired ? text : undefined);
      if (res.me) store.set({ me: res.me });
      inputs.delete(r.id);
      toast(`Redeemed "${r.title}"!`, { kind: 'win' });
      announce(`Redeemed ${r.title}`);
    } catch (e) { toast(e.message, { kind: 'error' }); } finally { pendingRedeem.delete(r.id); render(); }
  }

  // ---------- item shop
  function shopSection() {
    const st = store.get();
    if (!st.catalog) return null;
    const owned = new Set(st.owned || []), me = st.me;
    const flags = { unlockAll: !!(me && me.flags && me.flags.unlockAll), unique: (me && me.unique) || null };
    const balance = me ? me.balance : 0;
    const all = st.catalog.items.filter((it) => !['starter', 'reserved'].includes(it.rarity) && !it.reservedFor && it.slot !== 'species');
    let items = filters.group ? all.filter((it) => groupOf(it.slot) === filters.group) : all;
    const slots = [...new Set(items.map((it) => it.slot))];
    if (filters.slot && slots.includes(filters.slot)) items = items.filter((it) => it.slot === filters.slot); else filters.slot = '';
    const q = filters.q.trim().toLowerCase();
    if (q) items = items.filter((it) => it.name.toLowerCase().includes(q) || (SLOT_NAMES[it.slot] || it.slot).toLowerCase().includes(q));
    if (filters.rarity) items = items.filter((it) => it.rarity === filters.rarity);
    if (filters.afford) items = items.filter((it) => balance === -1 || it.price <= balance);
    const select = (key, label, opts) => h('label', { class: 'field' }, h('span', null, label),
      h('select', { 'data-fk': 'f-' + key, onchange: (e) => { filters[key] = e.target.value; shown = PAGE; render(); } },
        h('option', { value: '' }, 'All'), opts.map(([v, t]) => h('option', { value: v, selected: filters[key] === v }, t))));
    return [
      h('h3', { class: 'section-title' }, 'Item shop'),
      h('p', { class: 'small muted' }, 'Unlock outfits for your character. Tip: you can try anything on first in "Make your character".'),
      h('div', { class: 'chips shop-groups', role: 'group', 'aria-label': 'Shop categories' }, SHOP_GROUPS.map(([id, label]) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(filters.group === id), 'data-fk': 'shop-' + (id || 'all'),
        onclick: () => { filters.group = id; filters.slot = ''; shown = PAGE; render(); },
      }, label, h('span', { class: 'count' }, ' ' + (id ? all.filter((it) => groupOf(it.slot) === id).length : all.length))))),
      h('label', { class: 'field' }, h('span', null, 'Search the shop'), h('input', { type: 'search', value: filters.q, placeholder: 'e.g. hoodie, Glorp, wings', 'data-fk': 'f-search',
        oninput: (e) => { filters.q = e.target.value; shown = PAGE; render(); } })),
      h('div', { class: 'filters', role: 'group', 'aria-label': 'Shop filters' },
        select('slot', 'Type', slots.map((s) => [s, SLOT_NAMES[s] || s])),
        select('rarity', 'Rarity', RARITIES),
        h('label', { class: 'switch' }, h('span', null, 'Only what I can afford'),
          h('input', { type: 'checkbox', checked: filters.afford, 'data-fk': 'f-afford', onchange: (e) => { filters.afford = e.target.checked; render(); } }))),
      h('p', { class: 'small muted', role: 'status' }, `${items.length} item${items.length === 1 ? '' : 's'}${items.length > shown ? ` · showing ${shown}` : ''}`),
      items.length ? h('div', { class: 'grid' }, items.slice(0, shown).map((it) => itemCard(it, isUnlocked(it, owned, flags), st))) : h('p', { class: 'empty' }, 'Nothing matches. Try another category or search.'),
      items.length > shown ? h('button', { type: 'button', class: 'btn block', 'data-fk': 'shop-more', onclick: () => { shown += PAGE; render(); } }, `Show more (${items.length - shown} left)`) : null,
    ];
  }

  function itemCard(it, have, st) {
    const me = st.me, afford = me && (me.balance === -1 || me.balance >= it.price);
    return h('article', { class: 'item-card', 'data-item': it.id, 'data-owned': have ? '1' : '0' },
      h('img', { src: previews(it), alt: '', width: 64, height: 64, loading: 'lazy' }),
      h('span', { class: 'name' }, it.name),
      h('span', { class: ['badge', it.rarity] }, RARITIES.find((r) => r[0] === it.rarity)?.[1] || it.rarity),
      have ? h('span', { class: 'badge owned' }, icon('check'), 'Owned')
        : h('span', { class: 'price', 'aria-label': psd(it.price) }, icon('lock'), fmt(it.price), coinImg('coin-sm')),
      have ? null : h('button', {
        type: 'button', class: 'btn small solid', 'data-fk': 'buy-' + it.id, disabled: st.loggedIn && !afford,
        'aria-label': st.loggedIn ? `Unlock ${it.name} for ${psd(it.price)}` : `Log in to unlock ${it.name}`,
        onclick: () => (st.loggedIn ? buy(it) : actions.login()),
      }, st.loggedIn ? 'Unlock' : 'Log in'));
  }

  async function buy(it) {
    const ok = await confirmDialog({ title: `Unlock ${it.name}?`, body: `This spends ${psd(it.price)}. It stays yours for this season.`, confirmLabel: `Unlock (${fmt(it.price)})` });
    if (!ok) return;
    try {
      const r = await api.unlock(it.id);
      store.set({ me: r.me || store.get().me, owned: r.owned || [...(store.get().owned || []), it.id] });
      toast(`${it.name} unlocked! Wear it in "Make your character".`, { kind: 'win' });
    } catch (e) { toast(e.message, { kind: 'error' }); }
  }

  store.subscribe((s, keys) => { if (keys.some((k) => ['rewards', 'catalog', 'owned', 'me', 'live', 'loggedIn'].includes(k))) render(); });
  render();
  return { el };
}
