// Coin rain sizing (DESIGN §8.8): the number of 3D Dollah coins is proportional to the win, capped for performance.
// Very big wins add extra waves so they still feel bigger.

export const COIN_RAIN = Object.freeze({
  perCoin: 10,        // one coin per 10 Dollahs won
  minCoins: 8,
  maxCoins: 300,
  bigWin: 3000,       // above this, extra waves start
  waveCoins: 150,
  waveEvery: 3000,    // one more wave per 3,000 Dollahs above bigWin
  maxExtraWaves: 3,   // up to 4 waves in total
  waveGapMs: 600,
  rainMs: 2400,       // how long one wave keeps launching coins
});

/**
 * Coins in the first wave: clamp(round(win / 10), 8, 300). 0 for no win.
 * @param {number} win  Dollahs won (profit or payout, the caller decides; games use the payout)
 */
export function coinRainCount(win) {
  if (!(win > 0)) return 0;
  return Math.max(COIN_RAIN.minCoins, Math.min(COIN_RAIN.maxCoins, Math.round(win / COIN_RAIN.perCoin)));
}

/**
 * Every wave of a coin rain: [{ count, delayMs }]. One wave up to 3,000 Dollahs; then +1 wave of 150 coins per
 * further 3,000, at most 4 waves.
 * @param {number} win
 * @returns {{ count:number, delayMs:number }[]}
 */
export function coinRainWaves(win) {
  const first = coinRainCount(win);
  if (!first) return [];
  const waves = [{ count: first, delayMs: 0 }];
  const extra = win > COIN_RAIN.bigWin ? Math.min(COIN_RAIN.maxExtraWaves, Math.ceil((win - COIN_RAIN.bigWin) / COIN_RAIN.waveEvery)) : 0;
  for (let i = 1; i <= extra; i++) waves.push({ count: COIN_RAIN.waveCoins, delayMs: i * COIN_RAIN.waveGapMs });
  return waves;
}
