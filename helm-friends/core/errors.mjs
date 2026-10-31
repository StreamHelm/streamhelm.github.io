// Error codes shared by every Helm Friends surface, with the one-line chat wording (CONTRACTS §9).
// Core functions never throw for user mistakes: they return { ok:false, code, ...vars } and the adapter turns that into
// a chat line with errText(), or a UI message.

import { fmt, fmtWait } from './format.mjs';

/** @typedef {keyof typeof ERR} ErrCode */

/** ErrCode → message template. `{name}` placeholders are filled by errText(). */
export const ERR = Object.freeze({
  NO_FUNDS: '@{user} you only have {balance} Pepe\'s Silvia Dollahs.',
  BAD_AMOUNT: '@{user} bets are {min}–{max} Pepe\'s Silvia Dollahs.',
  COOLDOWN: '@{user} next game in {wait}.',
  STAGE_BUSY: '@{user} a game is on stage, try again in {wait}.',
  NO_STAGE: '@{user} the Helm Friends stage is offline right now.',
  NOT_LIVE: '@{user} games only run while Sky is live.',
  NO_TARGET: "@{user} I can't find {target} in chat.",
  SELF_TARGET: "@{user} you can't fight yourself (well, not here).",
  PENDING: '@{user} you already have a challenge waiting.',
  TARGET_BUSY: '@{user} {target} already has a challenge waiting.',
  PAIR_LIMIT: '@{user} you two have fought enough for one stream.',
  ALREADY_IN: "@{user} you're already in.",
  FULL: '@{user} that one is full.',
  SIDE_SWITCH: "@{user} you already bet on option {n}; you can't switch sides.",
  GIVE_CAP: '@{user} that is over the give limit ({max} per give, {cap} per day).',
  USAGE: '@{user} try: {usage}',
  // v1.11: a big event holds the stage (heist, battle royale, Grand Prix, Glorp's Blessing); the follow gate
  EVENT_BUSY: '@{user} {event} is on right now - try again in {wait}.',
  FOLLOW_FIRST: '@{user} follow the channel to get your Helm Friend and play!',
  NOT_OWNED: "You don't own that yet.",
  STALE: 'Your character changed somewhere else. Reload and try again.',
  LINK_REQUIRED: 'Connect your Twitch name first.',
  RATE_LIMIT: 'Slow down a little and try again.',
  FORBIDDEN: "You can't do that.",
  NOT_FOUND: "That doesn't exist (any more).",
  BAD_INPUT: "That didn't look right.",
  CLOSED: 'That is closed now.',
  INTERNAL: 'Something went wrong on our side.',
});

/** The codes that have a chat wording (the rest are UI-only, but still have a sensible default text). */
export const CHAT_CODES = Object.freeze(['NO_FUNDS', 'BAD_AMOUNT', 'COOLDOWN', 'STAGE_BUSY', 'NO_STAGE', 'NOT_LIVE',
  'NO_TARGET', 'SELF_TARGET', 'PENDING', 'TARGET_BUSY', 'PAIR_LIMIT', 'ALREADY_IN', 'FULL', 'SIDE_SWITCH', 'GIVE_CAP', 'USAGE', 'EVENT_BUSY', 'FOLLOW_FIRST']);

/**
 * A failure value. Extra fields (min, max, balance, waitMs…) are carried for the message.
 * @param {ErrCode} code
 * @param {Object} [vars]
 * @returns {{ ok:false, code:ErrCode } & Object}
 */
export function fail(code, vars) {
  if (!(code in ERR)) throw new Error('unknown error code ' + code);
  return { ok: false, code, ...(vars || {}) };
}

/**
 * The chat/UI text of an error. Numbers are thousands-grouped; `waitMs` fills {wait}; unknown placeholders stay empty.
 * @param {ErrCode} code
 * @param {Object} [vars]  e.g. { user:'sky', balance:120 } or a fail() result
 */
export function errText(code, vars = {}) {
  const tpl = ERR[code] || ERR.INTERNAL;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    if (k === 'wait') return fmtWait(vars.waitMs ?? 0);
    const v = vars[k];
    if (typeof v === 'number') return fmt(v);
    return v == null ? '' : String(v);
  });
}
