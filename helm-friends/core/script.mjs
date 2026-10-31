// Overlay scripts (CONTRACTS §5): a game's show as a timeline of beats. The cloud makes them, the overlay just plays
// them, so the overlay never decides anything. Every game's choreograph() builds its script with scriptBuilder() and
// every script must pass validateScript().

import { coinRainWaves, COIN_RAIN } from './coins.mjs';

/** Animations every body has (CONTRACTS §11). */
export const ANIMS = Object.freeze(['idle', 'walk', 'run', 'flee', 'jump', 'punch', 'kick', 'uppercut', 'hurt', 'knockout',
  'startled', 'cheer', 'dance', 'wave', 'sit', 'armwrestle', 'arrested', 'cuffedWalk', 'sad', 'victory']);
/** Face-layer expressions. */
export const EXPRESSIONS = Object.freeze(['neutral', 'happy', 'sad', 'fear', 'excited', 'angry', 'startled', 'ko']);
export const BEAT_OPS = Object.freeze(['moveTo', 'face', 'anim', 'expr', 'say', 'equip', 'unequip', 'hp', 'prop', 'fx',
  'coinRain', 'hide', 'show', 'wait']);
export const PROP_KINDS = Object.freeze(['bank', 'heistTable', 'armTable', 'slotMachine', 'rouletteWheel', 'copCar',
  'hpBar', 'ring', 'confetti', 'getawayCar',
  // v1.9: the small machine/table a character plays at + the big view above the stage; the coin flip; the Gleep Race
  'slotMini', 'slotReels', 'rouletteMini', 'rouletteBig', 'coinToss', 'coinBig', 'ufo', 'raceCourse', 'podium',
  // v1.11: the heist planning board (lobby + solo teardown), Glorp descending (Glorp's Blessing), the hosts' observation
  // deck (host mode ACTIVE), Sayok's cursed slot (small machine + big reels), the raid welcome banner
  'planningBoard', 'glorpDescend', 'observationDeck', 'cursedMini', 'cursedReels', 'raidBanner']);
/**
 * v1.11 prop kinds the art pack doesn't draw yet: the overlay draws them procedurally (overlay/hf/props-v110.mjs) until the
 * art engineer ships them (then remove them from this list). t-hf-art accepts these as "art pending".
 */
export const ART_PENDING = Object.freeze([]);   // v1.12: the art pack draws every v1.11 kind (planningBoard … raidBanner)
/** v1.9: props drawn in the air above the walking area at `y` (0..1 of the screen height) instead of on a lane's floor. */
export const SKY_PROPS = Object.freeze(['slotReels', 'rouletteBig', 'coinBig', 'ufo', 'raceCourse', 'glorpDescend', 'observationDeck', 'cursedReels', 'raidBanner']);
/** v1.9: props that belong to a cast member (`owner`): their getaway car / UFO is drawn from their spec.vehicles. */
export const OWNED_PROPS = Object.freeze(['getawayCar', 'ufo']);
const MAX_PATH = 400, MAX_LIFT = 40;
export const CROWDS = Object.freeze(['others-hide', 'others-watch', 'others-free']);
export const FX = Object.freeze(['confetti', 'dust', 'stars', 'flash', 'banner']);
export const DIRS = Object.freeze(['left', 'right', 'front', 'back']);
export const SPEEDS = Object.freeze(['walk', 'run', 'flee']);
export const LAYERS = Object.freeze(['gloves', 'cuffs', 'mask', 'bag']);

/** The house NPC's actor id (PepeBot: slots dealer, fight announcer, heist cop). */
export const HOUSE = 'pepebot';
/** Beat actor meaning "every actor on stage who is not in the cast" (e.g. everyone cheers a jackpot). */
export const EVERYONE = '*';
/**
 * v1.11 beat actor meaning "the hosts" — Sky's avatar (role broadcaster) and PepeBot (the house actor) — when the script
 * says `hosts: 'deck'` (host mode ACTIVE): they watch from the observation deck instead of taking part.
 */
export const HOSTS = '@host';

/** Ops that need an actor. */
const ACTOR_OPS = new Set(['moveTo', 'face', 'anim', 'expr', 'say', 'equip', 'unequip', 'hide', 'show']);
const MAX_SAY = 60, MAX_DURATION = 180000;

