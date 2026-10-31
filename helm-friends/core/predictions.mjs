// Predictions with two currencies (DESIGN §6): channel points are settled by Twitch, Dollahs by us (parimutuel).
// The bars show both: each option's length is its share of points + Dollahs × dollahToPoints, split inside into the
// outcome colour (points) and silver (Dollahs). A prediction only truly dies if neither currency was put in.

import { DEFAULT_ECONOMY } from './economy.mjs';
import { mulDiv, isMoney } from './money.mjs';
import { fail } from './errors.mjs';
import { intent, transfer, escrowAcct, userAcct, SYS } from './ledger.mjs';
import { fmt } from './format.mjs';

/** @typedef {{ twitchId:string, outcome:string, amount:number }} DollahBet   one row per viewer (top-ups summed) */
/** @typedef {{ outcome:string, points:number, users:number }} CpTotal         from Twitch's prediction progress */

const predIdem = (predId, kind, twitchId) => `p:${predId}:${kind}:${twitchId}`;
const pconf = (cfg) => (cfg && cfg.predictions) || DEFAULT_ECONOMY.predictions;

/** The outcome with the 1-based number `n` (what `!pred n <amount>` / `!bet` and `!predwin n` use), or null. */
export function outcomeByN(pred, n) {
  return pred.outcomes.find((o) => o.n === n) || null;
}

/**
 * May this viewer bet (or top up) now?
 * @param {Object} pred           HfPrediction
 * @param {DollahBet|null} existing  this viewer's bet so far
 * @param {string} outcomeId
 * @param {number} amount         the new money going in
 * @param {number} now
 * @returns {{ ok:true, total:number } | { ok:false, code:string }}
 */
export function betCheck(pred, existing, outcomeId, amount, now, cfg) {
  const lim = { min: pred.minBet ?? pconf(cfg).minBet, max: pred.maxBet ?? pconf(cfg).maxBet };
  if (pred.status !== 'open' || now >= pred.locksAt) return fail('CLOSED');
  const o = pred.outcomes.find((x) => x.id === outcomeId);
  if (!o) return fail('NOT_FOUND');
  if (existing && existing.amount > 0 && existing.outcome !== outcomeId) {
    const was = pred.outcomes.find((x) => x.id === existing.outcome);
    return fail('SIDE_SWITCH', { n: was ? was.n : '?' });
  }
  const total = (existing ? existing.amount : 0) + amount;
  if (!isMoney(amount) || amount < 1 || (!existing && amount < lim.min) || total > lim.max) return fail('BAD_AMOUNT', lim);
  return { ok: true, total };
}

/** A Dollah bet going into the prediction's escrow. */
export function betIntent(predId, twitchId, amount, idem) {
  return transfer(idem, 'pred_stake', userAcct(twitchId), escrowAcct(predId), amount, 'Prediction bet', { predictionId: predId });
}

/** Everyone gets their Dollahs back (cancel, or nobody bet on the winner). */
export function refundDollahPool(pred, bets) {
  return bets.filter((b) => b.amount > 0).map((b) =>
    transfer(predIdem(pred.id, 'refund', b.twitchId), 'pred_refund', escrowAcct(pred.id), userAcct(b.twitchId), b.amount,
      'Prediction refunded', { predictionId: pred.id }));
}

/**
 * Parimutuel settlement of the Dollah pool: each winner gets stake + floor(stake × losePool / winPool); the leftover
 * dust goes to the biggest winning bettor (earliest bet on a tie). The escrow always ends at exactly 0.
 * Nobody bet on the winner → noWinnerPolicy: 'refund' (default) gives everyone their Dollahs back, 'house' keeps them.
 * TIES (v1.9, `!predwin 1 3`): pass several winning outcome ids. Every bettor on ANY winning option is a winner; the
 * losing pool (the bets on every other option) is shared across all of them in proportion to their stakes, with the same
 * integer maths and the same dust rule (the biggest winning bettor, earliest on a tie). No Dollah is created or destroyed.
 * @param {Object} pred
 * @param {string|string[]} winningOutcome  outcome id, or several for a tie
 * @param {DollahBet[]} bets
 */
export function settleDollahPool(pred, winningOutcome, bets, cfg) {
  const live = bets.filter((b) => b.amount > 0);
  const won = new Set(Array.isArray(winningOutcome) ? winningOutcome : [winningOutcome]);
  const winners = live.filter((b) => won.has(b.outcome));
  const losePool = live.filter((b) => !won.has(b.outcome)).reduce((s, b) => s + b.amount, 0);
  if (!winners.length) {
    if (pconf(cfg).noWinnerPolicy === 'house' && losePool > 0) {
      return [intent(`p:${pred.id}:house:house`, 'pred_payout', [[escrowAcct(pred.id), -losePool], [SYS.house, losePool]],
        'Nobody picked the winner', { predictionId: pred.id })];
    }
    return refundDollahPool(pred, live);
  }
  const winPool = winners.reduce((s, b) => s + b.amount, 0);
  const shares = winners.map((b) => mulDiv(b.amount, losePool, winPool));
  let big = 0;
  winners.forEach((b, i) => { if (b.amount > winners[big].amount) big = i; });
  shares[big] += losePool - shares.reduce((s, x) => s + x, 0);
  return winners.map((b, i) => {
    const pay = b.amount + shares[i];
    return intent(predIdem(pred.id, 'payout', b.twitchId), 'pred_payout', [[escrowAcct(pred.id), -pay], [userAcct(b.twitchId), pay]],
      `Prediction won (+${fmt(shares[i])})`, { predictionId: pred.id });
  });
}

