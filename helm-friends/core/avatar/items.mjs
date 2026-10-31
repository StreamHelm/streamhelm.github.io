// The Helm Friends item list: the single source of every species, body option and wearable (DESIGN §8.5).
// The art pipeline (WP6) renders exactly these ids and writes assets/hf/catalog.json from buildCatalog(); prices come
// from the rarity table in the economy config. About half of everything is locked behind unlocks.
//
// Row format: [key, name, rarity, options]   options: ch = colour channels (default per slot), locked = fixed colours,
// fx = 'glow'|'prism'|'glitter'|'pulse', frames = [fps, count] own animation, hides = layers it hides,
// for = reservedFor ('sky'|'pepebot'), tags = extra tags, species = allowed species.

import { VEHICLE_CHANNELS } from './vehicles.mjs';

const S = 'starter', C = 'common', R = 'rare', E = 'epic', L = 'legendary', X = 'reserved';
const GODS = ['gods', 'stream'], STREAM = ['stream'];
/** Buyable by everyone, and free for Sky's unique avatar (tag 'kit:<unique>', see catalog.isUnlocked). */
const SKY_KIT = ['stream', 'kit:sky'];
/** Sky's own wardrobe (v1.11): reserved for his unique avatar, never for sale. */
const SKY = { for: 'sky', locked: true, tags: ['stream', 'sky'] };
/** Seasonal cosmetics (v1.12): tagged 'seasonal:<id>' (economy.seasonal windows, core seasonalOnSale). */
const HALLOWEEN = ['seasonal:halloween'], WINTER = ['seasonal:winter'];   // core seasonal.mjs sells these only inside the window
const HAT_HIDES = ['hair.top'];
const NATURAL = 'Natural (your colour)';
/** v1.16 coat rows for one species: [key, name, rarity, ch?] → breed rows (ch 1 = pattern on spec.skin, 0 = fixed palette). */
const coats = (sp, list) => list.map(([k, n, r, ch]) => [sp + '.' + k, n, r, ch ? { species: [sp], ch } : { species: [sp] }]);
/** v1.16 species feature rows (the 'ears' slot: face shapes, ears, extras, tusks, horns, face paints). */
const feats = (sp, list) => list.map(([k, n, r]) => [sp + '.' + k, n, r, { species: [sp] }]);

/** Default colour channels per slot (0 = colour comes from the spec, e.g. hair colour). */
const SLOT_CHANNELS = { hat: 2, eyewear: 1, ear: 1, nose: 1, shirt: 2, pants: 2, shoes: 2, hair: 0, hairfx: 0, facialHair: 0,
  brows: 0, eyes: 0, species: 0, breed: 0, ears: 0, wings: 1, pet: 1 };

