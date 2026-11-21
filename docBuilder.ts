// src/pdf/docBuilder.ts
// ─────────────────────────────────────────────────────────────────────────
// Builds the pdfmake document definition from all section builders.
// Section 10–11 of the prompt.
// ─────────────────────────────────────────────────────────────────────────

import type { PdfTheme } from './theme';
import type { MarketSource } from './formatters';
import type { PdfGenerateOptions, PdfData, DatasetCounts, PdfProgressCallback } from './pdfService';
import {
  PAGE_WIDTH, PAGE_HEIGHT, MARGINS, CONTENT_WIDTH,
  FONT_SIZE, LINE_HEIGHT, HEADER_LOGO_HEIGHT,
  HEADER_FOOTER_LINE_WIDTH, SPACING,
} from './layout';
import { FONT_FAMILY } from './fonts';

export interface DocBuilderContext {
  theme: PdfTheme;
  pdfId: string;
  userId: string;
  generatedAt: Date;
  timeZone: string;
  marketSource: MarketSource;
  data: PdfData;
  counts: DatasetCounts;
  fingerprint: string | null;
  options: PdfGenerateOptions;
  isMobile: boolean;
  limits: { MAX_PDF_IMAGE_BYTES: number; MAX_PDF_PAGES: number; MAX_BOT_ROWS_IN_PDF: number };
  signal: AbortSignal;
  onProgress: PdfProgressCallback;
}

/** Warnings collected during building for the appendix. */
export interface BuildWarnings {
  logoFailed: boolean;
  imagesSkipped: number;
  imagesFailed: number;
  fieldsShortened: number;
  charsReplaced: number;
  figuresFailed: number;
  devaFallbackCount: number;
}

// ── Logo SVG (from QuantIcon.tsx — recoloured for the page background) ───

