// The follow gate (v1.11, Sky): having a Helm Friend — appearing on stage, playing games, earning and spending Dollahs —
// needs at least a FOLLOW. Subs, VIPs, mods and Sky count as followers ("followers and above").
//   status true  = follows (or above)          → everything works; the first time, the cloud makes them a character
//   status false = checked: not following      → no avatar, no games/spending, no watch-time Dollahs; one short hint per
//                                                 hintSec (10 min) when they try a command ("Follow the channel to get
//                                                 your Helm Friend and play!")
//   status null  = not checked yet             → treated as following while the check runs (fail open: a real follower
//                                                 is never refused because Twitch was slow); it settles within seconds
// Policy (documented in help): non-followers do NOT earn Dollahs by watching; the season's start balance waits for them.
// Sky can switch the gate off on the admin page (cfg.follow.required = false), e.g. for a playtest.

import { DEFAULT_ECONOMY } from './economy.mjs';
import { fail } from './errors.mjs';
import { userGate } from './cooldown.mjs';

const cfgOf = (cfg) => (cfg && cfg.follow) || DEFAULT_ECONOMY.follow;

/** Intents that work without a follow: looking things up, help, the link, hiding, saying no. */
export const FOLLOW_FREE = Object.freeze(['balance', 'help', 'link', 'hide', 'decline', 'error']);

/**
 * Where someone stands. `flags.follows` is what the cloud learned (true/false, cached); roles and badges outrank it.
 * @param {{ role?:string, isSub?:boolean, isVip?:boolean, flags?:{ follows?:boolean|null, subTier?:number } }} who
 * @returns {true|false|null}
 */
export function followStatus(who) {
  if (!who) return null;
  if (who.role === 'broadcaster' || who.role === 'mod' || who.isSub || who.isVip) return true;
  const f = who.flags || {};
  if (f.subTier || f.vip) return true;
  if (f.follows === true) return true;
  if (f.follows === false) return false;
  return null;
}

/** Is the gate on? */
export const followRequired = (cfg = DEFAULT_ECONOMY) => cfgOf(cfg).required !== false;

/**
 * May they do this? FOLLOW_FIRST only for a CONFIRMED non-follower (status false) while the gate is on.
 * @param {true|false|null} status
 * @param {string} [intentKind]  omit for "anything that needs a follow" (avatar, unlocks, web actions)
 */
export function followGate(status, intentKind, cfg = DEFAULT_ECONOMY) {
  if (!followRequired(cfg) || status !== false) return { ok: true };
  if (intentKind && FOLLOW_FREE.includes(intentKind)) return { ok: true };
  return fail('FOLLOW_FIRST');
}

/** Does a non-follower get the hint now? (at most one per hintSec) */
export const followHintDue = (lastHintAt, now, cfg = DEFAULT_ECONOMY) => userGate(lastHintAt, now, cfgOf(cfg).hintSec).ok;

/** Should this account have an avatar on stage? (unknown counts as yes until checked) */
export const avatarAllowed = (status, cfg = DEFAULT_ECONOMY) => !followRequired(cfg) || status !== false;
