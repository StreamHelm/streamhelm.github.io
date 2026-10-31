// The shared gambling stage (DESIGN §4.8): one show at a time, and 2 minutes from the START of one show to the next.
// While a lobby or an accept window is open the stage is reserved. The state is a plain object the cloud stores; these
// functions never change it in place, they return the next state.
// v1.11 (Sky): BIG-EVENT EXCLUSIVITY is this file's rule too: while a big event (heist, battle royale, Gleep Grand Prix,
// Glorp's Blessing) holds the stage — its lobby or its show — every other game and event gets EVENT_BUSY naming it.
// Prediction bets, balance checks and emotes never go through the stage, so they stay allowed.

import { fail } from './errors.mjs';
import { DEFAULT_ECONOMY } from './economy.mjs';

/**
 * @typedef {Object} StageState
 * @property {number} busyUntil       end of the running show (0 = none)
 * @property {number} reservedUntil   deadline of an open lobby / accept window (0 = none)
 * @property {string|null} holder     game id that holds the reservation or the show
 * @property {string|null} holderKind v1.11: what holds it ('slots', 'fight', … or a BIG_EVENTS kind)
 * @property {number|null} lastStartAt   when the previous show started
 * @property {number|null} lastHeistAt   when the previous heist started (heists have their own extra cooldown)
 */

/** @returns {StageState} */
export function emptyStage() {
  return { busyUntil: 0, reservedUntil: 0, holder: null, holderKind: null, lastStartAt: null, lastHeistAt: null };
}

/** v1.11: the big events. While one is open or running, nothing else may start. */
export const BIG_EVENTS = Object.freeze(['heist', 'royale', 'grandprix', 'blessing']);
/** How chat lines and the join panel name each big event. */
export const EVENT_NAMES = Object.freeze({ heist: 'A bank heist', royale: 'A battle royale', grandprix: 'The Gleep Grand Prix', blessing: "Glorp's Blessing" });
/** The stage kind of a game record: a Grand Prix lobby/show is 'grandprix'; a race duel stays 'race'. */
export const stageKindOf = (game, input) => (game === 'race' && input && input.mode === 'gp' ? 'grandprix' : game);

/** The big event holding the stage at `now`, or null. */
export function eventOn(state, now) {
  const busyEnd = Math.max(state.busyUntil || 0, state.reservedUntil || 0);
  return now < busyEnd && BIG_EVENTS.includes(state.holderKind) ? { kind: state.holderKind, name: EVENT_NAMES[state.holderKind], until: busyEnd } : null;
}

/** When the global cooldown ends (0 if no show ever started). */
export function cooldownUntil(state, cfg = DEFAULT_ECONOMY) {
  return state.lastStartAt == null ? 0 : state.lastStartAt + cfg.cooldown.stageGlobalSec * 1000;
}

/**
 * Can a new game or event take the stage now?
 * A big event open or running → EVENT_BUSY (with its name); another show or lobby → STAGE_BUSY; only the cooldown left →
 * COOLDOWN. `waitMs` is the time until the stage is really free. Roles in cfg.cooldown.bypassRoles skip the cooldown,
 * never a running show or an event.
 * @param {StageState} state
 * @param {number} now
 * @param {Object} [cfg]
 * @param {{ role?:string }} [who]
 * @returns {{ ok:true, waitMs:0 } | { ok:false, code:'EVENT_BUSY'|'STAGE_BUSY'|'COOLDOWN', waitMs:number, event?:string, kind?:string }}
 */
export function stageGate(state, now, cfg = DEFAULT_ECONOMY, who = {}) {
  const bypass = !!who.role && cfg.cooldown.bypassRoles.includes(who.role);
  const busyEnd = Math.max(state.busyUntil || 0, state.reservedUntil || 0);
  const coolEnd = bypass ? 0 : cooldownUntil(state, cfg);
  const freeAt = Math.max(busyEnd, coolEnd);
  const ev = eventOn(state, now);
  if (ev) return fail('EVENT_BUSY', { waitMs: freeAt - now, event: ev.name, kind: ev.kind });
  if (now < busyEnd) return fail('STAGE_BUSY', { waitMs: freeAt - now });
  if (now < coolEnd) return fail('COOLDOWN', { waitMs: coolEnd - now });
  return { ok: true, waitMs: 0 };
}

/**
 * The heist's own cooldown (on top of the stage gate).
 * @returns {{ ok:true, waitMs:0 } | { ok:false, code:'COOLDOWN', waitMs:number }}
 */
export function heistGate(state, now, cfg = DEFAULT_ECONOMY) {
  if (state.lastHeistAt == null) return { ok: true, waitMs: 0 };
  const until = state.lastHeistAt + cfg.heist.cooldownSec * 1000;
  return now < until ? fail('COOLDOWN', { waitMs: until - now }) : { ok: true, waitMs: 0 };
}

/** Reserve the stage for a lobby / accept window until `until`; `kind` = what holds it. @returns {StageState} */
export function stageReserve(state, gameId, until, kind = null) {
  return { ...state, reservedUntil: until, holder: gameId, holderKind: kind };
}

/**
 * A show starts now and lasts `durationMs`. Starts the cooldown clock unless `cooldown:false` (Glorp's Blessing holds the
 * stage for its show without charging the gambling cooldown). @returns {StageState}
 */
export function stageStart(state, gameId, now, durationMs, { heist = false, kind = null, cooldown = true } = {}) {
  return { ...state, busyUntil: now + durationMs, reservedUntil: 0, holder: gameId, holderKind: kind,
    lastStartAt: cooldown ? now : state.lastStartAt, lastHeistAt: heist ? now : state.lastHeistAt };
}

/** A reservation ends without a show (declined, timed out, canceled): no cooldown is charged. @returns {StageState} */
export function stageRelease(state, gameId) {
  if (state.holder !== gameId) return state;
  return { ...state, reservedUntil: 0, busyUntil: 0, holder: null, holderKind: null };
}

/** What the public `stage` event shows; with `now`, also the big event holding it (v1.11, join panel / web app). */
export function stageView(state, cfg = DEFAULT_ECONOMY, now = null) {
  const v = { busyUntil: Math.max(state.busyUntil || 0, state.reservedUntil || 0), cooldownUntil: cooldownUntil(state, cfg) };
  if (now != null) { const ev = eventOn(state, now); if (ev) v.event = { kind: ev.kind, name: ev.name }; }
  return v;
}

/**
 * A simple per-key cooldown (per-user command spam, error replies, emotes).
 * @param {number|null|undefined} lastAt
 * @param {number} now
 * @param {number} sec
 * @returns {{ ok:boolean, waitMs:number }}
 */
export function userGate(lastAt, now, sec) {
  const until = lastAt == null ? 0 : lastAt + sec * 1000;
  return now < until ? { ok: false, waitMs: until - now } : { ok: true, waitMs: 0 };
}

/**
 * The key for the "same two people, max N fights per stream" rule; order-independent.
 * @param {string} a
 * @param {string} b
 */
export function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
