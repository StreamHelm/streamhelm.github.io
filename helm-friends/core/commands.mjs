// Chat command parsing (DESIGN §5, CONTRACTS §7). parseCommand() only reads the text: it never looks at balances,
// lobbies or permissions. It returns an Intent, an { kind:'error' } intent for one of OUR commands typed wrong (so
// the bot can answer with the right usage), or null when the message isn't a Helm Friends command at all.

import { parseAmountLiteral } from './money.mjs';
import { pickNumbers } from './games/roulette.mjs';

/**
 * Every command: default triggers, who may use it, and its usage line. Triggers are renamable (ctxLite.triggers).
 * who: 'everyone' | 'mod' (mods and the broadcaster) | 'broadcaster'
 */
export const COMMANDS = Object.freeze({
  balance: { triggers: ['!balance', '!dollahs'], who: 'everyone', usage: '!balance' },   // v1.14 (Sky): !balance first, !dollahs an alias
  fight: { triggers: ['!fight'], who: 'everyone', usage: '!fight @user 100', gambling: true },
  armwrestle: { triggers: ['!armwrestle'], who: 'everyone', usage: '!armwrestle @user 100', gambling: true },
  accept: { triggers: ['!accept'], who: 'everyone', usage: '!accept' },
  decline: { triggers: ['!decline'], who: 'everyone', usage: '!decline' },
  slots: { triggers: ['!slots'], who: 'everyone', usage: '!slots 100 (or !slots 100 3 for 3 spins)', gambling: true },
  // v1.11: Sayok's cursed slot - higher risk, higher reward
  cursed: { triggers: ['!cursed'], who: 'everyone', usage: '!cursed 100 (or !cursed 100 3 for 3 spins)', gambling: true },
  roulette: { triggers: ['!roulette'], who: 'everyone', usage: '!roulette 100 red (or !roulette 100 red 3 for 3 spins)', gambling: true },
  flip: { triggers: ['!flip', '!coinflip'], who: 'everyone', usage: '!flip 100 heads (or tails; add 1-5 for more flips)', gambling: true },
  race: { triggers: ['!race'], who: 'everyone', usage: '!race @user 100', gambling: true },
  grandprix: { triggers: ['!gp', '!grandprix'], who: 'mod', usage: '!gp [entry fee] (then !gp start or !gp cancel)', gambling: true },
  royale: { triggers: ['!royale', '!br'], who: 'mod', usage: '!royale (then !royale start or !royale cancel)', gambling: true },
  join: { triggers: ['!join'], who: 'everyone', usage: '!join' },
  heist: { triggers: ['!heist'], who: 'everyone', usage: '!heist 200 driver', gambling: true },
  // v1.9 (Sky): !pred <option> <amount> BETS (anyone; !bet is the old alias); !predwin <option> [option …] RESOLVES (mods / Sky)
  bet: { triggers: ['!pred', '!bet'], who: 'everyone', usage: '!pred 2 500 (bets 500 on option 2)' },
  predwin: { triggers: ['!predwin'], who: 'mod', usage: '!predwin 2 (a tie: !predwin 1 3; also !predwin lock, !predwin cancel)' },
  give: { triggers: ['!give'], who: 'mod', usage: '!give @user 500' },
  take: { triggers: ['!take'], who: 'broadcaster', usage: '!take @user 500' },
  redeem: { triggers: ['!redeem'], who: 'everyone', usage: '!redeem <reward name> [your text]' },
  jump: { triggers: ['!jump'], who: 'everyone', usage: '!jump', emote: true },
  dance: { triggers: ['!dance'], who: 'everyone', usage: '!dance', emote: true },
  wave: { triggers: ['!wave'], who: 'everyone', usage: '!wave', emote: true },
  sit: { triggers: ['!sit'], who: 'everyone', usage: '!sit', emote: true },
  cheer: { triggers: ['!cheer'], who: 'everyone', usage: '!cheer', emote: true },
  show: { triggers: ['!show'], who: 'everyone', usage: '!show' },
  hide: { triggers: ['!hide'], who: 'everyone', usage: '!hide' },
  // v1.11 (Sky): !helmfriends (aliases !hf, !helm, !friends) posts the web app link - or "coming soon" until it is published
  link: { triggers: ['!helmfriends', '!hf', '!helm', '!friends'], who: 'everyone', usage: '!helmfriends' },
  help: { triggers: ['!hfhelp'], who: 'everyone', usage: '!hfhelp [topic]' },
});

