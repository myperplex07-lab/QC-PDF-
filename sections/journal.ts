// src/pdf/sections/journal.ts
// ─────────────────────────────────────────────────────────────────────────
// Trade Journal — Section 11.6 of the prompt.
// Table + detail card per entry: lesson, emotion before/after, rating 1–5,
// tags, direction long/short, outcome, MFE/MAE.
// ─────────────────────────────────────────────────────────────────────────

import type { DocBuilderContext, BuildWarnings } from '../docBuilder';
import { sectionPageBreak, emptyState, themedTableLayout } from '../docBuilder';
import { FONT_SIZE, SPACING, CONTENT_WIDTH, MAX_TEXT_FIELD_CHARS, CELL_TO_PARAGRAPH_THRESHOLD } from '../layout';
import {
  fmtDateTime, fmtDate, fmtPercent, fmtCurrency, fmtInt,
  badgeLabel, titleCase, MISSING,
} from '../formatters';
import { sanitize, prepareText, wrapLongTokens } from '../sanitizer';

const TRUNCATION_MARKER = '…[shortened in PDF; full text in the ZIP export]';

function truncateText(text: string, warnings: BuildWarnings): string {
  if (text.length <= MAX_TEXT_FIELD_CHARS) return text;
  warnings.fieldsShortened++;
  return [...text].slice(0, MAX_TEXT_FIELD_CHARS).join('') + TRUNCATION_MARKER;
}

function outcomeColor(outcome: string, theme: any): string {
  switch (outcome.toLowerCase()) {
    case 'win': return theme.bullish;
    case 'loss': return theme.bearish;
    case 'breakeven': return theme.neutral;
    case 'pending': return theme.info;
    default: return theme.textPrimary;
  }
}

/** Build the Trade Journal section. */
export function buildJournalSection(ctx: DocBuilderContext, warnings: BuildWarnings): any[] {
  const { theme, data, marketSource } = ctx;
  const entries = [...data.journal].reverse(); // newest first
  const content: any[] = [];

  content.push(sectionPageBreak());
  content.push({
    text: 'Trade Journal',
    fontSize: FONT_SIZE.h1,
    bold: true,
    color: theme.accentColor,
    tocItem: true,
    margin: [0, 0, 0, SPACING.lg],
  });

  if (entries.length === 0) {
    content.push(emptyState('Trade Journal', theme));
    return content;
  }

  // ── Summary table ──────────────────────────────────────────────────────
  const tableBody: any[][] = [
    [
      { text: '#', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Date', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Ticker', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Direction', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Outcome', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Rating', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
    ],
  ];

  for (let i = 0; i < entries.length; i++) {
    const row = entries[i];
    const outcome = String(row.outcome ?? '');
    tableBody.push([
      { text: String(i + 1), fontSize: FONT_SIZE.table, color: theme.textMuted },
      { text: fmtDateTime(row.trade_date as string | null ?? row.created_at as string | null), fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: wrapLongTokens(sanitize(String(row.ticker ?? ''))), fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: badgeLabel(String(row.direction ?? '')), fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: badgeLabel(outcome), fontSize: FONT_SIZE.table, color: outcomeColor(outcome, theme), bold: true },
      { text: row.rating != null ? `${row.rating}/5` : MISSING, fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
    ]);
  }

  content.push({
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [24, 80, 70, 55, 55, 35],
      body: tableBody,
    },
    layout: themedTableLayout(theme),
    margin: [0, 0, 0, SPACING.lg],
  });

  // ── Detail cards ───────────────────────────────────────────────────────
  for (let i = 0; i < entries.length; i++) {
    const row = entries[i];
    const outcome = String(row.outcome ?? '');

    const detailPairs: [string, string][] = [];

    detailPairs.push(['Ticker', sanitize(String(row.ticker ?? '')) || MISSING]);
    detailPairs.push(['Trade Date', fmtDateTime(row.trade_date as string | null ?? row.created_at as string | null)]);
    detailPairs.push(['Direction', row.direction ? badgeLabel(String(row.direction)) : MISSING]);
    detailPairs.push(['Outcome', outcome ? badgeLabel(outcome) : MISSING]);
    detailPairs.push(['Rating', row.rating != null ? `${row.rating}/5` : MISSING]);

    // Emotion
    if (row.emotion_before) detailPairs.push(['Emotion Before', titleCase(String(row.emotion_before))!]);
    if (row.emotion_after) detailPairs.push(['Emotion After', titleCase(String(row.emotion_after))!]);

    // MFE/MAE
    if (row.mfe_pct != null) detailPairs.push(['MFE %', fmtPercent(row.mfe_pct as number)]);
    if (row.mae_pct != null) detailPairs.push(['MAE %', fmtPercent(row.mae_pct as number)]);
    if (row.pnl_pct != null) detailPairs.push(['P&L %', fmtPercent(row.pnl_pct as number)]);
    if (row.pnl_amount != null) detailPairs.push(['P&L Amount', fmtCurrency(row.pnl_amount as number, marketSource)]);

    // Tags
    const tags = row.tags;
    if (tags) {
      const tagStr = Array.isArray(tags)
        ? (tags as string[]).join(', ')
        : String(tags);
      detailPairs.push(['Tags', sanitize(tagStr)]);
    }

    // Lesson
    const lesson = row.lesson ?? row.notes ?? row.note;
    let lessonBlock: any = null;
    if (lesson) {
      const { text: cleaned, replacedCount } = prepareText(String(lesson));
      warnings.charsReplaced += replacedCount;
      const truncated = truncateText(cleaned, warnings);
      if (truncated.length > CELL_TO_PARAGRAPH_THRESHOLD) {
        lessonBlock = {
          columns: [
            {
              canvas: [{
                type: 'rect' as const,
                x: 0, y: 0, w: 3, h: 500,
                color: theme.accentColor,
              }],
              width: 6,
            },
            {
              text: truncated,
              fontSize: FONT_SIZE.body,
              color: theme.textPrimary,
              lineHeight: 1.3,
              width: '*',
            },
          ],
          margin: [0, SPACING.xs, 0, SPACING.md],
        };
      } else {
        detailPairs.push(['Lesson/Notes', truncated]);
      }
    }

    content.push({
      stack: [
        {
          text: `Entry ${i + 1}: ${wrapLongTokens(sanitize(String(row.ticker ?? '')))}`,
          fontSize: FONT_SIZE.h3,
          bold: true,
          color: theme.accentColor,
          margin: [0, SPACING.md, 0, SPACING.xs],
        },
        {
          table: {
            headerRows: 0,
            widths: [120, '*'],
            body: detailPairs.map(([k, v]) => [
              { text: k, fontSize: FONT_SIZE.table, color: theme.textSecondary, bold: true },
              { text: v, fontSize: FONT_SIZE.table, color: theme.textPrimary },
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
        },
        ...(lessonBlock ? [lessonBlock] : []),
      ],
      unbreakable: detailPairs.length <= 8, // small cards stay together
    });
  }

  return content;
}
