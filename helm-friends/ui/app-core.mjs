// The Helm Friends app, shared by the web app, the Twitch panel and StreamHelm's embedded view. Each entry point only
// supplies an auth provider and its config; everything else (state, screens, live updates) is here.
//
// auth provider: { mode, header():string|null, loggedIn():boolean, login():void, logout(wiped?):Promise<void>,
//                  lost(code):void, extAuthed?:boolean, onChange?(fn) }

import { buildCatalog } from '../core/index.mjs';
import { h, mount } from './h.mjs';
import { createStore } from './store.mjs';
import { createApi, ApiError } from './api.mjs';
import { createShell } from './shell.mjs';
import { createEditor } from './editor.mjs';
import { createUnlocks } from './unlocks.mjs';
import { createPredictions } from './predictions.mjs';
import { createToday } from './today.mjs';
import { createPlay } from './play.mjs';
import { createHistory } from './history.mjs';
import { createHelp } from './help.mjs';
import { createSettings } from './settings.mjs';
import { connectRealtime } from './realtime.mjs';
import { loadArt } from './avatar-render.mjs';
import { liveRegion, announce } from './a11y.mjs';
import { toast } from './toast.mjs';

export const ROUTES = ['character', 'play', 'unlocks', 'help', 'history', 'settings'];
const TITLES = { character: 'Make your character', play: 'Play & challenges', unlocks: 'Channel unlocks', help: 'Help & how-to', history: 'My history', settings: 'Settings' };

/** True when two JSON-able values hold the same data (every poll sends fresh objects; equal data must not re-render). */
export const sameJson = (a, b) => { if (a === b) return true; try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };

/**
 * @param {HTMLElement} root
 * @param {{ config:Object, auth:Object, fetchFn?:typeof fetch }} o
 *   config: { apiBase, artBase, pagesUrl, twitchUrl, links:{ privacy, terms, app? }, pollMs?, sse? }
 */