/** Heist role words people actually type → role. */
export const ROLE_ALIASES = Object.freeze({
  mastermind: 'mastermind', boss: 'mastermind', brains: 'mastermind', leader: 'mastermind',
  hacker: 'hacker', hack: 'hacker', tech: 'hacker',
  safecracker: 'safecracker', safe: 'safecracker', cracker: 'safecracker',
  driver: 'driver', getaway: 'driver', wheelman: 'driver', wheels: 'driver',
  lookout: 'lookout', look: 'lookout', watch: 'lookout',
  muscle: 'muscle', tank: 'muscle', goon: 'muscle',
});

const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁪-⁯﻿]|\uDB40[\uDC00-\uDC7F]/g;
const AMOUNT_LIKE = /^(?:\d[\d,_]*(?:\.\d+)?[km]?|all|allin|all-in|max|half)$/i;
const LOGIN = /^[a-z0-9_]{1,25}$/;

/** Cleans a chat line: drops invisible characters (7TV's duplicate-message bypass etc.), trims, collapses spaces. */
export function cleanText(text) {
  return String(text ?? '').replace(INVISIBLE, '').replace(/[\s 　]+/g, ' ').trim();
}

/** A target login from "@Name", "name," … or null. */
export function parseTarget(tok) {
  if (!tok) return null;
  const t = tok.replace(/^@+/, '').replace(/[,.:;!?]+$/, '').toLowerCase();
  return LOGIN.test(t) ? t : null;
}

const isAmountLike = (tok) => !!tok && AMOUNT_LIKE.test(tok);
const amountTok = (tok) => ({ raw: tok });

/**
 * A roulette pick from one word: red black green/zero odd even low high, 1st/2nd/3rd (or 1-12 13-24 25-36), a number
 * 0–36, or a range a-b of 2–18 numbers. null if it isn't one.
 * @param {string} tok
 * @returns {{ kind:string, a?:number, b?:number }|null}
 */
export function parsePick(tok) {
  const t = String(tok || '').toLowerCase();
  const words = { red: 'red', reds: 'red', black: 'black', blacks: 'black', green: 'green', zero: 'green', odd: 'odd', odds: 'odd',
    even: 'even', evens: 'even', low: 'low', high: 'high' };
  if (words[t]) return { kind: words[t] };
  const dozens = { '1st': 1, first: 1, '2nd': 2, second: 2, '3rd': 3, third: 3, '1-12': 1, '13-24': 2, '25-36': 3 };
  if (dozens[t]) return { kind: 'dozen', a: dozens[t] };
  let m = /^(\d{1,2})$/.exec(t);
  if (m) { const n = Number(m[1]); return n === 0 ? { kind: 'green' } : n <= 36 ? { kind: 'number', a: n } : null; }
  m = /^(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) {
    const x = Number(m[1]), y = Number(m[2]);
    const pick = { kind: 'range', a: Math.min(x, y), b: Math.max(x, y) };
    return pickNumbers(pick) ? pick : null;
  }
  return null;
}

/** The trigger → command key map, after the streamer's renames. */
export function triggerMap(overrides) {
  const map = new Map();
  for (const [key, c] of Object.entries(COMMANDS)) {
    const list = overrides && Array.isArray(overrides[key]) && overrides[key].length ? overrides[key] : c.triggers;
    for (const t of list) map.set(String(t).toLowerCase(), key);
  }
  return map;
}

const DEFAULT_MAP = triggerMap(null);

/**
 * Parses one chat message.
 * @param {string} text
 * @param {{ triggers?:Object<string, string[]> }} [ctxLite]  renamed triggers per command key
 * @returns {Object|null}  an Intent (CONTRACTS §7), { kind:'error', cmd, code:'USAGE'|'BAD_AMOUNT', usage }, or null
 */
