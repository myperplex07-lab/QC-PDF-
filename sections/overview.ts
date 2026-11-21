// src/pdf/sections/overview.ts
// ─────────────────────────────────────────────────────────────────────────
// Overview KPI cards — Section 11.3 of the prompt.
// Counts, averages, streaks computed from the fetched data.
// ─────────────────────────────────────────────────────────────────────────

import type { DocBuilderContext, BuildWarnings } from '../docBuilder';
import { sectionPageBreak, emptyState, themedTableLayout } from '../docBuilder';
import { FONT_SIZE, SPACING, COLUMN_WIDTH, COLUMN_GUTTER, CONTENT_WIDTH } from '../layout';
import { fmtInt, fmtDecimal, fmtPercent, fmtConfidence, MISSING } from '../formatters';

/** Compute KPIs from the fetched audit trail data. */
function computeKpis(data: Record<string, unknown>[]) {
  const total = data.length;
  if (total === 0) {
    return {
      totalAnalyses: 0,
      avgConfidence: null as number | null,
      bullishCount: 0, bearishCount: 0, neutralCount: 0, volatileCount: 0,
      riskLow: 0, riskMed: 0, riskHigh: 0, riskExtreme: 0,
      withImages: 0,
      avgScore: null as number | null,
      scoredCount: 0,
    };
  }

  let confSum = 0, confCount = 0;
  let bullishCount = 0, bearishCount = 0, neutralCount = 0, volatileCount = 0;
  let riskLow = 0, riskMed = 0, riskHigh = 0, riskExtreme = 0;
  let withImages = 0;
  let scoreSum = 0, scoredCount = 0;

  for (const row of data) {
    // Confidence
    const conf = row.confidence as number | null | undefined;
    if (conf != null && !isNaN(conf)) { confSum += conf; confCount++; }

    // Sentiment
    const sentiment = String(row.market_sentiment ?? '').toLowerCase();
    if (sentiment === 'bullish') bullishCount++;
    else if (sentiment === 'bearish') bearishCount++;
    else if (sentiment === 'neutral') neutralCount++;
    else if (sentiment === 'highly_volatile') volatileCount++;

    // Risk
    const risk = String(row.risk_level ?? '').toLowerCase();
    if (risk === 'low') riskLow++;
    else if (risk === 'medium' || risk === 'moderate') riskMed++;
    else if (risk === 'high') riskHigh++;
    else if (risk === 'extreme') riskExtreme++;

    // Images
    if (row.image_1 || row.image_2) withImages++;

    // Prediction score
    const fr = row.full_result as Record<string, unknown> | null | undefined;
    if (fr) {
      const score = (fr as any).score_points as number | null | undefined;
      if (score != null && !isNaN(score)) { scoreSum += score; scoredCount++; }
    }
  }

  return {
    totalAnalyses: total,
    avgConfidence: confCount > 0 ? confSum / confCount : null,
    bullishCount, bearishCount, neutralCount, volatileCount,
    riskLow, riskMed, riskHigh, riskExtreme,
    withImages,
    avgScore: scoredCount > 0 ? scoreSum / scoredCount : null,
    scoredCount,
  };
}

