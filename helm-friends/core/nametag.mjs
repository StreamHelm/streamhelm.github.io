// Name tags and chat bubbles (v1.18, Sky approved), aligned with the art engineer's v1.18 spec:
//   Viewer side (web app / panel Settings → "Name & chat"):
//     • hide my name, hide my chat bubbles = account flags `hideName` / `hideChat` (PATCH /me/settings), sent to the overlay
//       on the Actor as `tag: { hideName?, hideChat? }` (nameTagOf);
//     • name colour, text box shape, name font = the CHARACTER SPEC's `tag: { shape, colors, name, font }` (art v1.18:
//       catalog slots `tag` (box shapes), `nameColor`, `font`; free ones + locked ones bought in the shop), saved with the
//       character (PUT /me/character → core normalizeSpec checks ownership). nameOptions() lists the choices.
//   Sky's side (Helm Friends → Events → Overlay): show ALL usernames, show ALL chat bubbles, the overlay font = DEFAULTS;
//     every overlay browser source can override them with ?names=0&chats=0&font=… (the overlay engineer's part).

import { isUnlocked } from './avatar/catalog.mjs';

/** The name tag a spec without one gets (art v1.18 DEFAULT_TAG). */
export const DEFAULT_NAME_TAG = Object.freeze({ shape: 'tag.rounded', colors: [], name: 'nameColor.white', font: 'font.clean' });
/** Fonts Sky can pick as the overlay default (art v1.18 `font.*`; `art.json fonts` may add more — the admin page lists them). */
export const OVERLAY_FONTS = Object.freeze([
  { id: 'font.clean', name: 'Clean (default)' }, { id: 'font.bold', name: 'Bold' }, { id: 'font.tall', name: 'Tall' }, { id: 'font.arcade', name: 'Arcade' },
].map(Object.freeze));
/** Sky's overlay-wide defaults (every overlay can override them with ?names= &chats= &font=). */
export const DEFAULT_OVERLAY = Object.freeze({ names: true, chats: true, font: 'font.clean' });
/** Rough CSS look of the art's name colours for previews (the overlay draws the real thing from art.json nameTags). */
export const NAME_COLOR_CSS = Object.freeze({ white: '#f6f7fb', yellow: '#ffe14d', green: '#1fe20e', cyan: '#3fe0e8', blue: '#5b9bff', purple: '#c98cf0', pink: '#ff7ad9',
  red: '#ff3b3b', orange: '#ff9a2e', grey: '#a9a9b8', neon: '#39ff14', gold: '#ffcf3f', gradient: null, glitter: null, rainbow: null });

const FONT_ID = /^[a-z0-9][a-z0-9._-]{0,31}$/;
/** A tidy overlay setting: { names:boolean, chats:boolean, font:string }. */
export function normalizeOverlay(o) {
  const src = o && typeof o === 'object' ? o : {};
  return { names: src.names !== false, chats: src.chats !== false, font: typeof src.font === 'string' && FONT_ID.test(src.font) ? src.font : DEFAULT_OVERLAY.font };
}

/** Defensive: anything marked as a costume is never sold or offered (art v1.18 costumes aren't catalog items at all). */
export const isCostume = (it) => !!it && (it.slot === 'costume' || (Array.isArray(it.tags) && it.tags.includes('costume')));

/** The viewer's name tag (spec.tag, or the default for a spec saved before v1.18). */
export const tagOfSpec = (spec) => ({ ...DEFAULT_NAME_TAG, ...((spec && spec.tag) || {}) });

/**
 * Every choice for the Settings pickers, per catalog slot: { shapes, colors, fonts } of { id, name, price, rarity, locked, css? }.
 * @param {Object} catalog  @param {Set<string>|string[]} owned  @param {{ unlockAll?:boolean, unique?:string|null }} flags
 */
export function nameOptions(catalog, owned, flags = {}) {
  const items = (catalog && (Array.isArray(catalog) ? catalog : catalog.items)) || [];
  const of = (slot) => items.filter((it) => it.slot === slot && !isCostume(it) && (!it.reservedFor || it.reservedFor === flags.unique)).map((it) => ({
    id: it.id, name: it.name, price: it.price || 0, rarity: it.rarity, locked: !isUnlocked(it, owned, flags),
    css: slot === 'nameColor' ? NAME_COLOR_CSS[it.id.split('.').pop()] ?? null : null, fx: (it.anim && it.anim.fx) || null }));
  return { shapes: of('tag'), colors: of('nameColor'), fonts: of('font') };
}

/** Does this catalog sell name tags yet (art v1.18)? The pickers show only then. */
export const hasNameTags = (catalog) => ((catalog && catalog.items) || []).some((it) => it.slot === 'tag' || it.slot === 'nameColor');

/**
 * Checks a Settings patch { hideName?, hideChat? } (booleans only).
 * @returns {{ ok:true, patch:Object } | { ok:false, code:'BAD_INPUT', path?:string }}
 */
export function nameFlagsCheck(body) {
  const patch = {};
  for (const k of ['hideName', 'hideChat']) if (k in body) { if (typeof body[k] !== 'boolean') return { ok: false, code: 'BAD_INPUT', path: '$.' + k }; patch[k] = body[k]; }
  return { ok: true, patch };
}

/** What the overlay needs besides the spec (Actor.tag): { hideName?, hideChat? }, or null. */
export function nameTagOf(flags) {
  const f = flags || {}, out = {};
  if (f.hideName) out.hideName = true;
  if (f.hideChat) out.hideChat = true;
  return Object.keys(out).length ? out : null;
}
