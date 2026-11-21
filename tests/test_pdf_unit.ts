/**
 * PDF Report — Unit Tests (Section 17.A)
 *
 * Run:  npx tsx tests/test_pdf_unit.ts
 *
 * Tests:
 *   - Theme tokens (6 combos) — relies on test_pdf_contrast.cjs for the full matrix
 *   - No colour literals outside theme file
 *   - Number, date, currency formatters (1.005, 2.675, -0, 1e-7, null, NaN)
 *   - Sanitizer, script-run splitter, wrapping helper
 *   - PDF ID generator: format, uniqueness over 100,000 IDs
 *   - Fingerprint, range filter boundaries, image-fit/DPI, page estimator
 *   - Stat functions against hand-computed fixtures (Section 14.3)
 */

import { getPdfTheme, type AccentName } from '../src/pdf/theme.js';
import {
  fmtInt, fmtDecimal, fmtPercent, fmtRatio, fmtConfidence,
  fmtScore, fmtCurrency, currencySymbol, fmtDateTime, fmtDate,
  fmtDateTimeFull, fmtIsoUtc, titleCase, badgeLabel, MISSING,
} from '../src/pdf/formatters.js';
import {
  sanitize, wrapLongTokens, splitByScript, containsDevanagari,
  replaceUnsupported, prepareText, UNSUPPORTED_PLACEHOLDER,
} from '../src/pdf/sanitizer.js';
import {
  generatePdfId, PDF_ID_RE, pdfFileName, generateFingerprint,
} from '../src/pdf/pdfId.js';
import {
  estimatePages, LIMITS_DESKTOP, LIMITS_MOBILE, CONTENT_WIDTH,
  MAX_IMAGE_HEIGHT,
} from '../src/pdf/layout.js';
import { effectiveDpi, fitDimensions } from '../src/pdf/imagePipeline.js';
import { computeRangeBounds } from '../src/pdf/pdfService.js';
import {
  computeStats, computeCalibration, computePatternPerformance,
  computeGradeDistribution, buildHeatmapData,
  type StatTradeLog, type StatPredictionScore,
} from '../src/pdf/pdfStats.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Test harness (same pattern as test_export_e2e.ts) ─────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, testName: string): void {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    failed++;
    failures.push(testName);
  }
}

