// src/pdf/sections/statistics.ts
// ─────────────────────────────────────────────────────────────────────────
// Statistics — Section 11.4 / 14 of the prompt.
// Every dashboard widget mapped to a PDF figure or table.
//
// Uses pdfStats.ts for computation and chartBuilders.ts for SVG rendering.
// ─────────────────────────────────────────────────────────────────────────

import type { DocBuilderContext, BuildWarnings } from '../docBuilder';
import { sectionPageBreak, themedTableLayout } from '../docBuilder';
import {
  FONT_SIZE, SPACING, CONTENT_WIDTH, COLUMN_WIDTH, COLUMN_GUTTER,
} from '../layout';
import {
  fmtInt, fmtDecimal, fmtPercent, badgeLabel, MISSING,
} from '../formatters';
import type { ComputedStats, CalibrationBucket, PatternPerf, GradeDistribution, HeatmapDay } from '../pdfStats';

// ── Chart builder wrappers (graceful failure per Section 14.6) ───────────

function tryChart(
  builder: () => string,
  warnings: BuildWarnings,
): string | null {
  try {
    const svg = builder();
    return svg || null;
  } catch {
    warnings.figuresFailed++;
    return null;
  }
}

function chartOrFallback(
  svgStr: string | null,
  title: string,
  dataTable: any,
  theme: any,
  warnings: BuildWarnings,
): any[] {
  if (svgStr) {
    return [
      { svg: svgStr, width: CONTENT_WIDTH, margin: [0, 0, 0, SPACING.sm] },
    ];
  }
  // Fallback: "Figure unavailable" + data table
  return [
    {
      text: `Figure unavailable: ${title}`,
      fontSize: FONT_SIZE.body,
      color: theme.textMuted,
      italics: true,
      margin: [0, 0, 0, SPACING.xs],
    },
    ...(dataTable ? [dataTable] : []),
  ];
}

// ── Main export ──────────────────────────────────────────────────────────

