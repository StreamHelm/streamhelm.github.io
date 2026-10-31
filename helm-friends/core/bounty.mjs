// The bounty on the richest viewer (v1.11, Sky). Whoever has the most Dollahs among the viewers seen THIS stream wears a
// "WANTED" tag over their head; beating them in a staked duel (fight, arm wrestle or Gleep Race 1v1) pays a bounty bonus
// from the mint on top of the pot. Designed not to inflate the economy:
//   - only a holder with ≥ minBalance (5,000) has a bounty; it is pct (2 %) of their balance, clamped to min..cap (50..500)
//   - the duel must be staked ≥ minStake (100) and the holder must accept it (they can always !decline) — no friendly farms
//   - at most perStream (3) bounties are paid per stream → the mint adds ≤ 1,500 per stream, worst case, i.e. less than
//     what ten active chatters earn in an hour of watching (≈ 1,600)
//   - fights are 50/50, so the expected bounty per duel is half of it; alts gain nothing (they'd need the richest balance)
// Infinite (playtest) accounts, bots, banned accounts and the hosts never hold a bounty.

import { DEFAULT_ECONOMY } from './economy.mjs';
import { mulDiv } from './money.mjs';
import { transfer, userAcct, SYS } from './ledger.mjs';

const cfgOf = (cfg) => (cfg && cfg.bounty) || DEFAULT_ECONOMY.bounty;
/** Duels that can claim a bounty (a race counts only as a 1v1). */
export const BOUNTY_GAMES = Object.freeze(['fight', 'armwrestle', 'race']);

/** The bounty amount on a balance (0 below minBalance). */
export function bountyAmount(balance, cfg = DEFAULT_ECONOMY) {
  const c = cfgOf(cfg);
  if (!(balance >= c.minBalance)) return 0;
  return Math.max(c.min, Math.min(c.cap, mulDiv(balance, c.pct, 100)));
}

/**
 * Who holds the bounty: the richest eligible candidate (ties → the lower twitchId, stable), or null.
 * @param {{ twitchId:string, balance:number, infinite?:boolean, bot?:boolean, banned?:boolean, host?:boolean }[]} candidates
 * @returns {{ twitchId:string, amount:number, balance:number }|null}
 */
export function bountyHolder(candidates, cfg = DEFAULT_ECONOMY) {
  let best = null;
  for (const c of candidates || []) {
    if (!c || c.infinite || c.bot || c.banned || c.host || !(c.balance >= 0)) continue;
    if (!best || c.balance > best.balance || (c.balance === best.balance && c.twitchId < best.twitchId)) best = c;
  }
  const amount = best ? bountyAmount(best.balance, cfg) : 0;
  return amount > 0 ? { twitchId: best.twitchId, amount, balance: best.balance } : null;
}

/**
 * Does a settled duel claim the bounty fixed on it at challenge time (input.bounty = { holder, amount })?
 * @param {string} game
 * @param {Object} input    the duel's input (a, b, stake, mode?, bounty?)
 * @param {Object} outcome  { winner, loser }
 * @param {number} paidThisStream  bounties already paid this stream
 * @returns {{ winner:string, holder:string, amount:number }|null}
 */
export function bountyClaim(game, input, outcome, paidThisStream, cfg = DEFAULT_ECONOMY) {
  const c = cfgOf(cfg), b = input && input.bounty;
  if (!b || !BOUNTY_GAMES.includes(game) || (game === 'race' && input.mode === 'gp')) return null;
  if (!(input.stake >= c.minStake) || paidThisStream >= c.perStream) return null;
  if (!outcome || outcome.loser !== b.holder || outcome.winner === b.holder) return null;
  return b.amount > 0 ? { winner: outcome.winner, holder: b.holder, amount: Math.min(b.amount, c.cap) } : null;
}

/** The bounty bonus (sys:mint → the winner), key bt:<gameId>. */
export function bountyIntent(gameId, claim, holderName) {
  return transfer(`bt:${gameId}`, 'bounty', SYS.mint, userAcct(claim.winner), claim.amount, `Bounty on @${holderName || claim.holder}`, { gameId });
}

/** The worst-case mint per stream (for the design note and the admin page). */
export const bountyTheory = (cfg = DEFAULT_ECONOMY) => ({ maxPerStream: cfgOf(cfg).cap * cfgOf(cfg).perStream, ...cfgOf(cfg) });