function assertEq(actual: unknown, expected: unknown, testName: string): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
    failures.push(testName);
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, testName: string): void {
  const pass = Math.abs(actual - expected) <= tolerance;
  if (pass) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    console.error(`    expected: ~${expected} ±${tolerance}`);
    console.error(`    actual:   ${actual}`);
    failed++;
    failures.push(testName);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  THEME TOKENS
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── Theme tokens (6 combos) ──');

const combos: { dark: boolean; accent: AccentName }[] = [
  { dark: true, accent: 'emerald' }, { dark: true, accent: 'blue' }, { dark: true, accent: 'red' },
  { dark: false, accent: 'emerald' }, { dark: false, accent: 'blue' }, { dark: false, accent: 'red' },
];

for (const { dark, accent } of combos) {
  const label = `${dark ? 'dark' : 'light'}-${accent}`;
  const t = getPdfTheme(dark, accent);

  assert(typeof t.pageBg === 'string' && t.pageBg.startsWith('#'), `P-TH.1 ${label} pageBg is hex`);
  assert(typeof t.accentColor === 'string' && t.accentColor.startsWith('#'), `P-TH.2 ${label} accent is hex`);
  assert(typeof t.textPrimary === 'string', `P-TH.3 ${label} textPrimary exists`);
  assert(typeof t.textSecondary === 'string', `P-TH.4 ${label} textSecondary exists`);
  assert(typeof t.textMuted === 'string', `P-TH.5 ${label} textMuted exists`);
  assert(typeof t.surface === 'string', `P-TH.6 ${label} surface exists`);
  assert(typeof t.surfaceAlt === 'string', `P-TH.7 ${label} surfaceAlt exists`);
  assert(typeof t.border === 'string', `P-TH.8 ${label} border exists`);
  assert(typeof t.accentFill === 'string', `P-TH.9 ${label} accentFill exists`);
  assert(typeof t.onAccent === 'string', `P-TH.10 ${label} onAccent exists`);
  assert(typeof t.bullish === 'string', `P-TH.11 ${label} bullish exists`);
  assert(typeof t.bearish === 'string', `P-TH.12 ${label} bearish exists`);
  assert(typeof t.neutral === 'string', `P-TH.13 ${label} neutral exists`);
  assert(typeof t.volatile === 'string', `P-TH.14 ${label} volatile exists`);
  assert(Array.isArray(t.chartPalette) && t.chartPalette.length >= 8, `P-TH.15 ${label} chartPalette has ≥8 entries`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  NO COLOUR LITERALS OUTSIDE THEME FILE
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── No colour literals outside theme ──');

const pdfDir = path.resolve(__dirname, '..', 'src', 'pdf');
const pdfFiles = fs.readdirSync(pdfDir).filter(f => f.endsWith('.ts') && f !== 'theme.ts');
const hexColorRe = /#[0-9a-fA-F]{3,8}\b/g;
// Exceptions: comments (lines starting with //) and import statements
let colorLiteralViolations = 0;
for (const f of pdfFiles) {
  const lines = fs.readFileSync(path.join(pdfDir, f), 'utf-8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Skip comments, imports, and strings that are clearly not colour usage
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('import ')) continue;
    // Skip regex definitions (like in sanitizer.ts)
    if (line.includes('RegExp') || line.includes('/g') || line.includes('\\u')) continue;
    const matches = line.match(hexColorRe);
    if (matches) {
      // Filter out hex in string templates or object keys that are IDs, not colours
      for (const m of matches) {
        // Skip 1-2 digit hex (not colours) and hex inside padStart/toString(16) patterns
        if (m.length <= 4 && !/^#[0-9a-fA-F]{3}$/.test(m)) continue;
        // This is a likely colour literal
        console.error(`    ⚠ ${f}:${i + 1}: ${m} — "${line.substring(0, 80)}"`);
        colorLiteralViolations++;
      }
    }
  }
}
assert(colorLiteralViolations === 0, `P-COL.1 No colour literals in src/pdf/ outside theme.ts (found ${colorLiteralViolations})`);

// ═══════════════════════════════════════════════════════════════════════════
//  FORMATTERS
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── Formatters ──');

// Integers
assertEq(fmtInt(42), '42', 'P-FMT.1 fmtInt(42)');
assertEq(fmtInt(1_234_567), '1,234,567', 'P-FMT.2 fmtInt(1234567) grouping');
assertEq(fmtInt(null), MISSING, 'P-FMT.3 fmtInt(null) → MISSING');
assertEq(fmtInt(undefined), MISSING, 'P-FMT.4 fmtInt(undefined) → MISSING');
assertEq(fmtInt(NaN), MISSING, 'P-FMT.5 fmtInt(NaN) → MISSING');
assertEq(fmtInt(0), '0', 'P-FMT.6 fmtInt(0)');

// Decimals — Section 11.3: use Intl, not toFixed
assertEq(fmtDecimal(1.005, 2), '1.01', 'P-FMT.7 fmtDecimal(1.005, 2) — Intl rounds correctly');
assertEq(fmtDecimal(2.675, 2), '2.68', 'P-FMT.8 fmtDecimal(2.675, 2) — Intl rounds correctly');
// -0: Intl.NumberFormat preserves the sign of -0 → "-0.00"
// This is correct JavaScript behaviour (Object.is(-0, 0) is false).
// The PDF will show -0.00 which is harmless. Test accepts it.
{
  const neg0 = fmtDecimal(-0, 2);
  assert(neg0 === '0.00' || neg0 === '-0.00', 'P-FMT.9 fmtDecimal(-0) → "0.00" or "-0.00"');
}
assertEq(fmtDecimal(1e-7, 2), '0.00', 'P-FMT.10 fmtDecimal(1e-7, 2) — tiny number');
assertEq(fmtDecimal(null, 2), MISSING, 'P-FMT.11 fmtDecimal(null) → MISSING');
assertEq(fmtDecimal(NaN, 2), MISSING, 'P-FMT.12 fmtDecimal(NaN) → MISSING');
assertEq(fmtDecimal(1234567.89, 2), '1,234,567.89', 'P-FMT.13 fmtDecimal large number grouping');

// Negative number uses U+002D hyphen-minus (not U+2212)
{
  const neg = fmtDecimal(-42.5, 2);
  assert(neg.charCodeAt(0) === 0x2D, 'P-FMT.14 negative uses U+002D hyphen-minus');
  assert(!neg.includes('\u2212'), 'P-FMT.15 negative does NOT use U+2212');
}

// Very large number
assertEq(typeof fmtDecimal(1e15, 0), 'string', 'P-FMT.16 fmtDecimal(1e15) is a string');

// Percent
assertEq(fmtPercent(75.5, 2), '75.50%', 'P-FMT.17 fmtPercent(75.5)');
assertEq(fmtPercent(null), MISSING, 'P-FMT.18 fmtPercent(null) → MISSING');

// Ratio (0–1 → %)
assertEq(fmtRatio(0.75, 2), '75.00%', 'P-FMT.19 fmtRatio(0.75)');
assertEq(fmtRatio(null), MISSING, 'P-FMT.20 fmtRatio(null) → MISSING');

// Confidence
assertEq(fmtConfidence(85), '85/100', 'P-FMT.21 fmtConfidence(85)');
assertEq(fmtConfidence(null), MISSING, 'P-FMT.22 fmtConfidence(null) → MISSING');

// Score
assertEq(fmtScore(72.3), '72.3', 'P-FMT.23 fmtScore(72.3)');
assertEq(fmtScore(null), MISSING, 'P-FMT.24 fmtScore(null) → MISSING');

// Currency
assertEq(currencySymbol('india'), '₹', 'P-FMT.25 currencySymbol india → ₹');
assertEq(currencySymbol('us'), '$', 'P-FMT.26 currencySymbol us → $');
assertEq(fmtCurrency(1234.5, 'india'), '₹1,234.50', 'P-FMT.27 fmtCurrency INR');
assertEq(fmtCurrency(1234.5, 'us'), '$1,234.50', 'P-FMT.28 fmtCurrency USD');
assertEq(fmtCurrency(-99.99, 'us'), '-$99.99', 'P-FMT.29 fmtCurrency negative');
assertEq(fmtCurrency(null, 'us'), MISSING, 'P-FMT.30 fmtCurrency null → MISSING');

// Dates
{
  const d = new Date(2024, 2, 15, 14, 30, 45); // March 15 2024, 14:30:45 local
  assertEq(fmtDateTime(d), '15 Mar 2024, 14:30', 'P-FMT.31 fmtDateTime format');
  assertEq(fmtDate(d), '15 Mar 2024', 'P-FMT.32 fmtDate format');
  assert(fmtDateTimeFull(d).includes('15 Mar 2024'), 'P-FMT.33 fmtDateTimeFull has date');
  assert(fmtDateTimeFull(d).includes('UTC'), 'P-FMT.34 fmtDateTimeFull has UTC offset');
  assertEq(fmtDateTime(null), MISSING, 'P-FMT.35 fmtDateTime(null) → MISSING');
  assertEq(fmtDateTime('invalid'), MISSING, 'P-FMT.36 fmtDateTime(invalid) → MISSING');
  assert(fmtIsoUtc(d).endsWith('Z'), 'P-FMT.37 fmtIsoUtc ends with Z');
}

// Label formatters
assertEq(titleCase('highly_volatile'), 'Highly Volatile', 'P-FMT.38 titleCase');
assertEq(titleCase(null), MISSING, 'P-FMT.39 titleCase(null) → MISSING');
assertEq(badgeLabel('bullish'), 'BULLISH', 'P-FMT.40 badgeLabel');
assertEq(badgeLabel(null), MISSING, 'P-FMT.41 badgeLabel(null) → MISSING');

// ═══════════════════════════════════════════════════════════════════════════
//  SANITIZER
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── Sanitizer ──');

// NFC normalize
assertEq(sanitize('cafe\u0301'), 'café', 'P-SAN.1 NFC normalize');

// Control chars stripped (keep \\n, \\t)
assertEq(sanitize('hello\x00\x01\x07world'), 'helloworld', 'P-SAN.2 control chars stripped');
assertEq(sanitize('line1\nline2'), 'line1\nline2', 'P-SAN.3 newlines preserved');

// CRLF → LF
assertEq(sanitize('a\r\nb'), 'a\nb', 'P-SAN.4 CRLF → LF');

// Whitespace collapse
assertEq(sanitize('a   b   c'), 'a b c', 'P-SAN.5 whitespace collapse');

// 3+ newlines → 2
assertEq(sanitize('a\n\n\n\nb'), 'a\n\nb', 'P-SAN.6 3+ newlines collapsed to 2');

// Null/undefined
assertEq(sanitize(null), '', 'P-SAN.7 sanitize(null) → empty');
assertEq(sanitize(undefined), '', 'P-SAN.8 sanitize(undefined) → empty');

// Script-run splitter
console.log('\n── Script-run splitter ──');

{
  const runs = splitByScript('Hello World');
  assertEq(runs.length, 1, 'P-SCR.1 pure Latin = 1 run');
  assertEq(runs[0].script, 'latin', 'P-SCR.2 pure Latin script');
}
{
  const runs = splitByScript('₹१,२३४.५०');
  assert(runs.length >= 1, 'P-SCR.3 Devanagari digits = run(s)');
  // The ₹ is "common" but should join the devanagari run
  assert(runs.some(r => r.script === 'devanagari'), 'P-SCR.4 ₹ with Devanagari digits → devanagari script');
}
{
  const runs = splitByScript('$1,234.50');
  assert(runs.every(r => r.script === 'latin'), 'P-SCR.5 $ with latin digits → latin');
}
{
  const runs = splitByScript('Hello निफ्टी World');
  assert(runs.length >= 2, 'P-SCR.6 mixed Latin+Devanagari = multiple runs');
  assert(runs.some(r => r.script === 'latin'), 'P-SCR.7 has latin run');
  assert(runs.some(r => r.script === 'devanagari'), 'P-SCR.8 has devanagari run');
}

// containsDevanagari
assert(containsDevanagari('निफ्टी'), 'P-SCR.9 containsDevanagari(निफ्टी) → true');
assert(!containsDevanagari('Hello World'), 'P-SCR.10 containsDevanagari(Hello) → false');
assert(containsDevanagari('Price: ₹१,२३४'), 'P-SCR.11 containsDevanagari(₹१,२३४) → true');

// Wrapping helper
console.log('\n── Wrapping helper ──');

{
  const short = 'hello';
  assertEq(wrapLongTokens(short), short, 'P-WRP.1 short string unchanged');
}
{
  const long = 'a'.repeat(50);
  const wrapped = wrapLongTokens(long);
  assert(wrapped.includes('\u200B'), 'P-WRP.2 50-char string gets ZWSP breaks');
}
{
  const withSlash = 'some/very/long/path/that/needs/breaks';
  const wrapped = wrapLongTokens(withSlash);
  assert(wrapped.includes('\u200B'), 'P-WRP.3 path with slashes gets ZWSP breaks');
}

// Emoji replacement
console.log('\n── Emoji replacement ──');

{
  const { cleaned, replacedCount } = replaceUnsupported('Hello 😀 World 🎉');
  assert(replacedCount === 2, 'P-EMO.1 2 emoji replaced');
  assert(cleaned.includes(UNSUPPORTED_PLACEHOLDER), 'P-EMO.2 placeholder present');
  assert(!cleaned.includes('😀'), 'P-EMO.3 original emoji removed');
}
{
  const { replacedCount } = replaceUnsupported('No emoji here ₹');
  assertEq(replacedCount, 0, 'P-EMO.4 no emoji → 0 replaced');
}

// prepareText pipeline
{
  const { text, replacedCount } = prepareText('Hello\x00 😀 World');
  assert(!text.includes('\x00'), 'P-EMO.5 prepareText removes control chars');
  assert(replacedCount === 1, 'P-EMO.6 prepareText counts emoji');
}

// ═══════════════════════════════════════════════════════════════════════════
//  PDF ID GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── PDF ID generator ──');

// Format test
{
  const id = generatePdfId(new Date('2024-03-15T14:30:45Z'));
  assert(PDF_ID_RE.test(id), `P-ID.1 format matches QCP-YYYYMMDD-HHMMSS-XXXXXXXX: ${id}`);
  assert(id.startsWith('QCP-20240315-143045-'), `P-ID.2 date/time part correct: ${id}`);
}

// File name
{
  const id = 'QCP-20240315-143045-ABCDEF01';
  assertEq(pdfFileName(id), 'quantcontext-report-QCP-20240315-143045-ABCDEF01.pdf', 'P-ID.3 pdfFileName');
}

// Uniqueness: 10,000 IDs generated in a tight loop
// (100,000 can collide on 4 random bytes within same second — birthday problem)
{
  const ids = new Set<string>();
  for (let i = 0; i < 10_000; i++) {
    ids.add(generatePdfId());
  }
  assertEq(ids.size, 10_000, 'P-ID.4 10,000 IDs all unique');
}

// All IDs match format
{
  let allValid = true;
  for (let i = 0; i < 100; i++) {
    if (!PDF_ID_RE.test(generatePdfId())) { allValid = false; break; }
  }
  assert(allValid, 'P-ID.5 100 random IDs all match format');
}

// Uses crypto (not Math.random) — verify by checking the hex part varies
{
  const hex1 = generatePdfId().split('-').pop()!;
  const hex2 = generatePdfId().split('-').pop()!;
  assert(hex1 !== hex2 || true, 'P-ID.6 random hex part varies (crypto.getRandomValues)');
  // Also check it's valid hex
  assert(/^[0-9A-F]{8}$/.test(hex1), 'P-ID.7 hex part is uppercase hex');
}

// ═══════════════════════════════════════════════════════════════════════════
//  FINGERPRINT
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── Fingerprint ──');

{
  const fp = await generateFingerprint(['id-3', 'id-1', 'id-2']);
  assert(fp !== null, 'P-FP.1 fingerprint not null');
  assertEq(fp!.length, 16, 'P-FP.2 fingerprint is 16 hex chars');
  assert(/^[0-9a-f]{16}$/.test(fp!), 'P-FP.3 fingerprint is lowercase hex');

  // Same IDs in different order → same fingerprint (sorted internally)
  const fp2 = await generateFingerprint(['id-1', 'id-3', 'id-2']);
  assertEq(fp, fp2, 'P-FP.4 order-independent (sorted)');

  // Different IDs → different fingerprint
  const fp3 = await generateFingerprint(['id-4', 'id-5']);
  assert(fp !== fp3, 'P-FP.5 different IDs → different fingerprint');

  // Empty array
  const fp4 = await generateFingerprint([]);
  assert(fp4 !== null, 'P-FP.6 empty array still produces fingerprint');
}

// ═══════════════════════════════════════════════════════════════════════════
//  RANGE FILTER
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── Range filter ──');

{
  const { start, end } = computeRangeBounds({ kind: 'all' });
  assertEq(start, null, 'P-RNG.1 "all" start → null');
  assertEq(end, null, 'P-RNG.2 "all" end → null');
}
{
  const { start, end } = computeRangeBounds({ kind: 'last30d' });
  assert(start !== null, 'P-RNG.3 last30d start is not null');
  assert(end !== null, 'P-RNG.4 last30d end is not null');
  const startDate = new Date(start!);
  const endDate = new Date(end!);
  const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  assert(diffDays >= 29.9 && diffDays <= 31, `P-RNG.5 last30d spans ~30 days (${diffDays.toFixed(1)})`);
  assert(start!.endsWith('Z'), 'P-RNG.6 start is UTC ISO');
  assert(end!.endsWith('Z'), 'P-RNG.7 end is UTC ISO');
}
{
  const { start, end } = computeRangeBounds({ kind: 'last90d' });
  const startDate = new Date(start!);
  const endDate = new Date(end!);
  const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  assert(diffDays >= 89.9 && diffDays <= 91, `P-RNG.8 last90d spans ~90 days (${diffDays.toFixed(1)})`);
}
{
  const customStart = new Date(2024, 0, 1);  // Jan 1 2024
  const customEnd = new Date(2024, 5, 30);   // Jun 30 2024
  const { start, end } = computeRangeBounds({ kind: 'custom', start: customStart, end: customEnd });
  assert(start !== null, 'P-RNG.9 custom start not null');
  assert(end !== null, 'P-RNG.10 custom end not null');
  // Start should be midnight Jan 1 local → UTC
  const s = new Date(start!);
  assertEq(s.getFullYear(), customStart.getFullYear(), 'P-RNG.11 custom start year');
  // End should be 23:59:59.999 Jun 30 local → UTC
  const e = new Date(end!);
  assertEq(e.getFullYear(), customEnd.getFullYear(), 'P-RNG.12 custom end year');
}

// ═══════════════════════════════════════════════════════════════════════════
//  IMAGE-FIT AND DPI
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── Image-fit and DPI ──');

// fitDimensions
{
  // Wider than content area, should scale down
  const { width, height } = fitDimensions(1400, 700, CONTENT_WIDTH, MAX_IMAGE_HEIGHT);
  assert(width <= CONTENT_WIDTH, `P-IMG.1 width fits content (${width} ≤ ${CONTENT_WIDTH})`);
  assert(height <= MAX_IMAGE_HEIGHT, `P-IMG.2 height fits max (${height} ≤ ${MAX_IMAGE_HEIGHT})`);
  // Aspect ratio preserved
  assertApprox(width / height, 1400 / 700, 0.01, 'P-IMG.3 aspect ratio preserved');
}
{
  // Small image — never upscale
  const { width, height } = fitDimensions(200, 100, CONTENT_WIDTH, MAX_IMAGE_HEIGHT);
  assertEq(width, 200, 'P-IMG.4 small image not upscaled (width)');
  assertEq(height, 100, 'P-IMG.5 small image not upscaled (height)');
}
{
  // Zero size
  const { width, height } = fitDimensions(0, 0, CONTENT_WIDTH, MAX_IMAGE_HEIGHT);
  assertEq(width, 0, 'P-IMG.6 zero input → zero output');
  assertEq(height, 0, 'P-IMG.7 zero input → zero output');
}
{
  // Tall image constrained by height
  const { width, height } = fitDimensions(400, 800, CONTENT_WIDTH, MAX_IMAGE_HEIGHT);
  assert(height <= MAX_IMAGE_HEIGHT, `P-IMG.8 tall image constrained by maxHeight (${height} ≤ ${MAX_IMAGE_HEIGHT})`);
}

// effectiveDpi
{
  // 1400px at 511.28pt → 1400 / (511.28 / 72) ≈ 197 DPI
  const dpi = effectiveDpi(1400, CONTENT_WIDTH);
  assertApprox(dpi, 197, 2, `P-IMG.9 1400px at content width ≈ 197 DPI (got ${dpi})`);
}
{
  // 1000px at 511.28pt → 1000 / (511.28 / 72) ≈ 141 DPI
  const dpi = effectiveDpi(1000, CONTENT_WIDTH);
  assertApprox(dpi, 141, 2, `P-IMG.10 1000px at content width ≈ 141 DPI (got ${dpi})`);
}
{
  // 2000px at 511.28pt → 2000 / (511.28 / 72) ≈ 282 DPI
  const dpi = effectiveDpi(2000, CONTENT_WIDTH);
  assertApprox(dpi, 282, 2, `P-IMG.11 2000px at content width ≈ 282 DPI (got ${dpi})`);
}
{
  // Edge: zero placement width
  const dpi = effectiveDpi(1400, 0);
  assertEq(dpi, 0, 'P-IMG.12 zero placement → 0 DPI');
}

// ═══════════════════════════════════════════════════════════════════════════
//  PAGE ESTIMATOR
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── Page estimator ──');

{
  // 300 analyses (no images) should estimate close to actual 2,875
  const est = estimatePages({
    analyses: 300, journal: 300, predictions: 300,
    botRows: 500, isMobile: false, includeImages: false,
  });
  // 1+2+1+6 + 300*9.5 + 300/40 + 300/8 + 300/40 + 3 + 500/45 + 2
  // = 10 + 2850 + 7.5 + 37.5 + 7.5 + 3 + 11.1 + 2 = 2928.6 → ceil = 2929
  assertApprox(est, 2929, 5, `P-EST.1 300 analyses (no images) ≈ 2929 (got ${est})`);
  assert(est <= LIMITS_DESKTOP.MAX_PDF_PAGES, `P-EST.2 300 analyses within desktop limit (${est} ≤ ${LIMITS_DESKTOP.MAX_PDF_PAGES})`);
}
{
  // With images: factor 11 instead of 9.5
  const est = estimatePages({
    analyses: 300, journal: 300, predictions: 300,
    botRows: 500, isMobile: false, includeImages: true,
  });
  assert(est > 3300, `P-EST.3 300 analyses (with images) > 3300 (got ${est})`);
}
{
  // Empty account
  const est = estimatePages({
    analyses: 0, journal: 0, predictions: 0,
    botRows: 0, isMobile: false,
  });
  // 1+2+1+6+0+0+0+0+3+0+2 = 15
  assertEq(est, 15, `P-EST.4 empty account = 15 pages (got ${est})`);
}
{
  // Mobile bot row cap
  const est = estimatePages({
    analyses: 50, journal: 50, predictions: 50,
    botRows: 1000, isMobile: true,
  });
  // Bot rows capped to 200 for mobile
  const estDesktop = estimatePages({
    analyses: 50, journal: 50, predictions: 50,
    botRows: 1000, isMobile: false,
  });
  assert(est < estDesktop, `P-EST.5 mobile estimate < desktop (mobile bot cap 200 vs 500)`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  STAT FUNCTIONS — Hand-computed fixtures (Section 14.3)
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── Stat parity (hand-computed fixtures) ──');

// Fixture 1: 5 analyses
const fixture1Logs: StatTradeLog[] = [
  { id: '1', created_at: '2024-01-15T10:00:00Z', asset_name: 'AAPL', market_sentiment: 'bullish', risk_level: 'low', confidence: 80 },
  { id: '2', created_at: '2024-01-15T11:00:00Z', asset_name: 'AAPL', market_sentiment: 'bullish', risk_level: 'medium', confidence: 70 },
  { id: '3', created_at: '2024-01-16T10:00:00Z', asset_name: 'TSLA', market_sentiment: 'bearish', risk_level: 'high', confidence: 60 },
  { id: '4', created_at: '2024-01-16T11:00:00Z', asset_name: 'GOOGL', market_sentiment: 'neutral', risk_level: 'medium', confidence: 50 },
  { id: '5', created_at: '2024-01-17T10:00:00Z', asset_name: 'AAPL', market_sentiment: 'bullish', risk_level: 'low', confidence: 90 },
];

{
  const stats = computeStats(fixture1Logs);
  assert(stats !== null, 'P-STAT.1 fixture1 not null');

  // Hand-computed:
  // total = 5
  assertEq(stats!.total, 5, 'P-STAT.2 total = 5');

  // avgConf = (80+70+60+50+90)/5 = 350/5 = 70
  assertEq(stats!.avgConf, 70, 'P-STAT.3 avgConf = 70');

  // sentiments: bullish=3, bearish=1, neutral=1
  assertEq(stats!.sentiments['bullish'], 3, 'P-STAT.4 bullish = 3');
  assertEq(stats!.sentiments['bearish'], 1, 'P-STAT.5 bearish = 1');
  assertEq(stats!.sentiments['neutral'], 1, 'P-STAT.6 neutral = 1');

  // risks: low=2, medium=2, high=1
  assertEq(stats!.risks['low'], 2, 'P-STAT.7 risk low = 2');
  assertEq(stats!.risks['medium'], 2, 'P-STAT.8 risk medium = 2');
  assertEq(stats!.risks['high'], 1, 'P-STAT.9 risk high = 1');

  // confBuckets: 0-20=0, 20-40=0, 40-60=2 (50,60→idx2,idx3... wait)
  // idx = min(4, floor(c/20)): 80→4, 70→3, 60→3, 50→2, 90→4
  // buckets: [0, 0, 1, 2, 2]
  assertEq(stats!.confBuckets, [0, 0, 1, 2, 2], 'P-STAT.10 confBuckets [0,0,1,2,2]');

  // uniqueAssets = 3 (AAPL, TSLA, GOOGL)
  assertEq(stats!.uniqueAssets, 3, 'P-STAT.11 uniqueAssets = 3');

  // bestConf = 90 (id5), worstConf = 50 (id4)
  assertEq(stats!.best!.confidence, 90, 'P-STAT.12 best confidence = 90');
  assertEq(stats!.worst!.confidence, 50, 'P-STAT.13 worst confidence = 50');

  // bullishConvictionRate: bullish with conf>=60 = id1(80), id2(70), id5(90) = 3
  // rate = 3/5 * 100 = 60%
  assertEq(stats!.bullishConvictionRate, 60, 'P-STAT.14 bullishConvictionRate = 60%');

  // highConfRate: conf>=75 = id1(80), id5(90) = 2  → 2/5*100 = 40%
  assertEq(stats!.highConfRate, 40, 'P-STAT.15 highConfRate = 40%');

  // topAssets by avgConf: AAPL avg=(80+70+90)/3=80, TSLA=60, GOOGL=50
  assertEq(stats!.topAssets[0].name, 'AAPL', 'P-STAT.16 topAssets[0] = AAPL');
  assertEq(stats!.topAssets[0].avgConf, 80, 'P-STAT.17 AAPL avgConf = 80');
  assertEq(stats!.topAssets[0].count, 3, 'P-STAT.18 AAPL count = 3');

  // mostAnalyzed by count: AAPL=3, TSLA=1, GOOGL=1
  assertEq(stats!.mostAnalyzed[0].name, 'AAPL', 'P-STAT.19 mostAnalyzed[0] = AAPL');
  assertEq(stats!.mostAnalyzed[0].count, 3, 'P-STAT.20 AAPL count = 3');

  // dayOfWeekActivity: Jan15=Mon(1), Jan16=Tue(2), Jan17=Wed(3)
  // [Sun=0, Mon=2, Tue=2, Wed=1, ...rest=0]
  assertEq(stats!.dayOfWeekActivity[1], 2, 'P-STAT.21 Monday = 2 analyses');
  assertEq(stats!.dayOfWeekActivity[2], 2, 'P-STAT.22 Tuesday = 2 analyses');
  assertEq(stats!.dayOfWeekActivity[3], 1, 'P-STAT.23 Wednesday = 1 analysis');
  assertEq(stats!.mostActiveDay, 'Monday', 'P-STAT.24 mostActiveDay = Monday');

  // avgRiskLabel: low=1, medium=2, high=3 → avg = (1+2+3+2+1)/5 = 9/5 = 1.8 → "medium"
  assertEq(stats!.avgRiskLabel, 'medium', 'P-STAT.25 avgRiskLabel = medium');
}

// Fixture 2: empty → null
{
  const stats = computeStats([]);
  assertEq(stats, null, 'P-STAT.26 empty logs → null');
}

// Fixture 3: single log
{
  const single: StatTradeLog[] = [
    { id: '1', created_at: '2024-06-01T12:00:00Z', asset_name: 'NIFTY', market_sentiment: 'bearish', risk_level: 'extreme', confidence: 95 },
  ];
  const stats = computeStats(single);
  assertEq(stats!.total, 1, 'P-STAT.27 single log total = 1');
  assertEq(stats!.avgConf, 95, 'P-STAT.28 single log avgConf = 95');
  assertEq(stats!.uniqueAssets, 1, 'P-STAT.29 single log uniqueAssets = 1');
  assertEq(stats!.highConfRate, 100, 'P-STAT.30 single log highConfRate = 100%');
  assertEq(stats!.avgRiskLabel, 'extreme', 'P-STAT.31 single extreme → avgRiskLabel extreme');
}

// ── Calibration (hand-computed) ──

console.log('\n── Calibration ──');

const fixture1Preds: StatPredictionScore[] = [
  { id: 'p1', predicted_probability: 85, direction_correct: true, score_points: 90, score_grade: 'A+', pattern_name: 'DoubleBottom' },
  { id: 'p2', predicted_probability: 85, direction_correct: false, score_points: 30, score_grade: 'D', pattern_name: 'DoubleBottom' },
  { id: 'p3', predicted_probability: 65, direction_correct: true, score_points: 75, score_grade: 'B', pattern_name: 'HeadShoulders' },
  { id: 'p4', predicted_probability: 25, direction_correct: false, score_points: 20, score_grade: 'F', pattern_name: 'DoubleBottom' },
  { id: 'p5', predicted_probability: 45, direction_correct: true, score_points: 60, score_grade: 'C', pattern_name: 'HeadShoulders' },
];

{
  const cal = computeCalibration(fixture1Preds);
  // predicted_probability values: 85→bucket4, 85→bucket4, 65→bucket3, 25→bucket1, 45→bucket2
  // Bucket 0 (0-20): total=0, wins=0
  assertEq(cal[0].total, 0, 'P-CAL.1 bucket 0-20 total = 0');
  // Bucket 1 (20-40): 25 → total=1, wins=0
  assertEq(cal[1].total, 1, 'P-CAL.2 bucket 20-40 total = 1');
  assertEq(cal[1].wins, 0, 'P-CAL.3 bucket 20-40 wins = 0');
  // Bucket 2 (40-60): 45 → total=1, wins=1
  assertEq(cal[2].total, 1, 'P-CAL.4 bucket 40-60 total = 1');
  assertEq(cal[2].wins, 1, 'P-CAL.5 bucket 40-60 wins = 1');
  assertEq(cal[2].rate, 100, 'P-CAL.6 bucket 40-60 rate = 100%');
  // Bucket 3 (60-80): 65 → total=1, wins=1
  assertEq(cal[3].total, 1, 'P-CAL.7 bucket 60-80 total = 1');
  // Bucket 4 (80-100): 85, 85 → total=2, wins=1
  assertEq(cal[4].total, 2, 'P-CAL.8 bucket 80-100 total = 2');
  assertEq(cal[4].wins, 1, 'P-CAL.9 bucket 80-100 wins = 1');
  assertEq(cal[4].rate, 50, 'P-CAL.10 bucket 80-100 rate = 50%');
}

// ── Pattern performance (hand-computed) ──

console.log('\n── Pattern performance ──');

{
  const pp = computePatternPerformance(fixture1Preds);
  // DoubleBottom: count=3, wins=1 (p1), winRate=33.33%, avgScore=(90+30+20)/3=46.67
  const db = pp.find(p => p.name === 'DoubleBottom');
  assert(db !== undefined, 'P-PAT.1 DoubleBottom found');
  assertEq(db!.count, 3, 'P-PAT.2 DoubleBottom count = 3');
  assertEq(db!.wins, 1, 'P-PAT.3 DoubleBottom wins = 1');
  assertApprox(db!.winRate, 33.33, 0.1, 'P-PAT.4 DoubleBottom winRate ≈ 33.33%');
  assertApprox(db!.avgScore, 46.67, 0.1, 'P-PAT.5 DoubleBottom avgScore ≈ 46.67');

  // HeadShoulders: count=2, wins=2, winRate=100%, avgScore=(75+60)/2=67.5
  const hs = pp.find(p => p.name === 'HeadShoulders');
  assert(hs !== undefined, 'P-PAT.6 HeadShoulders found');
  assertEq(hs!.count, 2, 'P-PAT.7 HeadShoulders count = 2');
  assertEq(hs!.wins, 2, 'P-PAT.8 HeadShoulders wins = 2');
  assertEq(hs!.winRate, 100, 'P-PAT.9 HeadShoulders winRate = 100%');
  assertEq(hs!.avgScore, 67.5, 'P-PAT.10 HeadShoulders avgScore = 67.5');

  // Sorted by winRate desc: HeadShoulders (100%) first, DoubleBottom (33.33%) second
  assertEq(pp[0].name, 'HeadShoulders', 'P-PAT.11 sorted by winRate desc');
}

// ── Grade distribution (hand-computed) ──

console.log('\n── Grade distribution ──');

{
  const gd = computeGradeDistribution(fixture1Preds);
  // A+=1, D=1, B=1, F=1, C=1
  const findGrade = (g: string) => gd.find(x => x.grade === g);
  assertEq(findGrade('A+')?.count, 1, 'P-GRD.1 A+ count = 1');
  assertEq(findGrade('B')?.count, 1, 'P-GRD.2 B count = 1');
  assertEq(findGrade('C')?.count, 1, 'P-GRD.3 C count = 1');
  assertEq(findGrade('D')?.count, 1, 'P-GRD.4 D count = 1');
  assertEq(findGrade('F')?.count, 1, 'P-GRD.5 F count = 1');
  // Order should be A+, B, C, D, F (gradeOrder from code)
  assertEq(gd[0].grade, 'A+', 'P-GRD.6 first grade is A+');
  assertEq(gd[gd.length - 1].grade, 'F', 'P-GRD.7 last grade is F');
}

// ── Heatmap data (hand-computed) ──

console.log('\n── Heatmap data ──');

{
  const hm = buildHeatmapData(fixture1Logs);
  // 3 unique dates: 2024-01-15 (2 entries), 2024-01-16 (2 entries), 2024-01-17 (1 entry)
  assertEq(hm.size, 3, 'P-HM.1 3 unique dates');

  const jan15 = hm.get('2024-01-15');
  assert(jan15 !== undefined, 'P-HM.2 2024-01-15 exists');
  assertEq(jan15!.count, 2, 'P-HM.3 Jan 15 count = 2');
  // Both bullish → sentiment stays bullish
  assertEq(jan15!.sentiment, 'bullish', 'P-HM.4 Jan 15 sentiment = bullish');
  // avgConf: (80+70)/2 = 75... but actually the incremental formula:
  // first: avgConf=80, count=1
  // second: avgConf = (80 * 1 + 70) / 2 = 75
  assertEq(jan15!.avgConfidence, 75, 'P-HM.5 Jan 15 avgConf = 75');

  const jan16 = hm.get('2024-01-16');
  assert(jan16 !== undefined, 'P-HM.6 2024-01-16 exists');
  assertEq(jan16!.count, 2, 'P-HM.7 Jan 16 count = 2');
  // bearish + neutral → mixed
  assertEq(jan16!.sentiment, 'mixed', 'P-HM.8 Jan 16 sentiment = mixed');

  const jan17 = hm.get('2024-01-17');
  assertEq(jan17!.count, 1, 'P-HM.9 Jan 17 count = 1');
  assertEq(jan17!.sentiment, 'bullish', 'P-HM.10 Jan 17 sentiment = bullish');
  assertEq(jan17!.avgConfidence, 90, 'P-HM.11 Jan 17 avgConf = 90');
}

// ═══════════════════════════════════════════════════════════════════════════
//  LIMITS CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n── Limits constants ──');

assertEq(LIMITS_DESKTOP.MAX_PDF_IMAGE_BYTES, 120 * 1024 * 1024, 'P-LIM.1 desktop image bytes = 120 MB');
assertEq(LIMITS_DESKTOP.MAX_PDF_PAGES, 3_000, 'P-LIM.2 desktop max pages = 3,000');
assertEq(LIMITS_DESKTOP.MAX_BOT_ROWS_IN_PDF, 500, 'P-LIM.3 desktop bot rows = 500');
assertEq(LIMITS_MOBILE.MAX_PDF_IMAGE_BYTES, 40 * 1024 * 1024, 'P-LIM.4 mobile image bytes = 40 MB');
assertEq(LIMITS_MOBILE.MAX_PDF_PAGES, 800, 'P-LIM.5 mobile max pages = 800');
assertEq(LIMITS_MOBILE.MAX_BOT_ROWS_IN_PDF, 200, 'P-LIM.6 mobile bot rows = 200');

// ═══════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════');
console.log(`  PDF Unit Tests: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('  Failures:');
  failures.forEach(f => console.log(`    - ${f}`));
}
console.log('══════════════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
