// A tiny JSON validator plus every Helm Friends request/record schema, so the cloud, the web app and the panel all
// reject the same bad input the same way. Schemas are plain objects:
//   { t:'object', props:{…}, req:[…], extra:false }   { t:'array', items, min, max }
//   { t:'string', min, max, re, enum }   { t:'int', min, max }   { t:'number', min, max }   { t:'bool' }   { t:'any' }
//   any schema may add  nullable:true  (null allowed) — `req` decides whether the key must be present.

/**
 * Checks `value` against `schema`. Stops at the first problem.
 * @param {unknown} value
 * @param {Object} schema
 * @param {string} [path]
 * @returns {{ ok:true } | { ok:false, code:'BAD_INPUT', path:string, msg:string }}
 */
export function check(value, schema, path = '$') {
  const bad = (msg) => ({ ok: false, code: 'BAD_INPUT', path, msg });
  if (value === null && schema.nullable) return { ok: true };
  switch (schema.t) {
    case 'any': return { ok: true };
    case 'bool': return typeof value === 'boolean' ? { ok: true } : bad('expected true/false');
    case 'int':
      if (!Number.isSafeInteger(value)) return bad('expected a whole number');
      return range(value, schema) || { ok: true };
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return bad('expected a number');
      return range(value, schema) || { ok: true };
    case 'string': {
      if (typeof value !== 'string') return bad('expected text');
      if (schema.min != null && value.length < schema.min) return bad(`at least ${schema.min} characters`);
      if (schema.max != null && value.length > schema.max) return bad(`at most ${schema.max} characters`);
      if (schema.enum && !schema.enum.includes(value)) return bad('not one of the allowed values');
      if (schema.re && !schema.re.test(value)) return bad('wrong format');
      return { ok: true };
    }
    case 'array': {
      if (!Array.isArray(value)) return bad('expected a list');
      if (schema.min != null && value.length < schema.min) return bad(`at least ${schema.min} entries`);
      if (schema.max != null && value.length > schema.max) return bad(`at most ${schema.max} entries`);
      for (let i = 0; i < value.length; i++) {
        const r = check(value[i], schema.items, `${path}[${i}]`);
        if (!r.ok) return r;
      }
      return { ok: true };
    }
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('expected an object');
      for (const k of schema.req || []) if (!(k in value)) return { ok: false, code: 'BAD_INPUT', path: `${path}.${k}`, msg: 'missing' };
      for (const [k, v] of Object.entries(value)) {
        const sub = schema.props && schema.props[k];
        if (!sub) { if (schema.extra === false) return { ok: false, code: 'BAD_INPUT', path: `${path}.${k}`, msg: 'unexpected field' }; continue; }
        if (v === undefined) continue;
        const r = check(v, sub, `${path}.${k}`);
        if (!r.ok) return r;
      }
      return { ok: true };
    }
    default: throw new Error('schema without a known type at ' + path);
  }
  function range(v, s) {
    if (s.min != null && v < s.min) return bad(`at least ${s.min}`);
    if (s.max != null && v > s.max) return bad(`at most ${s.max}`);
    return null;
  }
}

const str = (max, extra = {}) => ({ t: 'string', max, ...extra });
const int = (min, max, extra = {}) => ({ t: 'int', min, max, ...extra });
const obj = (props, req = Object.keys(props), extra = false) => ({ t: 'object', props, req, extra });
const nul = (s) => ({ ...s, nullable: true });

