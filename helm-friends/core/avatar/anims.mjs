// Animation names in the art pack (CONTRACTS §11 + v1.18). The art pack (art.json `anims`) is the authority for frame
// counts / fps / directions; this list lets core, the overlay and tests name the v1.18 additions without guessing.

/** The original 20 (CONTRACTS §11). */
export const BASE_ANIMS = Object.freeze(['idle', 'walk', 'run', 'flee', 'jump', 'punch', 'kick', 'uppercut', 'hurt', 'knockout',
  'startled', 'cheer', 'dance', 'wave', 'sit', 'armwrestle', 'arrested', 'cuffedWalk', 'sad', 'victory']);

/**
 * v1.18 idle variants (side + front, play once then return to `idle`): give every actor its own rhythm so a crowd never
 * moves like a hive mind. `sit` and `wave` (existing) count as idle variants too.
 */
export const IDLE_VARIANTS = Object.freeze(['idleLook', 'idleStretch', 'idleYawn', 'idleScratch', 'idleTap', 'idlePhone', 'idleShift']);

/**
 * v1.18 fight set (side view unless noted). `guard` loops (the bouncing fighting stance); strikes, blocks and hit
 * reactions play once; `knockout` (existing) holds; `getUp` stands back up from the knockout's last frame;
 * `victoryDance` is front view and loops. Strike timing / reach: art.json `fight` (contact frame, reach per body).
 */
export const FIGHT_ANIMS = Object.freeze(['guard', 'jab', 'cross', 'hook', 'uppercut', 'block', 'weave', 'hitLight', 'hitHeavy',
  'knockback', 'knockout', 'getUp', 'victoryDance']);
/** Strikes with a contact frame in art.json `fight.strikes` (punch / kick / uppercut are the original three). */
export const STRIKES = Object.freeze(['jab', 'cross', 'hook', 'uppercut', 'punch', 'kick']);

/** Every animation the v1.18 art pack contains. */
export const ART_ANIMS = Object.freeze([...BASE_ANIMS, ...IDLE_VARIANTS, ...FIGHT_ANIMS.filter((a) => !BASE_ANIMS.includes(a))]);