export function buildStatisticsSection(
  ctx: DocBuilderContext,
  warnings: BuildWarnings,
  stats: ComputedStats | null,
  calibration: CalibrationBucket[],
  patternPerf: PatternPerf[],
  gradeDistrib: GradeDistribution[],
  heatmapData: Map<string, HeatmapDay>,
  chartBuilders?: typeof import('../chartBuilders') | null,
): any[] {
  const { theme, data } = ctx;
  const content: any[] = [];

  content.push(sectionPageBreak());
  content.push({
    text: 'Statistics',
    fontSize: FONT_SIZE.h1,
    bold: true,
    color: theme.accentColor,
    tocItem: true,
    margin: [0, 0, 0, SPACING.lg],
  });

  if (!stats) {
    content.push({
      text: 'Not enough data for statistics.',
      fontSize: FONT_SIZE.body,
      color: theme.textMuted,
      italics: true,
      margin: [0, SPACING.md, 0, SPACING.md],
    });
    return content;
  }

  // chartBuilders is now passed in from docBuilder.ts (lazy-loaded via dynamic import).

  // ── 1. KPI Cards ───────────────────────────────────────────────────────
  const kpiPairs: [string, string][] = [
    ['Total Analyses', fmtInt(stats.total)],
    ['Avg Confidence', fmtDecimal(stats.avgConf, 1) + '/100'],
    ['Bullish Conviction Rate', fmtPercent(stats.bullishConvictionRate, 1)],
    ['High Confidence Rate (≥75)', fmtPercent(stats.highConfRate, 1)],
    ['Analysis Streak', `${stats.streak} day${stats.streak !== 1 ? 's' : ''}`],
    ['Unique Assets', fmtInt(stats.uniqueAssets)],
    ['Most Active Day', stats.mostActiveDay],
    ['Avg Risk Level', badgeLabel(stats.avgRiskLabel)],
  ];

  content.push({
    text: 'Key Metrics',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, 0, 0, SPACING.sm],
  });

  content.push({
    table: {
      headerRows: 1,
      widths: ['*', 120],
      body: [
        [
          { text: 'Metric', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
          { text: 'Value', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
        ],
        ...kpiPairs.map(([k, v]) => [
          { text: k, fontSize: FONT_SIZE.table, color: theme.textPrimary },
          { text: v, fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
        ]),
      ],
    },
    layout: themedTableLayout(theme),
    margin: [0, 0, 0, SPACING.lg],
  });

  // ── 2. Confidence Histogram (5 buckets) ────────────────────────────────
  content.push({
    text: 'Confidence Distribution',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, SPACING.md, 0, SPACING.sm],
  });

  const confLabels = ['0–20', '20–40', '40–60', '60–80', '80–100'];

  // SVG bar chart (if chartBuilders available)
  if (chartBuilders) {
    const confChartData = stats.confBuckets.map((count, i) => ({
      label: confLabels[i],
      value: count,
    }));
    const confSvg = tryChart(
      () => chartBuilders!.buildBarChart(confChartData, theme, CONTENT_WIDTH, 'Confidence Buckets'),
      warnings,
    );
    content.push(...chartOrFallback(confSvg, 'Confidence Distribution', null, theme, warnings));
  }

  content.push({
    table: {
      headerRows: 1,
      widths: ['*', 60, 80],
      body: [
        [
          { text: 'Range', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
          { text: 'Count', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
          { text: '% of Total', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
        ],
        ...stats.confBuckets.map((count, i) => [
          { text: confLabels[i], fontSize: FONT_SIZE.table, color: theme.textPrimary },
          { text: fmtInt(count), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
          { text: fmtPercent(stats!.total > 0 ? (count / stats!.total) * 100 : 0, 1), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
        ]),
      ],
    },
    layout: themedTableLayout(theme),
    margin: [0, 0, 0, SPACING.lg],
  });

  // ── 3. Sentiment Distribution ──────────────────────────────────────────
  content.push({
    text: 'Sentiment Distribution',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, SPACING.md, 0, SPACING.sm],
  });

  const sentRows = Object.entries(stats.sentiments)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => {
      const colorMap: Record<string, string> = {
        bullish: theme.bullish, bearish: theme.bearish,
        neutral: theme.neutral, highly_volatile: theme.volatile,
      };
      return { label: badgeLabel(label), count, color: colorMap[label] || theme.textPrimary };
    });

  // SVG donut chart
  if (chartBuilders) {
    const sentChartData = sentRows.map(r => ({
      label: r.label,
      value: r.count,
      color: r.color,
    }));
    const sentSvg = tryChart(
      () => chartBuilders!.buildDonutChart(sentChartData, theme, COLUMN_WIDTH),
      warnings,
    );
    content.push(...chartOrFallback(sentSvg, 'Sentiment Distribution', null, theme, warnings));
  }

  content.push({
    table: {
      headerRows: 1,
      widths: ['*', 60, 80],
      body: [
        [
          { text: 'Sentiment', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
          { text: 'Count', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
          { text: '% of Total', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
        ],
        ...sentRows.map(r => [
          { text: r.label, fontSize: FONT_SIZE.table, color: r.color, bold: true },
          { text: fmtInt(r.count), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
          { text: fmtPercent(stats!.total > 0 ? (r.count / stats!.total) * 100 : 0, 1), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
        ]),
      ],
    },
    layout: themedTableLayout(theme),
    margin: [0, 0, 0, SPACING.lg],
  });

  // ── 4. Risk Distribution ───────────────────────────────────────────────
  content.push({
    text: 'Risk Distribution',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, SPACING.md, 0, SPACING.sm],
  });

  const riskRows = Object.entries(stats.risks)
    .sort((a, b) => {
      const order: Record<string, number> = { low: 0, medium: 1, moderate: 1, high: 2, extreme: 3 };
      return (order[a[0]] ?? 4) - (order[b[0]] ?? 4);
    })
    .map(([label, count]) => {
      const colorMap: Record<string, string> = {
        low: theme.riskLow, medium: theme.riskMed, moderate: theme.riskMed,
        high: theme.riskHigh, extreme: theme.riskExtreme,
      };
      return { label: badgeLabel(label), count, color: colorMap[label] || theme.textPrimary };
    });

  // SVG bar chart for risk
  if (chartBuilders) {
    const riskChartData = riskRows.map(r => ({
      label: r.label,
      value: r.count,
      color: r.color,
    }));
    const riskSvg = tryChart(
      () => chartBuilders!.buildBarChart(riskChartData, theme, CONTENT_WIDTH, 'Risk Levels'),
      warnings,
    );
    content.push(...chartOrFallback(riskSvg, 'Risk Distribution', null, theme, warnings));
  }

  content.push({
    table: {
      headerRows: 1,
      widths: ['*', 60, 80],
      body: [
        [
          { text: 'Risk Level', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
          { text: 'Count', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
          { text: '% of Total', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
        ],
        ...riskRows.map(r => [
          { text: r.label, fontSize: FONT_SIZE.table, color: r.color, bold: true },
          { text: fmtInt(r.count), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
          { text: fmtPercent(stats!.total > 0 ? (r.count / stats!.total) * 100 : 0, 1), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
        ]),
      ],
    },
    layout: themedTableLayout(theme),
    margin: [0, 0, 0, SPACING.lg],
  });

  // ── 5. Day-of-Week Activity ────────────────────────────────────────────
  content.push({
    text: 'Day-of-Week Activity',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, SPACING.md, 0, SPACING.sm],
  });

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // SVG bar chart for day-of-week
  if (chartBuilders) {
    const dowChartData = stats.dayOfWeekActivity.map((count, i) => ({
      label: dayNames[i],
      value: count,
    }));
    const dowSvg = tryChart(
      () => chartBuilders!.buildBarChart(dowChartData, theme, CONTENT_WIDTH, 'Analyses by Day'),
      warnings,
    );
    content.push(...chartOrFallback(dowSvg, 'Day-of-Week Activity', null, theme, warnings));
  }

  content.push({
    table: {
      headerRows: 1,
      widths: ['*', 60],
      body: [
        [
          { text: 'Day', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
          { text: 'Analyses', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
        ],
        ...stats.dayOfWeekActivity.map((count, i) => [
          { text: dayNames[i], fontSize: FONT_SIZE.table, color: theme.textPrimary, bold: dayNames[i] === stats!.mostActiveDay },
          { text: fmtInt(count), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
        ]),
      ],
    },
    layout: themedTableLayout(theme),
    margin: [0, 0, 0, SPACING.lg],
  });

  // ── 6. Monthly Volume ──────────────────────────────────────────────────
  if (stats.monthlyVolume.length > 0) {
    content.push({
      text: 'Monthly Volume',
      fontSize: FONT_SIZE.h2,
      bold: true,
      color: theme.accentColor,
      margin: [0, SPACING.md, 0, SPACING.sm],
    });

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 60],
        body: [
          [
            { text: 'Month', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
            { text: 'Analyses', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
          ],
          ...stats.monthlyVolume.map(mv => [
            { text: mv.month, fontSize: FONT_SIZE.table, color: theme.textPrimary },
            { text: fmtInt(mv.count), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
          ]),
        ],
      },
      layout: themedTableLayout(theme),
      margin: [0, 0, 0, SPACING.lg],
    });
  }

  // ── 7. Top Assets (by avg confidence) ──────────────────────────────────
  if (stats.topAssets.length > 0) {
    content.push({
      text: 'Top Assets (by Avg Confidence)',
      fontSize: FONT_SIZE.h2,
      bold: true,
      color: theme.accentColor,
      margin: [0, SPACING.md, 0, SPACING.sm],
    });

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 60, 80],
        body: [
          [
            { text: 'Asset', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
            { text: 'Count', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
            { text: 'Avg Conf', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
          ],
          ...stats.topAssets.map(a => [
            { text: a.name, fontSize: FONT_SIZE.table, color: theme.textPrimary },
            { text: fmtInt(a.count), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
            { text: fmtDecimal(a.avgConf, 1), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
          ]),
        ],
      },
      layout: themedTableLayout(theme),
      margin: [0, 0, 0, SPACING.lg],
    });
  }

  // ── 8. Most Analyzed Assets ────────────────────────────────────────────
  if (stats.mostAnalyzed.length > 0) {
    content.push({
      text: 'Most Analyzed Assets',
      fontSize: FONT_SIZE.h2,
      bold: true,
      color: theme.accentColor,
      margin: [0, SPACING.md, 0, SPACING.sm],
    });

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 60, 80],
        body: [
          [
            { text: 'Asset', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
            { text: 'Count', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
            { text: 'Avg Conf', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
          ],
          ...stats.mostAnalyzed.map(a => [
            { text: a.name, fontSize: FONT_SIZE.table, color: theme.textPrimary },
            { text: fmtInt(a.count), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
            { text: fmtDecimal(a.avgConf, 1), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
          ]),
        ],
      },
      layout: themedTableLayout(theme),
      margin: [0, 0, 0, SPACING.lg],
    });
  }

  // ── 9. Confidence Calibration (Section 14, App.tsx:6090-6103) ──────────
  if (calibration.length > 0 && calibration.some(b => b.total > 0)) {
    content.push(sectionPageBreak());
    content.push({
      text: 'Confidence Calibration',
      fontSize: FONT_SIZE.h2,
      bold: true,
      color: theme.accentColor,
      margin: [0, 0, 0, SPACING.sm],
    });

    // SVG bar chart for calibration win rates
    if (chartBuilders) {
      const calChartData = calibration
        .filter(b => b.total > 0)
        .map(b => ({
          label: `${b.label}%`,
          value: b.rate,
        }));
      const calSvg = tryChart(
        () => chartBuilders!.buildBarChart(calChartData, theme, CONTENT_WIDTH, 'Win Rate by Confidence Bucket'),
        warnings,
      );
      content.push(...chartOrFallback(calSvg, 'Calibration', null, theme, warnings));
    }

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 50, 50, 70],
        body: [
          [
            { text: 'Bucket', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
            { text: 'Total', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
            { text: 'Wins', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
            { text: 'Win Rate', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
          ],
          ...calibration.map(b => [
            { text: `${b.label}%`, fontSize: FONT_SIZE.table, color: theme.textPrimary },
            { text: fmtInt(b.total), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
            { text: fmtInt(b.wins), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
            { text: fmtPercent(b.rate, 1), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
          ]),
        ],
      },
      layout: themedTableLayout(theme),
      margin: [0, 0, 0, SPACING.lg],
    });
  }

  // ── 10. Pattern Performance ────────────────────────────────────────────
  if (patternPerf.length > 0) {
    content.push({
      text: 'Pattern Performance',
      fontSize: FONT_SIZE.h2,
      bold: true,
      color: theme.accentColor,
      margin: [0, SPACING.md, 0, SPACING.sm],
    });

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 45, 45, 60, 60],
        body: [
          [
            { text: 'Pattern', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
            { text: 'Count', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
            { text: 'Wins', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
            { text: 'Win Rate', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
            { text: 'Avg Score', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
          ],
          ...patternPerf.map(p => [
            { text: p.name, fontSize: FONT_SIZE.table, color: theme.textPrimary },
            { text: fmtInt(p.count), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
            { text: fmtInt(p.wins), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
            { text: fmtPercent(p.winRate, 1), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
            { text: fmtDecimal(p.avgScore, 1), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
          ]),
        ],
      },
      layout: themedTableLayout(theme),
      margin: [0, 0, 0, SPACING.lg],
    });
  }

  // ── 11. Grade Distribution ─────────────────────────────────────────────
  if (gradeDistrib.length > 0) {
    content.push({
      text: 'Score Grade Distribution',
      fontSize: FONT_SIZE.h2,
      bold: true,
      color: theme.accentColor,
      margin: [0, SPACING.md, 0, SPACING.sm],
    });

    content.push({
      table: {
        headerRows: 1,
        widths: ['*', 60],
        body: [
          [
            { text: 'Grade', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
            { text: 'Count', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
          ],
          ...gradeDistrib.map(g => [
            { text: g.grade, fontSize: FONT_SIZE.table, color: theme.textPrimary, bold: true },
            { text: fmtInt(g.count), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
          ]),
        ],
      },
      layout: themedTableLayout(theme),
      margin: [0, 0, 0, SPACING.lg],
    });
  }

  // ── 12. Confidence Timeline ────────────────────────────────────────────
  if (stats.confTimeline.length > 1) {
    content.push({
      text: 'Confidence Over Time',
      fontSize: FONT_SIZE.h2,
      bold: true,
      color: theme.accentColor,
      margin: [0, SPACING.md, 0, SPACING.sm],
    });

    content.push({
      text: `Average daily confidence over the last ${stats.confTimeline.length} data points.`,
      fontSize: FONT_SIZE.caption,
      color: theme.textMuted,
      margin: [0, 0, 0, SPACING.sm],
    });

    // SVG line chart for confidence timeline
    if (chartBuilders) {
      const timelinePoints = stats.confTimeline.map(pt => ({
        label: pt.date,
        value: pt.avg,
      }));
      const lineSvg = tryChart(
        () => chartBuilders!.buildLineChart(timelinePoints, theme, CONTENT_WIDTH, 160, 'Confidence Over Time'),
        warnings,
      );
      content.push(...chartOrFallback(lineSvg, 'Confidence Timeline', null, theme, warnings));
    }

    content.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: ['*', 80],
        body: [
          [
            { text: 'Date', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
            { text: 'Avg Confidence', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
          ],
          ...stats.confTimeline.map(pt => [
            { text: pt.date, fontSize: FONT_SIZE.table, color: theme.textPrimary },
            { text: fmtDecimal(pt.avg, 1), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
          ]),
        ],
      },
      layout: themedTableLayout(theme),
      margin: [0, 0, 0, SPACING.lg],
    });
  }

  return content;
}