function logoSvg(theme: PdfTheme, height: number): any {
  // QuantIcon.tsx uses currentColor, viewBox 0 0 24 24
  // We recolour it to the accent for visibility on the page background
  const color = theme.accentColor;
  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${height}" height="${height}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
    <line x1="2" y1="2" x2="6" y2="6"/>
  </svg>`;
  return { svg: svgStr, width: height, height: height };
}

// ── Running header (Section 10.2) ────────────────────────────────────────

function buildHeader(theme: PdfTheme, pdfId: string) {
  return (currentPage: number, _pageCount: number) => {
    // Cover page (page 1) has no running header
    if (currentPage === 1) return null;

    return {
      margin: [MARGINS.left, MARGINS.top - 30, MARGINS.right, 0],
      stack: [
        {
          columns: [
            // Left: small logo + title
            {
              columns: [
                logoSvg(theme, HEADER_LOGO_HEIGHT),
                {
                  text: 'QuantContext Engine',
                  fontSize: FONT_SIZE.caption,
                  color: theme.textSecondary,
                  margin: [4, 3, 0, 0],
                },
              ],
              width: 'auto',
            },
            // Right: report title
            {
              text: 'Account Data Report',
              fontSize: FONT_SIZE.caption,
              color: theme.textMuted,
              alignment: 'right' as const,
              margin: [0, 3, 0, 0],
            },
          ],
        },
        // Accent hairline under header
        {
          canvas: [{
            type: 'line' as const,
            x1: 0, y1: 0,
            x2: CONTENT_WIDTH, y2: 0,
            lineWidth: HEADER_FOOTER_LINE_WIDTH,
            lineColor: theme.accentColor,
          }],
          margin: [0, 3, 0, 0],
        },
      ],
    };
  };
}

// ── Running footer (Section 10.3) ────────────────────────────────────────

function buildFooter(theme: PdfTheme, pdfId: string) {
  return (currentPage: number, pageCount: number) => {
    return {
      margin: [MARGINS.left, 8, MARGINS.right, 0],
      stack: [
        // Accent hairline
        {
          canvas: [{
            type: 'line' as const,
            x1: 0, y1: 0,
            x2: CONTENT_WIDTH, y2: 0,
            lineWidth: HEADER_FOOTER_LINE_WIDTH,
            lineColor: theme.accentColor,
          }],
        },
        {
          columns: [
            {
              text: `QuantContext Engine · ${pdfId}`,
              fontSize: FONT_SIZE.footer,
              color: theme.textMuted,
            },
            {
              text: `Page ${currentPage} of ${pageCount}`,
              fontSize: FONT_SIZE.footer,
              color: theme.textMuted,
              alignment: 'right' as const,
            },
          ],
          margin: [0, 3, 0, 0],
        },
      ],
    };
  };
}

// ── Full-bleed background (Section 8.5) ──────────────────────────────────

function buildBackground(theme: PdfTheme) {
  return (_currentPage: number, _pageSize: { width: number; height: number }) => {
    return {
      canvas: [{
        type: 'rect' as const,
        x: 0, y: 0,
        w: PAGE_WIDTH,
        h: PAGE_HEIGHT,
        color: theme.pageBg,
      }],
    };
  };
}

// ── Styles ───────────────────────────────────────────────────────────────

function buildStyles(theme: PdfTheme) {
  return {
    h1: { fontSize: FONT_SIZE.h1, bold: true, color: theme.accentColor, margin: [0, 0, 0, SPACING.md] as number[] },
    h2: { fontSize: FONT_SIZE.h2, bold: true, color: theme.accentColor, margin: [0, SPACING.lg, 0, SPACING.sm] as number[] },
    h3: { fontSize: FONT_SIZE.h3, bold: true, color: theme.textPrimary, margin: [0, SPACING.md, 0, SPACING.xs] as number[] },
    body: { fontSize: FONT_SIZE.body, color: theme.textPrimary, lineHeight: LINE_HEIGHT },
    muted: { fontSize: FONT_SIZE.body, color: theme.textMuted },
    caption: { fontSize: FONT_SIZE.caption, color: theme.textMuted },
    tableHeader: { fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, fillColor: theme.accentFill },
    tableCell: { fontSize: FONT_SIZE.table, color: theme.textPrimary },
    tableCellAlt: { fontSize: FONT_SIZE.table, color: theme.textPrimary, fillColor: theme.surfaceAlt },
    badge: { fontSize: FONT_SIZE.caption, bold: true },
    footer: { fontSize: FONT_SIZE.footer, color: theme.textMuted },
    confidential: { fontSize: FONT_SIZE.caption, color: theme.textMuted, italics: true },
  };
}

// ── Section separator helper ─────────────────────────────────────────────

export function sectionPageBreak(): any {
  return { text: '', pageBreak: 'before' as const };
}

export function sectionTitle(text: string, theme: PdfTheme): any {
  return { text, style: 'h1' };
}

// ── Empty state ──────────────────────────────────────────────────────────

export function emptyState(sectionName: string, theme: PdfTheme): any {
  return {
    text: 'No records in this range.',
    fontSize: FONT_SIZE.body,
    color: theme.textMuted,
    italics: true,
    margin: [0, SPACING.md, 0, SPACING.md],
  };
}

// ── Table layout helper ──────────────────────────────────────────────────

export function themedTableLayout(theme: PdfTheme) {
  return {
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
  };
}

// ── Main builder ─────────────────────────────────────────────────────────

export async function buildDocDefinition(ctx: DocBuilderContext): Promise<any> {
  const { theme, pdfId, signal, onProgress } = ctx;

  // Lazy-import section builders
  const [
    { buildCoverSection },
    { buildContentsSection },
    { buildOverviewSection },
    { buildStatisticsSection },
    { buildAuditTrailSection },
    { buildJournalSection },
    { buildPredictionsSection },
    { buildWatchlistSection },
    { buildAlertsSection },
    { buildPresetsSection },
    { buildBotSignalsSection },
    { buildSettingsSection },
    { buildAppendixSection },
    pdfStatsModule,
    chartBuildersModule,
  ] = await Promise.all([
    import('./sections/cover'),
    import('./sections/contents'),
    import('./sections/overview'),
    import('./sections/statistics'),
    import('./sections/auditTrail'),
    import('./sections/journal'),
    import('./sections/predictions'),
    import('./sections/watchlist'),
    import('./sections/alerts'),
    import('./sections/presets'),
    import('./sections/botSignals'),
    import('./sections/settings'),
    import('./sections/appendix'),
    import('./pdfStats'),
    import('./chartBuilders'),
  ]);

  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

  const warnings: BuildWarnings = {
    logoFailed: false,
    imagesSkipped: 0,
    imagesFailed: 0,
    fieldsShortened: 0,
    charsReplaced: 0,
    figuresFailed: 0,
    devaFallbackCount: 0,
  };

  // Build all content sections in order (Section 11)
  onProgress('Building cover…');
  const cover = buildCoverSection(ctx, warnings);

  onProgress('Building overview…');
  const overview = buildOverviewSection(ctx, warnings);

  // Statistics (Phase D — Section 14)
  onProgress('Building statistics…');
  const statLogs = ctx.data.auditTrail.map(r => ({
    id: String(r.id ?? ''),
    created_at: String(r.created_at ?? ''),
    asset_name: r.asset_name != null ? String(r.asset_name) : undefined,
    ticker: r.ticker != null ? String(r.ticker) : undefined,
    market_sentiment: String(r.market_sentiment ?? 'neutral'),
    risk_level: String(r.risk_level ?? 'medium'),
    confidence: Number(r.confidence) || 0,
  })) as import('./pdfStats').StatTradeLog[];

  const statPredictions = ctx.data.predictions.map(r => ({
    id: String(r.id ?? ''),
    predicted_probability: r.predicted_probability != null ? Number(r.predicted_probability) : undefined,
    direction_correct: r.direction_correct != null ? Boolean(r.direction_correct) : undefined,
    score_points: r.score_points != null ? Number(r.score_points) : undefined,
    score_grade: r.score_grade != null ? String(r.score_grade) : undefined,
    pattern_name: r.pattern_name != null ? String(r.pattern_name) : undefined,
  })) as import('./pdfStats').StatPredictionScore[];

  const computedStats = pdfStatsModule.computeStats(statLogs);
  const calibration = pdfStatsModule.computeCalibration(statPredictions);
  const patternPerf = pdfStatsModule.computePatternPerformance(statPredictions);
  const gradeDistrib = pdfStatsModule.computeGradeDistribution(statPredictions);
  const heatmapData = pdfStatsModule.buildHeatmapData(statLogs);

  const statistics = buildStatisticsSection(ctx, warnings, computedStats, calibration, patternPerf, gradeDistrib, heatmapData, chartBuildersModule);

  onProgress('Building audit trail…');
  const auditTrail = buildAuditTrailSection(ctx, warnings);

  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

  onProgress('Building journal…');
  const journal = buildJournalSection(ctx, warnings);

  onProgress('Building predictions…');
  const predictions = buildPredictionsSection(ctx, warnings);

  onProgress('Building watchlist…');
  const watchlist = buildWatchlistSection(ctx, warnings);

  onProgress('Building alerts…');
  const alerts = buildAlertsSection(ctx, warnings);

  onProgress('Building presets…');
  const presets = buildPresetsSection(ctx, warnings);

  onProgress('Building bot signals…');
  const botSignals = buildBotSignalsSection(ctx, warnings);

  onProgress('Building settings…');
  const settings = buildSettingsSection(ctx, warnings);

  onProgress('Building appendix…');
  const appendix = buildAppendixSection(ctx, warnings);

  // Contents page needs section references — build after all sections
  const contents = buildContentsSection(ctx);

  // Compose full content array
  const content = [
    ...cover,
    ...contents,
    ...overview,
    ...statistics,
    ...auditTrail,
    ...journal,
    ...predictions,
    ...watchlist,
    ...alerts,
    ...presets,
    ...botSignals,
    ...settings,
    ...appendix,
  ];

  return {
    pageSize: 'A4' as const,
    pageMargins: [MARGINS.left, MARGINS.top, MARGINS.right, MARGINS.bottom] as [number, number, number, number],
    background: buildBackground(theme),
    header: buildHeader(theme, pdfId),
    footer: buildFooter(theme, pdfId),
    content,
    styles: buildStyles(theme),
    info: {
      title: 'QuantContext Engine \u2014 Account Data Report',
      author: 'QuantContext Engine',
      subject: `Report for user ${ctx.userId}`,
      keywords: pdfId,
      creator: 'QuantContext Engine',
      producer: 'QuantContext Engine (pdfmake)',
    },
  };
}