export function parseCommand(text, ctxLite = {}) {
  const clean = cleanText(text);
  if (!clean.startsWith('!') || clean.length > 500) return null;
  const toks = clean.split(' ');
  const map = ctxLite.triggers ? triggerMap(ctxLite.triggers) : DEFAULT_MAP;
  const key = map.get(toks[0].toLowerCase());
  if (!key) return null;
  const args = toks.slice(1);
  const cmd = COMMANDS[key];
  const usage = (code = 'USAGE') => ({ kind: 'error', cmd: key, code, usage: cmd.usage });

  if (cmd.emote) return { kind: 'emote', name: key };
  switch (key) {
    case 'balance': {
      if (!args.length) return { kind: 'balance' };
      const target = parseTarget(args[0]);
      return target ? { kind: 'balance', target } : { kind: 'balance' };
    }
    case 'fight': case 'armwrestle': {
      let [x, y] = args;
      if (isAmountLike(x) && y && y.startsWith('@')) [x, y] = [y, x];   // "!fight 100 @bob"
      const target = parseTarget(x);
      if (!target) return usage();
      return { kind: key, target, amount: y ? amountTok(y) : null };
    }
    case 'accept': case 'decline': case 'join': case 'show': case 'hide': case 'link':
      return { kind: key };
    case 'slots': case 'cursed': {
      const r = splitRuns(args.slice(0, 3));
      if (!r || r.rest.length !== 1) return usage();
      return { kind: key, amount: amountTok(r.rest[0]), runs: r.runs };
    }
    case 'roulette': {
      const r = splitRuns(args.slice(0, 4), 2);
      if (!r || r.rest.length !== 2) return usage();
      let [x, y] = r.rest;
      if (!isAmountLike(x) && isAmountLike(y)) [x, y] = [y, x];        // "!roulette red 100"
      const pick = parsePick(y);
      return pick ? { kind: 'roulette', amount: amountTok(x), pick, runs: r.runs } : usage();
    }
    case 'flip': {
      let call = null; const others = [];
      for (const tok of args.slice(0, 4)) {
        const c = FLIP_WORDS[tok.toLowerCase()];
        if (c) { if (call) return usage(); call = c; } else others.push(tok);
      }
      const r = splitRuns(others);
      if (!r || r.rest.length !== 1) return usage();
      return { kind: 'flip', amount: amountTok(r.rest[0]), call: call || 'heads', runs: r.runs };
    }
    case 'race': {
      let [x, y] = args;
      if (isAmountLike(x) && y && y.startsWith('@')) [x, y] = [y, x];
      const target = parseTarget(x);
      if (!target) return usage();
      return { kind: 'race', target, amount: y ? amountTok(y) : null };
    }
    case 'grandprix': {
      const a = (args[0] || '').toLowerCase();
      if (!a || a === 'open') return { kind: 'grandprix', op: 'open', fee: null };
      if (a === 'start' || a === 'go') return { kind: 'grandprix', op: 'start', fee: null };
      if (a === 'cancel' || a === 'stop') return { kind: 'grandprix', op: 'cancel', fee: null };
      return isAmountLike(a) ? { kind: 'grandprix', op: 'open', fee: amountTok(a) } : usage();
    }
    case 'royale': {
      const op = { open: 'open', start: 'start', go: 'start', cancel: 'cancel', stop: 'cancel' }[(args[0] || 'open').toLowerCase()];
      return op ? { kind: 'royale', op } : usage();
    }
    case 'heist': {
      const first = args[0] && args[0].toLowerCase();
      if (first === 'start' || first === 'go') return { kind: 'heistOp', op: 'start' };
      if (first === 'cancel' || first === 'stop') return { kind: 'heistOp', op: 'cancel' };
      let amount = null, role = null;
      for (const tok of args.slice(0, 2)) {               // "<amount> [role]" in either order
        const r = ROLE_ALIASES[tok.toLowerCase()];
        if (r) { if (role) return usage(); role = r; }
        else { if (amount) return usage(); amount = amountTok(tok); }
      }
      return { kind: 'heist', amount, role };
    }
    case 'bet': {
      const n = optionNumber(args[0]);
      if (n == null || !args[1]) return usage();
      return { kind: 'bet', n, amount: amountTok(args[1]) };
    }
    case 'predwin': {
      const a = args[0] && args[0].toLowerCase();
      if (a === 'lock' && args.length === 1) return { kind: 'predwin', ns: [], op: 'lock' };
      if (a === 'cancel' && args.length === 1) return { kind: 'predwin', ns: [], op: 'cancel' };
      const ns = args.slice(0, 10).map(optionNumber);
      // every word an option number 1–10, no repeats ("!predwin 2 2" is a typo, not a tie)
      if (!ns.length || args.length > 10 || ns.some((n) => n == null) || new Set(ns).size !== ns.length) return usage();
      return { kind: 'predwin', ns, op: 'resolve' };
    }
    case 'give': case 'take': {
      let [x, y] = args;
      if (x && !x.startsWith('@') && y && y.startsWith('@')) [x, y] = [y, x];
      const target = parseTarget(x);
      if (!target || !y) return usage();
      const amt = parseAmountLiteral(y);
      if (!amt.ok || amt.amount <= 0) return usage('BAD_AMOUNT');
      return { kind: key, target, amount: amt.amount };
    }
    case 'redeem': {
      if (!args.length) return usage();
      return { kind: 'redeem', query: args[0], input: args.slice(1).join(' '), text: args.join(' ') };
    }
    case 'help':
      return args[0] ? { kind: 'help', topic: args[0].toLowerCase().replace(/^!/, '') } : { kind: 'help' };
    default:
      return null;
  }
}

