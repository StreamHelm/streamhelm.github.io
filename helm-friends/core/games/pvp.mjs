// What fight and arm wrestle share (DESIGN §4.5): two players, the same stake each, winner takes the pot (minus an
// optional rake, default 0). A stake of 0 is a friendly match "for glory": no money moves.

import { fail } from '../errors.mjs';
import { applyBp, isMoney } from '../money.mjs';
import { SYS, intent, escrowAcct, userAcct, gameIdem } from '../ledger.mjs';
import { isId, stakeIntent, at } from './common.mjs';
import { fmt } from '../format.mjs';

/**
 * @param {{ a:string, b:string, stake:number }} input
 * @param {{ minBet:number, maxBet:number }} lim
 */
export function validatePvp(input, lim) {
  if (!input || !isId(input.a) || !isId(input.b)) return fail('BAD_INPUT');
  if (input.a === input.b) return fail('SELF_TARGET');
  if (input.stake === 0) return { ok: true };
  if (!isMoney(input.stake) || input.stake < lim.minBet || input.stake > lim.maxBet) return fail('BAD_AMOUNT', { min: lim.minBet, max: lim.maxBet });
  return { ok: true };
}

/** Both stakes into escrow (A at challenge time, B on accept; the cloud posts them at those moments). */
export function stakesPvp(input, gameId) {
  return input.stake > 0 ? [stakeIntent(gameId, input.a, input.stake), stakeIntent(gameId, input.b, input.stake)] : [];
}

/** The house cut of a pot. */
export function rakeOf(pot, rakePct) {
  return rakePct > 0 ? applyBp(pot, Math.round(rakePct * 100)) : 0;
}

/**
 * The winner takes the pot (2 × stake) minus the rake.
 * @param {string} gameId
 * @param {{ a:string, b:string, stake:number, rakePct?:number }} input
 * @param {string} winner
 */
export function settlePvp(gameId, input, winner, label) {
  if (!(input.stake > 0)) return [];
  const pot = input.stake * 2, rake = rakeOf(pot, input.rakePct || 0);
  return [intent(gameIdem(gameId, 'payout', winner), 'payout',
    [[escrowAcct(gameId), -pot], [userAcct(winner), pot - rake], [SYS.house, rake]], `Won the ${label}`, { gameId })];
}

/** "@a beat @b - +500" / "@a beat @b!" for a friendly. */
export function pvpSummary(input, winner, loser, verb) {
  const prize = input.stake > 0 ? ` - +${fmt(input.stake * 2 - rakeOf(input.stake * 2, input.rakePct || 0) - input.stake)}` : '!';
  return `${at(input, winner)} ${verb} ${at(input, loser)}${prize}`;
}