/** @type {Object<string, [string, string, string, Object?][]>} slot → rows */
export const ITEM_ROWS = {
  species: [
    ['human', 'Human', S], ['dragon', 'Dragon', S], ['ape', 'Ape', S], ['cat', 'Cat', S], ['dog', 'Dog', S],
    ['frog', 'Frog', S], ['capybara', 'Capybara', S], ['panda', 'Panda', S],
    ['alien', 'Gleep alien', S], ['rat', 'Rat', S], ['axolotl', 'Axolotl', S],
    ['beardie', 'Bearded dragon', S], ['bat', 'Bat', S], ['orc', 'Orc', S], ['minotaur', 'Minotaur', S], ['clown', 'Clown', S],
    ['mecha', 'Mecha Dragon (PepeBot)', X, { for: 'pepebot', locked: true, fx: 'pulse' }],
  ],
  eyes: [
    ['round', 'Round', S], ['almond', 'Almond', S], ['sleepy', 'Sleepy', S], ['anime', 'Big & shiny', C], ['star', 'Star eyes', R],
  ],
  brows: [['1', 'Soft brows', S], ['2', 'Bold brows', S], ['3', 'Arched brows', S]],
  hair: [
    ['bald', 'Bald', S], ['buzz', 'Buzz cut', S], ['short', 'Short', S], ['sidepart', 'Side part', S], ['messy', 'Messy', S],
    ['ponytail', 'Ponytail', S], ['bob', 'Bob', S], ['long', 'Long', S], ['curly', 'Curly', S], ['afro', 'Afro', S],
    ['mohawk', 'Mohawk', C], ['spiky', 'Spiky', C], ['bun', 'Top bun', C], ['mullet', 'Mullet', C],
    ['braids', 'Braids', R], ['dreads', 'Dreads', R], ['pompadour', 'Pompadour', R], ['anime', 'Anime spikes', E],
    // round 2 (v1.10)
    ['space_buns', 'Space buns', S], ['undercut', 'Undercut', S], ['wolf', 'Wolf cut', C], ['twintails', 'Twin tails', C],
    ['liberty', 'Liberty spikes', R], ['cosmic', 'Cosmic waterfall', L, { fx: 'glitter' }],
    // clown hair (v1.11)
    ['clown_tufts', 'Curly clown tufts', S], ['clown_twotone', 'Two-tone clown tufts', C, { locked: true }], ['rainbow_afro', 'Rainbow clown afro', R, { locked: true }],
  ],
  hairfx: [
    ['neon', 'Neon hair (glow)', E, { fx: 'glow' }], ['stardust', 'Stardust hair (glitter)', E, { fx: 'glitter' }],
    ['prism', 'Prism hair (colour-cycling)', L, { fx: 'prism' }],
  ],
  facialHair: [
    ['stubble', 'Stubble', S], ['mustache', 'Mustache', S], ['goatee', 'Goatee', S],
    ['fullbeard', 'Full beard', C], ['muttonchops', 'Mutton chops', C],
    ['soulpatch', 'Soul patch', S], ['handlebar', 'Handlebar mustache', C], ['wizard', 'Wizard beard', R],
    ['sky_beard', "Sky's beard", X, { for: 'sky', locked: true, tags: STREAM }],
  ],
  hat: [
    ['cap', 'Cap', S, { hides: HAT_HIDES }], ['beanie', 'Beanie', S, { hides: HAT_HIDES }], ['bucket', 'Bucket hat', S, { hides: HAT_HIDES }],
    ['cowboy', 'Cowboy hat', S, { hides: HAT_HIDES }], ['headband', 'Headband', S, { ch: 1 }], ['bandana', 'Bandana', S],
    ['snapback', 'Snapback', S, { hides: HAT_HIDES }], ['beret', 'Beret', S, { hides: HAT_HIDES }],
    ['wizard', 'Wizard hat', S, { hides: HAT_HIDES }], ['hardhat', 'Hard hat', S, { hides: HAT_HIDES, ch: 1 }],
    ['visor', 'Visor', S], ['tophat', 'Top hat', S, { hides: HAT_HIDES }],
    ['glorp_halo', 'Glorp halo-antennae', E, { locked: true, fx: 'glow', tags: GODS }],
    ['klerb_crown', 'Klerb chaos crown', E, { locked: true, hides: HAT_HIDES, tags: GODS }],
    ['sayok_horns', 'Sayok horns', E, { locked: true, tags: GODS }],
    ['helm_captain', "Helm captain's hat", R, { locked: true, hides: HAT_HIDES, tags: STREAM }],
    ['tricorn', 'Pirate tricorn', C, { hides: HAT_HIDES }], ['crown', 'Crown', L, { locked: true, fx: 'glitter', hides: HAT_HIDES }],
    ['astronaut', 'Astronaut helmet', R, { hides: ['hair.top', 'hair.back'] }],
    ['propeller', 'Propeller cap', R, { frames: [12, 4], hides: HAT_HIDES }], ['cone', 'Traffic cone', C, { locked: true, hides: HAT_HIDES }],
    ['chef', 'Chef hat', C, { hides: HAT_HIDES, ch: 1 }], ['viking', 'Viking helmet', R, { hides: HAT_HIDES }],
    ['neon_halo', 'Neon halo', L, { fx: 'glow', ch: 1 }],
    // round 2 (v1.10)
    ['trucker', 'Trucker cap', S, { hides: HAT_HIDES }], ['fedora', 'Fedora', S, { hides: HAT_HIDES }], ['flatcap', 'Flat cap', S, { hides: HAT_HIDES }],
    ['earmuffs', 'Earmuffs', S], ['party', 'Party hat', C, { hides: HAT_HIDES }],
    ['ufo_hat', 'Mini-UFO hat', R, { locked: true, frames: [8, 4], tags: ['gleep', 'stream'] }],
    ['helm_wheel', 'Spinning Helm wheel', E, { locked: true, frames: [8, 6], tags: STREAM }],
    ['sayok_flame', 'Sayok flame crown', L, { locked: true, frames: [12, 6], tags: GODS }],
    ['dollah_tophat', "Pepe's Silvia Dollah top hat", L, { locked: true, fx: 'glitter', hides: HAT_HIDES, tags: STREAM }],
    // v1.11: Sky's own hats
    ['sky_mustard_beanie', "Sky's mustard beanie", X, { ...SKY, hides: HAT_HIDES }], ['sky_pom_beanie', "Sky's black & gold pom beanie", X, { ...SKY, hides: HAT_HIDES }],
    ['sky_white_cap', "Sky's white cap", X, { ...SKY, hides: HAT_HIDES }],
    // v1.11: seasonal
    ['pumpkin', 'Jack-o\'-lantern head', E, { locked: true, fx: 'pulse', hides: ['hair.top', 'hair.back'], tags: HALLOWEEN }], ['witch', 'Witch hat', R, { locked: true, hides: HAT_HIDES, tags: HALLOWEEN }],
    ['clown_tiny', 'Tiny clown hat', S, { ch: 2 }], ['clown_confetti', 'Confetti-puff tiny hat', E, { locked: true, frames: [10, 6] }],
    ['santa', 'Santa hat', R, { locked: true, hides: HAT_HIDES, tags: WINTER }], ['antlers', 'Reindeer antlers', C, { locked: true, tags: WINTER }],
    // round 4 (v1.16)
    ['beanie_pom', 'Pom-pom beanie', S, { hides: HAT_HIDES }], ['sunhat', 'Wide sun hat', S, { hides: HAT_HIDES }], ['headset', 'Gamer headset', S],
    ['ushanka', 'Trapper hat', C, { hides: HAT_HIDES }], ['cat_ears', 'Cat-ear headband', C],
    ['helm_beanie', 'Helm-wheel beanie', R, { locked: true, hides: HAT_HIDES, tags: STREAM }], ['pepebot_cap', 'PepeBot cap', E, { locked: true, hides: HAT_HIDES, tags: STREAM }],
    ['glorp_bucket', 'Glorp bucket hat', R, { locked: true, hides: HAT_HIDES, tags: GODS }],
  ],
  eyewear: [
    ['round', 'Round glasses', S], ['square', 'Square glasses', S], ['sunglasses', 'Sunglasses', S], ['aviators', 'Aviators', S],
    ['goggles', 'Goggles', S],
    ['dealwithit', 'Pixel shades', R, { locked: true }], ['3d', '3D glasses', C, { locked: true }], ['monocle', 'Monocle', C],
    ['glorp_visor', 'Glorp visor', E, { locked: true, fx: 'glow', tags: GODS }],
    ['sky_frames', "Sky's chunky black frames", X, { for: 'sky', locked: true, tags: STREAM }],
    // round 2 (v1.10)
    ['cateye', 'Cat-eye glasses', S], ['hearts', 'Heart shades', S], ['stars', 'Star shades', C],
    ['helm_monocle', 'Helm-wheel monocle', R, { locked: true, tags: STREAM }],
    ['klerb_kaleido', 'Klerb kaleidoscope specs', E, { locked: true, tags: GODS }],
    ['sayok_slits', 'Sayok red-eye slits', E, { locked: true, fx: 'pulse', tags: GODS }],
    ['gleep_visor', 'Gleep visor', E, { locked: true, fx: 'glow', tags: ['gleep', 'stream'] }],
    ['pepebot_visor', 'PepeBot visor', L, { locked: true, fx: 'glow', tags: STREAM }],
    ['sky_synth_frames', "Sky's synthwave frames", X, { ...SKY, fx: 'glow' }],
    // round 4 (v1.16)
    ['rectangle', 'Rectangle glasses', S], ['browline', 'Browline glasses', S], ['shield', 'Shield shades', C], ['round_tinted', 'Tinted round shades', C],
    ['led_shades', 'LED shutter shades', R, { locked: true, tags: STREAM }], ['helm_shades', 'Helm crew shades', E, { locked: true, fx: 'glow', tags: STREAM }],
  ],
  ear: [
    ['stud', 'Stud', S], ['small_hoop', 'Small hoop', S],
    ['black_rings', 'Small black rings', C, { locked: true, tags: SKY_KIT }], ['gold_hoops', 'Gold hoops', R, { locked: true }],
    ['gauges', 'Gauges', C],
    ['cuff', 'Ear cuff', S], ['feather', 'Feather earring', S], ['industrial', 'Industrial bar', C],
    ['star', 'Star dangles', R, { locked: true, fx: 'glow' }],
    ['glorp_leaf', 'Glorp leaf earrings', E, { locked: true, fx: 'glow', tags: GODS }],
    ['dollah', "Pepe's Silvia Dollah earrings", E, { locked: true, fx: 'glitter', tags: STREAM }],
  ],
  nose: [['stud', 'Nose stud', S], ['septum_silver', 'Silver septum ring', C, { locked: true, tags: SKY_KIT }],
    ['clown_red', 'Red clown nose', S], ['clown_glitter', 'Glitter clown nose', R, { locked: true, fx: 'glitter' }], ['clown_lightup', 'Light-up clown nose', E, { locked: true, frames: [4, 2] }],
    ['ring', 'Nostril ring', S], ['bridge', 'Bridge bar', C], ['septum_gold', 'Gold septum ring', R, { locked: true }],
    ['gleep_stud', 'Gleep-glow stud', E, { locked: true, fx: 'glow', tags: ['gleep', 'stream'] }]],
  shirt: [
    ['tee', 'Tee', S], ['vneck', 'V-neck', S], ['tank', 'Tank top', S], ['longsleeve', 'Long sleeve', S], ['polo', 'Polo', S],
    ['flannel', 'Flannel', S], ['hoodie', 'Hoodie', S], ['sweater', 'Sweater', S], ['buttonup', 'Button-up', S],
    ['raglan', 'Raglan', S], ['stripes', 'Striped tee', S], ['henley', 'Henley', S], ['denim_jacket', 'Denim jacket', S],
    ['sweatshirt', 'Sweatshirt', S],
    ['sky_face', 'Sky face tee', E, { locked: true, tags: STREAM }],
    ['glorp', 'Glorp tee', R, { locked: true, fx: 'glow', tags: GODS }], ['klerb', 'Klerb tee', R, { locked: true, tags: GODS }],
    ['sayok', 'Sayok tee', R, { locked: true, tags: GODS }],
    ['peepaw', "Peepaw's Retirement Home tee", R, { locked: true, tags: STREAM }],
    ['pepebot', 'PepeBot tee', R, { locked: true, tags: STREAM }], ['pepe', 'Pepe tee', E, { locked: true, tags: STREAM }],
    ['jersey', 'Sports jersey', R, { ch: 2, tags: ['number'] }], ['helm_hoodie', 'Helm wheel hoodie', R, { ch: 1, tags: STREAM }],
    ['synthwave', 'Synthwave jacket', L, { frames: [8, 6] }], ['glitter', 'Glitter top', E, { ch: 1, fx: 'glitter' }],
    ['tuxedo', 'Tuxedo', R], ['spacesuit', 'Space suit', E], ['labcoat', 'Lab coat', C], ['hazmat', 'Hazmat suit', C],
    ['cosmic_robe', 'Cosmic robe', L, { fx: 'prism' }],
    ['sky_outfit', "Sky's black host jacket", X, { for: 'sky', locked: true, frames: [8, 8], tags: STREAM }],
    // round 2 (v1.10)
    ['hawaiian', 'Hawaiian shirt', S], ['bomber', 'Bomber jacket', S], ['turtleneck', 'Turtleneck', S], ['varsity', 'Varsity jacket', C],
    ['ufo_tee', 'UFO tee', C, { locked: true, tags: ['gleep', 'stream'] }],
    ['gleep', 'Gleep juice tee', R, { locked: true, fx: 'glow', tags: ['gleep', 'stream'] }],
    ['trinity', 'Cosmic Trinity tee', E, { locked: true, tags: GODS }],
    ['dollah', "Pepe's Silvia Dollah tee", E, { locked: true, fx: 'glitter', tags: STREAM }],
    // v1.11: Sky's own wardrobe (based on his real clothes) + the retro-synth glow jacket
    ['sky_flannel', "Sky's buffalo-plaid flannel", X, SKY], ['sky_camo', "Sky's purple camo tee", X, SKY],
    ['sky_colorblock', "Sky's colour-block tee", X, SKY], ['sky_overshirt', "Sky's black overshirt", X, SKY],
    ['sky_football', "Sky's black & gold football jersey", X, SKY], ['sky_hockey', "Sky's black & gold hockey jersey", X, SKY],
    ['sky_synth', "Sky's retro-synth glow jacket", X, { ...SKY, frames: [10, 8] }],
    // v1.11: seasonal
    // clown tops (v1.11): ruffled collars, bow ties, jumpsuits
    ['clown_polka', 'Polka-dot clown top', S], ['clown_stripes', 'Striped clown jumpsuit top', S], ['clown_ruffle', 'Ruffle collar & bow tie', C],
    ['clown_suspenders', 'Clown shirt & suspenders', C], ['clown_sparkle', 'Sparkle ringmaster coat', E, { locked: true, fx: 'glitter' }],
    ['spooky_clown', 'Spooky clown ruffle', R, { locked: true, tags: HALLOWEEN }],
    ['skeleton', 'Glow skeleton top', R, { locked: true, fx: 'glow', tags: HALLOWEEN }], ['ugly_sweater', 'Ugly holiday sweater', R, { locked: true, frames: [4, 4], tags: WINTER }],
    // round 4 (v1.16): more tops and outerwear
    ['puffer', 'Puffer jacket', S], ['windbreaker', 'Windbreaker', S], ['cardigan', 'Cardigan', S], ['track_jacket', 'Track jacket', S], ['rugby', 'Rugby shirt', S],
    ['tiedye', 'Tie-dye tee', C], ['baseball', 'Baseball jersey', C], ['sweater_vest', 'Sweater vest', C], ['leather_jacket', 'Biker jacket', R],
    ['trench', 'Trench coat', R], ['parka', 'Fur-hood parka', E],
    ['helm_crew', 'Helm crew jacket', E, { locked: true, tags: STREAM }], ['esports', 'PepeBot esports jersey', E, { locked: true, tags: STREAM }],
    ['mod_vest', 'Chat mod hi-vis vest', R, { locked: true, tags: STREAM }], ['glorp_tiedye', 'Glorp tie-dye', R, { locked: true, tags: GODS }],
  ],
  pants: [
    ['jeans', 'Jeans', S], ['chinos', 'Chinos', S], ['joggers', 'Joggers', S], ['shorts', 'Shorts', S], ['cargo_shorts', 'Cargo shorts', S],
    ['slacks', 'Slacks', S], ['sweatpants', 'Sweatpants', S], ['overalls', 'Overalls', S], ['leggings', 'Leggings', S],
    ['skirt', 'Skirt', S], ['pleated', 'Pleated skirt', S], ['capris', 'Capris', S], ['trackpants', 'Track pants', S],
    ['boardshorts', 'Board shorts', S], ['bootcut', 'Bootcut jeans', S],
    ['black_jeans', 'Ripped black jeans', C, { locked: true, tags: SKY_KIT }], ['cargo', 'Cargo pants', C], ['kilt', 'Kilt', R],
    ['glow_joggers', 'Glow-stripe joggers', E, { fx: 'glow' }], ['prison', 'Prison stripes', R, { locked: true }],
    ['leather', 'Leather pants', R], ['plaid', 'Plaid pants', C], ['camo', 'Camo pants', C], ['suit', 'Suit pants', C],
    ['sequin', 'Sequin pants', E, { fx: 'glitter', ch: 1 }], ['parachute', 'Parachute pants', C], ['space', 'Space pants', R],
    ['hazmat', 'Hazmat pants', C], ['cosmic', 'Cosmic leggings', L, { fx: 'prism' }],
    ['peepaw', "Peepaw's slacks", R, { locked: true, tags: STREAM }],
    // round 2 (v1.10)
    ['baggy', 'Baggy jeans', S], ['denim_shorts', 'Denim shorts', S], ['bellbottoms', 'Bell-bottoms', S], ['patchwork', 'Patchwork pants', C],
    ['gleep_cargo', 'Gleep-glow cargo', R, { locked: true, fx: 'glow', tags: ['gleep', 'stream'] }],
    ['starfield', 'Starfield leggings', E, { fx: 'glitter' }],
    // v1.11: Sky's own + seasonal
    ['sky_joggers', "Sky's brown joggers", X, SKY], ['sky_jeans', "Sky's black jeans", X, SKY], ['sky_shorts', "Sky's black shorts", X, SKY],
    ['sky_synth', "Sky's synth-grid pants", X, { ...SKY, fx: 'glow' }],
    ['clown_baggy', 'Baggy clown pants', S], ['clown_patch', 'Patchwork clown pants', C, { locked: true }],
    ['skeleton', 'Glow skeleton pants', R, { locked: true, fx: 'glow', tags: HALLOWEEN }], ['candycane', 'Candy-cane pants', C, { locked: true, tags: WINTER }],
    // round 4 (v1.16)
    ['wide_leg', 'Wide-leg pants', S], ['cargo_joggers', 'Cargo joggers', S], ['carpenter', 'Carpenter pants', S], ['biker_shorts', 'Biker shorts', S],
    ['corduroy', 'Corduroys', C], ['pajama', 'Pajama pants', C], ['tiedye', 'Tie-dye sweats', R],
    ['helm_cargo', 'Helm crew cargo', R, { locked: true, tags: STREAM }], ['klerb_check', 'Klerb chaos-check pants', E, { locked: true, tags: GODS }],
  ],
  shoes: [
    ['sneakers', 'Sneakers', S], ['hightops', 'High-tops', S], ['sandals', 'Sandals', S], ['loafers', 'Loafers', S], ['slipons', 'Slip-ons', S],
    ['black_boots', 'Black boots', C, { locked: true, tags: SKY_KIT }], ['cowboy', 'Cowboy boots', C], ['clown', 'Clown shoes', R],
    ['moon_boots', 'Moon boots', E, { frames: [8, 4], fx: 'glitter' }], ['rocket', 'Rocket sneakers', L, { fx: 'glow' }],
    // round 2 (v1.10)
    ['workboots', 'Work boots', S], ['skate', 'Skate shoes', S], ['platform', 'Platform boots', C],
    ['glorp_slides', 'Glorp slides', R, { locked: true, fx: 'glow', tags: GODS }],
    ['hover', 'UFO hover shoes', L, { locked: true, frames: [10, 4], tags: ['gleep', 'stream'] }],
    // v1.11: Sky's own shoes + seasonal
    ['sky_runners', "Sky's running sneakers", X, SKY], ['sky_hightops', "Sky's black high-tops", X, SKY],
    ['sky_chelseas', "Sky's black Chelsea boots", X, SKY], ['sky_synth', "Sky's synth glow kicks", X, { ...SKY, frames: [10, 4] }],
    ['clown_giant', 'Giant clown shoes', S], ['clown_squeaky', 'Squeaky bouncing clown shoes', E, { locked: true, frames: [10, 4] }],
    ['snow_boots', 'Snow boots', C, { locked: true, tags: WINTER }],
    // round 4 (v1.16)
    ['runners', 'Running shoes', S], ['hiking', 'Hiking boots', S], ['slides', 'Slides', S], ['chunky', 'Chunky sneakers', C], ['clogs', 'Foam clogs', C],
    ['helm_kicks', 'Helm crew kicks', E, { locked: true, fx: 'glow', tags: STREAM }],
  ],
  // v1.11: pets that follow the avatar (spec.pet)
  pet: [
    // ids are pet.<kind>.<variant> (the games' v1.11 proposal)
    ['kitten.cosmic', 'Cosmic kitten', S, { ch: 2 }], ['rat.brown', 'Pet rat', S], ['axolotl.pink', 'Pet axolotl', S],
    ['bat.night', 'Pet bat', C],
    ['kitten.glip', 'Glip (Glorp\'s kitten)', R, { locked: true, fx: 'glow', tags: GODS }], ['kitten.krub', 'Krub (Klerb\'s kitten)', R, { locked: true, tags: GODS }],
    ['kitten.sayno', 'Sayno (Sayok\'s kitten)', E, { locked: true, fx: 'pulse', tags: GODS }], ['drone.pepebot', 'Mini PepeBot drone', L, { locked: true, fx: 'glow', tags: STREAM }],
  ],
  // body options last (v1.16): the shop lists the catalog in order, so clothes come before the many coats / features
  breed: [
    ['cat.tabby', 'Tabby', S, { species: ['cat'] }], ['cat.orange', 'Orange', S, { species: ['cat'] }],
    ['cat.black', 'Black', S, { species: ['cat'] }], ['cat.white', 'White', S, { species: ['cat'] }],
    ['cat.tuxedo', 'Tuxedo', C, { species: ['cat'] }], ['cat.siamese', 'Siamese', R, { species: ['cat'] }],
    ['cat.calico', 'Calico', R, { species: ['cat'] }], ['cat.greypoint', 'Grey-point', C, { species: ['cat'] }],
    ['dog.lab', 'Labrador', S, { species: ['dog'] }], ['dog.shiba', 'Shiba', S, { species: ['dog'] }],
    ['dog.corgi', 'Corgi', S, { species: ['dog'] }], ['dog.beagle', 'Beagle', S, { species: ['dog'] }],
    ['dog.husky', 'Husky', R, { species: ['dog'] }], ['dog.dalmatian', 'Dalmatian', R, { species: ['dog'] }],
    ['dog.pug', 'Pug', C, { species: ['dog'] }], ['dog.poodle', 'Poodle', C, { species: ['dog'] }],
    // v1.16: more breeds, and coats for every other species (ch 1 = a pattern on your own colour, ch 0 = a fixed colour morph)
    ...coats('cat', [['bengal', 'Bengal', R], ['sphynx', 'Sphynx', C], ['russianblue', 'Russian blue', C], ['tortie', 'Tortoiseshell', C]]),
    ...coats('dog', [['dobie', 'Doberman', C], ['border', 'Border collie', C], ['shepherd', 'Shepherd', R], ['chocolate', 'Chocolate lab', S]]),
    ...coats('rat', [['natural', NATURAL, S, 1], ['hooded', 'Hooded', S, 1], ['agouti', 'Agouti ticking', S, 1], ['albino', 'Albino', C], ['black', 'Black', S], ['patchy', 'Patchy', C, 1]]),
    ...coats('panda', [['natural', 'Classic', S, 1], ['qinling', 'Qinling brown', C], ['red', 'Red-panda markings', R], ['inverted', 'Inverted', E]]),
    ...coats('capybara', [['natural', NATURAL, S, 1], ['golden', 'Golden', S], ['cocoa', 'Cocoa', S], ['ash', 'Ash grey', C], ['freckles', 'Freckles', S, 1], ['muddy', 'Mud-bath', C, 1]]),
    ...coats('frog', [['natural', NATURAL, S, 1], ['tree', 'Tree frog', S], ['dart_blue', 'Blue poison-dart', R], ['dart_bee', 'Bumblebee poison-dart', R], ['toad', 'Warty toad', S], ['spotted', 'Leopard spots', C, 1]]),
    ...coats('ape', [['natural', NATURAL, S, 1], ['silverback', 'Silverback', R], ['orangutan', 'Orangutan', S], ['chimp', 'Chimp', S], ['snub', 'Golden snub-nosed', E]]),
    ...coats('dragon', [['natural', NATURAL, S, 1], ['scales', 'Scale pattern', S, 1], ['tiger', 'Tiger stripes', C, 1], ['gold', 'Gold dragon', E], ['obsidian', 'Obsidian', R], ['frost', 'Frost', R]]),
    ...coats('alien', [['natural', NATURAL, S, 1], ['spots', 'Spots', S, 1], ['stripes', 'Stripes', C, 1], ['galaxy', 'Galaxy skin', E], ['grey', 'Classic grey', S]]),
    ...coats('axolotl', [['natural', 'Leucistic (your colour)', S, 1], ['wild', 'Wild type', S], ['golden', 'Golden albino', C], ['melanoid', 'Melanoid', C], ['copper', 'Copper', R]]),
    ...coats('beardie', [['natural', NATURAL, S, 1], ['red', 'Red morph', C], ['citrus', 'Citrus morph', C], ['zero', 'Zero (patternless)', R], ['tiger', 'Tiger banding', S, 1]]),
    ...coats('bat', [['natural', NATURAL, S, 1], ['fruit', 'Fruit bat', S], ['ghost', 'Ghost bat', R], ['vampire', 'Vampire bat', C]]),
    ...coats('orc', [['natural', NATURAL, S, 1], ['grey', 'Grey-skin', S], ['crimson', 'Crimson', C], ['warpaint', 'War paint', C, 1], ['scarred', 'Battle scars', R, 1]]),
    ...coats('minotaur', [['natural', NATURAL, S, 1], ['black', 'Black bull', S], ['white', 'White bull', C], ['highland', 'Highland ginger', C], ['holstein', 'Holstein patches', R]]),
  ],
  ears: [
    ['cat.pointy', 'Pointy ears', S, { species: ['cat'] }], ['cat.round', 'Round ears', S, { species: ['cat'] }],
    ['cat.folded', 'Folded ears', C, { species: ['cat'] }], ['cat.tufted', 'Tufted ears', C, { species: ['cat'] }],
    ['dog.floppy', 'Floppy ears', S, { species: ['dog'] }], ['dog.pointy', 'Pointy ears', S, { species: ['dog'] }],
    ['dog.fluffy', 'Fluffy ears', C, { species: ['dog'] }], ['dog.long', 'Long ears', C, { species: ['dog'] }],
    ['alien.twin', 'Twin bobble antennae', S, { species: ['alien'] }], ['alien.single', 'Single antenna', S, { species: ['alien'] }],
    ['alien.curly', 'Curly antennae', C, { species: ['alien'] }], ['alien.zigzag', 'Zap antennae', R, { species: ['alien'] }],
    ['alien.gleep', 'Gleep-glow antennae', E, { species: ['alien'], fx: 'glow' }], ['alien.nubs', 'Tiny nubs', S, { species: ['alien'] }],
    ['axolotl.frills', 'Gill frills', S, { species: ['axolotl'] }], ['axolotl.fluffy', 'Fluffy gills', C, { species: ['axolotl'] }],
    ['axolotl.neon', 'Neon gills', R, { species: ['axolotl'], fx: 'glow' }],
    // v1.11: beardie frills, bat ears, orc tusks, minotaur horns (all the 'ears' option of their species)
    ['beardie.frill', 'Beard frill', S, { species: ['beardie'] }], ['beardie.spiky', 'Spiky frill', C, { species: ['beardie'] }], ['beardie.crest', 'Royal crest', R, { species: ['beardie'] }],
    ['bat.tall', 'Tall bat ears', S, { species: ['bat'] }], ['bat.round', 'Round bat ears', S, { species: ['bat'] }], ['bat.tufted', 'Tufted bat ears', C, { species: ['bat'] }],
    ['orc.tusks', 'Tusks', S, { species: ['orc'] }], ['orc.big', 'Big tusks', C, { species: ['orc'] }], ['orc.gold', 'Gold-capped tusks', R, { species: ['orc'] }],
    // the clown's face paint (its 'ears' option; drawn under the hair)
    ['clown.classic', 'Classic white face paint', S, { species: ['clown'] }], ['clown.natural', 'Natural + clown makeup', S, { species: ['clown'] }],
    ['clown.harlequin', 'Harlequin diamonds', C, { species: ['clown'], ch: 2 }], ['clown.rainbow', 'Rainbow face paint', R, { species: ['clown'], fx: 'prism' }],
    ['minotaur.curved', 'Curved horns', S, { species: ['minotaur'] }], ['minotaur.long', 'Long horns', C, { species: ['minotaur'] }], ['minotaur.gilded', 'Gilded horns', R, { species: ['minotaur'] }],
    // v1.16: human face shapes, rat / panda ears (moved out of the head), extras, more tusks / horns / face paints
    ...feats('human', [['oval', 'Oval face', S], ['round', 'Round face', S], ['square', 'Square face', S], ['long', 'Long face', S], ['heart', 'Heart-shaped face', S]]),
    ...feats('rat', [['round', 'Round ears', S], ['dumbo', 'Dumbo ears', S], ['tiny', 'Tiny ears', C], ['torn', 'Street-fighter torn ear', R]]),
    ...feats('panda', [['round', 'Round ears', S], ['big', 'Big fluffy ears', C], ['pointy', 'Red-panda ears', R]]),
    ...feats('capybara', [['plain', 'No extras', S], ['towel', 'Hot-spring towel', S], ['yuzu', 'Yuzu on the head', C], ['duckling', 'Duckling buddy', E]]),
    ...feats('frog', [['plain', 'No extras', S], ['horned', 'Horned brows', C], ['vocal', 'Puffed vocal sac', C], ['lilypad', 'Lily-pad cap', R]]),
    ...feats('ape', [['plain', 'No extras', S], ['crest', 'Silverback crest', C], ['flanges', 'Orangutan cheek pads', R], ['tufts', 'Fluffy ear tufts', S]]),
    ...feats('orc', [['broken', 'One broken tusk', C], ['ringed', 'Ringed tusks', R], ['sabre', 'Sabre tusks', E]]),
    ...feats('minotaur', [['ram', 'Ram horns', C], ['short', 'Short horns', S], ['ringed', 'Gold-ringed horns', E]]),
    ...feats('clown', [['sad', 'Sad hobo face paint', C], ['mime', 'Mime face paint', S], ['star', 'Star-eye face paint', C]]),
  ],
  wings: [
    ['bat', 'Bat wings', S, { species: ['dragon', 'bat'] }], ['feathered', 'Feathered wings', S, { species: ['dragon'] }],
    ['tiny', 'Tiny wings', S, { species: ['dragon', 'bat'] }], ['butterfly', 'Butterfly wings', R, { species: ['dragon'], ch: 2 }],
    ['crystal', 'Crystal wings', E, { species: ['dragon'], fx: 'glow' }], ['flame', 'Flame wings', L, { species: ['dragon'], fx: 'pulse' }],
    ['tattered', 'Tattered wings', S, { species: ['dragon', 'bat'] }], ['veined', 'Veined wings', C, { species: ['dragon', 'bat'], ch: 2 }],
  ],
};

