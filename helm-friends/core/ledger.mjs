// Ledger intents: what core decides should happen to money. The cloud turns each intent into one double-entry
// transaction (CONTRACTS §3.4). Core never writes balances; it only describes transfers that sum to zero.

import { isMoney } from './money.mjs';

/**
 * @typedef {('accrual'|'active_bonus'|'follow_bonus'|'event_bonus'|'grant'|'give'|'take'|'unlock'|'reward'|
 *            'reward_refund'|'stake'|'payout'|'refund'|'pred_stake'|'pred_payout'|'pred_refund'|'season_start'|
 *            'correction')} LedgerKind
 */
/**
 * @typedef {Object} LedgerIntent
 * @property {string} idem
 * @property {LedgerKind} kind
 * @property {{ account:string, delta:number }[]} entries   sums to 0, no zero deltas, one line per account
 * @property {string} memo
 * @property {Object} [ref]
 */

export const KINDS = Object.freeze(['accrual', 'active_bonus', 'follow_bonus', 'event_bonus', 'grant', 'give', 'take',
  'unlock', 'reward', 'reward_refund', 'stake', 'payout', 'refund', 'pred_stake', 'pred_payout', 'pred_refund',
  'season_start', 'correction',
  // v1.11 faucets (sys:mint → viewer): daily check-in, Glorp's Blessing, raid stipend, bounty bonus
  'checkin', 'blessing', 'raid_stipend', 'bounty']);

/** System accounts. */
export const SYS = Object.freeze({ mint: 'sys:mint', house: 'sys:house', burn: 'sys:burn' });

/** A viewer's account string. @param {string} twitchId */
export const userAcct = (twitchId) => 'u:' + twitchId;

/** The escrow account of a game or prediction. @param {string} id */
export const escrowAcct = (id) => 'sys:escrow:' + id;

/** Idempotency key of a game settlement line (CONTRACTS §6.3). */
export const gameIdem = (gameId, kind, twitchId) => `g:${gameId}:${kind}:${twitchId}`;

/**
 * Builds an intent from signed lines. Lines for the same account merge; zero lines drop.
 * Throws (a programming error, never a user error) when the lines don't balance or aren't integers.
 * @param {string} idem
 * @param {LedgerKind} kind
 * @param {[string, number][]} lines  [account, delta]
 * @param {string} memo
 * @param {Object} [ref]
 * @returns {LedgerIntent}
 */
export function intent(idem, kind, lines, memo, ref) {
  if (!KINDS.includes(kind)) throw new Error('unknown ledger kind ' + kind);
  const by = new Map();
  for (const [account, delta] of lines) {
    if (!Number.isSafeInteger(delta)) throw new Error(`ledger delta must be an integer (${account}: ${delta})`);
    by.set(account, (by.get(account) || 0) + delta);
  }
  const entries = [...by].filter(([, d]) => d !== 0).map(([account, delta]) => ({ account, delta }));
  const sum = entries.reduce((s, e) => s + e.delta, 0);
  if (sum !== 0) throw new Error(`ledger intent ${idem} does not balance (${sum})`);
  const out = { idem, kind, entries, memo };
  if (ref) out.ref = ref;
  return out;
}

/**
 * A simple transfer of `amount` from one account to another.
 * @param {string} idem
 * @param {LedgerKind} kind
 * @param {string} from
 * @param {string} to
 * @param {number} amount  money > 0
 * @param {string} memo
 * @param {Object} [ref]
 */
export function transfer(idem, kind, from, to, amount, memo, ref) {
  if (!isMoney(amount) || amount === 0) throw new Error('transfer amount must be a positive integer, got ' + amount);
  return intent(idem, kind, [[from, -amount], [to, amount]], memo, ref);
}

/**
 * Sum of every delta per account over a list of intents (handy for checks: an escrow must end at 0).
 * @param {LedgerIntent[]} intents
 * @returns {Map<string, number>}
 */
export function netByAccount(intents) {
  const m = new Map();
  for (const it of intents) for (const e of it.entries) m.set(e.account, (m.get(e.account) || 0) + e.delta);
  return m;
}

/**
 * Structural check of an intent (what the cloud verifies before writing).
 * @param {LedgerIntent} it
 * @returns {boolean}
 */
export function isBalanced(it) {
  return !!it && Array.isArray(it.entries) && it.entries.length >= 2 &&
    it.entries.every((e) => typeof e.account === 'string' && Number.isSafeInteger(e.delta) && e.delta !== 0) &&
    it.entries.reduce((s, e) => s + e.delta, 0) === 0;
}
