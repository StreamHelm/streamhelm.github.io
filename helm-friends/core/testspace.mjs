// The TEST SPACE (v1.11, Sky): only in a playtest season. Fake viewers Sky can create, dress, fund, flag (follower / sub /
// mod) and make act — every action goes through the REAL chat-command path, so a test exercises the same code as a stream.
// Fake users never exist outside a playtest season (the cloud refuses, and a season reset wipes them), their lines never
// reach real Twitch chat (they're marked `test` and shown on the admin page / as overlay bubbles), and their avatars wear
// a small TEST tag. This file holds the rules: ids, names, the quick commands, and the auto-crowd's choices.

/** Fake ids: 12-digit numbers from 990000000000 (real Twitch ids are far shorter), so they pass every id check. */
export const FAKE_BASE = 990000000000;
export const fakeId = (n) => String(FAKE_BASE + n);
export const isFakeId = (id) => /^99\d{10}$/.test(String(id || ''));

const A = ['Glorpy', 'Klerby', 'Sayokish', 'Cosmic', 'Gleep', 'Peepaw', 'Lobster', 'Neon', 'Turbo', 'Sleepy', 'Spicy', 'Chonky'];
const B = ['Tester', 'Frog', 'Capy', 'Panda', 'Gremlin', 'Wizard', 'Bandit', 'Goblin', 'Pilot', 'Duck', 'Noodle', 'Bean'];
/** A readable fake name for fake number n (stable). */
export function fakeName(n) {
  return `${A[n % A.length]}${B[Math.floor(n / A.length) % B.length]}${n >= A.length * B.length ? n : ''}`.slice(0, 25);
}

/**
 * The chat line for an act-as quick button (the admin page's buttons build these; the cloud runs them as that fake).
 * @param {'join'|'heist'|'bet'|'accept'|'decline'|'challenge'|'slots'|'cursed'|'roulette'|'flip'|'race'|'raw'} kind
 * @param {{ role?:string, amount?:number, n?:number, target?:string, game?:'fight'|'armwrestle'|'race', text?:string, pick?:string, call?:string }} a
 */
export function actCommand(kind, a = {}) {
  const amt = Number.isSafeInteger(a.amount) && a.amount > 0 ? a.amount : 100;
  switch (kind) {
    case 'join': return '!join';
    case 'heist': return `!heist ${amt}${a.role ? ' ' + a.role : ''}`;
    case 'bet': return `!pred ${a.n || 1} ${amt}`;
    case 'accept': return '!accept';
    case 'decline': return '!decline';
    case 'challenge': return `!${a.game === 'armwrestle' ? 'armwrestle' : a.game === 'race' ? 'race' : 'fight'} @${String(a.target || '').replace(/^@/, '')} ${amt}`;
    case 'slots': return `!slots ${amt}`;
    case 'cursed': return `!cursed ${amt}`;
    case 'roulette': return `!roulette ${amt} ${a.pick || 'red'}`;
    case 'flip': return `!flip ${amt} ${a.call || 'heads'}`;
    case 'raw': return String(a.text || '').slice(0, 300);
    default: return '';
  }
}

export const DEFAULT_CROWD = Object.freeze({ on: false, perMin: 6 });

/**
 * The auto-crowd's moves for one pump (pure; seeded): fake users join open lobbies (heist with a random role), bet on an
 * open prediction, accept challenges aimed at them, and now and then play a game or chat. `perMin` actions per minute on
 * average; `dtMs` = the time since the last pump.
 * @param {{ fakes:{ twitchId:string, login:string }[], lobbies:{ id:string, game:string, people?:string[], bet?:{ min:number } }[],
 *   prediction?:{ id:string, outcomes:{ n:number }[] }|null, pending?:{ b:string }[], stageFree:boolean }} world
 * @param {import('./rng.mjs').Rng} rng
 * @param {{ perMin:number, dtMs:number }} o
 * @returns {{ twitchId:string, text:string }[]}
 */
export function crowdActions(world, rng, { perMin, dtMs }) {
  const out = [], fakes = world.fakes || [];
  if (!fakes.length || !(perMin > 0)) return out;
  // accepting a challenge never waits
  for (const p of world.pending || []) if (fakes.some((f) => f.twitchId === p.b)) out.push({ twitchId: p.b, text: rng.chance(0.85) ? '!accept' : '!decline' });
  const expected = (perMin * dtMs) / 60000;
  let n = Math.floor(expected) + (rng.next() < expected - Math.floor(expected) ? 1 : 0);
  const ROLES = ['mastermind', 'hacker', 'safecracker', 'driver', 'lookout', 'muscle'];
  while (n-- > 0) {
    const f = rng.pick(fakes), lob = (world.lobbies || []).find((l) => !(l.people || []).includes(f.login));
    if (lob) { out.push({ twitchId: f.twitchId, text: lob.game === 'heist' ? actCommand('heist', { amount: Math.max(lob.bet ? lob.bet.min : 50, 100), role: rng.pick(ROLES) }) : '!join' }); continue; }
    if (world.prediction && rng.chance(0.5)) { out.push({ twitchId: f.twitchId, text: actCommand('bet', { n: rng.pick(world.prediction.outcomes).n, amount: rng.int(1, 5) * 20 }) }); continue; }
    if (world.stageFree && rng.chance(0.4)) { out.push({ twitchId: f.twitchId, text: rng.pick([actCommand('slots', { amount: 50 }), actCommand('flip', { amount: 50, call: rng.pick(['heads', 'tails']) }), actCommand('roulette', { amount: 50, pick: rng.pick(['red', 'black', 'odd', '17']) }), actCommand('cursed', { amount: 20 })]) }); continue; }
    out.push({ twitchId: f.twitchId, text: rng.pick(['lets goooo', 'GLORP', 'this stream is cooking', 'klerb moment', 'who wants to heist', 'my guy is so drippy']) });
  }
  return out;
}

/** What Sky can trigger from the Test space (each runs through the real game / event path). */
export const TEST_TRIGGERS = Object.freeze(['slots', 'roulette', 'flip', 'cursed', 'fight', 'armwrestle', 'race', 'grandprix', 'royale', 'heist', 'heistSolo',
  'blessing', 'raid', 'bounty', 'prediction', 'predictionTie', 'joinPanel', 'commandList']);
