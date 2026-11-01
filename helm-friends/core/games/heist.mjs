// Bank heist (DESIGN §4.7): the channel's big faucet. A crew of 2–12 picks roles; covered roles and crew size raise
// the success chance up to a cap, so there is always at least a 20 % chance of failure. One roll decides success; then
// each member is paid, escapes or gets arrested. The band (clean / messy / escaped / busted) picks the animation.
// v1.11 (Sky): only the GETAWAY DRIVER is single-occupancy; every other role takes any number of people. When the heist
// locks, lockCrew() picks THE driver among would-be drivers (seeded) and spreads duplicates over the core roles nobody
// covers (seeded, evenly: always from the most crowded role, Muscle first), so a crew of n covers min(n, 5) roles. A heist
// may still run short-handed (2–4 people): each missing role costs 8 points of success chance; a duplicate adds only 1.5.

import { DEFAULT_ECONOMY } from '../economy.mjs';
import { mulDiv } from '../money.mjs';
import { SYS } from '../ledger.mjs';
import { fail } from '../errors.mjs';
import { scriptBuilder, HOUSE, clip } from '../script.mjs';
import { isId, checkStake, settleLine, stakeIntent, at, spread, crowdReact } from './common.mjs';
import { fmt } from '../format.mjs';

/** The five roles that "cover" something; first come, first served. */
export const CORE_ROLES = Object.freeze(['mastermind', 'hacker', 'safecracker', 'driver', 'lookout']);
export const ROLES = Object.freeze([...CORE_ROLES, 'muscle']);
/** When someone joins without asking for a role they get the first free one in this order (else muscle). */
export const AUTO_ROLE_ORDER = Object.freeze(['driver', 'lookout', 'hacker', 'safecracker', 'mastermind']);

export const ROLE_INFO = Object.freeze({
  mastermind: { name: 'Mastermind', what: 'covers a role; your own score pays ×1.25' },
  hacker: { name: 'Hacker', what: 'covers a role' },
  safecracker: { name: 'Safecracker', what: 'covers a role' },
  driver: { name: 'Getaway Driver', what: 'ONE seat only; if it goes wrong, everyone escapes more often' },
  lookout: { name: 'Lookout', what: 'covers a role; fewer arrests on a win, more escapes on a loss' },
  muscle: { name: 'Muscle', what: 'any number; each (up to 3) means fewer arrests on a win' },
});
/** v1.11: roles only one person may hold. */
export const SINGLE_ROLES = Object.freeze(['driver']);

// v1.11 odds: p = 0.25 + 0.08 × roles covered + 0.05 (all five) + 0.015 × members beyond the covered roles (max +0.06),
// capped 0.80. The highest reachable is 0.76, so a heist ALWAYS fails at least 24 % of the time.
export const HEIST = Object.freeze({
  base: 0.25, perRole: 0.08, fullCrew: 0.05, perExtraMember: 0.015, extraCap: 0.06, cap: 0.80,
  arrestBase: 0.15, arrestMin: 0.02, arrestLookout: 0.07, arrestDriver: 0.04, arrestPerMuscle: 0.02, muscleMax: 3,
  escapeBase: 0.20, escapeDriver: 0.25, escapeLookout: 0.15, escapeCap: 0.75,
  scoreLoBp: 15000, scoreHiBp: 25000,          // M ~ U[1.5, 2.5], one roll for the whole crew
  lootLo: 80, lootHi: 220, lootPerRoleBp: 500,  // L ~ int U[80, 220] × (1 + 0.05 × roles covered)
  mastermindBp: 12500,
});

/** Show timing (ms): planning at the table, the walk to the bank, the wait inside, then the outcome (≈ 35–45 s). */
/** v1.18 cinematic timing (ms): the planning room, the drive, entering, inside (random 9–13 s), the exit + result. ≈ 45–55 s. */
export const CINE = Object.freeze({ planAt: 4200, driveAt: 9500, boardMs: 1800, enterGap: 2200, doorAfter: 3200, insideLo: 9000, insideHi: 13000, outroMs: 9500 });

