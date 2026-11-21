// src/pdf/sections/auditTrail.ts
// ─────────────────────────────────────────────────────────────────────────
// Audit Trail — Sections 11.5 + 11.1 of the prompt.
// (a) Index table: date, ticker, sentiment, confidence, risk, pattern,
//     score, page number.
// (b) One block per analysis on a new page.
// ─────────────────────────────────────────────────────────────────────────

import type { DocBuilderContext, BuildWarnings } from '../docBuilder';
import { sectionPageBreak, emptyState, themedTableLayout } from '../docBuilder';
import {
  FONT_SIZE, SPACING, CONTENT_WIDTH,
  MAX_TEXT_FIELD_CHARS, CELL_TO_PARAGRAPH_THRESHOLD,
} from '../layout';
import {
  fmtDateTime, fmtConfidence, fmtDecimal, fmtPercent, fmtScore,
  badgeLabel, titleCase, MISSING,
} from '../formatters';
import { sanitize, prepareText, wrapLongTokens } from '../sanitizer';

// ── Meaning-colour helpers ───────────────────────────────────────────────

function sentimentColor(value: string, theme: any): string {
  switch (value.toLowerCase()) {
    case 'bullish': return theme.bullish;
    case 'bearish': return theme.bearish;
    case 'neutral': return theme.neutral;
    case 'highly_volatile': return theme.volatile;
    default: return theme.textPrimary;
  }
}

function riskColor(value: string, theme: any): string {
  switch (value.toLowerCase()) {
    case 'low': return theme.riskLow;
    case 'medium': case 'moderate': return theme.riskMed;
    case 'high': return theme.riskHigh;
    case 'extreme': return theme.riskExtreme;
    default: return theme.textPrimary;
  }
}

