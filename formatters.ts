// src/pdf/formatters.ts
// ─────────────────────────────────────────────────────────────────────────
// Number, date, and currency formatters for the PDF report.
// Section 11.3 of the prompt.
//
// Rules:
// - Use Intl.NumberFormat with explicit fraction digits (not toFixed)
// - Half-away-from-zero rounding (Intl default)
// - Right currency per market (₹ for NSE/india, $ for US)
// - Missing → "—"
// - Negative numbers: plain hyphen-minus U+002D (not U+2212)
// - Positive/negative P&L also use bullish/bearish colours (handled
//   at the section level, not here)
// ─────────────────────────────────────────────────────────────────────────

/** The em-dash used for missing/null values. */
export const MISSING = '—';

/** Market source type matching App.tsx:1423. */
export type MarketSource = 'us' | 'india';

// ─────────────────────────────────────────────────────────────────────────
// Number formatters using Intl (avoids toFixed binary-double issues)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Format an integer. Returns MISSING for null/undefined/NaN.
 */
export function fmtInt(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return MISSING;
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(Math.round(value));
}

/**
 * Format a decimal number with explicit fraction digits.
 * @param fractionDigits min and max fraction digits (default 2).
 */
export function fmtDecimal(
  value: number | null | undefined,
  fractionDigits: number = 2,
): string {
  if (value == null || isNaN(value)) return MISSING;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: true,
  }).format(value);
  // Intl may produce U+2212 for negatives; replace with hyphen-minus
  return formatted.replace('\u2212', '-');
}

/**
 * Format a percentage value. The input is already a percentage number
 * (e.g. 75.5 → "75.50%"), NOT a ratio.
 */
export function fmtPercent(
  value: number | null | undefined,
  fractionDigits: number = 2,
): string {
  if (value == null || isNaN(value)) return MISSING;
  return fmtDecimal(value, fractionDigits) + '%';
}

/**
 * Format a ratio as percentage (e.g. 0.75 → "75.00%").
 * Used for fields like predicted_probability (0–1 range).
 */
export function fmtRatio(
  value: number | null | undefined,
  fractionDigits: number = 2,
): string {
  if (value == null || isNaN(value)) return MISSING;
  return fmtPercent(value * 100, fractionDigits);
}

/**
 * Format a confidence score (0–100 range).
 * Shows as integer with /100 suffix.
 */
export function fmtConfidence(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return MISSING;
  return `${Math.round(value)}/100`;
}

/**
 * Format a prediction score (0–100 points range).
 */
export function fmtScore(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return MISSING;
  return fmtDecimal(value, 1);
}

// ─────────────────────────────────────────────────────────────────────────
// Currency formatting
// ─────────────────────────────────────────────────────────────────────────

/** Currency symbol per market. */
export function currencySymbol(market: MarketSource): string {
  return market === 'india' ? '₹' : '$';
}

/**
 * Format a currency amount with the right symbol.
 * @param value The amount.
 * @param market 'us' or 'india' for $ or ₹.
 * @param fractionDigits Decimal places (default 2).
 */
export function fmtCurrency(
  value: number | null | undefined,
  market: MarketSource,
  fractionDigits: number = 2,
): string {
  if (value == null || isNaN(value)) return MISSING;
  const sym = currencySymbol(market);
  const num = fmtDecimal(Math.abs(value), fractionDigits);
  const sign = value < 0 ? '-' : '';
  return `${sign}${sym}${num}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Date/time formatting (Section 9.6)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Format a date as "DD MMM YYYY, HH:mm" in the user's local time zone.
 * Section 9.6: table times use this format.
 */
export function fmtDateTime(
  value: string | number | Date | null | undefined,
): string {
  if (value == null) return MISSING;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return MISSING;

  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTH_NAMES[d.getMonth()];
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');

  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Format a date as "DD MMM YYYY" (no time).
 */
export function fmtDate(
  value: string | number | Date | null | undefined,
): string {
  if (value == null) return MISSING;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return MISSING;

  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTH_NAMES[d.getMonth()];
  const year = d.getFullYear();

  return `${day} ${month} ${year}`;
}

/**
 * Full date with time zone for the cover/appendix (Section 9.6).
 * "DD MMM YYYY, HH:mm:ss TZ (UTC±HH:MM)"
 */
export function fmtDateTimeFull(date?: Date): string {
  const d = date ?? new Date();
  const base = fmtDateTime(d);
  const seconds = String(d.getSeconds()).padStart(2, '0');

  // Time zone name
  const tzName = Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
    .formatToParts(d)
    .find(p => p.type === 'timeZoneName')?.value ?? '';

  // UTC offset
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absOffset = Math.abs(offset);
  const hh = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const mm = String(absOffset % 60).padStart(2, '0');
  const utcOffset = `UTC${sign}${hh}:${mm}`;

  return `${base}:${seconds} ${tzName} (${utcOffset})`;
}

/**
 * ISO 8601 UTC string for the appendix.
 */
export function fmtIsoUtc(date?: Date): string {
  return (date ?? new Date()).toISOString();
}

/**
 * Get the user's time zone name (e.g. "Asia/Kolkata").
 */
export function getUserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'Unknown';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Label formatters
// ─────────────────────────────────────────────────────────────────────────

/**
 * Title-case a snake_case or lowercase string.
 * "highly_volatile" → "Highly Volatile"
 */
export function titleCase(value: string | null | undefined): string {
  if (!value) return MISSING;
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Uppercase label for badges.
 * "bullish" → "BULLISH"
 */
export function badgeLabel(value: string | null | undefined): string {
  if (!value) return MISSING;
  return value.replace(/_/g, ' ').toUpperCase();
}
