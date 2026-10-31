// Plain-English help: the ONE source for `!hfhelp`, the web app's "Help & how-to", the Twitch panel and StreamHelm.
// Numbers (odds, limits, payouts) are read from the real tables, so the help can never disagree with the games.

import { DEFAULT_ECONOMY } from './economy.mjs';
import { COMMANDS } from './commands.mjs';
import { slotsTheory } from './games/slots.mjs';
import { ROLE_INFO, CORE_ROLES } from './games/heist.mjs';
import { flipTheory } from './games/flip.mjs';
import { raceTheory } from './games/race.mjs';
import { fmt } from './format.mjs';
import { cursedTheory } from './games/cursed.mjs';
import { checkinTheory } from './streak.mjs';
import { TITLES } from './titles.mjs';
import { CORE_ROLES as ROLES5 } from './games/heist.mjs';

/**
 * @typedef {Object} HelpEntry
 * @property {string} id          topic id ('slots', 'heist', …) — what `!hfhelp <topic>` takes
 * @property {string} title
 * @property {string[]} commands  command keys it explains (COMMANDS)
 * @property {string} who         'Everyone' | 'Mods and Sky' | 'Sky'
 * @property {string} syntax
 * @property {string} example
 * @property {string} line        one chat line (≤ 300 chars) for `!hfhelp <topic>`
 * @property {string[]} text      paragraphs for the web app / panel
 * @property {{ cols:string[], rows:string[][] }} [table]  odds/payout table where it helps
 */

const pct = (p, d = 1) => (p * 100).toFixed(d).replace(/\.0+$/, '') + '%';
const WHO = { everyone: 'Everyone', mod: 'Mods and Sky', broadcaster: 'Sky' };

/**
 * Builds the help for an economy config (Sky's tuned numbers show up automatically).
 * @param {Object} [cfg]
 * @returns {HelpEntry[]}
 */