function scoreGrade(score: number | null | undefined): string {
  if (score == null || isNaN(score)) return MISSING;
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

// ── Truncate long text with marker (Section 11.1) ────────────────────────

const TRUNCATION_MARKER = '…[shortened in PDF; full text in the ZIP export]';

function truncateText(text: string, warnings: BuildWarnings): string {
  if (text.length <= MAX_TEXT_FIELD_CHARS) return text;
  warnings.fieldsShortened++;
  // Cut at a code-point boundary
  const cut = [...text].slice(0, MAX_TEXT_FIELD_CHARS).join('');
  return cut + TRUNCATION_MARKER;
}

// ── Build key-value table for a detail block ─────────────────────────────

function kvTable(pairs: [string, string][], theme: any): any {
  return {
    table: {
      headerRows: 0,
      widths: [140, '*'],
      body: pairs.map(([k, v]) => [
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
    margin: [0, SPACING.xs, 0, SPACING.md],
  };
}

// ── Build a paragraph block with accent bar (for long text) ──────────────

function accentParagraph(text: string, theme: any): any {
  return {
    columns: [
      {
        canvas: [{
          type: 'rect' as const,
          x: 0, y: 0,
          w: 3, h: 500, // height will be clipped by pdfmake
          color: theme.accentColor,
        }],
        width: 6,
      },
      {
        text,
        fontSize: FONT_SIZE.body,
        color: theme.textPrimary,
        lineHeight: 1.3,
        width: '*',
      },
    ],
    margin: [0, SPACING.xs, 0, SPACING.md],
  };
}

// ── Flatten nested object for detail blocks ──────────────────────────────

function flattenObj(
  obj: Record<string, unknown>,
  prefix: string = '',
): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [key, val] of Object.entries(obj)) {
    const label = prefix ? `${prefix} › ${titleCase(key)}` : titleCase(key);
    if (val === null || val === undefined) {
      pairs.push([label!, MISSING]);
    } else if (Array.isArray(val)) {
      pairs.push([label!, val.map(v => String(v)).join(', ') || MISSING]);
    } else if (typeof val === 'object') {
      pairs.push(...flattenObj(val as Record<string, unknown>, label!));
    } else {
      pairs.push([label!, String(val)]);
    }
  }
  return pairs;
}

// ── HUD tab label mapping (Section 11.1) ─────────────────────────────────

const HUD_TAB_KEYS: { key: string; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'telemetry', label: 'Telemetry' },
  { key: 'trade_setup', label: 'Trade Setup' },
  { key: 'prediction', label: 'Prediction' },
  { key: 'logic', label: 'Logic' },
  { key: 'memory', label: 'Memory' },
  { key: 'cross_chart_correlation', label: 'Cross-Chart Correlation' },
  { key: 'event_risk', label: 'Event Risk' },
];

// ── Build one analysis block (Section 11.1) ──────────────────────────────

function buildAnalysisBlock(
  row: Record<string, unknown>,
  _index: number,
  ctx: DocBuilderContext,
  warnings: BuildWarnings,
): any[] {
  const { theme, marketSource } = ctx;
  const block: any[] = [];

  // ── New page for each analysis ─────────────────────────────────────────
  block.push(sectionPageBreak());

  const ticker = sanitize(String(row.ticker ?? ''));
  const createdAt = fmtDateTime(row.created_at as string | null);
  const analysisId = sanitize(String(row.id ?? ''));
  const sentiment = String(row.market_sentiment ?? '');
  const confidence = row.confidence as number | null;
  const riskLevel = String(row.risk_level ?? '');
  const pattern = sanitize(String(row.pattern_detected ?? ''));

  // Score from full_result
  const fr = (row.full_result ?? {}) as Record<string, unknown>;
  const scorePoints = fr.score_points as number | null | undefined;
  const grade = scoreGrade(scorePoints as number);

  // ── Header band ────────────────────────────────────────────────────────
  block.push({
    columns: [
      // Left: ticker, date, ID
      {
        stack: [
          { text: wrapLongTokens(ticker), fontSize: FONT_SIZE.h2 + 2, bold: true, color: theme.textPrimary },
          { text: `${createdAt}`, fontSize: FONT_SIZE.body, color: theme.textSecondary, margin: [0, 2, 0, 0] },
          { text: `ID: ${wrapLongTokens(analysisId)}`, fontSize: FONT_SIZE.footer, color: theme.textMuted, margin: [0, 2, 0, 0] },
        ],
        width: '*',
      },
      // Right: badges
      {
        stack: [
          // Sentiment badge
          sentiment ? {
            text: ` ${badgeLabel(sentiment)} `,
            fontSize: FONT_SIZE.caption,
            bold: true,
            color: sentimentColor(sentiment, theme),
            margin: [0, 0, 0, 3],
          } : null,
          // Confidence
          confidence != null ? {
            text: `Confidence: ${fmtConfidence(confidence)}`,
            fontSize: FONT_SIZE.caption,
            color: theme.textSecondary,
            margin: [0, 0, 0, 3],
          } : null,
          // Risk badge
          riskLevel ? {
            text: ` ${badgeLabel(riskLevel)} RISK `,
            fontSize: FONT_SIZE.caption,
            bold: true,
            color: riskColor(riskLevel, theme),
            margin: [0, 0, 0, 3],
          } : null,
          // Score badge
          scorePoints != null ? {
            text: `Score: ${fmtScore(scorePoints)} (${grade})`,
            fontSize: FONT_SIZE.caption,
            color: theme.textSecondary,
          } : null,
        ].filter(Boolean),
        width: 'auto',
        alignment: 'right' as const,
      },
    ],
    margin: [0, 0, 0, SPACING.md],
  });

  // ── Chart images in cards (Section 11.1) ───────────────────────────────
  const img1 = row.image_1 as string | null | undefined;
  const img2 = row.image_2 as string | null | undefined;

  if (ctx.options.includeImages) {
    if (img1) {
      block.push({
        stack: [
          { image: img1, width: CONTENT_WIDTH - 2, fit: [CONTENT_WIDTH - 2, 250] },
          { text: 'Chart 1', fontSize: FONT_SIZE.caption, color: theme.textMuted, margin: [0, 4, 0, 0] },
        ],
        margin: [0, 0, 0, SPACING.md],
      });
    }
    if (img2) {
      block.push({
        stack: [
          { image: img2, width: CONTENT_WIDTH - 2, fit: [CONTENT_WIDTH - 2, 250] },
          { text: 'Chart 2', fontSize: FONT_SIZE.caption, color: theme.textMuted, margin: [0, 4, 0, 0] },
        ],
        margin: [0, 0, 0, SPACING.md],
      });
    }
    if (!img1 && !img2) {
      block.push({
        text: 'No chart image stored for this analysis.',
        fontSize: FONT_SIZE.body,
        color: theme.textMuted,
        italics: true,
        margin: [0, 0, 0, SPACING.md],
      });
    }
  }

  // ── Key facts table ────────────────────────────────────────────────────
  const userTag = sanitize(String(row.user_pattern_tag ?? ''));
  const predictedDir = fr.predicted_direction != null ? titleCase(String(fr.predicted_direction)) : MISSING;
  const predictedProb = fr.predicted_probability != null ? fmtPercent(fr.predicted_probability as number, 1) : MISSING;

  const keyFacts: [string, string][] = [
    ['Ticker', ticker || MISSING],
    ['Pattern Detected', pattern || MISSING],
    ['Your Pattern Tag', userTag || MISSING],
    ['Prediction Direction', predictedDir!],
    ['Prediction Probability', predictedProb!],
    ['Risk Level', riskLevel ? badgeLabel(riskLevel) : MISSING],
    ['Prediction Score', scorePoints != null ? `${fmtScore(scorePoints)} (${grade})` : MISSING],
    ['Created At', createdAt],
  ];

  block.push({
    text: 'Key Facts',
    fontSize: FONT_SIZE.h3,
    bold: true,
    color: theme.accentColor,
    margin: [0, SPACING.sm, 0, SPACING.xs],
  });
  block.push(kvTable(keyFacts, theme));

  // ── Detail blocks that mirror HUD tabs (Section 11.1) ──────────────────
  for (const tab of HUD_TAB_KEYS) {
    const tabData = fr[tab.key];
    if (tabData === null || tabData === undefined) continue;

    block.push({
      text: tab.label,
      fontSize: FONT_SIZE.h3,
      bold: true,
      color: theme.accentColor,
      margin: [0, SPACING.sm, 0, SPACING.xs],
    });

    if (typeof tabData === 'string') {
      // Long text: use paragraph block
      const { text: cleaned, replacedCount } = prepareText(tabData);
      warnings.charsReplaced += replacedCount;
      const truncated = truncateText(cleaned, warnings);
      if (truncated.length > CELL_TO_PARAGRAPH_THRESHOLD) {
        block.push(accentParagraph(truncated, theme));
      } else {
        block.push({
          text: truncated,
          fontSize: FONT_SIZE.body,
          color: theme.textPrimary,
          lineHeight: 1.3,
          margin: [0, 0, 0, SPACING.md],
        });
      }
    } else if (Array.isArray(tabData)) {
      // Array → list
      block.push({
        ul: tabData.map(item => {
          const { text: cleaned, replacedCount } = prepareText(String(item));
          warnings.charsReplaced += replacedCount;
          return { text: truncateText(cleaned, warnings), fontSize: FONT_SIZE.body, color: theme.textPrimary };
        }),
        margin: [0, 0, 0, SPACING.md],
      });
    } else if (typeof tabData === 'object') {
      // Object → flatten to key-value table
      const pairs = flattenObj(tabData as Record<string, unknown>);
      const processedPairs: [string, string][] = pairs.map(([k, v]) => {
        const { text: cleaned, replacedCount } = prepareText(v);
        warnings.charsReplaced += replacedCount;
        const truncated = truncateText(cleaned, warnings);
        return [k, truncated];
      });
      block.push(kvTable(processedPairs, theme));
    } else {
      block.push({
        text: String(tabData),
        fontSize: FONT_SIZE.body,
        color: theme.textPrimary,
        margin: [0, 0, 0, SPACING.md],
      });
    }
  }

  // ── Any remaining keys in full_result not covered by HUD tabs ──────────
  const coveredKeys = new Set(HUD_TAB_KEYS.map(t => t.key));
  // Also cover the top-level keys we already showed
  coveredKeys.add('score_points');
  coveredKeys.add('predicted_direction');
  coveredKeys.add('predicted_probability');

  const extraKeys = Object.keys(fr).filter(k => !coveredKeys.has(k));
  if (extraKeys.length > 0) {
    block.push({
      text: 'Additional Data',
      fontSize: FONT_SIZE.h3,
      bold: true,
      color: theme.accentColor,
      margin: [0, SPACING.sm, 0, SPACING.xs],
    });
    const extraPairs: [string, string][] = extraKeys.map(k => {
      const val = fr[k];
      let strVal: string;
      if (val === null || val === undefined) {
        strVal = MISSING;
      } else if (typeof val === 'object') {
        strVal = JSON.stringify(val, null, 2);
      } else {
        strVal = String(val);
      }
      const { text: cleaned, replacedCount } = prepareText(strVal);
      warnings.charsReplaced += replacedCount;
      return [titleCase(k)!, truncateText(cleaned, warnings)] as [string, string];
    });
    block.push(kvTable(extraPairs, theme));
  }

  return block;
}

// ── Main export ──────────────────────────────────────────────────────────

export function buildAuditTrailSection(ctx: DocBuilderContext, warnings: BuildWarnings): any[] {
  const { theme, data } = ctx;
  const analyses = data.auditTrail;
  const content: any[] = [];

  content.push(sectionPageBreak());
  content.push({
    text: 'Audit Trail',
    fontSize: FONT_SIZE.h1,
    bold: true,
    color: theme.accentColor,
    tocItem: true,
    margin: [0, 0, 0, SPACING.lg],
  });

  if (analyses.length === 0) {
    content.push(emptyState('Audit Trail', theme));
    return content;
  }

  // ── 5.1 Index table ────────────────────────────────────────────────────
  // Show newest first (Section 7.6: data fetched ascending, show newest first)
  const reversed = [...analyses].reverse();

  content.push({
    text: 'Index',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, 0, 0, SPACING.sm],
  });

  const indexBody: any[][] = [
    [
      { text: '#', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Date', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Ticker', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Sentiment', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Conf', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
      { text: 'Risk', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Pattern', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Score', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
    ],
  ];

  for (let i = 0; i < reversed.length; i++) {
    const row = reversed[i];
    const sentiment = String(row.market_sentiment ?? '');
    const riskLevel = String(row.risk_level ?? '');
    const fr = (row.full_result ?? {}) as Record<string, unknown>;
    const sp = fr.score_points as number | null | undefined;

    indexBody.push([
      { text: String(i + 1), fontSize: FONT_SIZE.table, color: theme.textMuted },
      { text: fmtDateTime(row.created_at as string | null), fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: wrapLongTokens(sanitize(String(row.ticker ?? ''))), fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: badgeLabel(sentiment), fontSize: FONT_SIZE.table, color: sentimentColor(sentiment, theme), bold: true },
      { text: fmtConfidence(row.confidence as number | null), fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
      { text: badgeLabel(riskLevel), fontSize: FONT_SIZE.table, color: riskColor(riskLevel, theme), bold: true },
      { text: wrapLongTokens(sanitize(String(row.pattern_detected ?? '') || MISSING)), fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: sp != null ? `${fmtScore(sp)} (${scoreGrade(sp)})` : MISSING, fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
    ]);
  }

  content.push({
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [24, 72, 60, 58, 32, 48, 70, 50],
      body: indexBody,
    },
    layout: themedTableLayout(theme),
    margin: [0, 0, 0, SPACING.lg],
  });

  // ── 5.2 One block per analysis ─────────────────────────────────────────
  // Newest first
  for (let i = 0; i < reversed.length; i++) {
    if (ctx.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const analysisContent = buildAnalysisBlock(reversed[i], i, ctx, warnings);
    content.push(...analysisContent);
  }

  return content;
}
