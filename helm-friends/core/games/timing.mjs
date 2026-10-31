// Spreading a show's events over a target duration (used by fights and the royale).

/**
 * Integer gaps, one per weight, each in [lo, hi], summing to at most `budget` (exactly `budget` whenever the bounds
 * allow it). Proportional to the weights first, then nudged until the sum fits.
 * @param {number[]} weights  > 0
 * @param {number} budget     ms
 * @param {number} lo
 * @param {number} hi
 * @returns {number[]}
 */
export function fitGaps(weights, budget, lo, hi) {
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  const g = weights.map((w) => Math.min(hi, Math.max(lo, Math.round((budget * w) / total))));
  let diff = budget - g.reduce((s, x) => s + x, 0);
  while (diff !== 0) {
    const idx = g.map((x, i) => i).filter((i) => (diff > 0 ? g[i] < hi : g[i] > lo));
    if (!idx.length) break;
    const step = Math.trunc(diff / idx.length) || Math.sign(diff);
    for (const i of idx) {
      if (diff === 0) break;
      const want = Math.abs(step) > Math.abs(diff) ? diff : step;
      const next = Math.min(hi, Math.max(lo, g[i] + want));
      diff -= next - g[i];
      g[i] = next;
    }
  }
  return g;
}

/** Running sum: [a, b, c] → [a, a+b, a+b+c]. */
export function cumulative(xs) {
  let s = 0;
  return xs.map((x) => (s += x));
}