export function buildHelp(cfg = DEFAULT_ECONOMY) {
  const a = cfg.accrual, slots = slotsTheory(), flip = flipTheory(), cursed = cursedTheory(), ci = checkinTheory(cfg);
  const cu = cfg.cursed || DEFAULT_ECONOMY.cursed, bl = cfg.blessing || DEFAULT_ECONOMY.blessing, rd = cfg.raid || DEFAULT_ECONOMY.raid, bt = cfg.bounty || DEFAULT_ECONOMY.bounty;
  const followOn = !cfg.follow || cfg.follow.required !== false;
  const race = cfg.race || DEFAULT_ECONOMY.race, gp = race.gp, gp10 = raceTheory(10, 0, cfg);
  const runs = (g) => (cfg[g] && cfg[g].maxRuns) || 1;
  const cd = Math.round(cfg.cooldown.stageGlobalSec / 60);
  const e = (id, title, commands, syntax, example, line, text, table) => {
    const who = WHO[COMMANDS[commands[0]] ? COMMANDS[commands[0]].who : 'everyone'];
    const entry = { id, title, commands, who, syntax, example, line, text };
    if (table) entry.table = table;
    return entry;
  };
  return [
    e('about', "What are Pepe's Silvia Dollahs?", [], '', '',
      "Pepe's Silvia Dollahs are the channel's play money: earn them by watching and chatting, spend them on your Helm Friend, channel unlocks, games and predictions. They have no cash value.",
      ["Pepe's Silvia Dollahs are the channel's own play money. You earn them by hanging out on stream and spend them on your Helm Friend's look, channel unlocks, games and predictions.",
        'Pepe\'s Silvia Dollahs have no cash value. They can never be bought, sold, or swapped for money, Bits or channel points, and Sky can reset them at any time.']),
    e('earning', 'How you earn Pepe\'s Silvia Dollahs', [], '', '',
      `You earn ${a.perTick} Pepe's Silvia Dollahs every ${a.tickSec / 60} minutes you watch, plus ${a.activeBonus} for chatting in each ${a.activeWindowSec / 60}-minute window. Subs earn more.`,
      [`Watching: ${a.perTick} Pepe's Silvia Dollahs every ${a.tickSec / 60} minutes while Sky is live (about half the channel-point rate).`,
        `Chatting: ${a.activeBonus} extra Pepe's Silvia Dollahs for each ${a.activeWindowSec / 60}-minute window where you sent a real message (two words or more, not a command).`,
        `Subs earn ×${a.subMult[1]} (Tier 1), ×${a.subMult[2]} (Tier 2) and ×${a.subMult[3]} (Tier 3).`,
        `Following gives a one-time ${fmt(a.followBonus)}. Gift subs, cheers and raids give a bonus too.`,
        `New accounts (younger than ${a.minAccountAgeDays} days) and bots don't earn.`,
        ...(followOn ? ['You need to follow the channel to earn by watching, to get your Helm Friend and to play. (Subs, VIPs and mods count as followers.)'] : []),
        `Check in once a day in the web app or the Twitch panel: ${fmt(ci.first)} Pepe's Silvia Dollahs, +${fmt((cfg.checkin || DEFAULT_ECONOMY.checkin).step)} for every day in a row up to ${fmt(ci.max)}. Miss a day and the streak starts over.`]),
    e('checkin', 'Daily check-in', [], 'Web app / panel: Check in', '',
      `Check in once a day in the web app or the Twitch panel: ${fmt(ci.first)} Pepe's Silvia Dollahs on day 1, more every day in a row (up to ${fmt(ci.max)} from day ${ci.maxDays}). Missing a day resets the streak.`,
      [`Press "Check in" in the web app or the Twitch panel once a day. Day 1 pays ${fmt(ci.first)} Pepe's Silvia Dollahs, and each day in a row pays more, up to ${fmt(ci.max)} from day ${ci.maxDays} on (a perfect week is ${fmt(ci.week)}).`,
        'Miss a day and your streak starts over at day 1. Days change at midnight UTC.']),
    e('balance', 'Check your Pepe\'s Silvia Dollahs', ['balance'], '!balance', '!balance',
      '!balance (or !dollahs) shows your Pepe\'s Silvia Dollahs. The web app shows them too, with your history.',
      ['Type !balance (or !dollahs) in chat. Your balance is always in the top right of the web app and the Twitch panel, next to the coin.']),
    e('fight', 'Fight someone', ['fight', 'accept', 'decline'], '!fight @user [amount]', '!fight @sky 100',
      `!fight @user 100 challenges them; they type !accept or !decline within ${cfg.fight.acceptSec}s. Winner takes the pot. Leave out the amount for a friendly fight.`,
      [`Challenge someone with !fight @user and an amount (${fmt(cfg.fight.minBet)}–${fmt(cfg.fight.maxBet)}). Your bet is held right away.`,
        `They have ${cfg.fight.acceptSec} seconds to type !accept (they bet the same amount) or !decline (you get yours back).`,
        'Everyone else scatters, you two put on boxing gloves, and a 15–20 second fight decides it. The winner takes both bets.',
        'It is a fair coin flip: how your character looks never changes the odds. Leave out the amount to fight just for glory.']),
    e('armwrestle', 'Arm wrestle someone', ['armwrestle', 'accept', 'decline'], '!armwrestle @user [amount]', '!armwrestle @sky 50',
      `!armwrestle @user 50 challenges them; they !accept or !decline. Everyone gathers round the table for 10 seconds. Winner takes the pot.`,
      ['Works like a fight: challenge, they accept or decline, the winner takes both bets.',
        'Everyone gathers round the table and cheers for a 10-second back-and-forth. Fair 50/50.']),
    e('slots', 'Slots', ['slots'], '!slots <amount> [spins]', '!slots 100 3',
      `!slots 100 spins (${fmt(cfg.slots.minBet)}–${fmt(cfg.slots.maxBet)}); !slots 100 3 spins 3 times. Three Glorps = JACKPOT ×100. One Glorp gives half back. Returns about ${pct(slots.rtp)} over time.`,
      [`Bet ${fmt(cfg.slots.minBet)}–${fmt(cfg.slots.maxBet)} with !slots <amount>. Three reels of Glorp, Klerb, Sayok, Sky and PepeBot.`,
        `Add a number to spin up to ${runs('slots')} times in one go: !slots 100 3 bets 100 on each of 3 spins (300 in total, so you need 300). Every spin pays on its own; it all happens in one show.`,
        'Everyone else gathers round to watch: they jump for joy when you win and look gutted when you lose.',
        `Payouts include your bet. Over many spins slots pays back about ${pct(slots.rtp)} of what goes in.`],
      { cols: ['Result', 'Pays', 'Chance'], rows: slots.lines.map((l) => [l.label, l.mult + '×', pct(l.p, 2)]) }),
    e('cursed', "Sayok's cursed slot", ['cursed'], '!cursed <amount> [spins]', '!cursed 100',
      `!cursed 100 spins Sayok's cursed slot (${fmt(cu.minBet)}–${fmt(cu.maxBet)}): three of Sayok's Eyes = SAYOK'S DOOM ×666. Higher risk than !slots: it returns about ${pct(cursed.rtp)} and wins less often, but pays huge.`,
      [`Bet ${fmt(cu.minBet)}–${fmt(cu.maxBet)} with !cursed <amount>, up to ${cu.maxRuns} spins at once (!cursed 100 3). The reels hold Bones, Hellfire, Skulls, Sayok's Eye and one lonely Glorp.`,
        `It is the high-risk machine: it pays something only ${pct(cursed.hit)} of the time (slots: about a third) and returns about ${pct(cursed.rtp)} over time (slots: ${pct(slots.rtp)}), but three Eyes pay 666× your bet.`,
        "A Glorp anywhere on the line is Glorp's mercy: your bet back."],
      { cols: ['Result', 'Pays', 'Chance'], rows: cursed.lines.map((l) => [l.label, l.mult + '×', pct(l.p, 2)]) }),
    e('roulette', 'Roulette', ['roulette'], '!roulette <amount> <pick> [spins]', '!roulette 100 red',
      `!roulette 100 red. Picks: red black odd even low high (2×), 1st 2nd 3rd (3×), a number 0-36 (36×), or a range like 7-12. Add 1-${runs('roulette')} for more spins.`,
      [`Bet ${fmt(cfg.roulette.minBet)}–${fmt(cfg.roulette.maxBet)} on a European wheel (0 to 36).`,
        `!roulette 100 red 5 bets 100 on red five times in one show (500 in total). Every bet returns about ${pct(36 / 37)} over time.`,
        'A range a-b of 2 to 18 numbers pays 36 ÷ (how many numbers), rounded down to the cent: 7-12 (6 numbers) pays 6×.',
        'Zero (green) loses every bet except a bet on 0 itself.'],
      { cols: ['Pick', 'Example', 'Pays'], rows: [['Red / black', 'red', '2×'], ['Odd / even', 'odd', '2×'], ['Low 1-18 / high 19-36', 'low', '2×'],
        ['Dozen', '1st (or 1-12)', '3×'], ['One number', '17', '36×'], ['Green (zero)', 'green', '36×'], ['Range of 6', '7-12', '6×']] }),
    e('flip', 'Coin flip', ['flip'], '!flip <amount> [heads|tails] [flips]', '!flip 100 tails',
      `!flip 100 heads (or tails) flips the Pepe's Silvia Dollah coin (${fmt(cfg.flip.minBet)}–${fmt(cfg.flip.maxBet)}). Call it right: 2× back. 1 in 40 it lands on its edge and the house wins. Add 1-${runs('flip')} for more flips.`,
      ['Heads is Sky, tails is the Cosmic Trinity. Type !flip <amount> and heads or tails (heads if you leave it out).',
        `Call it right and you get double your bet back. The catch: once in about ${Math.round(1 / flip.pEdge)} flips the coin lands on its edge (Klerb's doing) and nobody wins. That makes it pay back ${pct(flip.rtp)} over time.`,
        `!flip 100 tails 3 flips three times in one show (300 in total). Big wins rain coins.`],
      { cols: ['Result', 'Chance', 'Pays'], rows: [['Your call', pct(flip.pWin, 2), flip.mult + '×'], ['The other side', pct(flip.pWin, 2), '0'], ['On its edge', pct(flip.pEdge, 1), '0']] }),
    e('race', 'Gleep Race', ['race', 'grandprix', 'accept', 'decline', 'join'], '!race @user [amount]  ·  !join', '!race @sky 100',
      `!race @user 100: you both get beamed into your UFOs and race across the screen; they !accept or !decline. Winner takes the pot. Mods/Sky can open a Gleep Grand Prix (!gp): !join to race for the prize.`,
      [`Challenge someone with !race @user and an amount (${fmt(race.minBet)}–${fmt(race.maxBet)}), or no amount just for glory. They have ${race.acceptSec} seconds to !accept or !decline. It is a fair 50/50.`,
        'Your UFO is the one you designed in the web app (the default saucer until you do). Boosts, wobbles and a moment of Klerb chaos make it close; who wins is decided fairly before the race starts.',
        `The GLEEP GRAND PRIX: Sky or a mod opens it with !gp (or !gp <entry fee>), or it is unlocked with a channel reward. Everyone has ${gp.lobbySec} seconds to type !join (${gp.minRacers}–${gp.maxRacers} racers).`,
        `The prize pool is every entry fee plus a prize from the bank (more racers = bigger, up to ${fmt(gp.prizeCap)}). The podium splits it ${gp.split.join(' / ')}%. With 10 racers the bank adds about ${fmt(Math.round(gp10.mintMean))}.`,
        'Mods: !gp start starts early, !gp cancel calls it off and refunds every fee.']),
    e('heist', 'Bank heist', ['heist'], '!heist <amount> [role]', '!heist 200 driver',
      `!heist 200 driver opens or joins a heist (${fmt(cfg.heist.minStake)}–${fmt(cfg.heist.maxStake)}). Roles: ${CORE_ROLES.join(', ')}, muscle. More roles and more people = better odds, never a sure thing.`,
      [`Type !heist <amount> and optionally a role. The first one opens a ${cfg.heist.lobbySec}-second lobby; anyone can join (${cfg.heist.minCrew}–${cfg.heist.maxCrew} people).`,
        `Only the getaway driver's seat is for one person; any number of people can share the other roles. When the heist starts, people doubled up on a role are moved to cover the roles nobody picked (the result line says who went where).`,
        `Every one of the ${ROLES5.length} roles that is covered raises the odds a lot; extra people in a covered role help a little. A heist can run short-handed (2–4 people) with lower odds. There is always at least a 20% chance it goes wrong. If only one person joins, it is called off and the stake comes back.`,
        'If several people want to be the getaway driver, one of them is picked at random when the heist starts (fair for late joiners too) and their own car is the getaway car. The others take the roles still open, then Muscle; the result line says who went where.',
        'If it works you get your bet back multiplied, plus a share of the loot. If it fails some of the crew still escape with their bet; the rest get arrested.',
        `The opener can type !heist start once 2 people are in. One heist every ${Math.round(cfg.heist.cooldownSec / 60)} minutes.`],
      { cols: ['Role', 'What it does'], rows: Object.values(ROLE_INFO).map((r) => [r.name, r.what]) }),
    e('royale', 'Battle royale', ['royale', 'join'], '!royale  ·  !join', '!join',
      `When a mod or Sky opens a battle royale, type !join (free). Last one standing wins Pepe's Silvia Dollahs; the runner-up gets ${cfg.royale.runnerUpPct}%.`,
      ['Only Sky or a mod can start one with !royale. Then everyone has a minute to type !join; it is free.',
        `Everyone brawls at once and the last one standing wins Pepe's Silvia Dollahs (more players = bigger prize, up to ${fmt(cfg.royale.prizeCap)}). Knockouts are random and fair.`,
        'Mods: !royale start begins early, !royale cancel calls it off.']),
    e('predictions', 'Predictions', ['bet', 'predwin'], '!pred <option #> <amount>', '!pred 2 500',
      '!pred 2 500 puts 500 Pepe\'s Silvia Dollahs on option 2 of the current prediction (!bet works too). You can top up, not switch sides. Winners split the losing side.',
      ['When Sky runs a prediction you can bet Pepe\'s Silvia Dollahs as well as channel points: in chat with !pred <option> <amount> (or !bet), or in the web app.',
        'Bets on the winning option share the Pepe\'s Silvia Dollahs from the losing options, in proportion to what they bet. If nobody picked the winner, everyone gets their Pepe\'s Silvia Dollahs back.',
        'A tie: when Sky or a mod names several winners, everyone who bet on any of them shares the losing side, again in proportion to their bets. Twitch only allows one winner, so on a tie the channel-point side is canceled and every channel point goes back.',
        'The bars show both: the colour part is channel points, the silver part is Pepe\'s Silvia Dollahs.',
        'Mods: !predwin 2 picks the winner (!predwin 1 3 for a tie), !predwin lock closes betting, !predwin cancel refunds everyone.']),
    e('rewards', 'Channel unlocks', ['redeem'], '!redeem <reward> [text]', '!redeem hydrate',
      '!redeem <reward> spends Pepe\'s Silvia Dollahs on a channel unlock. Browse them all in the web app under Channel unlocks.',
      ['Some channel rewards cost Pepe\'s Silvia Dollahs instead of channel points. Redeem them in the web app (Channel unlocks) or with !redeem and the start of the reward name.',
        'Some only work while Sky is live. Channel-point rewards are listed too, with a link to redeem them on Twitch.']),
    e('avatar', 'Your Helm Friend', ['show', 'hide'], '!show  ·  !hide', '!hide',
      "Make your Helm Friend in the web app. It walks around on stream when you chat. !hide hides it, !show brings it back.",
      ['Open the web app and choose "Make your character": species, body, height, face, hair and clothes. Use the arrows to cycle pieces and the colour wheel for colours.',
        'Locked items show their price; you can try them on before unlocking. Press "Update / save changes" to send your character to the stream.',
        'Your Helm Friend appears when you chat and leaves after 15 minutes of quiet. !hide keeps it off stream, !show brings it back.']),
    e('emotes', 'Emotes', ['jump', 'dance', 'wave', 'sit', 'cheer'], '!jump !dance !wave !sit !cheer', '!dance',
      'Make your Helm Friend move: !jump !dance !wave !sit !cheer.',
      ['Type !jump, !dance, !wave, !sit or !cheer and your Helm Friend does it on stream (once every 10 seconds).']),
    e('link', 'The web app', ['link', 'help'], '!helm  ·  !hfhelp [topic]', '!hfhelp slots',
      '!helmfriends (or !hf) posts the web app link. !hfhelp <topic> explains one thing: earning, checkin, fight, slots, cursed, roulette, flip, race, heist, royale, events, titles, predictions, rewards, avatar.',
      ['!helmfriends (or !hf, !helm) posts the link to the web app. !hfhelp <topic> gives a one-line explanation in chat.']),
    e('events', "Glorp's Blessing, raids and big events", [], '', '',
      `Big events (heist, battle royale, Grand Prix, Glorp's Blessing) take over the stage: no other games until they're done. Glorp's Blessing rains ${fmt(bl.perViewerMin)}–${fmt(bl.perViewerMax)} Pepe's Silvia Dollahs on everyone watching. Raiders get ${fmt(rd.stipend)} as a welcome.`,
      [`Glorp's Blessing: once in a while Glorp floats down over the stage and rains ${fmt(bl.perViewerMin)}–${fmt(bl.perViewerMax)} Pepe's Silvia Dollahs on everyone who is watching right then. No command - just be there.`,
        `Raids: when a raid arrives every Helm Friend dances, and everyone who came with the raid gets a one-time welcome of ${fmt(rd.stipend)} Pepe's Silvia Dollahs when they first chat or show up.`,
        'While a big event is open or running (a heist, a battle royale, the Gleep Grand Prix or Glorp\'s Blessing) nobody can start another game; join the event instead. Prediction bets still work.']),
    e('titles', 'Titles and the bounty', [], '', '',
      `Win duels in a row (fights, arm wrestling, Gleep Races) for a title over your head: On a Roll ×3, Undefeated ×5, Unstoppable ×10, Living Legend ×20. The richest viewer has a bounty: beat them in a duel of ${fmt(bt.minStake)}+ to win it.`,
      [`Duel streaks: every fight, arm wrestle or Gleep Race 1v1 you win in a row counts. ${TITLES.slice().reverse().map((t) => `${t.text} ×${t.min}`).join(', ')}. Lose once and the streak is over. End someone's streak of 5+ and you're a Streak Breaker for the stream.`,
        `The bounty: the richest viewer seen this stream (with ${fmt(bt.minBalance)}+ Pepe's Silvia Dollahs) is WANTED. Beat them in a fight, arm wrestle or Gleep Race for ${fmt(bt.minStake)}+ Pepe's Silvia Dollahs and the bank adds a bounty of ${bt.pct}% of their balance (${fmt(bt.min)}–${fmt(bt.cap)}). At most ${bt.perStream} bounties are paid per stream.`]),
    e('admin', 'For Sky and mods', ['give', 'take'], '!give @user <amount>  ·  !take @user <amount>', '!give @sky 500',
      `Mods: !give @user 500 (up to ${fmt(cfg.give.modMaxPerGive)} per give, ${fmt(cfg.give.modDailyCap)} per day). Sky: !take @user 500. Everything is logged.`,
      [`!give @user <amount> gives Pepe's Silvia Dollahs. Mods can give up to ${fmt(cfg.give.modMaxPerGive)} at once and ${fmt(cfg.give.modDailyCap)} per day; Sky has no limit.`,
        '!take @user <amount> (Sky only) removes Pepe\'s Silvia Dollahs. Every give and take is written to the history log.']),
    e('cooldown', 'Why do I have to wait?', [], '', '',
      `Games share one stage: one show at a time, and ${cd} minute${cd === 1 ? '' : 's'} between game starts, so the stream stays tidy.`,
      [`Slots, roulette, coin flips, fights, arm wrestling, Gleep Races, heists and battle royales share one stage. A multi-spin (!slots 100 3) is one show. Only one runs at a time, and the next can start ${cd} minute${cd === 1 ? '' : 's'} after the last one began.`,
        'Checking your balance, emotes and prediction bets never wait.']),
  ];
}