/**
 * @typedef {{ t:number, actor?:string, do:string, args?:Object }} Beat
 * @typedef {Object} Script
 * @property {string} id
 * @property {string} kind
 * @property {number} startsAt
 * @property {number} durationMs
 * @property {{ actor:string, role:string }[]} cast
 * @property {'others-hide'|'others-watch'|'others-free'} crowd
 * @property {{ id:string, kind:string, x:number, lane:number, state?:string }[]} props
 * @property {Beat[]} beats
 */

/**
 * Builds a script beat by beat. Beats may be added in any order; build() sorts them by time (stable).
 * @param {{ id:string, kind:string, startsAt:number, crowd:Script['crowd'] }} head
 */
export function scriptBuilder({ id, kind, startsAt, crowd }) {
  const cast = [], props = [], beats = [];
  const b = {
    /** Adds an actor with a role ('a', 'b', 'player', 'crew:driver', 'dealer'…). */
    cast(actor, role) { if (!cast.some((c) => c.actor === actor)) cast.push({ actor, role }); return b; },
    /** Adds a prop. */
    prop(pid, pkind, x, lane, state, extra) { const p = { id: pid, kind: pkind, x, lane }; if (state) p.state = state; if (extra) Object.assign(p, extra); props.push(p); return b; },
    /** Adds one beat at `t` ms from the start. */
    at(t, op, actor, args) {
      const beat = { t: Math.round(t), do: op };
      if (actor != null) beat.actor = actor;
      if (args) beat.args = args;
      beats.push(beat);
      return b;
    },
    /** A coin rain from (x, y) sized by `win`, with extra waves for very big wins. */
    coinRain(t, win, x, y) {
      for (const w of coinRainWaves(win)) b.at(t + w.delayMs, 'coinRain', null, { x, y, count: w.count, ms: COIN_RAIN.rainMs });
      return b;
    },
    /** A speech bubble, trimmed to the 60-character limit. */
    say(t, actor, text, ms = 2200) { return b.at(t, 'say', actor, { text: clip(text, MAX_SAY), ms }); },
    /** The finished script. */
    build(durationMs) {
      const sorted = beats.map((x, i) => [x, i]).sort((p, q) => p[0].t - q[0].t || p[1] - q[1]).map((p) => p[0]);
      return { id, kind, startsAt, durationMs: Math.round(durationMs), cast: cast.slice(), crowd, props: props.slice(), beats: sorted };
    },
  };
  return b;
}

