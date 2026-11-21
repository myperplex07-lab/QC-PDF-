// src/pdf/sections/cover.ts
// ─────────────────────────────────────────────────────────────────────────
// Cover page — Section 10.7 of the prompt.
// Full-bleed bg, accent band, logo, title, info table, dataset counts,
// confidentiality line, PIN notice.
// ─────────────────────────────────────────────────────────────────────────

import type { DocBuilderContext, BuildWarnings } from '../docBuilder';
import {
  PAGE_WIDTH, CONTENT_WIDTH, MARGINS,
  COVER_LOGO_HEIGHT, COVER_ACCENT_BAND_HEIGHT,
  FONT_SIZE, SPACING,
} from '../layout';
import { ACCENT_LABELS } from '../theme';
import { fmtDateTimeFull, fmtInt, MISSING } from '../formatters';
import { sanitize } from '../sanitizer';

/** Build the cover page content array. */
export function buildCoverSection(ctx: DocBuilderContext, warnings: BuildWarnings): any[] {
  const { theme, pdfId, userId, generatedAt, timeZone, data, counts, options } = ctx;

  // ── Logo ───────────────────────────────────────────────────────────────
  let logo: any;
  try {
    const color = theme.accentColor;
    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${COVER_LOGO_HEIGHT}" height="${COVER_LOGO_HEIGHT}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
      <line x1="2" y1="2" x2="6" y2="6"/>
    </svg>`;
    logo = { svg: svgStr, width: COVER_LOGO_HEIGHT, height: COVER_LOGO_HEIGHT, margin: [0, 0, 0, SPACING.md] };
  } catch {
    warnings.logoFailed = true;
    // Fallback: text wordmark
    logo = {
      text: 'QC',
      fontSize: COVER_LOGO_HEIGHT * 0.6,
      bold: true,
      color: theme.accentColor,
      margin: [0, 0, 0, SPACING.md],
    };
  }

  // ── Range label ────────────────────────────────────────────────────────
  let rangeLabel: string;
  switch (options.range.kind) {
    case 'all':     rangeLabel = 'All time'; break;
    case 'last12m': rangeLabel = 'Last 12 months'; break;
    case 'last90d': rangeLabel = 'Last 90 days'; break;
    case 'last30d': rangeLabel = 'Last 30 days'; break;
    case 'custom': {
      const s = options.range.start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const e = options.range.end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      rangeLabel = `${s} – ${e}`;
      break;
    }
  }

  // ── Info table (2-column key-value) ────────────────────────────────────
  const infoRows = [
    ['User ID', sanitize(userId)],
    ['PDF ID', pdfId],
    ['Generated', fmtDateTimeFull(generatedAt)],
    ['Time zone', timeZone],
    ['Theme', theme.label],
    ['Range', rangeLabel],
    ['Report version', '1'],
  ];

  const infoTable = {
    table: {
      headerRows: 0,
      widths: [120, '*'],
      body: infoRows.map(([key, val]) => [
        { text: key, fontSize: FONT_SIZE.body, color: theme.textSecondary, bold: true },
        { text: val, fontSize: FONT_SIZE.body, color: theme.textPrimary },
      ]),
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0,
      hLineColor: () => theme.border,
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    margin: [0, SPACING.lg, 0, SPACING.lg],
  };

  // ── Dataset counts table ───────────────────────────────────────────────
  const countRows: [string, string][] = [
    ['Audit Trail (analyses)', fmtInt(counts.auditTrail)],
    ['Trade Journal', fmtInt(counts.journal)],
    ['Prediction Scores', fmtInt(counts.predictions)],
    ['Watchlist', fmtInt(counts.watchlist)],
    ['Context Presets', fmtInt(counts.contextPresets)],
    ['Bot Signals', fmtInt(counts.botSignals)],
    ['Price Alerts', fmtInt(counts.priceAlerts)],
  ];

  const countsTable = {
    table: {
      headerRows: 1,
      widths: ['*', 80],
      body: [
        [
          { text: 'Dataset', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
          { text: 'Records', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
        ],
        ...countRows.map(([name, cnt]) => [
          { text: name, fontSize: FONT_SIZE.table, color: theme.textPrimary },
          { text: cnt, fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
        ]),
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => theme.border,
      vLineColor: () => theme.border,
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 4,
      paddingBottom: () => 4,
      fillColor: (rowIndex: number) => {
        if (rowIndex === 0) return theme.accentFill;
        return rowIndex % 2 === 0 ? theme.surface : theme.surfaceAlt;
      },
    },
    margin: [0, 0, 0, SPACING.lg],
  };

  // ── Accent band at the top (full-bleed, inside background) ─────────────
  const accentBand = {
    canvas: [{
      type: 'rect' as const,
      x: -MARGINS.left,
      y: 0,
      w: PAGE_WIDTH,
      h: COVER_ACCENT_BAND_HEIGHT,
      color: theme.accentColor,
    }],
    margin: [0, 0, 0, SPACING.xxl],
  };

  return [
    // Accent band
    accentBand,

    // Logo
    { alignment: 'center' as const, ...logo },

    // Title
    {
      text: 'QuantContext Engine',
      fontSize: FONT_SIZE.coverTitle,
      bold: true,
      color: theme.accentColor,
      alignment: 'center' as const,
      margin: [0, 0, 0, SPACING.sm],
    },

    // Subtitle
    {
      text: 'Account Data Report',
      fontSize: FONT_SIZE.h1,
      color: theme.textSecondary,
      alignment: 'center' as const,
      margin: [0, 0, 0, SPACING.xxl],
    },

    // Info table
    infoTable,

    // Included records heading
    {
      text: 'Records included',
      fontSize: FONT_SIZE.h3,
      bold: true,
      color: theme.textPrimary,
      margin: [0, 0, 0, SPACING.sm],
    },

    // Dataset counts
    countsTable,

    // Confidentiality line
    {
      text: 'Confidential — contains your complete trading data.',
      style: 'confidential',
      alignment: 'center' as const,
      margin: [0, SPACING.md, 0, SPACING.xs],
    },

    // PIN notice
    {
      text: 'Protected with your engine PIN. Your PIN is the password. Keep the PDF private.',
      fontSize: FONT_SIZE.caption,
      color: theme.textMuted,
      italics: true,
      alignment: 'center' as const,
      margin: [0, 0, 0, 0],
    },
  ];
}
