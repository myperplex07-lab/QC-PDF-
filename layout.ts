// src/pdf/layout.ts
// ─────────────────────────────────────────────────────────────────────────
// ALL page measurements live here. No size or spacing literals elsewhere
// in src/pdf/. Values from prompt Section 10.1.
// ─────────────────────────────────────────────────────────────────────────

// ── Page ─────────────────────────────────────────────────────────────────

/** A4 portrait in points (210 × 297 mm). */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

/** Margins: [left, top, right, bottom]. */
export const MARGINS = {
  left: 42,
  top: 64,
  right: 42,
  bottom: 56,
} as const;

/** Usable content area. */
export const CONTENT_WIDTH = PAGE_WIDTH - MARGINS.left - MARGINS.right; // 511.28 pt
export const CONTENT_HEIGHT = PAGE_HEIGHT - MARGINS.top - MARGINS.bottom; // 721.89 pt

// ── Two-column layout ────────────────────────────────────────────────────

export const COLUMN_GUTTER = 14; // pt
export const COLUMN_WIDTH = (CONTENT_WIDTH - COLUMN_GUTTER) / 2; // 248.64 pt

// ── Spacing scale ────────────────────────────────────────────────────────

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// ── Type scale ───────────────────────────────────────────────────────────

export const FONT_SIZE = {
  coverTitle: 30,
  h1: 20,
  h2: 14,
  h3: 11,
  body: 9.5,
  table: 8.5,
  caption: 8,
  footer: 7.5,
  /** Absolute minimum — nothing below this. */
  min: 7.5,
} as const;

/** Line height multiplier. */
export const LINE_HEIGHT = 1.3;

// ── Tables ───────────────────────────────────────────────────────────────

export const TABLE_CELL_PADDING = {
  horizontal: 6,  // left and right
  vertical: 4,    // top and bottom
} as const;

/** Table line width in points. */
export const TABLE_LINE_WIDTH = 0.5;

// ── Cards and borders ────────────────────────────────────────────────────

/** Border width for image cards, info boxes. */
export const CARD_BORDER_WIDTH = 0.75;

// ── Images ───────────────────────────────────────────────────────────────

/** Max height for stacked chart images. */
export const MAX_IMAGE_HEIGHT = 250;

/** Caption height below each image card. */
export const IMAGE_CAPTION_GAP = 8;

// ── Header and footer ────────────────────────────────────────────────────

/** Small logo in running header (height in points). */
export const HEADER_LOGO_HEIGHT = 17; // 16–18 pt range, centered

/** Cover logo height. */
export const COVER_LOGO_HEIGHT = 52; // 48–56 pt range

/** Hairline under header / above footer. */
export const HEADER_FOOTER_LINE_WIDTH = 0.5;

// ── Accent band on cover ─────────────────────────────────────────────────

export const COVER_ACCENT_BAND_HEIGHT = 6;

// ── Text limits ──────────────────────────────────────────────────────────

/** Max characters in a single text field before truncation (Section 11.1). */
export const MAX_TEXT_FIELD_CHARS = 8_000;

/** Threshold for switching a cell to a paragraph block (Section 10.4). */
export const CELL_TO_PARAGRAPH_THRESHOLD = 1_200;

// ── Limits (measured — Section 15) ───────────────────────────────────────
//
// Measured with test_pdf_perf.mjs (Section 15.3):
//   Run A (300 analyses, no images, 300 journal, 500 bot rows):
//     Pages: 2,875 — Time: 59 s — Peak RSS: 1,625 MB — PDF: 22.3 MB
//   Run B (1,000 analyses): OOM on 8 GB machine
//
// Desktop limit raised from the starting 2,500 to 3,000 to accommodate
// 300-analysis reports.  Mobile stays at 800 (devices have ≤ 4 GB RAM).
// Peak RSS 1,625 MB is acceptable for desktops with ≥ 8 GB.
// The Web Worker (pdfWorker.ts) keeps the UI responsive during the
// 55 s pdfmake layout (longest sync block moved off main thread).

export const LIMITS_DESKTOP = {
  MAX_PDF_IMAGE_BYTES: 120 * 1024 * 1024,  // 120 MB
  MAX_PDF_PAGES: 3_000,
  MAX_BOT_ROWS_IN_PDF: 500,
} as const;

export const LIMITS_MOBILE = {
  MAX_PDF_IMAGE_BYTES: 40 * 1024 * 1024,   // 40 MB
  MAX_PDF_PAGES: 800,
  MAX_BOT_ROWS_IN_PDF: 200,
} as const;

/** Image quality presets (Section 13). */
export const IMAGE_QUALITY = {
  smaller: { maxWidth: 1000, jpegQuality: 0.70, label: 'Smaller file' },
  standard: { maxWidth: 1400, jpegQuality: 0.82, label: 'Standard' },
  high: { maxWidth: 2000, jpegQuality: 0.92, label: 'High quality' },
} as const;

export type ImageQualityKey = keyof typeof IMAGE_QUALITY;

// ── Page estimator (measured — Section 15) ───────────────────────────────

/**
 * Estimate total pages from record counts.
 *
 * The prompt's starting formula used 2.5 pages per analysis.
 * Measurement with realistic ~27.5 KB full_result fixtures shows ~9.5
 * pages per analysis (without images).  With two chart images this rises
 * to about 10–11 pages.  We use 9.5 (no images) or 11 (with images) and
 * let the caller pass includeImages to pick the right factor.
 *
 * Measured basis (Run A, 300 analyses, no images):
 *   Total 2,875 pages — fixed overhead ~72 — analysis pages ~2,803
 *   → 2,803 / 300 ≈ 9.3, rounded up to 9.5 for safety.
 */
export function estimatePages(counts: {
  analyses: number;
  journal: number;
  predictions: number;
  botRows: number;
  isMobile: boolean;
  includeImages?: boolean;
}): number {
  const maxBot = counts.isMobile ? LIMITS_MOBILE.MAX_BOT_ROWS_IN_PDF : LIMITS_DESKTOP.MAX_BOT_ROWS_IN_PDF;
  const cappedBot = Math.min(counts.botRows, maxBot);
  const perAnalysis = counts.includeImages ? 11 : 9.5;

  return Math.ceil(
    1                                   // cover
    + 2                                 // contents
    + 1                                 // overview
    + 6                                 // statistics
    + counts.analyses * perAnalysis     // analysis pages (measured)
    + counts.analyses / 40              // index table
    + counts.journal / 8                // journal
    + counts.predictions / 40           // prediction scores
    + 3                                 // small sections (watchlist, alerts, presets)
    + cappedBot / 45                    // bot signals
    + 2                                 // appendix
  );
}

/** Detect mobile using best-available signals. */
export function detectMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  // navigator.userAgentData?.mobile (Section 15)
  if ((navigator as any).userAgentData?.mobile) return true;
  // Fallback: user agent string
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  // navigator.deviceMemory hint (Chrome only)
  if ((navigator as any).deviceMemory && (navigator as any).deviceMemory < 4) return true;
  return false;
}

/** Get the appropriate limits for the current device. */
export function getLimits(isMobile: boolean) {
  return isMobile ? LIMITS_MOBILE : LIMITS_DESKTOP;
}