/**
 * The per-outcome totals stored on the prediction (CONTRACTS §3.6) from the Dollah bets and Twitch's point totals.
 * @param {Object} pred
 * @param {DollahBet[]} bets
 * @param {CpTotal[]} [cp]
 */
export function totalsFrom(pred, bets, cp = []) {
  return pred.outcomes.map((o) => {
    const mine = bets.filter((b) => b.outcome === o.id && b.amount > 0);
    const c = cp.find((x) => x.outcome === o.id || x.outcome === o.twitchOutcomeId) || { points: 0, users: 0 };
    return { outcome: o.id, dollahs: mine.reduce((s, b) => s + b.amount, 0), bettors: mine.length, points: c.points || 0, pointUsers: c.users || 0 };
  });
}

/** Integer percentages that add up to exactly 100 (largest remainder). All zero when the total is 0. */
export function percentages(weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (!(total > 0)) return weights.map(() => 0);
  const raw = weights.map((w) => (w * 100) / total), out = raw.map(Math.floor);
  let left = 100 - out.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; out[i]++; left--; }
  return out;
}

/**
 * The bars. pct = share of the combined weight (points + Dollahs × dollahToPoints); cpPct/dPct split the bar.
 * @param {Object} pred
 * @param {CpTotal[]} [cpTotals]  fresher point totals than pred.totals (optional)
 * @returns {{ outcome:string, n:number, pct:number, cpPct:number, dPct:number, points:number, dollahs:number, pointUsers:number, bettors:number }[]}
 */
export function bars(pred, cpTotals, cfg = DEFAULT_ECONOMY) {
  const k = cfg.dollahToPoints;
  const rows = pred.outcomes.map((o) => {
    const t = (pred.totals || []).find((x) => x.outcome === o.id) || { dollahs: 0, bettors: 0, points: 0, pointUsers: 0 };
    const c = cpTotals && cpTotals.find((x) => x.outcome === o.id || x.outcome === o.twitchOutcomeId);
    return { o, dollahs: t.dollahs || 0, bettors: t.bettors || 0, points: c ? c.points : t.points || 0, pointUsers: c ? c.users : t.pointUsers || 0 };
  });
  const pct = percentages(rows.map((r) => r.points + r.dollahs * k));
  return rows.map((r, i) => {
    const w = r.points + r.dollahs * k;
    const cpPct = w > 0 ? Math.round((r.points * 100) / w) : 100;
    return { outcome: r.o.id, n: r.o.n, pct: pct[i], cpPct, dPct: 100 - cpPct, points: r.points, dollahs: r.dollahs, pointUsers: r.pointUsers, bettors: r.bettors };
  });
}

const people = (n) => `${fmt(n)} ${n === 1 ? 'person' : 'people'}`;

/** The caption under a bar: "12,400 pts (31 people) · 3,250 Dollahs (9 people)". */
export function barCaption(bar, pointsName = 'pts') {
  return `${fmt(bar.points)} ${pointsName} (${people(bar.pointUsers)}) · ${fmt(bar.dollahs)} Pepe's Silvia Dollahs (${people(bar.bettors)})`;
}

/**
 * What our prediction does when Twitch's side changes (the survival table, DESIGN §6.2.5).
 * @param {Object} pred
 * @param {{ status:'locked'|'canceled'|'resolved', winningTwitchOutcomeId?:string }} ev
 * @param {{ dollahBettors:number, pointUsers:number }} counts
 * @returns {{ action:'keep'|'lock'|'cancel'|'resolve', twitchStatus:string, winner?:string, note?:string }}
 */
export function onTwitchEvent(pred, ev, counts) {
  const live = pred.status === 'open' || pred.status === 'locked';
  if (ev.status === 'canceled') {
    if (live && counts.dollahBettors > 0) {
      return { action: 'keep', twitchStatus: 'canceled', note: 'Channel points were refunded by Twitch — the Pepe\'s Silvia Dollahs side is still running.' };
    }
    return { action: live ? 'cancel' : 'keep', twitchStatus: 'canceled' };
  }
  if (ev.status === 'locked') {
    // Twitch's window closed. With only Dollah bets, ours keeps its own lock time; otherwise lock together.
    if (pred.status === 'open' && !(counts.dollahBettors > 0 && counts.pointUsers === 0)) return { action: 'lock', twitchStatus: 'locked' };
    return { action: 'keep', twitchStatus: 'locked' };
  }
  if (ev.status === 'resolved') {
    const o = pred.outcomes.find((x) => x.twitchOutcomeId && x.twitchOutcomeId === ev.winningTwitchOutcomeId);
    if (live && o) return { action: 'resolve', twitchStatus: 'resolved', winner: o.id };
    return { action: 'keep', twitchStatus: 'resolved' };
  }
  return { action: 'keep', twitchStatus: pred.twitchStatus || null };
}

/**
 * What happens at locksAt: nobody bet anything → cancel both sides; else lock.
 * @returns {'lock'|'cancel'|'wait'}
 */
export function atLockTime(pred, now, counts) {
  if (pred.status !== 'open' || now < pred.locksAt) return 'wait';
  return counts.dollahBettors > 0 || counts.pointUsers > 0 ? 'lock' : 'cancel';
}