/**
 * The crew's chances. Probabilities are plain floats (never money).
 * @param {{ role:string }[]} crew
 * @returns {{ covered:number, has:Object<string,boolean>, muscle:number, p:number, arrest:number, escape:number }}
 */
export function heistOdds(crew) {
  const H = HEIST, has = Object.fromEntries(CORE_ROLES.map((r) => [r, crew.some((m) => m.role === r)]));
  const covered = CORE_ROLES.filter((r) => has[r]).length;
  const muscle = crew.filter((m) => m.role === 'muscle').length;
  // a duplicate or Muscle (anyone beyond the covered roles) adds a little, far less than covering a missing role
  const p = Math.min(H.cap, H.base + H.perRole * covered + (covered === CORE_ROLES.length ? H.fullCrew : 0) +
    Math.min(H.extraCap, H.perExtraMember * Math.max(0, crew.length - covered)));
  const arrest = Math.max(H.arrestMin, H.arrestBase - H.arrestLookout * +has.lookout - H.arrestDriver * +has.driver -
    H.arrestPerMuscle * Math.min(muscle, H.muscleMax));
  const escape = Math.min(H.escapeCap, H.escapeBase + H.escapeDriver * +has.driver + H.escapeLookout * +has.lookout);
  return { covered, has, muscle, p, arrest, escape };
}

/**
 * The role someone gets when they join (v1.11): any role they ask for (several people may share it) — except a taken
 * driver's seat, where they wait in the first uncovered role instead (else Muscle); with no role asked for, the first
 * uncovered core role, else Muscle. lockCrew() settles the final roles when the heist starts.
 */
export function assignRole(crew, wanted) {
  const taken = new Set(crew.map((m) => m.role));
  if (wanted === 'muscle') return 'muscle';
  if (wanted && CORE_ROLES.includes(wanted) && !(SINGLE_ROLES.includes(wanted) && taken.has(wanted))) return wanted;
  return AUTO_ROLE_ORDER.find((r) => !taken.has(r) && !(wanted === 'driver' && r === 'driver')) || 'muscle';
}

/**
 * Adds someone to a heist lobby. Pure: returns the new crew.
 * v1.9 driver rule: everyone who asks for getaway driver is remembered (`wants:'driver'`). The first gets the seat for
 * now, later ones wait as Muscle; when the heist starts, draftDrivers() picks THE driver among all of them (seeded) and
 * moves the others to the open roles. `contested` = the seat was already asked for.
 * @param {{ player:string, role:string, stake:number, wants?:string }[]} crew
 * @param {{ player:string, stake:number, role?:string|null }} join
 * @returns {{ ok:true, crew:Object[], role:string, contested?:boolean } | { ok:false, code:string }}
 */
export function joinHeist(crew, join, cfg) {
  const h = (cfg && cfg.heist) || DEFAULT_ECONOMY.heist;
  if (!isId(join.player)) return fail('BAD_INPUT');
  if (crew.some((m) => m.player === join.player)) return fail('ALREADY_IN');
  if (crew.length >= h.maxCrew) return fail('FULL', { max: h.maxCrew });
  const st = checkStake(join.stake, h.minStake, h.maxStake);
  if (!st.ok) return st;
  const role = assignRole(crew, join.role || null);
  const m = { player: join.player, role, stake: join.stake };
  if (join.role === 'driver') m.wants = 'driver';
  const out = { ok: true, crew: [...crew, m], role };
  if (join.role === 'driver' && role !== 'driver') out.contested = true;
  return out;
}

/**
 * The getaway-driver draft (v1.9, Sky: "exactly one is picked"). Candidates = everyone who asked for driver plus whoever
 * holds the seat. With two or more, ONE is picked by the game's seeded rng (provably fair, and a late joiner has the same
 * chance as the first — that's why it isn't first-come); the others take the open core roles in AUTO_ROLE_ORDER, then
 * Muscle. Without an rng (previews, the crew line) the first candidate is used: the roles covered are the same either way,
 * so the odds never depend on who gets picked.
 * @param {{ player:string, role:string, stake:number, wants?:string }[]} crew
 * @param {import('../rng.mjs').Rng|null} [rng]
 * @returns {{ crew:Object[], driver:string|null, from:string[], moved:{ player:string, role:string }[] }}
 */
