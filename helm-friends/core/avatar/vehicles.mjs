// Helm Friends vehicles (CONTRACTS v1.8): every viewer owns two customizable rides that the games use —
//   the GETAWAY CAR (the heist's getaway driver drives it) and a UFO (the "Gleep Race").
// Vehicle parts are ordinary catalog items (same rarity prices, same unlocks, same recolour channels as clothes), so the
// shop, `isUnlocked`, `priceOf` and the cloud's unlock route need nothing new. A character spec carries the choice as
//   spec.vehicles = { car:{ body, wheels, decal }, ufo:{ hull, dome, lights, trail } }   (each a Worn, or null when optional)
// Row format is the same as items.mjs: [key, name, rarity, options] (ch, locked, fx, frames, tags, for).

const S = 'starter', C = 'common', R = 'rare', E = 'epic', L = 'legendary';
const GODS = ['gods', 'stream'], STREAM = ['stream'], SKY_KIT = ['stream', 'kit:sky'], PEPE_KIT = ['stream', 'kit:pepebot'];

/** The two vehicles and their parts, in draw order (back → front). */
export const VEHICLE_KINDS = Object.freeze(['car', 'ufo']);
export const VEHICLE_PARTS = Object.freeze({
  car: Object.freeze(['body', 'wheels', 'decal']),
  ufo: Object.freeze(['trail', 'hull', 'lights', 'dome']),
});
/** Parts that may be empty (null). Everything else always has an item. */
export const VEHICLE_OPTIONAL = Object.freeze({ car: Object.freeze(['decal']), ufo: Object.freeze(['lights', 'trail']) });

/** Default recolour channels per vehicle slot (an item's `ch` option overrides). */
export const VEHICLE_CHANNELS = Object.freeze({ 'car.body': 2, 'car.wheels': 1, 'car.decal': 1, 'ufo.hull': 2, 'ufo.dome': 1, 'ufo.lights': 1, 'ufo.trail': 1 });

/** @type {Object<string, [string, string, string, Object?][]>} vehicle slot ('car.body') → rows */
export const VEHICLE_ROWS = {
  'car.body': [
    ['sedan', 'Sedan', S], ['hatchback', 'Hatchback', S], ['pickup', 'Pickup truck', S], ['van', 'Panel van', S],
    ['muscle', 'Muscle car', S], ['wagon', 'Woody wagon', S], ['lowrider', 'Lowrider', R, { fx: 'pulse', tags: ['hydraulics'] }],
    ['limo', 'Stretch limo', R],
    ['outrun', 'Outrun 86 (neon underglow)', E, { fx: 'glow' }],
    ['helm_cruiser', 'Helm Cruiser (all-black, neon trim)', E, { locked: true, fx: 'glow', tags: SKY_KIT }],
    ['pepebot_mecha', 'PepeBot mecha car', L, { locked: true, fx: 'pulse', tags: PEPE_KIT }],
    ['dollah_armored', "Pepe's Silvia Dollah armored truck", L, { locked: true, fx: 'glitter', tags: STREAM }],
  ],
  'car.wheels': [
    ['steel', 'Steel wheels', S], ['sport', 'Sport rims', S], ['whitewall', 'Whitewalls', S],
    ['offroad', 'Off-road tyres', S], ['wire', 'Wire spokes', S],
    ['spinners', 'Spinners', R, { frames: [12, 4] }],
    ['helm_hubcaps', 'Helm-wheel hubcaps', E, { locked: true, fx: 'glow', tags: SKY_KIT }],
    ['dollah_hubcaps', "Pepe's Silvia Dollah hubcaps", E, { locked: true, fx: 'glitter', tags: STREAM }],
    ['neon', 'Neon rims', L, { fx: 'glow' }],
  ],
  'car.decal': [
    ['stripes', 'Racing stripes', S], ['number', 'Race number', S, { tags: ['number'] }], ['pinstripe', 'Pinstripes', S],
    ['flames', 'Hot-rod flames', S], ['checker', 'Checkered flag', S],
    ['glorp', 'Glorp leaf', R, { locked: true, fx: 'glow', tags: GODS }],
    ['klerb', 'Klerb chaos star', R, { locked: true, tags: GODS }],
    ['sayok', 'Sayok sigil', R, { locked: true, tags: GODS }],
    ['dollah', "Pepe's Silvia Dollah wrap", E, { locked: true, fx: 'glitter', tags: STREAM }],
    ['pepebot', 'PepeBot face', R, { locked: true, tags: STREAM }],
  ],
  'ufo.hull': [
    ['saucer', 'Classic saucer', S], ['bell', 'Bell saucer', S], ['disc', 'Flat disc', S],
    ['junker', 'Junkyard saucer', S], ['ringed', 'Ringed saucer', S],
    ['glorp', 'Glorp-green saucer', E, { locked: true, fx: 'glow', tags: GODS }],
    ['klerb', 'Klerb chaos-star UFO', E, { locked: true, frames: [10, 8], tags: GODS }],
    ['sayok', 'Sayok flame UFO', E, { locked: true, frames: [12, 6], tags: GODS }],
    ['dollah', "Pepe's Silvia Dollah UFO", L, { locked: true, fx: 'glitter', tags: STREAM }],
    ['pepebot', 'PepeBot mothership', L, { locked: true, fx: 'pulse', tags: PEPE_KIT }],
  ],
  'ufo.dome': [
    ['glass', 'Glass dome', S], ['bubble', 'Bubble dome', S], ['visor', 'Visor dome', S],
    ['helm', 'Helm-wheel dome', R, { locked: true, tags: STREAM }],
    ['prism', 'Prism dome', E, { fx: 'prism' }],
  ],
  'ufo.lights': [
    ['ring', 'Ring lights', S], ['dots', 'Porthole lights', S], ['strip', 'Strip lights', S],
    ['chase', 'Chase lights', C, { frames: [10, 4] }],
    ['disco', 'Disco lights', R, { fx: 'prism' }],
    ['helm', 'Helm-wheel beacon', E, { locked: true, fx: 'glow', tags: SKY_KIT }],
  ],
  'ufo.trail': [
    ['puff', 'Puff trail', S], ['zoom', 'Speed lines', S], ['bubbles', 'Bubble trail', S],
    ['sparkle', 'Sparkle trail', C, { fx: 'glitter' }],
    ['rainbow', 'Rainbow trail', R, { fx: 'prism' }],
    ['gleep', 'Gleep juice trail', E, { locked: true, fx: 'glow', tags: STREAM }],
    ['dollah', "Pepe's Silvia Dollah coin trail", L, { locked: true, frames: [12, 6], tags: STREAM }],
  ],
};

