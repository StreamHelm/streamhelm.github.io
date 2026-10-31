// Dollah amounts. Money is ALWAYS a safe, non-negative integer; multipliers are applied in whole basis points with a
// floor, so no float ever lands in a balance (CONTRACTS conventions: "Multipliers are applied with Math.floor").

import { fail } from './errors.mjs';
export { fmt } from './format.mjs';

/** The balance value that means "infinite" (playtest Sky). */
export const INFINITE = -1;

/** One basis point = 1/10,000. Multipliers like 0.5×, 1.2× or 7.2× are exact in basis points. */
export const BP = 10000;

/**
 * True for a valid money value: a safe integer ≥ 0.
 * @param {unknown} n
 */
export function isMoney(n) {
  return Number.isSafeInteger(n) && n >= 0;
}

/**
 * A multiplier as whole basis points: 1.2 → 12000, 0.5 → 5000, 7.2 → 72000. Rounds away float noise (1.4 is 1.39999…).
 * @param {number} mult
 */
export function toBp(mult) {
  if (!Number.isFinite(mult) || mult < 0) throw new RangeError('bad multiplier ' + mult);
  return Math.round(mult * BP);
}

/**
 * floor(amount × mult), done in integers. The single place a Dollah amount is multiplied.
 * @param {number} amount  money
 * @param {number} mult    e.g. 0.5, 1.2, 36
 * @returns {number} money
 */
export function applyMult(amount, mult) {
  if (!isMoney(amount)) throw new RangeError('applyMult: not money ' + amount);
  return applyBp(amount, toBp(mult));
}

/**
 * floor(amount × bp / 10,000) in integers (BigInt when the product would leave the safe range).
 * @param {number} amount
 * @param {number} bp
 */
export function applyBp(amount, bp) {
  const p = amount * bp;
  if (Number.isSafeInteger(p)) return Math.floor(p / BP);
  return Number((BigInt(amount) * BigInt(bp)) / BigInt(BP));
}

/**
 * floor(a × b / c) for money, exact (BigInt inside). Used for parimutuel shares.
 * @param {number} a
 * @param {number} b
 * @param {number} c  > 0
 */
export function mulDiv(a, b, c) {
  if (c <= 0) throw new RangeError('mulDiv by ' + c);
  return Number((BigInt(a) * BigInt(b)) / BigInt(c));
}

/** Money clamp. */
export function clampMoney(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

const WORD_ALL = new Set(['all', 'allin', 'all-in', 'max']);
const LITERAL = /^(\d{1,15})(?:\.(\d{1,6}))?(k|m)?$/;
const SUFFIX = { k: 3, m: 6 };

/**
 * Parses a plain amount: "250", "1,000", "1k", "1.5k", "2m". No "all"/"half" (those need a balance).
 * Decimals are allowed only when they make a whole number ("1.5k" = 1500; "10.5" and "1.2345k" are not whole).
 * @param {string} text
 * @returns {{ ok:true, amount:number } | { ok:false, code:'BAD_AMOUNT' }}
 */
export function parseAmountLiteral(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/(\d)[,_](?=\d{3}\b)/g, '$1');
  const m = LITERAL.exec(t);
  if (!m) return fail('BAD_AMOUNT');
  const zeros = m[3] ? SUFFIX[m[3]] : 0, frac = m[2] || '';
  if (frac.replace(/0+$/, '').length > zeros) return fail('BAD_AMOUNT'); // not a whole number of Dollahs
  const digits = m[1] + frac.padEnd(zeros, '0').slice(0, zeros);
  const amount = Number(digits);
  if (!Number.isSafeInteger(amount)) return fail('BAD_AMOUNT');
  return { ok: true, amount };
}

/**
 * Turns what a viewer typed into a stake, checked against their live balance and the game's limits.
 * Accepts "250", "1k", "1.5k", "all", "half". "all"/"half" clamp to `max`.
 * Checks run in this order: format → limits (BAD_AMOUNT) → balance (NO_FUNDS).
 * @param {string} text
 * @param {number} balance   current balance; -1 = infinite
 * @param {{ min:number, max:number }} limits
 * @returns {{ ok:true, amount:number } | { ok:false, code:'BAD_AMOUNT'|'NO_FUNDS', min:number, max:number, balance:number }}
 */
/**
 * A per-run bet for a multi-run game (`!slots 100 3`): the bet must be legal on its own (min..max) and bet × runs must be
 * covered by the balance. "all" / "half" mean all / half of what you have, shared across the runs (clamped to max).
 * @param {string} text
 * @param {number} balance   INFINITE (-1) for an infinite playtest account
 * @param {{ min:number, max:number }} lim
 * @param {number} runs      1..n
 * @returns {{ ok:true, amount:number, total:number } | { ok:false, code:'BAD_AMOUNT'|'NO_FUNDS' }}
 */
export function parseRunsBet(text, balance, lim, runs = 1) {
  const n = Number.isSafeInteger(runs) && runs > 0 ? runs : 1;
  if (balance === INFINITE) { const a = parseAmount(text, balance, lim); return a.ok ? { ok: true, amount: a.amount, total: a.amount * n } : a; }
  const t = String(text ?? '').trim().toLowerCase();
  const share = WORD_ALL.has(t) || t === 'half' ? Math.floor(balance / n) : balance;
  const a = parseAmount(text, share, lim);
  if (!a.ok) return a.code === 'NO_FUNDS' ? fail('NO_FUNDS', { min: lim.min, max: lim.max, balance }) : a;
  if (a.amount * n > balance) return fail('NO_FUNDS', { min: lim.min, max: lim.max, balance, need: a.amount * n });
  return { ok: true, amount: a.amount, total: a.amount * n };
}

export function parseAmount(text, balance, { min, max }) {
  const infinite = balance === INFINITE;
  const have = infinite ? Infinity : balance;
  const vars = { min, max, balance };
  const t = String(text ?? '').trim().toLowerCase();
  let amount;
  if (WORD_ALL.has(t)) amount = Math.min(have, max);
  else if (t === 'half') amount = infinite ? max : Math.min(Math.floor(have / 2), max);
  else {
    const lit = parseAmountLiteral(t);
    if (!lit.ok) return fail('BAD_AMOUNT', vars);
    amount = lit.amount;
    if (amount < min || amount > max) return fail('BAD_AMOUNT', vars);
  }
  if (amount < min) return fail('NO_FUNDS', vars); // "all"/"half" of too little to place a minimum bet
  if (amount > have) return fail('NO_FUNDS', vars);
  return { ok: true, amount };
}