export function draftDrivers(crew, rng = null) {
  const cands = crew.filter((m) => m.wants === 'driver' || m.role === 'driver').map((m) => m.player);
  const holder = (crew.find((m) => m.role === 'driver') || {}).player || null;
  if (cands.length < 2) return { crew: crew.map((m) => ({ ...m })), driver: holder, from: cands, moved: [] };
  const driver = rng ? rng.pick(cands) : cands[0];
  const taken = new Set(crew.filter((m) => !cands.includes(m.player)).map((m) => m.role));
  taken.add('driver');
  const moved = [];
  const next = crew.map((m) => {
    if (!cands.includes(m.player)) return { ...m };
    if (m.player === driver) return { ...m, role: 'driver' };
    const role = AUTO_ROLE_ORDER.find((r) => !taken.has(r)) || 'muscle';
    if (role !== 'muscle') taken.add(role);
    moved.push({ player: m.player, role });
    return { ...m, role };
  });
  return { crew: next, driver, from: cands, moved };
}

/**
 * The auto-spread (v1.11, Sky): core roles nobody covers are filled from the duplicates, evenly. For each missing role
 * (AUTO_ROLE_ORDER) one person moves from the most crowded group that can spare someone: Muscle first (it covers nothing),
 * then the core role with the most people (ties: the later role in ROLES). The driver never moves. With an rng the person
 * is a seeded pick from that group (provably fair); without one (previews) it is the last to join — the roles covered,
 * and so the odds, are the same either way.
 * @param {{ player:string, role:string }[]} crew
 * @param {import('../rng.mjs').Rng|null} [rng]
 * @returns {{ crew:Object[], moved:{ player:string, from:string, role:string }[] }}
 */
export function spreadRoles(crew, rng = null) {
  const out = crew.map((m) => ({ ...m })), moved = [];
  const count = (r) => out.filter((m) => m.role === r).length;
  for (const role of AUTO_ROLE_ORDER) {
    if (count(role) > 0) continue;
    const donors = ['muscle', ...[...CORE_ROLES].reverse()].filter((r) => !SINGLE_ROLES.includes(r) && count(r) > (r === 'muscle' ? 0 : 1));
    if (!donors.length) break;
    let from = donors[0];
    for (const r of donors) if (r !== 'muscle' && from !== 'muscle' && count(r) > count(from)) from = r;
    const group = out.filter((m) => m.role === from);
    const who = rng ? rng.pick(group) : group[group.length - 1];
    who.role = role;
    moved.push({ player: who.player, from, role });
  }
  return { crew: out, moved };
}

/**
 * The crew as it goes in (v1.11): the driver draft, then the auto-spread. Pure; same seed → same crew.
 * @returns {{ crew:Object[], driver:string|null, from:string[], moved:{ player:string, role:string }[], spread:{ player:string, from:string, role:string }[] }}
 */
export function lockCrew(crew, rng = null) {
  const d = draftDrivers(crew, rng ? rng.fork('driver') : null);
  const sp = spreadRoles(d.crew, rng ? rng.fork('spread') : null);
  return { crew: sp.crew, driver: (sp.crew.find((m) => m.role === 'driver') || {}).player || null, from: d.from, moved: d.moved, spread: sp.moved };
}

/** Score part of a payout: floor(stake × M × roleMult). */
const scorePart = (stake, mBp, roleBp) => mulDiv(stake, mBp * roleBp, 100000000);
/** Loot part: floor(L × (1 + 0.05 × covered)). */
const lootPart = (loot, covered) => mulDiv(loot, 10000 + HEIST.lootPerRoleBp * covered, 10000);
const roleBpOf = (role) => (role === 'mastermind' ? HEIST.mastermindBp : 10000);

/**
 * Exact expected results per member (closed form over the discrete score and loot draws). For tests and the admin page.
 * @returns {{ p:number, arrest:number, escape:number, members:{ player:string, stake:number, expectedReturn:number, ev:number }[] }}
 */