export function mountApp(root, { config, auth, fetchFn }) {
  const mode = auth.mode;
  const api = createApi({ base: config.apiBase, auth, fetchFn });
  const routeFromHash = () => { const r = (location.hash.match(/^#\/(\w+)/) || [])[1]; return ROUTES.includes(r) ? r : 'character'; };
  const store = createStore({
    mode, route: routeFromHash(), loggedIn: auth.loggedIn(), extAuthed: !!auth.extAuthed,
    online: null, live: null, season: null, help: null, pointsName: null,
    me: null, catalog: null, owned: [], character: null, rewards: [], prediction: null, myBet: null,
    lobbies: [], stageEvent: null,   // v1.11: open lobbies (Live events) and the big event holding the stage
    challenges: { incoming: [], outgoing: [] }, people: [], economy: null,   // v1.14: the challenge inbox, who is on stage, public limits
  });
  /**
   * v1.14: every write of server data goes through here, so an unchanged catalog / reward list / character / lobby list
   * (each poll sends fresh objects) never notifies the screens. The editor used to reload its draft on every catalog
   * "change", which threw the viewer's unsaved picks away on every poll (Sky: "it kept jumping back to Bearded Dragon").
   */
  const setData = (patch) => {
    const st = store.get(), out = {};
    for (const [k, v] of Object.entries(patch)) if (!sameJson(st[k], v)) out[k] = v;
    if (Object.keys(out).length) store.set(out);
  };

  const actions = {
    login: () => auth.login(),
    logout: async (wiped = false) => { await auth.logout(wiped); store.set({ loggedIn: false, me: null, owned: [], character: null, challenges: { incoming: [], outgoing: [] }, people: [] }); go('character'); },
    refresh: () => refresh(),
    reloadCharacter: async () => { const c = await api.character(); setData({ character: { spec: c.spec, rev: c.rev } }); },
    reloadUnlocks: async () => { const u = await api.unlocks(); setData({ owned: u.owned }); },
    reloadMine: () => loadMine(),
    reloadChallenges: () => loadChallenges(),
    reloadPeople: () => loadPeople(),
    refreshPrediction: () => loadPrediction(),
    setData,
  };

  function go(route) {
    if (location.hash !== '#/' + route) history.pushState(null, '', '#/' + route);
    show(route);
  }
  function show(route, focus = true) {
    store.set({ route });
    document.title = `${TITLES[route]} · Pepe's Helm Friends`;
    for (const [id, page] of Object.entries(pages)) page.el.hidden = id !== route;
    if (focus) shell.main.focus({ preventScroll: true });   // not on first load: keyboard users start at the top
    window.scrollTo(0, 0);
  }

  const art = loadArt(config.artBase || './art/', { fetchFn }).catch(() => null);
  const previews = (it) => (config.artBase || './art/') + it.preview;
  const shell = createShell({ mode, go, actions, links: config.links });
  const pages = {
    character: createEditor({ store, api, actions, art }),
    play: createPlay({ store, api, actions, go, compact: mode === 'ext' }),
    unlocks: createUnlocks({ store, api, actions, previews, twitchUrl: config.twitchUrl }),
    help: createHelp({ store, mode, links: config.links }),
    history: createHistory({ store, api, actions }),
    settings: createSettings({ store, api, actions, mode }),
  };
  const preds = createPredictions({ store, api, actions, compact: mode === 'ext' });
  const today = createToday({ store, api, actions, go });   // v1.11: check-in, auto character, follow note, Live events
  shell.live.append(pages.play.inbox, today.el, preds.el);   // v1.14: incoming challenges show on every screen
  mount(shell.main, Object.values(pages).map((p) => p.el));
  mount(root, shell.el);
  liveRegion();

  store.subscribe((st) => shell.update(st));
  shell.update(store.get());
  show(store.get().route, false);
  window.addEventListener('popstate', () => show(routeFromHash()));
  if (auth.onChange) auth.onChange(() => { store.set({ loggedIn: auth.loggedIn(), extAuthed: !!auth.extAuthed }); refresh(); });

  // ---------- data
  const quiet = (p) => p.catch((e) => { if (!(e instanceof ApiError)) throw e; return e; });
  function noteError(e) {
    if (!(e instanceof ApiError)) return;
    if (e.code === 'OFFLINE') store.set({ online: false });
    else if (e.status === 401 || e.code === 'LINK_REQUIRED') { auth.lost(e.code); store.set({ loggedIn: auth.loggedIn(), me: null }); }
  }

  async function refresh() {
    const [cfg, catalog, rewards] = await Promise.all([quiet(api.config()), quiet(api.catalog()), quiet(api.rewards())]);
    if (cfg instanceof ApiError) { noteError(cfg); if (!store.get().catalog) store.set({ catalog: buildCatalog() }); }
    else {
      setData({ online: true, live: typeof cfg.live === 'boolean' ? cfg.live : null, help: Array.isArray(cfg.help) ? cfg.help : null,
        pointsName: cfg.pointsName || null, season: cfg.season || null, economy: cfg.economy || null });
    }
    if (!(catalog instanceof ApiError)) setData({ catalog }); else if (!store.get().catalog) store.set({ catalog: buildCatalog() });
    if (!(rewards instanceof ApiError)) setData({ rewards: rewards.rewards || [] });
    await loadPrediction();
    await loadLobbies();
    if (auth.loggedIn()) { await loadMine(); await loadChallenges(); if (store.get().route === 'play') await loadPeople(); }
  }

  /** v1.11: open lobbies + the big event holding the stage. */
  async function loadLobbies() {
    const r = await quiet(api.lobbies());
    if (!(r instanceof ApiError)) setData({ lobbies: r.lobbies || [], stageEvent: (r.stage && r.stage.event) || null });
  }
  actions.reloadLobbies = loadLobbies;

  /** v1.14: my waiting challenges (incoming: accept / decline; outgoing: call it off). */
  async function loadChallenges() {
    if (!auth.loggedIn()) return;
    const r = await quiet(api.challenges());
    if (!(r instanceof ApiError)) setData({ challenges: { incoming: r.incoming || [], outgoing: r.outgoing || [] } });
  }
  /** v1.14: who is on stage right now (the people you can challenge). */
  async function loadPeople() {
    if (!auth.loggedIn()) return;
    const r = await quiet(api.people());
    if (!(r instanceof ApiError)) setData({ people: r.people || [] });
  }

  async function loadMine() {
    const [me, un, ch] = await Promise.all([quiet(api.me()), quiet(api.unlocks()), quiet(api.character())]);
    for (const r of [me, un, ch]) if (r instanceof ApiError) { noteError(r); return; }
    setData({ me: { ...me, characterAuto: !!(ch.auto || me.characterAuto) }, owned: un.owned || [], character: { spec: ch.spec, rev: ch.rev }, season: me.season || store.get().season, loggedIn: true });
  }

  async function loadPrediction() {
    const p = await quiet(api.currentPrediction());
    if (!(p instanceof ApiError)) setData({ prediction: p.prediction ? p : null });
  }

  function onEvent(type, d) {
    const st = store.get();
    switch (type) {
      case 'balance':
        if (st.me && typeof d.balance === 'number') {
          if (d.balance !== st.me.balance) { store.set({ me: { ...st.me, balance: d.balance, lifetimeEarned: d.lifetimeEarned ?? st.me.lifetimeEarned } }); announce(`Balance ${d.balance === -1 ? 'unlimited' : d.balance} Pepe's Silvia Dollahs`); }
        } else if (st.loggedIn) loadMine();
        break;
      case 'unlocks': if (Array.isArray(d.owned)) setData({ owned: d.owned }); else actions.reloadUnlocks().catch(noteError); break;
      case 'character': if (!st.character || d.rev !== st.character.rev) actions.reloadCharacter().catch(noteError); break;
      case 'catalog': quiet(api.catalog()).then((c) => { if (!(c instanceof ApiError)) setData({ catalog: c }); }); break;
      case 'rewards': quiet(api.rewards()).then((r) => { if (!(r instanceof ApiError)) setData({ rewards: r.rewards || [] }); }); break;
      case 'prediction': if (d.prediction !== undefined) setData({ prediction: d.prediction ? { prediction: d.prediction, bars: d.bars || [] } : null }); else loadPrediction(); break;
      case 'season': refresh(); break;
      case 'toast': if (d.text) toast(String(d.text), { kind: ['win', 'info', 'error'].includes(d.kind) ? d.kind : 'info' }); break;
      case 'hello': if (d.season) setData({ season: d.season }); break;
      case 'live': if (typeof d.live === 'boolean') setData({ live: d.live }); break;
      case 'challenges': loadChallenges(); break;   // v1.14: someone challenged me / my challenge was answered or ran out
      case 'game': case 'stage':
        loadLobbies();   // v1.11: a lobby opened / filled / closed
        if (st.loggedIn && type === 'game') { loadChallenges(); if (d && d.status === 'settled') loadMine(); }   // v1.14: winnings land in my balance
        break;
      default: break;
    }
  }

  const ready = refresh().catch((e) => { noteError(e); });
  const rt = connectRealtime({
    api, authed: () => auth.loggedIn(), onEvent, pollMs: config.pollMs || 20000, sse: config.sse !== false,
    onPoll: async () => { await refresh(); },
  });

  return { store, api, actions, go, ready, realtime: rt, poke: (type) => onEvent(type, {}) };
}

/** A visible error when the app can't start at all (e.g. an old browser without ES modules). */
export function fatal(root, text) {
  mount(root, h('div', { class: 'hf-app' }, h('p', { class: 'note error' }, text)));
}
