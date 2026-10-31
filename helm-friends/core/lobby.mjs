// Open lobbies (v1.11): what the EVENT JOIN overlay panel, the web app / panel "Live events" card and the overlay's
// planning-board phase show while a big event is waiting for people — all from one function, lobbyView().
//   lobbyView(rec)       → how to join (by command, with Sky's renamed triggers), roles taken / open and by whom, bet
//                          syntax, the countdown, the current odds (heist)
//   lobbyScript(view)    → the planning-board phase on stage: the board with role slots, the crew gathered in front of it
//                          (royale: the fighters at the ring; Grand Prix: the racers at the start)
//   teardownScript(…)    → a heist nobody (or one person) joined: the board is torn down, everyone walks off (Sky, v1.11)
// The cloud makes these (it knows the lobby and the triggers); the overlay only plays them.

import { DEFAULT_ECONOMY } from './economy.mjs';
import { COMMANDS } from './commands.mjs';
import { CORE_ROLES, ROLE_INFO, SINGLE_ROLES, heistOdds, lockCrew } from './games/heist.mjs';
import { EVENT_NAMES, stageKindOf } from './cooldown.mjs';
import { scriptBuilder, clip } from './script.mjs';
import { spread } from './games/common.mjs';
import { fmt } from './format.mjs';

const MAX_SHOW = 180000;
/** The trigger people should type for a command key (Sky's first renamed trigger, else the default). */
export const triggerOf = (key, triggers) => ((triggers && Array.isArray(triggers[key]) && triggers[key].length ? triggers[key] : COMMANDS[key].triggers)[0]);

/**
 * The public view of an open lobby, or null when `rec` isn't one.
 * @param {{ id:string, game:string, status:string, input:Object, endsAt:number }} rec
 * @param {{ cfg?:Object, triggers?:Object, now?:number }} [o]
 * @returns {null|{ id:string, kind:string, game:string, title:string, closesAt:number, count:number, min:number, max:number,
 *   fee:number, bet:{ syntax:string, min:number, max:number }|null, join:{ cmd:string, what:string }[],
 *   roles?:{ role:string, name:string, cmd:string, single:boolean, people:string[], open:boolean, what:string }[],
 *   chance?:number, people:string[] }}
 */
export function lobbyView(rec, o = {}) {
  if (!rec || rec.status !== 'lobby') return null;
  const cfg = o.cfg || DEFAULT_ECONOMY, tr = (k) => triggerOf(k, o.triggers), input = rec.input || {}, names = input.names || {};
  const nm = (id) => String(names[id] || id).slice(0, 40);
  const kind = stageKindOf(rec.game, input);
  const base = { id: rec.id, kind, game: rec.game, title: EVENT_NAMES[kind] || rec.game, closesAt: rec.endsAt };
  if (rec.game === 'heist') {
    const h = cfg.heist, crew = input.crew || [];
    const roles = [...CORE_ROLES, 'muscle'].map((role) => {
      const people = crew.filter((m) => m.role === role).map((m) => nm(m.player));
      const single = SINGLE_ROLES.includes(role);
      return { role, name: ROLE_INFO[role].name, cmd: `${tr('heist')} <amount> ${role}`, single, people, open: !single || !people.length, what: ROLE_INFO[role].what };
    });
    const chance = crew.length ? Math.round(heistOdds(lockCrew(crew).crew).p * 100) : 0;
    return { ...base, count: crew.length, min: h.minCrew, max: h.maxCrew, fee: 0, bet: { syntax: `${tr('heist')} <amount> [role]`, min: h.minStake, max: h.maxStake },
      join: [{ cmd: `${tr('heist')} ${Math.max(h.minStake, 100)} hacker`, what: `Join with a bet of ${fmt(h.minStake)}–${fmt(h.maxStake)} and a role (or none: you get an open one)` }],
      roles, chance, people: crew.map((m) => nm(m.player)) };
  }
  if (rec.game === 'royale') {
    const r = cfg.royale, ps = input.players || [];
    return { ...base, count: ps.length, min: r.minPlayers, max: r.maxPlayers, fee: 0, bet: null,
      join: [{ cmd: tr('join'), what: 'Jump in - it is free. Last one standing wins Pepe\'s Silvia Dollahs.' }], people: ps.map(nm) };
  }
  if (rec.game === 'race' && input.mode === 'gp') {
    const gp = (cfg.race || DEFAULT_ECONOMY.race).gp, rs = input.racers || [], fee = input.fee || 0;
    return { ...base, count: rs.length, min: gp.minRacers, max: gp.maxRacers, fee, bet: null,
      join: [{ cmd: tr('join'), what: fee ? `Race your UFO - entry ${fmt(fee)} Pepe's Silvia Dollahs, it all goes into the prize pool.` : 'Race your UFO - free. The podium wins the prize.' }], people: rs.map(nm) };
  }
  return null;
}