/** The most runs one command can ask for (`!slots 100 5`); the cloud also checks the game's cfg.maxRuns. */
export const MAX_RUNS = 5;
/** Coin-flip calls people type → 'heads' | 'tails'. Heads = Sky's face, tails = the Cosmic Trinity. */
export const FLIP_WORDS = Object.freeze({ heads: 'heads', head: 'heads', h: 'heads', sky: 'heads',
  tails: 'tails', tail: 'tails', t: 'tails', trinity: 'tails', gods: 'tails' });
const RUNS_MARKED = /^(?:[x×](\d{1,2})|(\d{1,2})[x×])$/i;

/**
 * Takes the run count out of a command's words (v1.9). A marked count ("x3", "3x", "×3") may stand anywhere; otherwise a
 * plain number AFTER the first `keep` words is the count ("!slots 100 3", "!roulette 100 red 3"). Default 1 run.
 * @param {string[]} toks
 * @param {number} [keep]  words that come before an unmarked count (the amount, the roulette pick)
 * @returns {{ runs:number, rest:string[] } | null}  null = a count outside 1..MAX_RUNS, or two counts
 */
export function splitRuns(toks, keep = 1) {
  let runs = null; const rest = [];
  for (const tok of toks) {
    const m = RUNS_MARKED.exec(tok);
    if (m) { if (runs != null) return null; runs = Number(m[1] || m[2]); } else rest.push(tok);
  }
  if (runs == null && rest.length === keep + 1 && /^\d{1,2}$/.test(rest[keep])) runs = Number(rest.pop());
  if (runs == null) return { runs: 1, rest };
  return runs >= 1 && runs <= MAX_RUNS ? { runs, rest } : null;
}

/** "#2" / "2" → 2 (1–10), else null. */
function optionNumber(tok) {
  const m = /^#?(\d{1,2})$/.exec(String(tok || ''));
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 10 ? n : null;
}

const RANK = { broadcaster: 3, mod: 2 };
const rankOf = (role) => RANK[role] || 1;
const NEEDS = { everyone: 1, mod: 2, broadcaster: 3 };

/**
 * May someone with this role run this intent? (Opener-only rules like `!heist start` need state; the cloud checks
 * those.) Mods may look up someone else's balance; viewers only their own.
 * @param {Object} intent
 * @param {'viewer'|'follower'|'sub'|'vip'|'mod'|'broadcaster'} role
 */
export function canUse(intent, role) {
  if (!intent || intent.kind === 'error') return true;
  const r = rankOf(role);
  if (intent.kind === 'balance' && intent.target) return r >= NEEDS.mod;
  if (intent.kind === 'heistOp') return intent.op === 'cancel' ? r >= NEEDS.mod : true;
  const key = intent.kind === 'emote' ? intent.name : intent.kind;
  const c = COMMANDS[key];
  return !c || r >= NEEDS[c.who];
}

/** Is this a gambling intent (it needs the stage)? `!join` and `!heist` joins of an open lobby are decided by the cloud. */
export function isGambling(intent) {
  return !!intent && !!(COMMANDS[intent.kind] && COMMANDS[intent.kind].gambling);
}

/**
 * Finds the Dollah reward a `!redeem` means: the longest title that the text starts with (whole words, any case),
 * else the only reward whose title starts with the first word. The rest of the text is the viewer's input.
 * @param {string} text  everything after "!redeem"
 * @param {{ title:string, enabled?:boolean }[]} rewards
 * @returns {{ reward:Object, input:string } | null}
 */
export function matchReward(text, rewards) {
  const t = cleanText(text), low = t.toLowerCase();
  const live = rewards.filter((r) => r.enabled !== false);
  let best = null;
  for (const r of live) {
    const title = cleanText(r.title).toLowerCase();
    if (title && low.startsWith(title) && (low.length === title.length || low[title.length] === ' ') && (!best || title.length > best.len)) {
      best = { reward: r, len: title.length };
    }
  }
  if (best) return { reward: best.reward, input: t.slice(best.len).trim() };
  const first = low.split(' ')[0];
  const cands = first ? live.filter((r) => cleanText(r.title).toLowerCase().startsWith(first)) : [];
  return cands.length === 1 ? { reward: cands[0], input: t.slice(first.length).trim() } : null;
}
