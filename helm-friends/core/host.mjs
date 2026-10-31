// Host participation (v1.11, Sky): a switch Sky flips on the admin page, live, remembered by the cloud.
//   TEST   - Sky's and PepeBot's avatars join big events like anyone (Sky by command; PepeBot's bot account is entered in
//            free lobbies automatically, so a playtest has company).
//   ACTIVE - they never take part: Sky's joins are refused politely and, during every big event's show, both climb into the
//            observation deck above the stage (prop `observationDeck`) and react from there.
// The rule lives here; the cloud asks hostMayJoin(), and every big event's script goes through hostDeck().

import { BIG_EVENTS } from './cooldown.mjs';
import { HOSTS, EVERYONE } from './script.mjs';

export const HOST_MODES = Object.freeze(['test', 'active']);
export const DEFAULT_HOST_MODE = 'test';
export const normalizeHostMode = (m) => (HOST_MODES.includes(m) ? m : DEFAULT_HOST_MODE);

/**
 * May this person take part in this event? In ACTIVE mode the broadcaster (and the bot account) can't join a big event.
 * @param {'test'|'active'} mode
 * @param {{ role?:string, bot?:boolean }} who
 * @param {string} kind  a stage kind ('heist', 'royale', 'grandprix', …)
 */
export function hostMayJoin(mode, who, kind) {
  if (normalizeHostMode(mode) !== 'active' || !BIG_EVENTS.includes(kind)) return true;
  return !(who && (who.role === 'broadcaster' || who.bot));
}

/** Should PepeBot's bot account be entered in this free lobby automatically? (TEST mode only.) */
export const hostAutoJoin = (mode, kind, fee = 0) => normalizeHostMode(mode) === 'test' && (kind === 'royale' || (kind === 'grandprix' && !fee));

/** Where the deck hangs: high on the right, out of every show's way. */
export const DECK = Object.freeze({ x: 0.9, y: 0.16, lane: 2 });

/**
 * Sends the hosts up to the observation deck for a big event's show (ACTIVE mode): adds the deck prop, `hosts:'deck'` and
 * @host beats (climb up, watch excited, cheer with every coin rain and banner, wince at alarms and arrests, climb down).
 * The overlay keeps hosts out of the crowd while `hosts:'deck'`. Pure: returns a new script.
 * @param {import('./script.mjs').Script} script
 */
export function hostDeck(script) {
  const beats = [...script.beats], T = script.durationMs;
  const add = (t, op, args) => beats.push({ t: Math.max(0, Math.min(T, Math.round(t))), actor: HOSTS, do: op, ...(args ? { args } : {}) });
  const deckBeats = [{ t: 0, do: 'prop', args: { id: 'deck', state: 'open' } }];
  add(0, 'moveTo', { x: DECK.x, lane: DECK.lane, speed: 'run', lift: 40 });
  add(1400, 'face', { dir: 'front' });
  add(1500, 'expr', { name: 'excited', ms: 3000 });
  const seen = new Set();
  for (const b of script.beats) {
    if (b.actor === HOSTS) continue;
    const key = Math.round(b.t / 1500);
    if (seen.has(key)) continue;
    if (b.do === 'coinRain' || (b.do === 'fx' && b.args && (b.args.name === 'banner' || b.args.name === 'confetti'))) {
      seen.add(key); add(b.t + 150, 'anim', { name: 'cheer' }); add(b.t + 150, 'expr', { name: 'happy', ms: 2400 });
    } else if (b.do === 'prop' && b.args && /^(alarm|arrive)$/.test(b.args.state) && /cop|bank/.test(b.args.id)) {
      seen.add(key); add(b.t + 100, 'expr', { name: 'startled', ms: 1800 });
    } else if (b.do === 'anim' && b.actor === EVERYONE && b.args && b.args.name === 'sad') {
      seen.add(key); add(b.t + 100, 'expr', { name: 'sad', ms: 1800 });
    }
  }
  add(T - 900, 'moveTo', { x: DECK.x - 0.06, lane: DECK.lane, speed: 'walk', lift: 0 });
  deckBeats.push({ t: Math.max(0, T - 300), do: 'prop', args: { id: 'deck', state: 'idle' } });
  const sorted = [...beats, ...deckBeats].map((b, i) => [b, i]).sort((p, q) => p[0].t - q[0].t || p[1] - q[1]).map((p) => p[0]);
  return { ...script, hosts: 'deck', props: [...script.props, { id: 'deck', kind: 'observationDeck', x: DECK.x, lane: DECK.lane, y: DECK.y, state: 'idle' }], beats: sorted };
}
