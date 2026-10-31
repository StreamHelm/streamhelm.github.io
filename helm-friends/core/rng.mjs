// Seeded randomness for Helm Friends. Every random choice in the core goes through an Rng made here, so a game is fully
// replayable from (seed, input): the cloud decides, anyone can re-run the same seed and get the same result.
//
// Generator: sfc32 (small, fast, passes PractRand), seeded from a string with the cyrb53 hash.

/**
 * @typedef {Object} Rng
 * @property {() => number} next                     uniform float in [0, 1)
 * @property {(lo:number, hi:number) => number} int  uniform integer in [lo, hi] (both inclusive)
 * @property {(lo:number, hi:number) => number} float uniform float in [lo, hi)
 * @property {<T>(a:T[]) => T} pick                  one element, uniformly
 * @property {<T>(a:T[]) => T[]} shuffle             a shuffled copy (Fisher-Yates); the input is not changed
 * @property {(p:number) => boolean} chance          true with probability p
 * @property {() => number} normal                   standard normal (mean 0, sd 1), Box-Muller
 * @property {(label:string) => Rng} fork            an independent stream derived from the ORIGINAL seed + label
 * @property {() => string} state                    the generator state, for restoreRng()
 * @property {string} seed                           the seed string this stream was made from
 */

const U32 = 4294967296; // 2^32

/** cyrb53: a fast 53-bit string hash. `salt` gives independent hashes of the same string. */
function cyrb53(str, salt) {
  let h1 = 0xdeadbeef ^ salt, h2 = 0x41c6ce57 ^ salt;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 2097152 * (h2 >>> 0) + (h1 >>> 0);
}

/** Builds an Rng around a 4-word sfc32 state. */
function makeRng(seed, a, b, c, d) {
  let spare = null; // the second Box-Muller value

  function u32() {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const out = (t + d) | 0;
    c = (c + out) | 0;
    return out >>> 0;
  }

  const rng = {
    seed,
    next: () => u32() / U32,
    int(lo, hi) {
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) throw new RangeError(`rng.int(${lo}, ${hi})`);
      // 53-bit draw so wide ranges stay unbiased enough
      const x = (u32() * 2097152 + (u32() >>> 11)) / 9007199254740992;
      return lo + Math.floor(x * (hi - lo + 1));
    },
    float: (lo, hi) => lo + (u32() / U32) * (hi - lo),
    pick(arr) {
      if (!arr.length) throw new RangeError('rng.pick of an empty list');
      return arr[rng.int(0, arr.length - 1)];
    },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    chance: (p) => u32() / U32 < p,
    normal() {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0;
      while (u === 0) u = u32() / U32;
      const v = u32() / U32, r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    },
    fork: (label) => createRng(seed + '/' + label),
    state: () => [a, b, c, d].map((w) => (w >>> 0).toString(16).padStart(8, '0')).join('.') + '|' + seed,
  };
  return rng;
}

/**
 * A deterministic Rng from any string. Same string → same sequence, on every runtime.
 * @param {string} seed
 * @returns {Rng}
 */
export function createRng(seed) {
  if (typeof seed !== 'string' || !seed) throw new TypeError('createRng needs a non-empty seed string');
  const w = [0, 1, 2, 3].map((salt) => cyrb53(seed, salt) % U32);
  const rng = makeRng(seed, w[0], w[1], w[2], w[3]);
  for (let i = 0; i < 12; i++) rng.next(); // warm up: sfc32's first outputs are correlated with the seed
  return rng;
}

/**
 * Rebuilds an Rng from rng.state(), continuing exactly where it was.
 * @param {string} state
 * @returns {Rng}
 */
export function restoreRng(state) {
  const m = /^([0-9a-f]{8})\.([0-9a-f]{8})\.([0-9a-f]{8})\.([0-9a-f]{8})\|(.+)$/s.exec(String(state));
  if (!m) throw new TypeError('restoreRng: not an rng state');
  return makeRng(m[5], parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), parseInt(m[4], 16));
}

/**
 * The seed of a game. The cloud keeps `serverSecretSalt` private until it reveals the seed after settlement.
 * @param {string} gameId
 * @param {string} serverSecretSalt
 */
export function seedFor(gameId, serverSecretSalt) {
  return String(gameId) + ':' + String(serverSecretSalt);
}