export const ID_RE = /^[a-z][a-zA-Z0-9_.]{0,63}$/;
export const IDEM = str(64, { min: 8, re: /^[A-Za-z0-9_:-]+$/ });
export const HEX_COLOR = str(7, { re: /^#[0-9a-fA-F]{6}$/ });
export const CATALOG_ID = str(64, { re: ID_RE });

export const HSV = obj({ h: int(0, 359), s: int(0, 100), v: int(0, 100) });

export const WORN = obj({
  item: CATALOG_ID,
  colors: { t: 'array', items: HSV, max: 3 },
  extra: obj({ number: str(2, { re: /^\d{1,2}$/ }) }, []),
}, ['item']);

/** CONTRACTS §3.2, stored as JSON (max 4 KB — checked by validateSpec). */
export const CHARACTER_SPEC = obj({
  v: int(1, 1),
  species: str(16, { enum: ['human', 'dragon', 'ape', 'cat', 'dog', 'frog', 'capybara', 'panda', 'alien', 'rat', 'axolotl', 'beardie', 'bat', 'orc', 'minotaur', 'clown', 'mecha'] }),
  model: int(1, 2),
  body: str(8, { enum: ['slim', 'average', 'broad'] }),
  height: str(8, { enum: ['short', 'medium', 'tall'] }),
  skin: HSV,
  breed: nul(CATALOG_ID),
  ears: nul(CATALOG_ID),
  wings: nul(obj({ style: CATALOG_ID, color: HSV })),
  eyes: obj({ shape: CATALOG_ID, color: HSV }),
  brows: CATALOG_ID,
  hair: obj({ style: CATALOG_ID, color: HSV, fx: nul(str(10, { enum: ['prism', 'neon', 'stardust'] })) }, ['style', 'color']),
  facialHair: obj({ style: nul(CATALOG_ID), color: HSV }),
  wear: obj(Object.fromEntries(['hat', 'eyewear', 'ear', 'nose', 'shirt', 'pants', 'shoes'].map((s) => [s, nul(WORN)])), []),
  unique: nul(str(16)),
  pet: nul(obj({ item: CATALOG_ID, colors: { t: 'array', items: HSV, max: 3 }, name: str(20) }, ['item'])),   // v1.12 (art round 3): optional
  vehicles: obj({                                    // v1.8: optional; normalizeSpec fills the defaults
    car: obj({ body: WORN, wheels: WORN, decal: nul(WORN) }, []),
    ufo: obj({ hull: WORN, dome: WORN, lights: nul(WORN), trail: nul(WORN) }, []),
  }, []),
}, ['v', 'species', 'model', 'body', 'height', 'skin', 'eyes', 'brows', 'hair', 'facialHair', 'wear']);

/** CONTRACTS §3.5 */
export const HF_REWARD = obj({
  id: str(64, { re: /^(r_[0-9a-f]{8}|tw_[A-Za-z0-9-]{1,60})$/ }),
  currency: str(8, { enum: ['dollahs', 'points'] }),
  title: str(45, { min: 1 }),
  prompt: str(200),
  cost: int(1, 100000000),
  inputRequired: { t: 'bool' },
  enabled: { t: 'bool' },
  paused: { t: 'bool' },
  cooldownSec: nul(int(0, 604800)),
  perStream: nul(int(1, 100000)),
  perUserPerStream: nul(int(1, 100000)),
  color: nul(HEX_COLOR),
  image: nul(str(500, { re: /^https:\/\// })),
  featureId: nul(str(64)),
  liveOnly: { t: 'bool' },
}, ['id', 'currency', 'title', 'prompt', 'cost', 'inputRequired', 'enabled', 'paused']);

/** Admin → create a prediction. */
export const PREDICTION_CREATE = obj({
  title: str(45, { min: 1 }),
  outcomes: { t: 'array', items: str(25, { min: 1 }), min: 2, max: 10 },
  windowSec: int(30, 1800),
  twitch: { t: 'bool' },
  minBet: int(1, 1000000),
  maxBet: int(1, 100000000),
}, ['title', 'outcomes', 'windowSec']);

/** Viewer request bodies (CONTRACTS §6.1). */
export const BODIES = Object.freeze({
  handoff: obj({ handoff: str(128, { min: 16 }) }),
  unlock: obj({ itemId: CATALOG_ID, idem: IDEM }),
  characterPut: obj({ spec: { t: 'object', props: {}, extra: true }, rev: int(0, Number.MAX_SAFE_INTEGER) }),
  redeem: obj({ input: str(500), idem: IDEM }, ['idem']),
  bet: obj({ outcome: str(64, { min: 1 }), amount: int(1, 100000000), idem: IDEM }),
  deleteMe: obj({ confirm: str(6, { enum: ['DELETE'] }) }),
});

/** A ledger intent, as core produces it. */
export const LEDGER_INTENT = obj({
  idem: str(200, { min: 3 }),
  kind: str(20),
  entries: { t: 'array', min: 2, max: 50, items: obj({ account: str(80, { min: 3 }), delta: { t: 'int' } }) },
  memo: str(120),
  ref: { t: 'object', props: {}, extra: true },
}, ['idem', 'kind', 'entries', 'memo']);
