// Pepe's Helm Friends core (CONTRACTS §2): every rule, formula and table, once, as pure functions.
// No I/O, no clock, no Math randomness: callers inject an Rng (createRng), the time (`now`) and the economy config.
// Loads with require() in Node 22.12+/Electron and with <script type="module"> in browsers (no top-level await).

export const CURRENCY = Object.freeze({ name: "Pepe's Silvia Dollahs", short: 'Dollahs', one: 'Dollah', code: 'PSD' });

export { createRng, restoreRng, seedFor } from './rng.mjs';
export { fmt, fmtWait, PSD, psd } from './format.mjs';
export { parseAmount, parseRunsBet, parseAmountLiteral, applyMult, applyBp, mulDiv, isMoney, toBp, INFINITE } from './money.mjs';
export { ERR, CHAT_CODES, fail, errText } from './errors.mjs';
export { KINDS, SYS, userAcct, escrowAcct, gameIdem, intent, transfer, netByAccount, isBalanced } from './ledger.mjs';
export {
  DEFAULT_ECONOMY, mergeEconomy, accrualFor, accrualEligible, subMultFor, tickStartOf, activeWindowOf, isActiveMessage,
  followBonusFor, eventBonusFor, tierFor, priceForRarity, giveCheck, giveIntent, grantIntent, takeIntent, unlockIntent,
  seasonStartIntent, correctionIntent,
} from './economy.mjs';
export { emptyStage, stageGate, heistGate, stageReserve, stageStart, stageRelease, stageView, cooldownUntil, userGate, pairKey, BIG_EVENTS, EVENT_NAMES, stageKindOf, eventOn } from './cooldown.mjs';
// ───── round 3 (CONTRACTS v1.11)
export { dayOf, daysBetween, checkinBonus, streakState, checkin, checkinTheory } from './streak.mjs';
export { blessingPayouts, blessingIntents, blessingScript, blessingLine, blessingTheory, BLESSING_SHOW } from './blessing.mjs';
export { isRaider, raidStipendIntent, raidStipendCap, raidScript, RAID_SHOW } from './raid.mjs';
export { bountyAmount, bountyHolder, bountyClaim, bountyIntent, bountyTheory, BOUNTY_GAMES } from './bounty.mjs';
export { TITLES, SLAYER_MIN, DUEL_GAMES, emptyStats, applyDuel, isDuel, titleFor, badgesFor } from './titles.mjs';
export { HOST_MODES, DEFAULT_HOST_MODE, normalizeHostMode, hostMayJoin, hostAutoJoin, hostDeck, DECK } from './host.mjs';
export { lobbyView, lobbyScript, teardownScript, triggerOf } from './lobby.mjs';
export { AUTO_EVENTS, AUTO_MODES, DEFAULT_AUTOMATION, normalizeAutomation, chatMayOpen, chanceSlot, emptyAutoState, dueEvents, recordStart, autoRate } from './automation.mjs';
export { FOLLOW_FREE, followStatus, followRequired, followGate, followHintDue, avatarAllowed } from './follow.mjs';
export { autoCharacter } from './autochar.mjs';
export { openSeasons, seasonOfItem, seasonalOnSale } from './seasonal.mjs';
export { composeFrame as composeSprite, partsForSpec as spriteParts, composePet } from './sprite.mjs';
export { renderCard, CARD, textWidth, fitText } from './card.mjs';
export { cursedTheory, CURSED_PAYTABLE, CURSED_REEL } from './games/cursed.mjs';
export { FAKE_BASE, fakeId, isFakeId, fakeName, actCommand, DEFAULT_CROWD, crowdActions, TEST_TRIGGERS } from './testspace.mjs';
export { COMMANDS, ROLE_ALIASES, FLIP_WORDS, MAX_RUNS, splitRuns, parseCommand, parsePick, parseTarget, cleanText, triggerMap, canUse, isGambling, matchReward } from './commands.mjs';
export { scriptBuilder, validateScript, clip, ANIMS, EXPRESSIONS, BEAT_OPS, PROP_KINDS, SKY_PROPS, OWNED_PROPS, CROWDS, FX, HOUSE, EVERYONE, HOSTS } from './script.mjs';
export { COIN_RAIN, coinRainCount, coinRainWaves } from './coins.mjs';
export {
  outcomeByN, betCheck, betIntent, refundDollahPool, settleDollahPool, totalsFrom, percentages, bars, barCaption,
  onTwitchEvent, atLockTime,
} from './predictions.mjs';
export { check, HSV, WORN, CHARACTER_SPEC, HF_REWARD, PREDICTION_CREATE, BODIES as REQUEST_BODIES, LEDGER_INTENT } from './schema.mjs';
export { HELP, buildHelp, helpFor, helpLine, commandList, linkLine } from './help.mjs';
export { GAMES, MULTI_RUN, playGame } from './games/index.mjs';
export { slotsTheory, PAYTABLE as SLOTS_PAYTABLE, REEL as SLOTS_REEL } from './games/slots.mjs';
export { pickNumbers, multBp as rouletteMultBp, pickRtp as rouletteRtp, colorOf as rouletteColor, pickLabel as roulettePickLabel } from './games/roulette.mjs';
export { heistOdds, heistTheory, joinHeist, assignRole, draftDrivers, spreadRoles, lockCrew, SINGLE_ROLES as HEIST_SINGLE_ROLES, crewLine, CORE_ROLES, ROLES as HEIST_ROLES, ROLE_INFO as HEIST_ROLE_INFO } from './games/heist.mjs';
export { royalePrize, royaleDuration } from './games/royale.mjs';
export { flipTheory, FLIP_FACES, FLIP_CALLS, FLIP_WIN_BP } from './games/flip.mjs';
export { raceTheory, raceGpPrize, podiumSplit, raceDuration, racePaths, racersOf, RACE } from './games/race.mjs';
export { runsOf, settleLine } from './games/common.mjs';
export { buildCatalog, indexCatalog, itemById, itemsBySlot, isUnlocked, priceOf, fitsSpecies, CATALOG_VERSION } from './avatar/catalog.mjs';
export {
  normalizeSpec, validateSpec, saveRejection, defaultSpec, uniqueSpec, randomStarterSpec, describeSpec, itemsInSpec,
  skinTone, clampHsv, SPECIES, RESERVED_SPECIES, MODELS, BODIES, HEIGHTS, WEAR_SLOTS, EYE_PRESETS,
  BREED_SPECIES, COAT_SPECIES, EAR_SPECIES, WING_SPECIES,
} from './avatar/spec.mjs';
export {
  VEHICLE_KINDS, VEHICLE_PARTS, VEHICLE_OPTIONAL, VEHICLE_DEFAULTS, VEHICLE_COLORS, VEHICLE_ROWS, defaultVehicles, vehicleOf, vehicleItems,
} from './avatar/vehicles.mjs';
export { layerOrder, rampFor, recolour, stretchRows, heightRows, hsvToRgb, rgbToHsv, fxColor, HEIGHT_ROWS, bodyColors } from './avatar/compose.mjs';