export function heistTheory(crew0) {
  const crew = lockCrew(crew0).crew, o = heistOdds(crew), H = HEIST;
  const nM = H.scoreHiBp - H.scoreLoBp + 1, nL = H.lootHi - H.lootLo + 1;
  let lootMean = 0;
  for (let l = H.lootLo; l <= H.lootHi; l++) lootMean += lootPart(l, o.covered);
  lootMean /= nL;
  const members = crew.map((m) => {
    let scoreMean = 0;
    for (let bp = H.scoreLoBp; bp <= H.scoreHiBp; bp++) scoreMean += scorePart(m.stake, bp, roleBpOf(m.role));
    scoreMean /= nM;
    const expectedReturn = o.p * (1 - o.arrest) * (scoreMean + lootMean) + (1 - o.p) * o.escape * m.stake;
    return { player: m.player, stake: m.stake, expectedReturn, ev: expectedReturn - m.stake };
  });
  return { p: o.p, arrest: o.arrest, escape: o.escape, members };
}

const limits = (cfg) => (cfg && cfg.heist) || DEFAULT_ECONOMY.heist;

/** @type {import('./index.mjs').GameEngine} */
export const GAME = Object.freeze({
  id: 'heist',
  defaults: { minBet: DEFAULT_ECONOMY.heist.minStake, maxBet: DEFAULT_ECONOMY.heist.maxStake, lobbyMs: DEFAULT_ECONOMY.heist.lobbySec * 1000, minPlayers: DEFAULT_ECONOMY.heist.minCrew, maxPlayers: DEFAULT_ECONOMY.heist.maxCrew },

  validate(input, cfg) {
    const h = limits(cfg);
    if (!input || !Array.isArray(input.crew)) return fail('BAD_INPUT');
    if (input.crew.length < h.minCrew) return fail('BAD_INPUT', { min: h.minCrew });
    if (input.crew.length > h.maxCrew) return fail('FULL', { max: h.maxCrew });
    const seen = new Set(), roles = new Set();
    for (const m of input.crew) {
      if (!m || !isId(m.player) || seen.has(m.player) || !ROLES.includes(m.role)) return fail('BAD_INPUT');
      if (SINGLE_ROLES.includes(m.role) && roles.has(m.role)) return fail('BAD_INPUT');   // v1.11: only the driver's seat is unique
      seen.add(m.player); roles.add(m.role);
      const st = checkStake(m.stake, h.minStake, h.maxStake);
      if (!st.ok) return st;
    }
    return { ok: true };
  },

  stakes: (input, gameId) => input.crew.map((m) => stakeIntent(gameId, m.player, m.stake)),

  /**
   * outcome.driver = who drives (their spec.vehicles.car is the getaway car); outcome.draft when several wanted the seat;
   * v1.11 outcome.spread = who the auto-spread moved to cover a missing role.
   */
  resolve(input, rng) {
    const d = lockCrew(input.crew, rng);   // its own forks ('driver', 'spread'): the success roll stream is untouched
    const o = heistOdds(d.crew), H = HEIST;
    const success = rng.chance(o.p);
    const scoreBp = rng.int(H.scoreLoBp, H.scoreHiBp);
    const members = d.crew.map((m) => {
      if (success) {
        if (rng.chance(o.arrest)) return { player: m.player, role: m.role, stake: m.stake, fate: 'arrested', payout: 0 };
        const loot = rng.int(H.lootLo, H.lootHi);
        return { player: m.player, role: m.role, stake: m.stake, fate: 'paid', payout: scorePart(m.stake, scoreBp, roleBpOf(m.role)) + lootPart(loot, o.covered) };
      }
      return rng.chance(o.escape)
        ? { player: m.player, role: m.role, stake: m.stake, fate: 'escaped', payout: m.stake }
        : { player: m.player, role: m.role, stake: m.stake, fate: 'arrested', payout: 0 };
    });
    const arrested = members.filter((m) => m.fate === 'arrested').length;
    const band = success ? (arrested ? 'messy' : 'clean') : (arrested === members.length ? 'busted' : 'escaped');
    const out = { successChance: Math.round(o.p * 10000) / 10000, success, band, scoreMult: scoreBp / 10000, members, driver: d.driver };
    if (d.from.length > 1) out.draft = { from: d.from, moved: d.moved };
    if (d.spread.length) out.spread = d.spread;
    return out;
  },

  /**
   * v1.18 heist cinematic (Sky): a short film in scenes. The `scene` prop (kind heistScene, sky) carries the scene name
   * as its state so the overlay can cut / dress the stage; every scene is also played with ordinary beats, so an overlay
   * that ignores heistScene still shows a sensible heist. Scene states, in order:
   *   room            the planning room: the crew walks in ONE BY ONE and gathers round the plan (table 'plan')
   *   drive           the getaway car pulls up, the crew piles in (hide), the car drives off ('leave')
   *   enter           the car arrives at the Silvia Bank; the robbers (everyone but the driver, who waits at the wheel)
   *                   get out, put masks on, walk in (bank doorOpen, hide)
   *   inside:<n>      n robbers inside: the bank shows their SILHOUETTES in the windows (bank state silhouettes:<n>)
   *   alarm           (not on a clean job) the alarm goes off (bank alarm)
   *   exit            the doors burst open: paid robbers run out with bags to the car, the lucky ones flee, the rest are cuffed
   *   result:<band>   the result scene: clean | messy | escaped | busted (+ a banner)
   */
  choreograph(input, outcome, rng, ctx) {
    const crew = outcome.members, n = crew.length, S = CINE, band = outcome.band;   // the members carry the final roles (after the draft)
    const driver = outcome.driver && crew.some((m) => m.player === outcome.driver) ? outcome.driver : null;
    const robbers = crew.filter((m) => m.player !== driver), r = robbers.length;
    const driverM = driver ? crew.find((m) => m.player === driver) : null;
    const s = scriptBuilder({ id: ctx.gameId || 'g_preview', kind: 'heist', startsAt: ctx.now, crowd: 'others-watch' });
    crew.forEach((m) => s.cast(m.player, 'crew:' + m.role));
    s.prop('table', 'heistTable', 0.25, 1, 'idle').prop('bank', 'bank', 0.72, 2, 'idle')
      // v1.9: the getaway car is the driver's own car design (their spec.vehicles.car); no driver = the default car
      .prop('getaway', 'getawayCar', 0.92, 0, 'hidden', outcome.driver ? { owner: outcome.driver } : undefined)
      .prop('cop1', 'copCar', 0.55, 0, 'hidden').prop('cop2', 'copCar', 0.95, 0, 'hidden')
      .prop('scene', 'heistScene', 0.5, 1, 'room', { y: 0.1, label: clip(`HEIST · ${n} in the crew`, 60) });
    const copsCome = band !== 'clean';
    if (copsCome) s.cast(HOUSE, 'cop', { costume: 'police' });   // v1.18 art costume
    const scene = (t, st) => s.at(t, 'prop', null, { id: 'scene', state: st });
    // 1. the planning room: arrivals one by one
    const tableX = spread(n, 0.12, 0.38), gap = Math.min(600, Math.floor(4800 / n));
    crew.forEach((m, i) => { s.at(i * gap, 'moveTo', m.player, { x: tableX[i], lane: i % 2 ? 2 : 0, speed: 'walk' }); s.at(i * gap + 2200, 'face', m.player, { dir: 'back' }); });
    s.at(S.planAt, 'prop', null, { id: 'table', state: 'plan' });
    rng.shuffle(crew).slice(0, Math.min(4, n)).forEach((m, i) => s.say(S.planAt + 300 + i * 900, m.player,
      m.player === driver ? rng.pick(["I'll bring the car.", 'Engine is warm.']) : rng.pick(['?!', 'The vault is HERE.', 'Easy money.', 'Wait, what?', 'I call shotgun.']), 1200));
    // 2. the drive: the car pulls up, everyone piles in, off it goes
    scene(S.driveAt, 'drive');
    s.at(S.driveAt, 'prop', null, { id: 'getaway', state: 'arrive' });
    const carX = spread(n, 0.84, 0.97);
    crew.forEach((m, i) => { s.at(S.driveAt + 300 + i * 80, 'moveTo', m.player, { x: carX[i], lane: 0, speed: 'run' }); s.at(S.driveAt + S.boardMs + i * 90, 'hide', m.player); });
    const departAt = S.driveAt + S.boardMs + n * 90 + 400;
    s.at(departAt, 'prop', null, { id: 'getaway', state: 'leave' });
    // 3. enter the Silvia Bank (the driver waits at the wheel)
    const E = departAt + S.enterGap;
    scene(E, 'enter');
    s.at(E, 'prop', null, { id: 'getaway', state: 'arrive' });
    const doorX = spread(r, 0.66, 0.78);
    robbers.forEach((m, i) => {
      s.at(E + 1500 + i * 120, 'show', m.player).at(E + 1500 + i * 120, 'equip', m.player, { layer: 'mask' });
      s.at(E + 1600 + i * 120, 'moveTo', m.player, { x: doorX[i], lane: 2, speed: 'walk' });
    });
    const door = E + S.doorAfter;
    s.at(door, 'prop', null, { id: 'bank', state: 'doorOpen' });
    robbers.forEach((m, i) => s.at(door + 300 + i * 150, 'hide', m.player));
    const inAt = door + 300 + r * 150 + 300, inside = rng.int(S.insideLo, S.insideHi), T = inAt + inside;
    scene(inAt, `inside:${r}`);
    s.at(inAt, 'prop', null, { id: 'bank', state: `silhouettes:${r}` });
    if (copsCome) { const a = T - Math.round(inside / 2); scene(a, 'alarm'); s.at(a, 'prop', null, { id: 'bank', state: 'alarm' }); }
    // 4. the exit
    if (copsCome) {
      s.at(T - 1200, 'prop', null, { id: 'cop1', state: 'arrive' });
      if (band === 'busted') s.at(T - 1000, 'prop', null, { id: 'cop2', state: 'arrive' });
      s.at(T - 600, 'moveTo', HOUSE, { x: 0.6, lane: 1, speed: 'run' });
      s.say(T - 200, HOUSE, band === 'busted' ? "Book 'em." : 'FREEZE!', 1500);
    }
    scene(T, 'exit');
    const arrest = (id, t) => {
      s.at(t + 300, 'anim', id, { name: 'arrested', hold: true }).at(t + 300, 'expr', id, { name: 'sad', ms: 4000 });
      s.at(t + 800, 'equip', id, { layer: 'cuffs' });
      s.at(t + 2200, 'moveTo', id, { x: 0.55, lane: 0, speed: 'walk', anim: 'cuffedWalk' });
      s.at(t + 4200, 'hide', id);                       // into the cop car
    };
    robbers.forEach((m, i) => {
      const t = T + i * 200;
      s.at(t, 'show', m.player);
      if (m.fate === 'paid') {
        s.at(t, 'equip', m.player, { layer: 'bag' }).at(t, 'expr', m.player, { name: 'excited', ms: 3000 });
        s.at(t + 200, 'moveTo', m.player, { x: 0.9, lane: 0, speed: 'run' });
      } else if (m.fate === 'escaped') {
        s.at(t, 'expr', m.player, { name: 'fear', ms: 3000 });
        s.at(t + 200, 'moveTo', m.player, { x: 0, lane: 0, speed: 'flee' });
      } else arrest(m.player, t);
    });
    const paid = robbers.filter((m) => m.fate === 'paid'), outT = T + r * 200 + 1500;
    for (const m of paid) s.at(outT, 'hide', m.player);                     // into the car
    if (driverM && driverM.fate === 'arrested') { s.at(T + 500, 'show', driver); arrest(driver, T + 500); }
    const carLeaves = paid.length || (driverM && driverM.fate !== 'arrested');
    if (carLeaves) s.at(paid.length ? outT + 100 : T + 400, 'prop', null, { id: 'getaway', state: 'leave' });   // the loot drives off / the driver bolts
    const won = crew.filter((m) => m.fate === 'paid').reduce((sum, m) => sum + m.payout, 0);
    if (won > 0) s.coinRain(T + 400, won, 0.72, 0.5);
    // 5. the result scene
    const R = T + r * 200 + 2000;
    scene(R, `result:${band}`);
    s.at(R, 'fx', null, { name: 'banner', x: 0.5, y: 0.18, text: { clean: 'CLEAN GETAWAY!', messy: 'MESSY... BUT RICH!', escaped: 'HEIST FAILED - RUN!', busted: 'BUSTED!' }[band] });
    if (band === 'clean') s.at(R + 200, 'fx', null, { name: 'confetti', x: 0.72, y: 0.2 });
    crowdReact(s, R + 100, band === 'clean' ? 'big' : band === 'messy' ? 'win' : 'lose');
    const end = T + n * 200 + S.outroMs;
    if (copsCome) s.at(end - 2500, 'prop', null, { id: 'cop1', state: 'leave' });
    if (band === 'busted') s.at(end - 2400, 'prop', null, { id: 'cop2', state: 'leave' });
    // the jail result: whoever got arrested sits it out in an orange jumpsuit (art costume) until the show ends
    for (const m of crew) if (m.fate === 'arrested') s.at(R, 'equip', m.player, { layer: 'costume', costume: 'jumpsuit' });
    for (const m of crew) {
      if (m.fate === 'arrested') s.at(end - 1500, 'unequip', m.player, { layer: 'costume' });
      s.at(end - 1500, 'unequip', m.player, { layer: m.fate === 'paid' ? 'bag' : 'cuffs' });
      if (m.player !== driver) s.at(end - 1500, 'unequip', m.player, { layer: 'mask' });
    }
    for (const m of crew) s.at(end - 1200, 'show', m.player);
    s.at(end - 1200, 'prop', null, { id: 'bank', state: 'idle' });
    // v1.18: the outcome in a form the overlay's cinematic reads (each person's take on the result scene)
    const out = s.build(end);
    out.info = { band: outcome.band, members: outcome.members.map((m) => ({ player: m.player, role: m.role, fate: m.fate, payout: m.payout, stake: m.stake })) };
    return out;
  },

  settle(input, outcome, gameId) {
    return outcome.members.map((m) => settleLine(gameId, m.player, m.stake, m.payout, m.fate === 'arrested' ? SYS.house : SYS.mint,
      m.fate === 'paid' ? 'Heist score' : m.fate === 'escaped' ? 'Heist: got away' : 'Heist: arrested'));
  },

  summary(input, outcome) {
    const by = (f) => outcome.members.filter((m) => m.fate === f);
    const list = (ms, withPay) => {
      const shown = ms.slice(0, 6).map((m) => at(input, m.player) + (withPay ? ' +' + fmt(m.payout - m.stake) : ''));
      return shown.join(', ') + (ms.length > 6 ? ` and ${ms.length - 6} more` : '');
    };
    // v1.9: several wanted to drive → one line says who drove and where the others went (first, so it never gets clipped)
    // v1.11: the auto-spread moves (duplicates sent to cover a missing role) go in the same bracket
    const mv = [...(outcome.draft ? outcome.draft.moved : []), ...(outcome.spread || [])];
    const moves = mv.map((m) => at(input, m.player) + ' → ' + ROLE_INFO[m.role].name.toLowerCase()).join(', ');
    const dr = outcome.draft ? ` (${at(input, outcome.driver)} drove, picked from ${outcome.draft.from.length} would-be drivers; ${moves})`
      : mv.length ? ` (roles spread: ${moves})` : '';
    let line;
    if (outcome.band === 'clean') line = `Heist CLEAN!${dr} The crew got away: ${list(by('paid'), true)}`;
    else if (outcome.band === 'messy') line = `Heist got MESSY${dr}: ${list(by('paid'), true)} got out with the loot; arrested: ${list(by('arrested'))}`;
    else if (outcome.band === 'escaped') line = `Heist FAILED${dr}: ${list(by('escaped'))} got away (stake back); arrested: ${list(by('arrested'))}`;
    else line = `Heist BUSTED!${dr} Everyone got arrested: ${list(by('arrested'))}`;
    return clip(line, 300);
  },
});

/** For the crew-summary line at T−15 s: "4 in the crew, roles 3/5, 64% chance". */
export function crewLine(crew) {
  const o = heistOdds(lockCrew(crew).crew);
  return `${crew.length} in the crew, roles ${o.covered}/${CORE_ROLES.length}, ${Math.round(o.p * 100)}% chance`;
}
