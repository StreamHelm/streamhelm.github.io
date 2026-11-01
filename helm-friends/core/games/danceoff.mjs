// THE DANCE-OFF `!danceoff @user [amount]` → `!accept` (v1.21, games round 6). Two Helm Friends dance on a light-up floor
// under a disco ball; CHAT decides who wins: for 20 seconds everyone types 1 (the challenger) or 2 (the one challenged).
// One vote per viewer (typing again only changes your vote; the two dancers can't vote), the most votes wins the pot; a tie
// is broken by PepeBot (a seeded coin flip, drawn first so it never depends on the votes).
// Money: like a fight - the same stake each (0 = just for glory), the winner takes the pot minus the optional rake (default
// 0), so the EV is 0 for both: it's a popularity contest, not a house game.
// Live input, provably fair (like Hot Potato's passes): every accepted vote is logged on the record as { t, by, n } (t = ms
// after the show started); resolve() replays them, so the same seed + votes always gives the same result. The show length
// never changes. After votes come in, the cloud re-makes the show from the seed + votes and re-sends it (same group
// 'danceoff:<gameId>', same startsAt, a new id <gameId>.v<k>) at most every DANCE.resendMs; the vote meter is part of the show
// (prop state votes:<a>,<b> every 500 ms while it changes), so a reload lands on the same picture.
// Show: intro (the floor lights up, PepeBot explains) → A's solo → B's solo → both together (styles change halfway) → the
// votes close ("the votes are in...") → the winner is announced: banner, coins, confetti, winner dances, loser slumps.

import { DEFAULT_ECONOMY } from '../economy.mjs';
import { scriptBuilder, HOUSE, EVERYONE, DANCE_STYLES, clip } from '../script.mjs';
import { validatePvp, stakesPvp, settlePvp, rakeOf } from './pvp.mjs';
import { at, nameOf } from './common.mjs';
import { fmt } from '../format.mjs';

/** Show timing (ms from the start). Votes count from voteFrom (incl.) to voteTo (excl.). */
export const DANCE = Object.freeze({ introMs: 3000, soloMs: 5000, voteFrom: 3000, voteTo: 23000, resultAt: 24500, outroMs: 5500, binMs: 500, resendMs: 1200, maxVotes: 3000 });

const limits = (cfg) => (cfg && cfg.danceoff) || DEFAULT_ECONOMY.danceoff;

/**
 * Turns a chat message into a vote: "1", "2", "!vote 1", "vote 2" (anything else → null).
 * @returns {1|2|null}
 */
export function parseVote(text) {
  const m = /^\s*!?(?:vote\s*)?([12])\s*!*\s*$/i.exec(String(text || ''));
  return m ? Number(m[1]) : null;
}

/** Each voter's last vote (only votes inside the window and before `upTo` ms) → { a, b, voters }. */
export function danceTally(input, upTo = Infinity) {
  const last = new Map();
  for (const v of input.votes || []) {
    if (!v || !(v.t >= DANCE.voteFrom && v.t < DANCE.voteTo) || v.t >= upTo || (v.n !== 1 && v.n !== 2)) continue;
    if (v.by === input.a || v.by === input.b) continue;
    last.set(v.by, v.n);
  }
  let a = 0, b = 0;
  for (const n of last.values()) if (n === 1) a++; else b++;
  return { a, b, voters: last.size };
}

/**
 * May `voter` vote `n` at `t` ms into the show? → { ok:true, vote:{ t, by, n } } | { ok:false, why }.
 * why: 'closed' (outside the window), 'dancer' (the two dancers can't vote), 'same' (that's already their vote), 'full', 'bad'.
 */
export function danceVote(input, t, voter, n) {
  if (n !== 1 && n !== 2) return { ok: false, why: 'bad' };
  if (!(t >= DANCE.voteFrom && t < DANCE.voteTo)) return { ok: false, why: 'closed' };
  if (voter === input.a || voter === input.b) return { ok: false, why: 'dancer' };
  const votes = input.votes || [];
  if (votes.length >= DANCE.maxVotes) return { ok: false, why: 'full' };
  for (let i = votes.length - 1; i >= 0; i--) if (votes[i].by === voter) { if (votes[i].n === n) return { ok: false, why: 'same' }; break; }
  return { ok: true, vote: { t: Math.round(t), by: String(voter), n } };
}

