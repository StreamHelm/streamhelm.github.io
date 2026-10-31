// The Dollah economy: earning (half the channel-point rate, DESIGN §4.1), prices, tiers, and the give/take rules.
// Every number Sky can tune lives in DEFAULT_ECONOMY; the cloud stores Sky's overrides and passes the merged config in.

import { applyMult } from './money.mjs';
import { fail } from './errors.mjs';
import { intent, transfer, userAcct, SYS } from './ledger.mjs';

const DAY = 86400000;

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

/** The default economy (CONTRACTS §8). Frozen: use mergeEconomy() to make an edited copy. */
export const DEFAULT_ECONOMY = deepFreeze({
  startBalance: 250,
  accrual: {
    tickSec: 300, perTick: 5, activeWindowSec: 900, activeBonus: 25, minAccountAgeDays: 7,
    subMult: { 1: 1.2, 2: 1.4, 3: 2.0 }, followBonus: 150, onlyWhileLive: true,
  },
  events: { perGiftedSub: 50, bitsPerDollah: 10, raidLeader: 100 },
  dollahToPoints: 2,
  cooldown: { stageGlobalSec: 120, perUserCmdSec: 3, errorReplySec: 60, emoteSec: 10, bypassRoles: ['broadcaster'] },
  // maxRuns (v1.9): `!slots 100 3` = three spins of 100 in one show (one stage slot); the bet limits are per run
  slots: { minBet: 10, maxBet: 1000, maxRuns: 5 },
  roulette: { minBet: 10, maxBet: 2000, maxRuns: 5 },
  flip: { minBet: 10, maxBet: 2000, maxRuns: 5 },
  fight: { minBet: 10, maxBet: 5000, acceptSec: 45, rakePct: 0, pairLimitPerStream: 3 },
  armwrestle: { minBet: 10, maxBet: 5000, acceptSec: 45, rakePct: 0, pairLimitPerStream: 3 },
  // Gleep Race (v1.9): `!race @user [amount]` is a 1v1 like a fight; the Grand Prix (Sky / mods / a redemption) is a
  // free-for-all with an optional entry fee. Prize pool = every fee + a mint prize like the royale's; split by `split` (%).
  race: {
    minBet: 10, maxBet: 5000, acceptSec: 45, rakePct: 0, pairLimitPerStream: 3,
    gp: { lobbySec: 60, minRacers: 3, maxRacers: 24, maxFee: 1000, prizeBase: 300, prizePer: 40, prizeCap: 3000, jitter: 0.2, split: [60, 25, 15] },
  },
  royale: { lobbySec: 60, minPlayers: 3, maxPlayers: 40, prizeBase: 300, prizePer: 40, prizeCap: 3000, jitter: 0.2, runnerUpPct: 15 },
  heist: { lobbySec: 90, minStake: 50, maxStake: 1000, minCrew: 2, maxCrew: 12, cooldownSec: 600 },
  give: { modDailyCap: 5000, modMaxPerGive: 1000 },
  predictions: { minBet: 10, maxBet: 10000, noWinnerPolicy: 'refund' },
  prices: { starter: 0, common: 300, rare: 1000, epic: 2500, legendary: 6000 },
  tiers: [{ id: 'bronze', earned: 1000 }, { id: 'silver', earned: 10000 }, { id: 'gold', earned: 50000 }, { id: 'cosmic', earned: 150000 }],
  // ───── round 3 (CONTRACTS v1.11)
  // Sayok's cursed slot `!cursed`: higher risk / higher reward than !slots (RTP in games/cursed.mjs cursedTheory())
  cursed: { minBet: 10, maxBet: 500, maxRuns: 3 },
  // daily check-in (web app / panel): day 1 pays base, +step per day in a row up to maxDays; a missed day resets the streak
  checkin: { enabled: true, base: 20, step: 10, maxDays: 7, tzOffsetMin: 0 },
  // Glorp's Blessing: every viewer seen in the last presentMin minutes gets U[min, max] Dollahs; the total is capped
  blessing: { perViewerMin: 10, perViewerMax: 30, totalCap: 3000, presentMin: 10 },
  // raids: viewers who first show up within windowMin of an incoming raid get a one-time stipend (at most raid size + extra)
  raid: { stipend: 50, windowMin: 15, extra: 10, hardMax: 500 },
  // the bounty on the richest viewer seen this stream: pct of their balance (min..cap) from the mint to whoever beats them in
  // a staked duel (fight / arm wrestle / race, stake ≥ minStake); at most perStream bounties are paid per stream
  bounty: { minBalance: 5000, pct: 2, min: 50, cap: 500, minStake: 100, perStream: 3 },
  // follow gate: an avatar, games and spending need a follow (subs, VIPs, mods and Sky count as followers); non-followers
  // don't earn by watching. One hint per viewer per hintSec.
  follow: { required: true, hintSec: 600 },
  // seasonal cosmetics: catalog items tagged `seasonal:<id>` are for sale only inside their window (MM-DD, inclusive, UTC)
  seasonal: [
    { id: 'halloween', name: 'Spooky Season', from: '10-01', to: '11-02' },
    { id: 'winter', name: 'Winter Holidays', from: '12-01', to: '01-06' },
  ],
  botLogins: ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot', 'soundalerts', 'sery_bot',
    'kofistreambot', 'commanderroot'],
});

