// All eight game engines (v1.9: + coin flip, Gleep Race) behind one interface (CONTRACTS §4), plus playGame(): the exact order the cloud runs them in.

import { GAME as slots } from './slots.mjs';
import { GAME as roulette } from './roulette.mjs';
import { GAME as fight } from './fight.mjs';
import { GAME as armwrestle } from './armwrestle.mjs';
import { GAME as royale } from './royale.mjs';
import { GAME as heist } from './heist.mjs';
import { GAME as flip } from './flip.mjs';
import { GAME as race } from './race.mjs';
import { GAME as cursed } from './cursed.mjs';
import { createRng } from '../rng.mjs';
import { DEFAULT_ECONOMY } from '../economy.mjs';

/**
 * @typedef {Object} GameEngine
 * @property {string} id
 * @property {{ minBet:number, maxBet:number, lobbyMs?:number, acceptMs?:number, minPlayers?:number, maxPlayers?:number }} defaults
 * @property {(input:Object, cfg?:Object) => ({ ok:true } | { ok:false, code:string })} validate   cfg = the economy config
 * @property {(input:Object, gameId:string) => import('../ledger.mjs').LedgerIntent[]} stakes       u → escrow, taken at creation
 * @property {(input:Object, rng:import('../rng.mjs').Rng, cfg?:Object) => Object} resolve           pure; same seed + input → same outcome
 * @property {(input:Object, outcome:Object, rng:import('../rng.mjs').Rng, ctx:{ now:number, gameId?:string, roster?:Object[] }) => import('../script.mjs').Script} choreograph
 * @property {(input:Object, outcome:Object, gameId:string) => import('../ledger.mjs').LedgerIntent[]} settle   payouts/refunds; empties the escrow
 * @property {(input:Object, outcome:Object) => string} summary   the one chat line at endsAt (≤ 300 chars)
 */

/** @type {Readonly<Record<'slots'|'roulette'|'fight'|'armwrestle'|'royale'|'heist'|'flip'|'race'|'cursed', GameEngine>>} */
export const GAMES = Object.freeze({ slots, roulette, fight, armwrestle, royale, heist, flip, race, cursed });
/** Games played 1–5 times in one show (input.runs, v1.9). */
export const MULTI_RUN = Object.freeze(['slots', 'roulette', 'flip', 'cursed']);

/**
 * Runs a game end to end from its seed: validate → resolve (rng fork 'resolve') → choreograph (fork 'show') →
 * settle → summary. Separate forks mean changing the animation code can never change an outcome.
 * @param {keyof typeof GAMES} gameId_  which engine
 * @param {Object} input
 * @param {string} seed
 * @param {{ gameId:string, now:number, cfg?:Object, roster?:Object[] }} ctx
 */
export function playGame(gameId_, input, seed, ctx) {
  const game = GAMES[gameId_];
  if (!game) throw new Error('unknown game ' + gameId_);
  const cfg = ctx.cfg || DEFAULT_ECONOMY;
  const v = game.validate(input, cfg);
  if (!v.ok) return v;
  const rng = createRng(seed);
  const outcome = game.resolve(input, rng.fork('resolve'), cfg);
  const script = game.choreograph(input, outcome, rng.fork('show'), { now: ctx.now, gameId: ctx.gameId, roster: ctx.roster || [] });
  return { ok: true, outcome, script, intents: game.settle(input, outcome, ctx.gameId), summary: game.summary(input, outcome) };
}