/** What each slot is called in the catalog id prefix. */
export const ID_PREFIX = { species: 'species', breed: 'breed', ears: 'ears', wings: 'wings', eyes: 'eyes', brows: 'brows',
  hair: 'hair', hairfx: 'hairfx', facialHair: 'facialHair', hat: 'hat', eyewear: 'eyewear', ear: 'ear', nose: 'nose',
  shirt: 'shirt', pants: 'pants', shoes: 'shoes', pet: 'pet' };

/**
 * One catalog item from a row (price filled in from the rarity table).
 * @param {string} slot
 * @param {[string, string, string, Object?]} row
 * @param {Object<string, number>} prices
 */
export function itemFromRow(slot, row, prices) {
  const [key, name, rarity, o = {}] = row;
  const id = (ID_PREFIX[slot] || slot) + '.' + key;   // vehicle slots ('car.body') are their own prefix
  const locked = !!o.locked;
  const anim = o.frames ? { kind: 'frames', fps: o.frames[0], frames: o.frames[1] } : o.fx ? { kind: 'fx', fx: o.fx } : null;
  const tags = [...(o.tags || [])];
  if (anim && !tags.includes('animated')) tags.push('animated');
  return {
    id, slot, name, rarity,
    price: rarity === X ? 0 : prices[rarity] ?? 0,
    channels: locked ? 0 : o.ch ?? SLOT_CHANNELS[slot] ?? VEHICLE_CHANNELS[slot] ?? 0,
    lockedColors: locked,
    anim,
    species: o.species ? [...o.species] : [],
    hides: o.hides ? [...o.hides] : [],
    reservedFor: o.for || null,
    preview: `preview/${id}.png`,
    tags,
    sinceVersion: 1,
  };
}
