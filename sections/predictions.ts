// src/pdf/sections/predictions.ts
// ─────────────────────────────────────────────────────────────────────────
// Prediction Scores — Section 11.7 of the prompt.
// Table: analysis date, ticker, predicted vs outcome, score, scored date.
// ─────────────────────────────────────────────────────────────────────────

import type { DocBuilderContext, BuildWarnings } from '../docBuilder';
import { sectionPageBreak, emptyState, themedTableLayout } from '../docBuilder';
import { FONT_SIZE, SPACING } from '../layout';
import { fmtDateTime, fmtScore, fmtRatio, titleCase, badgeLabel, MISSING } from '../formatters';
import { sanitize, wrapLongTokens } from '../sanitizer';

function scoreGrade(score: number | null | undefined): string {
  if (score == null || isNaN(score)) return MISSING;
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

/** Build the Prediction Scores section. */
export function buildPredictionsSection(ctx: DocBuilderContext, _warnings: BuildWarnings): any[] {
  const { theme, data } = ctx;
  const scores = [...data.predictions].reverse(); // newest first
  const content: any[] = [];

  content.push(sectionPageBreak());
  content.push({
    text: 'Prediction Scores',
    fontSize: FONT_SIZE.h1,
    bold: true,
    color: theme.accentColor,
    tocItem: true,
    margin: [0, 0, 0, SPACING.lg],
  });

  if (scores.length === 0) {
    content.push(emptyState('Prediction Scores', theme));
    return content;
  }

  const tableBody: any[][] = [
    [
      { text: '#', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Analysis Date', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Ticker', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Predicted', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Outcome', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Score', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
      { text: 'Grade', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Scored Date', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
    ],
  ];

  for (let i = 0; i < scores.length; i++) {
    const row = scores[i];
    const sp = row.score_points as number | null | undefined;
    const grade = scoreGrade(sp as number);

    tableBody.push([
      { text: String(i + 1), fontSize: FONT_SIZE.table, color: theme.textMuted },
      { text: fmtDateTime(row.analysis_created_at as string | null ?? row.created_at as string | null), fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: wrapLongTokens(sanitize(String(row.ticker ?? ''))), fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: row.predicted_direction ? titleCase(String(row.predicted_direction)) : MISSING, fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: row.actual_outcome ? titleCase(String(row.actual_outcome)) : MISSING, fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: sp != null ? fmtScore(sp) : MISSING, fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
      { text: grade, fontSize: FONT_SIZE.table, color: theme.textPrimary, bold: true },
      { text: fmtDateTime(row.scored_at as string | null), fontSize: FONT_SIZE.table, color: theme.textPrimary },
    ]);
  }

  content.push({
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [20, 68, 55, 50, 50, 36, 30, 68],
      body: tableBody,
    },
    layout: themedTableLayout(theme),
  });

  return content;
}
