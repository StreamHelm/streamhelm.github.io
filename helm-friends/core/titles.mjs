// Duel streaks and titles over avatars' heads (v1.11, Sky: "Undefeated ×5"). Duels = fights, arm wrestles and Gleep Race
// 1v1s (friendly ones count: titles are glory, never money). A win adds to your streak, a loss ends it. Titles:
//   On a Roll ×N        3–4 wins in a row          tier 1
//   Undefeated ×N       5–9                        tier 2
//   Unstoppable ×N      10–19                      tier 3
//   Living Legend ×N    20+                        tier 4
//   Streak Breaker      you ended someone's streak of 5+ (this stream)
//   Last One Standing   won the latest battle royale (until the next one)
//   Gleep Champion      won the latest Gleep Grand Prix (until the next one)
// One title shows at a time: the highest streak tier, else Streak Breaker, else the latest championship.
// The bounty "WANTED" tag (bounty.mjs) is a separate badge and can show next to a title.

/** @typedef {{ wins:number, losses:number, streak:number, best:number }} DuelStats */

export const TITLES = Object.freeze([
  { id: 'legend', min: 20, text: 'Living Legend', tier: 4 },
  { id: 'unstoppable', min: 10, text: 'Unstoppable', tier: 3 },
  { id: 'undefeated', min: 5, text: 'Undefeated', tier: 2 },
  { id: 'roll', min: 3, text: 'On a Roll', tier: 1 },
]);
export const SLAYER_MIN = 5;
export const DUEL_GAMES = Object.freeze(['fight', 'armwrestle', 'race']);

export const emptyStats = () => ({ wins: 0, losses: 0, streak: 0, best: 0 });

/**
 * Stats after one duel. Pure.
 * @param {DuelStats} winner @param {DuelStats} loser
 * @returns {{ winner:DuelStats, loser:DuelStats, broke:number }}  broke = the loser's streak that just ended (for Streak Breaker)
 */
export function applyDuel(winner, loser) {
  const w = { ...emptyStats(), ...winner }, l = { ...emptyStats(), ...loser };
  const broke = l.streak;
  w.wins += 1; w.streak += 1; w.best = Math.max(w.best, w.streak);
  l.losses += 1; l.streak = 0;
  return { winner: w, loser: l, broke };
}

/** Is this settled game a duel that counts? (a race only as a 1v1) */
export const isDuel = (game, input) => DUEL_GAMES.includes(game) && !(game === 'race' && input && input.mode === 'gp');

/**
 * The title over someone's head, or null.
 * @param {DuelStats|null} stats
 * @param {{ slayer?:boolean, royale?:boolean, gp?:boolean }} [extra]
 * @returns {{ id:string, text:string, tier:number }|null}
 */
export function titleFor(stats, extra = {}) {
  const st = stats || emptyStats();
  for (const t of TITLES) if (st.streak >= t.min) return { id: t.id, text: `${t.text} ×${st.streak}`, tier: t.tier };
  if (extra.slayer) return { id: 'slayer', text: 'Streak Breaker', tier: 1 };
  if (extra.royale) return { id: 'royale', text: 'Last One Standing', tier: 1 };
  if (extra.gp) return { id: 'gp', text: 'Gleep Champion', tier: 1 };
  return null;
}

/**
 * The overlay badges for everyone who has one: { [twitchId]: { title?, tier?, bounty? } } (feed message 'badges').
 * @param {{ [twitchId:string]: { stats?:DuelStats, slayer?:boolean } }} people
 * @param {{ royale?:string|null, gp?:string|null }} champions  latest winners
 * @param {{ twitchId:string, amount:number }|null} bounty
 */
export function badgesFor(people, champions = {}, bounty = null) {
  const out = {};
  const ids = new Set([...Object.keys(people || {}), champions.royale, champions.gp, bounty && bounty.twitchId].filter(Boolean));
  for (const id of ids) {
    const p = (people || {})[id] || {};
    const t = titleFor(p.stats, { slayer: !!p.slayer, royale: champions.royale === id, gp: champions.gp === id });
    const b = {};
    if (t) { b.title = t.text; b.tier = t.tier; }
    if (bounty && bounty.twitchId === id) b.bounty = bounty.amount;
    if (Object.keys(b).length) out[id] = b;
  }
  return out;
}