/** The plain ride everyone starts with (starter items; colours = the art's baked defaults). */
const PAINT = { h: 0, s: 75, v: 80 }, TRIM = { h: 0, s: 0, v: 90 }, RIM = { h: 0, s: 0, v: 75 };
const HULL = { h: 200, s: 15, v: 80 }, HULL2 = { h: 190, s: 60, v: 70 }, GLASS = { h: 185, s: 45, v: 95 }, LIGHT = { h: 55, s: 80, v: 100 };
export const VEHICLE_DEFAULTS = Object.freeze({
  car: Object.freeze({ body: 'car.body.sedan', wheels: 'car.wheels.steel', decal: null }),
  ufo: Object.freeze({ trail: null, hull: 'ufo.hull.saucer', lights: 'ufo.lights.ring', dome: 'ufo.dome.glass' }),
});
/** Default colours per vehicle slot (used when a part is (re)picked; channels beyond the item's count are dropped). */
export const VEHICLE_COLORS = Object.freeze({
  'car.body': [PAINT, TRIM], 'car.wheels': [RIM], 'car.decal': [TRIM],
  'ufo.hull': [HULL, HULL2], 'ufo.dome': [GLASS], 'ufo.lights': [LIGHT], 'ufo.trail': [{ h: 190, s: 20, v: 95 }],
});

/**
 * Fresh default vehicles (deep copy), with colours cut to each item's channels.
 * @param {(id:string)=>number} [channelsOf]  item id → channels (default: the slot default)
 */
export function defaultVehicles(channelsOf) {
  const out = {};
  for (const kind of VEHICLE_KINDS) {
    out[kind] = {};
    for (const part of VEHICLE_PARTS[kind]) {
      const id = VEHICLE_DEFAULTS[kind][part], slot = kind + '.' + part;
      const n = id ? (channelsOf ? channelsOf(id) : VEHICLE_CHANNELS[slot]) : 0;
      out[kind][part] = id ? { item: id, colors: VEHICLE_COLORS[slot].slice(0, n).map((c) => ({ ...c })) } : null;
    }
  }
  return out;
}

/** Sky's unique rides: the Helm Cruiser with Helm-wheel hubcaps, and the Helm-wheel beacon on a black saucer. */
export function skyVehicles() {
  const v = defaultVehicles();
  v.car = { body: { item: 'car.body.helm_cruiser', colors: [] }, wheels: { item: 'car.wheels.helm_hubcaps', colors: [] }, decal: null };
  v.ufo.hull = { item: 'ufo.hull.saucer', colors: [{ h: 0, s: 0, v: 14 }, { h: 110, s: 95, v: 85 }] };
  v.ufo.lights = { item: 'ufo.lights.helm', colors: [] };
  return v;
}

/** PepeBot's rides: his mecha car and his mothership. */
export function pepebotVehicles() {
  const v = defaultVehicles();
  v.car.body = { item: 'car.body.pepebot_mecha', colors: [] };
  v.ufo.hull = { item: 'ufo.hull.pepebot', colors: [] };
  return v;
}

/**
 * One vehicle of a spec with defaults filled in (what the overlay / games draw). Never throws.
 * @param {Object} spec
 * @param {'car'|'ufo'} kind
 * @returns {Object<string, {item:string, colors:Object[], extra?:Object}|null>}
 */
export function vehicleOf(spec, kind) {
  const v = spec && spec.vehicles && spec.vehicles[kind];
  const d = defaultVehicles()[kind];
  if (!v || typeof v !== 'object') return d;
  const out = {};
  for (const part of VEHICLE_PARTS[kind]) out[part] = v[part] === undefined ? d[part] : v[part];
  return out;
}

/** Every catalog id a spec's vehicles use. */
export function vehicleItems(spec) {
  const ids = [];
  for (const kind of VEHICLE_KINDS) {
    const v = vehicleOf(spec, kind);
    for (const part of VEHICLE_PARTS[kind]) if (v[part] && v[part].item) ids.push(v[part].item);
  }
  return ids;
}