export const HELP = Object.freeze(buildHelp());

/**
 * The help entry for a topic, a command key, or a trigger word ("slots", "!slots", "accept", "br"…). null if unknown.
 * @param {string} topic
 * @param {HelpEntry[]} [help]
 */
export function helpFor(topic, help = HELP) {
  const t = String(topic || '').toLowerCase().replace(/^!/, '');
  if (!t) return null;
  const direct = help.find((h) => h.id === t);
  if (direct) return direct;
  const key = Object.keys(COMMANDS).find((k) => k === t || COMMANDS[k].triggers.includes('!' + t));
  return key ? help.find((h) => h.commands.includes(key)) || null : null;
}

/**
 * The one chat line `!hfhelp [topic]` posts.
 * @param {string} [topic]
 * @param {{ url?:string }} [opts]
 */
export function helpLine(topic, { url } = {}) {
  const h = helpFor(topic);
  const more = url ? ` More: ${url}` : '';
  if (h) return (h.line + more).slice(0, 300);
  return ('Helm Friends: !balance, !slots, !cursed, !roulette, !flip, !fight, !race, !armwrestle, !heist, !pred, emotes, !helmfriends. !hfhelp <topic> for one of them.' + more).slice(0, 300);
}

/** One short line per command for the scrolling command list (v1.11). */
const WHAT = Object.freeze({
  balance: 'your Pepe\'s Silvia Dollahs', fight: 'challenge someone to a fight', armwrestle: 'arm wrestle someone', accept: 'take a challenge',
  decline: 'turn a challenge down', slots: 'spin the slots', cursed: "Sayok's cursed slot - high risk, high reward",
  roulette: 'bet on the wheel', flip: 'flip the Pepe\'s Silvia Dollah coin', race: 'race someone in your UFO', join: 'join the open event',
  heist: 'rob the Silvia Bank with a crew', bet: 'bet Pepe\'s Silvia Dollahs on the prediction', redeem: 'spend Pepe\'s Silvia Dollahs on a channel unlock',
  show: 'show your Helm Friend', hide: 'hide your Helm Friend', link: 'make your Helm Friend (web app)', help: 'how anything works',
});
const EMOTES = ['jump', 'dance', 'wave', 'sit', 'cheer'];