/** Cuts text to `n` characters with an ellipsis. */
export function clip(text, n) {
  const s = String(text ?? '');
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

const num01 = (v) => typeof v === 'number' && v >= 0 && v <= 1;
/** v1.11 planning board contents: { title, slots:[{ role, name, people:string[] (names ≤ 40), single?:bool }] } (≤ 8 slots, ≤ 12 people each). */
function validBoard(b) {
  return !!b && typeof b === 'object' && typeof b.title === 'string' && b.title.length <= MAX_SAY && Array.isArray(b.slots) && b.slots.length <= 8 &&
    b.slots.every((x) => x && typeof x.role === 'string' && typeof x.name === 'string' && x.name.length <= 40 && Array.isArray(x.people) && x.people.length <= 12 &&
      x.people.every((n) => typeof n === 'string' && n.length <= 40));
}
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * Checks a script against CONTRACTS §5 (what the overlay relies on).
 * @param {Script} s
 * @returns {{ ok:true } | { ok:false, errors:string[] }}
 */
export function validateScript(s) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!s || typeof s !== 'object') return { ok: false, errors: ['not an object'] };
  if (typeof s.id !== 'string' || !s.id) err('id');
  if (typeof s.kind !== 'string' || !s.kind) err('kind');
  if (!Number.isSafeInteger(s.startsAt)) err('startsAt');
  if (!isInt(s.durationMs, 1, MAX_DURATION)) err('durationMs ' + s.durationMs);
  if (!CROWDS.includes(s.crowd)) err('crowd ' + s.crowd);
  // v1.11 optional fields: hosts:'deck' (the @host actor + an observationDeck prop), group (a newer script of the same
  // group replaces the older one on the overlay: lobby boards)
  if (s.hosts != null && s.hosts !== 'deck') err('hosts');
  if (s.group != null && (typeof s.group !== 'string' || !s.group || s.group.length > 80)) err('group');
  const actors = new Set();
  if (!Array.isArray(s.cast)) err('cast');
  else for (const c of s.cast) {
    if (!c || typeof c.actor !== 'string' || !c.actor || typeof c.role !== 'string') err('cast entry');
    else if (actors.has(c.actor)) err('cast duplicate ' + c.actor);
    else actors.add(c.actor);
  }
  const propIds = new Set(), owned = [];
  if (!Array.isArray(s.props)) err('props');
  else for (const p of s.props) {
    if (!p || typeof p.id !== 'string' || propIds.has(p.id)) { err('prop id ' + (p && p.id)); continue; }
    propIds.add(p.id);
    if (!PROP_KINDS.includes(p.kind)) err(`prop ${p.id} kind ${p.kind}`);
    if (!num01(p.x)) err(`prop ${p.id} x`);
    if (!isInt(p.lane, 0, 2)) err(`prop ${p.id} lane`);
    if (p.y != null && !num01(p.y)) err(`prop ${p.id} y`);
    if (p.path != null && (!Array.isArray(p.path) || p.path.length > MAX_PATH || !p.path.every((v) => typeof v === 'number' && v >= -0.5 && v <= 1.5))) err(`prop ${p.id} path`);
    if (p.sampleMs != null && !isInt(p.sampleMs, 50, 2000)) err(`prop ${p.id} sampleMs`);
    if (p.label != null && (typeof p.label !== 'string' || p.label.length > MAX_SAY)) err(`prop ${p.id} label`);
    if (p.owner != null) owned.push(p);
    if (p.board != null && !validBoard(p.board)) err(`prop ${p.id} board`);
  }
  for (const p of owned) if (!OWNED_PROPS.includes(p.kind) || !actors.has(p.owner)) err(`prop ${p.id} owner`);
  if (!Array.isArray(s.beats)) return { ok: false, errors: [...errors, 'beats'] };
  let last = 0;
  s.beats.forEach((bt, i) => {
    const where = `beat ${i} (${bt && bt.do})`;
    if (!bt || !isInt(bt.t, 0, s.durationMs)) { err(where + ' t'); return; }
    if (bt.t < last) err(where + ' out of order');
    last = bt.t;
    if (!BEAT_OPS.includes(bt.do)) { err(where + ' op'); return; }
    if (ACTOR_OPS.has(bt.do) && bt.actor == null) err(where + ' needs an actor');
    if (bt.actor != null && bt.actor !== EVERYONE && !(bt.actor === HOSTS && s.hosts === 'deck') && !actors.has(bt.actor)) err(where + ' actor not in cast: ' + bt.actor);
    const a = bt.args || {};
    switch (bt.do) {
      case 'moveTo':
        if (!num01(a.x)) err(where + ' x');
        if (a.lane != null && !isInt(a.lane, 0, 2)) err(where + ' lane');
        if (!SPEEDS.includes(a.speed)) err(where + ' speed');
        if (a.anim != null && !ANIMS.includes(a.anim)) err(where + ' anim');
        if (a.lift != null && !isInt(a.lift, 0, MAX_LIFT)) err(where + ' lift');
        break;
      case 'face': if (!DIRS.includes(a.dir)) err(where + ' dir'); break;
      case 'anim': if (!ANIMS.includes(a.name)) err(where + ' anim ' + a.name); break;
      case 'expr': if (!EXPRESSIONS.includes(a.name)) err(where + ' expr ' + a.name); break;
      case 'say':
        if (typeof a.text !== 'string' || !a.text || a.text.length > MAX_SAY) err(where + ' text');
        if (!isInt(a.ms, 1, 30000)) err(where + ' ms');
        break;
      case 'equip': case 'unequip': if (!LAYERS.includes(a.layer)) err(where + ' layer'); break;
      case 'hp':
        if (!actors.has(a.actor)) err(where + ' hp actor');
        if (!isInt(a.value, 0, 100) || a.max !== 100) err(where + ' hp value');
        break;
      case 'prop':
        if (!propIds.has(a.id)) err(where + ' unknown prop ' + a.id);
        if (typeof a.state !== 'string' || !a.state) err(where + ' prop state');
        break;
      case 'fx':
        if (!FX.includes(a.name)) err(where + ' fx ' + a.name);
        if (!num01(a.x) || !num01(a.y)) err(where + ' fx position');
        if (a.name === 'banner' && (typeof a.text !== 'string' || !a.text || a.text.length > MAX_SAY)) err(where + ' banner text');
        break;
      case 'coinRain':
        if (!num01(a.x) || !num01(a.y)) err(where + ' coinRain position');
        if (!isInt(a.count, 1, COIN_RAIN.maxCoins)) err(where + ' coinRain count');
        if (!isInt(a.ms, 1, 10000)) err(where + ' coinRain ms');
        break;
      default: break;
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true };
}