/** @type {import('./index.mjs').GameEngine} */
export const GAME = Object.freeze({
  id: 'danceoff',
  defaults: { minBet: DEFAULT_ECONOMY.danceoff.minBet, maxBet: DEFAULT_ECONOMY.danceoff.maxBet, acceptMs: DEFAULT_ECONOMY.danceoff.acceptSec * 1000 },
  validate(input, cfg) {
    const v = validatePvp(input, limits(cfg));
    if (!v.ok) return v;
    if (input.votes != null && !(Array.isArray(input.votes) && input.votes.length <= DANCE.maxVotes)) return { ok: false, code: 'BAD_INPUT' };
    return v;
  },
  stakes: stakesPvp,
  resolve(input, rng) {
    const coin = rng.chance(0.5);   // drawn first: PepeBot's tie-break never depends on how many votes came in
    const t = danceTally(input), tie = t.a === t.b, aWins = tie ? coin : t.a > t.b;
    return { winner: aWins ? input.a : input.b, loser: aWins ? input.b : input.a, votesA: t.a, votesB: t.b, voters: t.voters, tie, durationMs: DANCE.resultAt + DANCE.outroMs };
  },
  choreograph(input, outcome, rng, ctx) {
    const { a, b } = input, { winner, loser } = outcome, D = DANCE;
    const styles = rng.shuffle([...DANCE_STYLES]);
    const nA = clip(nameOf(input, a), 18), nB = clip(nameOf(input, b), 18);
    const s = scriptBuilder({ id: ctx.gameId || 'g_preview', kind: 'danceoff', startsAt: ctx.now, crowd: 'others-watch' })
      .cast(a, 'a').cast(b, 'b').cast(HOUSE, 'host')
      .prop('floor', 'danceFloor', 0.5, 1, 'idle', { dance: { a, b }, label: input.stake > 0 ? `${fmt(input.stake * 2)} pot` : 'for glory' });
    s.at(0, 'moveTo', a, { x: 0.42, lane: 1, speed: 'walk' }).at(0, 'moveTo', b, { x: 0.58, lane: 1, speed: 'walk' });
    s.at(0, 'moveTo', HOUSE, { x: 0.5, lane: 1, speed: 'walk' });   // the host stands on the floor between the dancers
    s.at(1300, 'face', a, { dir: 'front' }).at(1300, 'face', b, { dir: 'front' }).at(1300, 'face', HOUSE, { dir: 'front' });
    s.at(1300, 'prop', null, { id: 'floor', state: 'on' });
    s.say(1400, HOUSE, clip(`DANCE-OFF! Chat: 1 = ${nA}, 2 = ${nB}`, 60), 2600);
    // A's solo, B's solo, then both together (new styles halfway); the other one cheers along during a solo
    const soloA = D.introMs, soloB = D.introMs + D.soloMs, both = D.introMs + 2 * D.soloMs, swap = both + (D.voteTo - both) / 2 - 150;
    s.at(soloA, 'anim', a, { name: 'dance', loop: true, style: styles[0] }).at(soloA, 'expr', a, { name: 'excited', ms: D.soloMs });
    s.at(soloA, 'fx', a, { name: 'notes', ms: D.soloMs });
    s.at(soloA + 400, 'anim', b, { name: 'cheer', loop: true });
    s.at(soloB, 'anim', b, { name: 'dance', loop: true, style: styles[1] }).at(soloB, 'expr', b, { name: 'excited', ms: D.soloMs });
    s.at(soloB, 'fx', b, { name: 'notes', ms: D.soloMs });
    s.at(soloB, 'anim', a, { name: 'idle', loop: true }).at(soloB + 300, 'anim', a, { name: 'cheer', loop: true });
    s.at(both, 'anim', a, { name: 'dance', loop: true, style: styles[2] }).at(both + 120, 'anim', b, { name: 'dance', loop: true, style: styles[3] });
    s.at(swap, 'anim', a, { name: 'dance', loop: true, style: styles[4] }).at(swap + 120, 'anim', b, { name: 'dance', loop: true, style: styles[5] });
    s.at(both, 'fx', a, { name: 'notes', ms: D.voteTo - both }).at(both, 'fx', b, { name: 'notes', ms: D.voteTo - both });
    s.at(both, 'expr', a, { name: 'happy', ms: D.voteTo - both }).at(both, 'expr', b, { name: 'happy', ms: D.voteTo - both });
    s.say(both + 200, HOUSE, 'Both together now!', 1600);
    s.say(D.voteTo - 4500, HOUSE, 'Last chance to vote! 1 or 2!', 2400);
    // the crowd bops along
    s.at(soloA + 600, 'anim', EVERYONE, { name: 'cheer' }).at(both + 600, 'anim', EVERYONE, { name: 'dance', loop: true, style: styles[6] });
    // the vote meter: every bin that changed
    let prev = '0,0';
    for (let t = D.voteFrom + D.binMs; t <= D.voteTo; t += D.binMs) {
      const x = danceTally(input, t), st = `${x.a},${x.b}`;
      if (st !== prev) { s.at(t, 'prop', null, { id: 'floor', state: 'votes:' + st }); prev = st; }
    }
    if (prev === '0,0') s.at(D.voteFrom + D.binMs, 'prop', null, { id: 'floor', state: 'votes:0,0' });
    s.at(D.voteTo, 'prop', null, { id: 'floor', state: `closed:${outcome.votesA},${outcome.votesB}` });
    s.at(D.voteTo, 'anim', a, { name: 'idle', loop: true }).at(D.voteTo, 'anim', b, { name: 'idle', loop: true });
    s.say(D.voteTo + 100, HOUSE, outcome.tie ? `A TIE?! ${outcome.votesA}-${outcome.votesB}... I decide!` : 'The votes are in...', 1400);
    const R = D.resultAt;
    s.at(R, 'prop', null, { id: 'floor', state: `result:${winner === a ? 'a' : 'b'}:${outcome.votesA},${outcome.votesB}` });
    s.at(R, 'fx', null, { name: 'banner', x: 0.5, y: 0.34, text: clip(`${nameOf(input, winner)} WINS THE DANCE-OFF!`, 60) });
    s.at(R, 'fx', null, { name: 'confetti', x: winner === a ? 0.42 : 0.58, y: 0.05 });
    s.at(R, 'anim', winner, { name: 'victory' }).at(R, 'expr', winner, { name: 'excited', ms: 4000 });
    s.at(R + 900, 'anim', winner, { name: 'dance', loop: true, style: styles[0] }).at(R + 900, 'fx', winner, { name: 'notes', ms: 3500 });
    s.at(R, 'anim', loser, { name: 'sad', loop: true }).at(R, 'expr', loser, { name: 'sad', ms: 4000 });
    s.at(R + 200, 'anim', EVERYONE, { name: 'cheer' });
    if (input.stake > 0) s.coinRain(R + 300, input.stake * 2, winner === a ? 0.42 : 0.58, 0.5);
    s.say(R + 600, HOUSE, outcome.tie ? 'Judges\' decision!' : clip(`${outcome.votesA} to ${outcome.votesB}!`, 60), 2000);
    const out = s.build(R + D.outroMs);
    out.group = 'danceoff:' + (ctx.gameId || 'g_preview');   // votes re-send the show (new id, same group): the overlay swaps it in
    return out;
  },
  settle: (input, outcome, gameId) => settlePvp(gameId, input, outcome.winner, 'dance-off'),
  summary(input, outcome) {
    const w = outcome.winner === input.a ? outcome.votesA : outcome.votesB, l = outcome.winner === input.a ? outcome.votesB : outcome.votesA;
    const prize = input.stake > 0 ? ` - +${fmt(input.stake * 2 - rakeOf(input.stake * 2, input.rakePct || 0) - input.stake)}` : '!';
    const score = outcome.tie ? `${w}-${l}, PepeBot broke the tie` : `${w}-${l}`;
    return `${at(input, outcome.winner)} out-danced ${at(input, outcome.loser)} (${score})${prize}`;
  },
});