/**
 * The planning-board phase on stage while a lobby is open (re-made on every join: same `group`, so the overlay replaces
 * the older one). Heist: the board with one slot per role and the crew in front of it; royale: fighters gather at the
 * ring; Grand Prix: racers line up at the start.
 * @param {ReturnType<typeof lobbyView>} view
 * @param {{ now:number, rev:number, members:string[] }} o   members = the twitchIds in the lobby (same order as view.people)
 */
export function lobbyScript(view, { now, rev, members }) {
  const dur = Math.max(1000, Math.min(MAX_SHOW, view.closesAt - now));
  const s = scriptBuilder({ id: `lb_${view.id}_${rev}`, kind: 'lobby', startsAt: now, crowd: 'others-free' });
  members.forEach((id) => s.cast(id, 'lobby'));
  const n = members.length;
  if (view.game === 'heist') {
    s.prop('board', 'planningBoard', 0.24, 2, 'idle', { board: { title: clip(`HEIST · ${view.chance}% · ${view.count}/${view.max}`, 60),
      slots: view.roles.map((r) => ({ role: r.role, name: r.name, people: r.people.slice(0, 12), ...(r.single ? { single: true } : {}) })) } });
    const xs = spread(n, 0.12, 0.36);
    members.forEach((id, i) => { s.at(0, 'moveTo', id, { x: xs[i], lane: i % 2 ? 1 : 0, speed: 'walk' }); s.at(Math.min(2600, dur - 1), 'face', id, { dir: 'back' }); });
  } else if (view.game === 'royale') {
    s.prop('ring', 'ring', 0.5, 1, 'idle');
    const xs = spread(n, 0.36, 0.64);
    members.forEach((id, i) => s.at(0, 'moveTo', id, { x: xs[i], lane: i % 3, speed: 'walk' }));
  } else {
    const xs = spread(n, 0.06, 0.3);
    members.forEach((id, i) => s.at(0, 'moveTo', id, { x: xs[i], lane: i % 3, speed: 'walk' }));
  }
  const out = s.build(dur);
  out.group = 'lobby:' + view.id;
  return out;
}

/**
 * A heist that didn't happen (only one person, or nobody, joined): the planning board is torn down, the would-be crew
 * looks sad and walks off, and normal overlay life resumes. ~5 s; it never takes the stage.
 * @param {{ gameId:string, now:number, members:string[] }} o
 */
export function teardownScript({ gameId, now, members }) {
  const s = scriptBuilder({ id: `td_${gameId}`, kind: 'lobbyTeardown', startsAt: now, crowd: 'others-free' })
    .prop('board', 'planningBoard', 0.24, 2, 'idle', { board: { title: 'HEIST CALLED OFF', slots: [] } });
  members.forEach((id) => s.cast(id, 'lobby'));
  s.at(300, 'prop', null, { id: 'board', state: 'tear' });
  members.forEach((id, i) => {
    s.at(400, 'face', id, { dir: 'front' }).at(400, 'expr', id, { name: 'sad', ms: 2500 }).at(500, 'anim', id, { name: 'sad' });
    if (i === 0) s.say(700, id, 'Guess I\'m robbing it alone... nah.', 1800);
    s.at(2600 + i * 150, 'moveTo', id, { x: i % 2 ? 0.7 : 0.55, lane: i % 3, speed: 'walk' });
  });
  const out = s.build(5000);
  out.group = 'lobby:' + gameId;
  return out;
}