/** Build the Overview section content. */
export function buildOverviewSection(ctx: DocBuilderContext, _warnings: BuildWarnings): any[] {
  const { theme, data, counts } = ctx;

  const kpis = computeKpis(data.auditTrail);

  const content: any[] = [
    sectionPageBreak(),
    {
      text: 'Overview',
      fontSize: FONT_SIZE.h1,
      bold: true,
      color: theme.accentColor,
      tocItem: true,
      margin: [0, 0, 0, SPACING.lg],
    },
  ];

  if (kpis.totalAnalyses === 0 && counts.journal === 0 && counts.predictions === 0) {
    content.push(emptyState('Overview', theme));
    return content;
  }

  // ── KPI rows ───────────────────────────────────────────────────────────
  const kpiPairs: [string, string][] = [
    ['Total Analyses', fmtInt(kpis.totalAnalyses)],
    ['Avg Confidence', kpis.avgConfidence != null ? fmtConfidence(kpis.avgConfidence) : MISSING],
    ['Scored Analyses', `${fmtInt(kpis.scoredCount)} of ${fmtInt(kpis.totalAnalyses)}`],
    ['Avg Score', kpis.avgScore != null ? fmtDecimal(kpis.avgScore, 1) : MISSING],
    ['With Images', fmtInt(kpis.withImages)],
    ['Journal Entries', fmtInt(counts.journal)],
    ['Prediction Scores', fmtInt(counts.predictions)],
    ['Watchlist Items', fmtInt(counts.watchlist)],
    ['Context Presets', fmtInt(counts.contextPresets)],
    ['Bot Signals', fmtInt(counts.botSignals)],
    ['Price Alerts', fmtInt(counts.priceAlerts)],
  ];

  content.push({
    table: {
      headerRows: 1,
      widths: ['*', 120],
      body: [
        [
          { text: 'KPI', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
          { text: 'Value', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
        ],
        ...kpiPairs.map(([key, val]) => [
          { text: key, fontSize: FONT_SIZE.table, color: theme.textPrimary },
          { text: val, fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
        ]),
      ],
    },
    layout: themedTableLayout(theme),
    margin: [0, 0, 0, SPACING.lg],
  });

  // ── Sentiment distribution ─────────────────────────────────────────────
  if (kpis.totalAnalyses > 0) {
    content.push({
      text: 'Sentiment Distribution',
      fontSize: FONT_SIZE.h2,
      bold: true,
      color: theme.accentColor,
      margin: [0, SPACING.md, 0, SPACING.sm],
    });

    const sentimentRows: [string, number, string][] = [
      ['BULLISH', kpis.bullishCount, theme.bullish],
      ['BEARISH', kpis.bearishCount, theme.bearish],
      ['NEUTRAL', kpis.neutralCount, theme.neutral],
      ['HIGHLY VOLATILE', kpis.volatileCount, theme.volatile],
    ];

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 80, 80],
        body: [
          [
            { text: 'Sentiment', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
            { text: 'Count', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
            { text: '% of Total', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
          ],
          ...sentimentRows.map(([label, count, color]) => [
            { text: label, fontSize: FONT_SIZE.table, color, bold: true },
            { text: fmtInt(count), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
            { text: fmtPercent(kpis.totalAnalyses > 0 ? (count / kpis.totalAnalyses) * 100 : 0, 1), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
          ]),
        ],
      },
      layout: themedTableLayout(theme),
      margin: [0, 0, 0, SPACING.lg],
    });

    // ── Risk distribution ────────────────────────────────────────────────
    content.push({
      text: 'Risk Distribution',
      fontSize: FONT_SIZE.h2,
      bold: true,
      color: theme.accentColor,
      margin: [0, SPACING.md, 0, SPACING.sm],
    });

    const riskRows: [string, number, string][] = [
      ['LOW', kpis.riskLow, theme.riskLow],
      ['MEDIUM', kpis.riskMed, theme.riskMed],
      ['HIGH', kpis.riskHigh, theme.riskHigh],
      ['EXTREME', kpis.riskExtreme, theme.riskExtreme],
    ];

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 80, 80],
        body: [
          [
            { text: 'Risk Level', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
            { text: 'Count', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
            { text: '% of Total', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
          ],
          ...riskRows.map(([label, count, color]) => [
            { text: label, fontSize: FONT_SIZE.table, color, bold: true },
            { text: fmtInt(count), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
            { text: fmtPercent(kpis.totalAnalyses > 0 ? (count / kpis.totalAnalyses) * 100 : 0, 1), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
          ]),
        ],
      },
      layout: themedTableLayout(theme),
      margin: [0, 0, 0, 0],
    });
  }

  return content;
}
