// Number and time formatting shared by chat lines, help text and UIs. Locale-independent on purpose (same output on the
// VPS, in OBS and in every browser).

/** The currency's full name. Sky (2026-10-30): user-facing text always says "Pepe's Silvia Dollahs", never a short form. */
export const PSD = "Pepe's Silvia Dollahs";

/** "1,234 Pepe's Silvia Dollahs" (1 → "1 Pepe's Silvia Dollah"; -1 → "unlimited Pepe's Silvia Dollahs"). */
export function psd(n) {
  if (n === -1 || n === Infinity) return 'unlimited ' + PSD;
  return fmt(n) + ' ' + (n === 1 ? "Pepe's Silvia Dollah" : PSD);
}

/**
 * Thousands-grouped integer: 1234567 → "1,234,567". -1 (the infinite playtest balance) → "∞".
 * @param {number} n
 */
export function fmt(n) {
  if (n === -1 || n === Infinity) return '∞';
  if (!Number.isFinite(n)) return '0';
  const neg = n < 0, s = String(Math.trunc(Math.abs(n)));
  return (neg ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * A short wait: "45s", "1m 20s", "3m". Always at least "1s".
 * @param {number} ms
 */
export function fmtWait(ms) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

/**
 * 'YYYY-MM-DD' (UTC) of a ms timestamp, without Date (core has no clock or Date: pure civil-from-days arithmetic).
 * @param {number} ms
 */
export function isoDay(ms) {
  const z = Math.floor(ms / 86400000) + 719468, era = Math.floor(z / 146097), doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)), mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp < 10 ? mp + 3 : mp - 9, y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Days since 1970-01-01 of a 'YYYY-MM-DD' (inverse of isoDay). */
export function dayNumber(day) {
  const [y0, m, d] = String(day).split('-').map(Number), y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400), yoe = y - era * 400, doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
}