/**
 * The commands ANY follower can use right now, for the scrolling command list overlay (v1.11): core COMMANDS with
 * who:'everyone', Sky's renamed triggers applied (the usage example too), switched-off ones left out; emotes in one row.
 * @param {{ triggers?:Object<string,string[]>, disabled?:string[] }} [cc]  the cloud's `commands` setting (v1.7 shape)
 * @returns {{ key:string, trigger:string, usage:string, what:string, gambling:boolean }[]}
 */
export function commandList(cc = {}) {
  const off = new Set(cc.disabled || []), tr = cc.triggers || {};
  const first = (k) => (Array.isArray(tr[k]) && tr[k].length ? tr[k] : COMMANDS[k].triggers)[0];
  const out = [];
  for (const [key, c] of Object.entries(COMMANDS)) {
    if (c.who !== 'everyone' || off.has(key) || EMOTES.includes(key)) continue;
    const trig = first(key), usage = c.usage.split(c.triggers[0]).join(trig);
    out.push({ key, trigger: trig, usage, what: WHAT[key] || '', gambling: !!c.gambling });
  }
  const emotes = EMOTES.filter((k) => !off.has(k)).map(first);
  if (emotes.length) out.push({ key: 'emotes', trigger: emotes[0], usage: emotes.join(' '), what: 'make your Helm Friend move', gambling: false });
  return out;
}

/** The `!helmfriends` reply (v1.11): the web app link, or a friendly "coming soon" before the site is published. */
export function linkLine(url) {
  return url ? `Make your Helm Friend, check your Pepe's Silvia Dollahs and check in daily: ${url}` : "Pepe's Helm Friends web app is coming soon - for now, chat to get your Helm Friend on stream!";
}