/**
 * A new economy config: `base` with `overrides` deep-merged in (arrays and scalars replace). Inputs are not changed.
 * @param {Object} base
 * @param {Object} [overrides]
 */
export function mergeEconomy(base, overrides) {
  const out = structuredCloneish(base);
  if (!overrides || typeof overrides !== 'object') return out;
  for (const [k, v] of Object.entries(overrides)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = mergeEconomy(out[k], v);
    } else out[k] = structuredCloneish(v);
  }
  return out;
}

function structuredCloneish(v) {
  if (Array.isArray(v)) return v.map(structuredCloneish);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, structuredCloneish(x)]));
  return v;
}

/** The sub multiplier for a tier (0 = not subbed). */
export function subMultFor(subTier, cfg = DEFAULT_ECONOMY) {
  return cfg.accrual.subMult[subTier] || 1;
}

/**
 * @typedef {Object} AccrualViewer
 * @property {string} twitchId
 * @property {string} [login]
 * @property {boolean} present          in Get Chatters this tick, or chatted during it
 * @property {boolean} [active]         sent ≥ 1 real message (≥ 2 words, not a command) in the active window
 * @property {(0|1|2|3)} [subTier]
 * @property {number|null} [accountCreatedAt]  Twitch account creation (ms); null = not known yet (counts as old enough)
 * @property {boolean} [banned]
 * @property {boolean} [bot]
 */
/**
 * @typedef {Object} AccrualTick
 * @property {string} seasonId
 * @property {number} tickStart                  ms, aligned to a tickSec boundary
 * @property {number|null} [activeWindowStart]   set on the tick that CLOSES an active window: pay the active bonus for it
 * @property {AccrualViewer[]} viewers
 */

/**
 * Who may earn at all: not banned, not a bot, account old enough.
 * @param {AccrualViewer} v
 * @param {number} at  ms
 */
export function accrualEligible(v, at, cfg = DEFAULT_ECONOMY) {
  if (!v || v.banned || v.bot) return false;
  if (v.login && cfg.botLogins.includes(String(v.login).toLowerCase())) return false;
  // v1.11 follow gate: a viewer checked as NOT following earns nothing by watching (unknown = not checked yet = earns)
  if (v.follower === false && (!cfg.follow || cfg.follow.required !== false)) return false;
  if (v.accountCreatedAt != null && at - v.accountCreatedAt < cfg.accrual.minAccountAgeDays * DAY) return false;
  return true;
}

/**
 * One accrual tick → ledger intents (watching pay for present viewers, plus the active bonus when a window closes).
 * Idempotency keys make a repeated tick (cloud + PC fallback both arriving) pay once.
 * @param {AccrualTick} tick
 * @param {Object} [cfg]
 * @returns {import('./ledger.mjs').LedgerIntent[]}
 */
export function accrualFor(tick, cfg = DEFAULT_ECONOMY) {
  const out = [], a = cfg.accrual, seen = new Set();
  for (const v of tick.viewers || []) {
    if (!v || seen.has(v.twitchId) || !accrualEligible(v, tick.tickStart, cfg)) continue;
    seen.add(v.twitchId);
    const mult = subMultFor(v.subTier || 0, cfg), acct = userAcct(v.twitchId);
    if (v.present) {
      const amt = applyMult(a.perTick, mult);
      if (amt > 0) out.push(transfer(`acc:${tick.seasonId}:${tick.tickStart}:${v.twitchId}`, 'accrual', SYS.mint, acct, amt, 'Watching'));
    }
    if (tick.activeWindowStart != null && v.active) {
      const amt = applyMult(a.activeBonus, mult);
      if (amt > 0) out.push(transfer(`act:${tick.seasonId}:${tick.activeWindowStart}:${v.twitchId}`, 'active_bonus', SYS.mint, acct, amt, 'Chatting bonus'));
    }
  }
  return out;
}

/**
 * Start of the tick containing `at` (accrual ticks are aligned to wall-clock boundaries).
 * @param {number} at
 */
export function tickStartOf(at, cfg = DEFAULT_ECONOMY) {
  const len = cfg.accrual.tickSec * 1000;
  return Math.floor(at / len) * len;
}

/** Start of the active window containing `at`. */
export function activeWindowOf(at, cfg = DEFAULT_ECONOMY) {
  const len = cfg.accrual.activeWindowSec * 1000;
  return Math.floor(at / len) * len;
}

/**
 * Does this chat message count toward the active bonus? (≥ 2 words and not a command.)
 * @param {string} text
 */
export function isActiveMessage(text) {
  const t = String(text || '').trim();
  return !!t && !t.startsWith('!') && t.split(/\s+/).length >= 2;
}

/** One-time follow bonus (per account per season). */
export function followBonusFor(seasonId, twitchId, cfg = DEFAULT_ECONOMY) {
  const amt = cfg.accrual.followBonus;
  return amt > 0 ? transfer(`fol:${seasonId}:${twitchId}`, 'follow_bonus', SYS.mint, userAcct(twitchId), amt, 'Thanks for the follow') : null;
}

/**
 * Event bonus for gift subs, cheers and incoming raids.
 * @param {{ type:'gift'|'cheer'|'raidIn', eventId:string, twitchId:string, count?:number, bits?:number }} ev
 * @returns {import('./ledger.mjs').LedgerIntent|null}
 */
export function eventBonusFor(ev, cfg = DEFAULT_ECONOMY) {
  const e = cfg.events;
  let amt = 0, memo = '';
  if (ev.type === 'gift') { amt = e.perGiftedSub * Math.max(0, Math.floor(ev.count || 0)); memo = 'Gift sub bonus'; }
  else if (ev.type === 'cheer') { amt = Math.floor(Math.max(0, ev.bits || 0) / e.bitsPerDollah); memo = 'Cheer bonus'; }
  else if (ev.type === 'raidIn') { amt = e.raidLeader; memo = 'Raid bonus'; }
  if (!(amt > 0) || !ev.twitchId || !ev.eventId) return null;
  return transfer(`tw:${ev.eventId}`, 'event_bonus', SYS.mint, userAcct(ev.twitchId), amt, memo);
}

/**
 * The Discord tier for lifetime earnings this season (the highest threshold reached), or null.
 * @param {number} lifetimeEarned
 */
export function tierFor(lifetimeEarned, cfg = DEFAULT_ECONOMY) {
  let best = null;
  for (const t of cfg.tiers) if (lifetimeEarned >= t.earned && (!best || t.earned > best.earned)) best = t;
  return best ? best.id : null;
}

/**
 * The unlock price of a rarity ('reserved' items are never for sale → null).
 * @param {string} rarity
 */
export function priceForRarity(rarity, cfg = DEFAULT_ECONOMY) {
  if (rarity === 'reserved') return null;
  const p = cfg.prices[rarity];
  return Number.isSafeInteger(p) ? p : null;
}

/**
 * May this person give `amount`? Broadcaster: always. Mods: per-give and per-day caps. Everyone else: no.
 * @param {number} amount
 * @param {'viewer'|'mod'|'broadcaster'} role
 * @param {number} givenToday  what this mod already gave today
 */
export function giveCheck(amount, role, givenToday, cfg = DEFAULT_ECONOMY) {
  if (role === 'broadcaster') return { ok: true };
  if (role !== 'mod') return fail('FORBIDDEN');
  const g = cfg.give;
  if (amount > g.modMaxPerGive || givenToday + amount > g.modDailyCap) return fail('GIVE_CAP', { max: g.modMaxPerGive, cap: g.modDailyCap });
  return { ok: true };
}

/** Sky/mod grant from the mint (the `!give` command). */
export function giveIntent(idem, toTwitchId, amount, byLabel) {
  return transfer(idem, 'give', SYS.mint, userAcct(toTwitchId), amount, `From ${byLabel}`, { by: byLabel });
}

/** Admin grant (playtest "give 10,000 to all testers", corrections in the viewer's favour). */
export function grantIntent(idem, toTwitchId, amount, memo) {
  return transfer(idem, 'grant', SYS.mint, userAcct(toTwitchId), amount, memo || 'Grant');
}

/**
 * Sky's `!take`: never more than the viewer has (balances can't go below 0).
 * @returns {import('./ledger.mjs').LedgerIntent|null}  null when there is nothing to take
 */
export function takeIntent(idem, fromTwitchId, amount, balance, byLabel) {
  const amt = Math.min(amount, Math.max(0, balance));
  return amt > 0 ? transfer(idem, 'take', userAcct(fromTwitchId), SYS.burn, amt, `Taken by ${byLabel}`, { by: byLabel }) : null;
}

/** Buying an unlock: viewer → burn. */
export function unlockIntent(idem, twitchId, itemId, price, itemName) {
  return transfer(idem, 'unlock', userAcct(twitchId), SYS.burn, price, `Unlocked ${itemName || itemId}`, { itemId });
}

/** First touch in a new season: the start balance from the mint. */
export function seasonStartIntent(seasonId, twitchId, cfg = DEFAULT_ECONOMY) {
  const amt = cfg.startBalance;
  return amt > 0 ? transfer(`ss:${seasonId}:${twitchId}`, 'season_start', SYS.mint, userAcct(twitchId), amt, 'Welcome to the season') : null;
}

/** A correction with Sky's reason; `delta` may be negative (taken to burn) or positive (from the mint). */
export function correctionIntent(idem, twitchId, delta, reason) {
  if (!Number.isSafeInteger(delta) || delta === 0) throw new Error('correction delta must be a non-zero integer');
  return intent(idem, 'correction', [[userAcct(twitchId), delta], [delta > 0 ? SYS.mint : SYS.burn, -delta]], reason || 'Correction');
}
