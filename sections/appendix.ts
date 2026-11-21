// src/pdf/sections/appendix.ts
// ─────────────────────────────────────────────────────────────────────────
// About This Report (Appendix) — Sections 11.2 / 11.13 of the prompt.
//
// What's included/excluded, snapshot time, counts per dataset,
// caps/warnings, field dictionary, time zone, PDF ID, User ID,
// fingerprint, library versions, PIN notice, disclaimer.
// ─────────────────────────────────────────────────────────────────────────

import type { DocBuilderContext, BuildWarnings } from '../docBuilder';
import { sectionPageBreak } from '../docBuilder';
import { FONT_SIZE, SPACING, MAX_TEXT_FIELD_CHARS } from '../layout';
import {
  fmtDateTimeFull, fmtIsoUtc, fmtInt, MISSING,
} from '../formatters';
import { sanitize } from '../sanitizer';

/** Build the Appendix section. */
export function buildAppendixSection(ctx: DocBuilderContext, warnings: BuildWarnings): any[] {
  const { theme, pdfId, userId, generatedAt, timeZone, data, counts, fingerprint, options, limits } = ctx;
  const content: any[] = [];

  content.push(sectionPageBreak());
  content.push({
    text: 'About This Report',
    fontSize: FONT_SIZE.h1,
    bold: true,
    color: theme.accentColor,
    tocItem: true,
    margin: [0, 0, 0, SPACING.lg],
  });

  // ── Helper: key-value section ──────────────────────────────────────────
  function kvBlock(pairs: [string, string][]): any {
    return {
      table: {
        headerRows: 0,
        widths: [160, '*'],
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
      margin: [0, 0, 0, SPACING.md],
    };
  }

  // ── What's included ────────────────────────────────────────────────────
  content.push({
    text: 'What is included',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, 0, 0, SPACING.sm],
  });

  content.push({
    ul: [
      'Audit Trail — all analyses with chart images (if enabled) and every data field',
      'Trade Journal — entries with lessons, emotions, ratings, tags, MFE/MAE',
      'Prediction Scores — predicted vs actual outcomes with grades',
      'Watchlist — current watchlist items',
      'Price Alerts — from this device (localStorage)',
      'Context Presets — saved context configurations',
      `Bot Signals — summary + latest ${fmtInt(limits.MAX_BOT_ROWS_IN_PDF)} rows`,
      'Settings — allow-listed engine settings and local preferences',
      'Statistics — overview KPIs and distributions',
    ].map(t => ({ text: t, fontSize: FONT_SIZE.body, color: theme.textPrimary })),
    margin: [0, 0, 0, SPACING.lg],
  });

  // ── What's excluded ────────────────────────────────────────────────────
  content.push({
    text: 'What is excluded',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, 0, 0, SPACING.sm],
  });

  content.push({
    ul: [
      'PIN and security data (hash, salt, security question/answer, lockout data)',
      'API keys, tokens, and credentials',
      'Embedding vectors',
      'Workspace cache',
      'Other users\' data',
      `Bot signals beyond the latest ${fmtInt(limits.MAX_BOT_ROWS_IN_PDF)} (use ZIP export for full history)`,
    ].map(t => ({ text: t, fontSize: FONT_SIZE.body, color: theme.textPrimary })),
    margin: [0, 0, 0, SPACING.lg],
  });

  // ── Data snapshot ──────────────────────────────────────────────────────
  content.push({
    text: 'Data Snapshot',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, 0, 0, SPACING.sm],
  });

  // Range label
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

  content.push(kvBlock([
    ['Snapshot time (local)', fmtDateTimeFull(data.snapshotTime)],
    ['Snapshot time (UTC)', fmtIsoUtc(data.snapshotTime)],
    ['Range', rangeLabel],
    ['Images included', options.includeImages ? `Yes (${options.imageQuality})` : 'No'],
    ['Theme', theme.label],
  ]));

  // ── Counts per dataset ─────────────────────────────────────────────────
  content.push({
    text: 'Counts per Dataset',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, SPACING.sm, 0, SPACING.sm],
  });

  const countEntries: [string, string, string][] = [
    ['Audit Trail', fmtInt(counts.auditTrail), fmtInt(data.dbCounts['audit_trail'] ?? counts.auditTrail)],
    ['Trade Journal', fmtInt(counts.journal), fmtInt(data.dbCounts['trade_journal'] ?? counts.journal)],
    ['Prediction Scores', fmtInt(counts.predictions), fmtInt(data.dbCounts['prediction_scores'] ?? counts.predictions)],
    ['Watchlist', fmtInt(counts.watchlist), fmtInt(data.dbCounts['watchlist'] ?? counts.watchlist)],
    ['Context Presets', fmtInt(counts.contextPresets), fmtInt(data.dbCounts['context_presets'] ?? counts.contextPresets)],
    ['Bot Signals', fmtInt(counts.botSignals), fmtInt(data.dbCounts['bot_signals'] ?? counts.botSignals)],
    ['Price Alerts', fmtInt(counts.priceAlerts), 'N/A (device only)'],
  ];

  content.push({
    table: {
      headerRows: 1,
      widths: ['*', 80, 100],
      body: [
        [
          { text: 'Dataset', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
          { text: 'In report', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
          { text: 'db_count_at_start', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
        ],
        ...countEntries.map(([name, inReport, dbCount]) => [
          { text: name, fontSize: FONT_SIZE.table, color: theme.textPrimary },
          { text: inReport, fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
          { text: dbCount, fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
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
  });

  // ── Rows added during export ───────────────────────────────────────────
  const addedKeys = Object.keys(data.rowsAdded).filter(k => (data.rowsAdded[k] ?? 0) > 0);
  if (addedKeys.length > 0) {
    content.push({
      text: 'Rows added during export (included per existing ZIP export rule):',
      fontSize: FONT_SIZE.caption,
      color: theme.textMuted,
      italics: true,
      margin: [0, 0, 0, SPACING.xs],
    });
    for (const k of addedKeys) {
      content.push({
        text: `  ${k}: ${fmtInt(data.rowsAdded[k])}`,
        fontSize: FONT_SIZE.caption,
        color: theme.textMuted,
        margin: [0, 0, 0, 2],
      });
    }
    content.push({ text: '', margin: [0, 0, 0, SPACING.sm] });
  }

  // ── Caps and warnings ──────────────────────────────────────────────────
  const warningLines: string[] = [];
  if (warnings.logoFailed) warningLines.push('Logo failed to load — text wordmark used instead.');
  if (warnings.imagesSkipped > 0) warningLines.push(`${warnings.imagesSkipped} image(s) skipped (budget exceeded).`);
  if (warnings.imagesFailed > 0) warningLines.push(`${warnings.imagesFailed} image(s) could not be decoded.`);
  if (warnings.fieldsShortened > 0) warningLines.push(`${warnings.fieldsShortened} text field(s) shortened (max ${fmtInt(MAX_TEXT_FIELD_CHARS)} characters).`);
  if (warnings.charsReplaced > 0) warningLines.push(`${warnings.charsReplaced} unsupported character(s) replaced with ◻.`);
  if (warnings.figuresFailed > 0) warningLines.push(`${warnings.figuresFailed} statistics figure(s) could not be built.`);
  if (warnings.devaFallbackCount > 0) warningLines.push(`${warnings.devaFallbackCount} Devanagari string(s) used canvas fallback.`);

  if (warningLines.length > 0) {
    content.push({
      text: 'Warnings',
      fontSize: FONT_SIZE.h2,
      bold: true,
      color: theme.accentColor,
      margin: [0, 0, 0, SPACING.sm],
    });
    content.push({
      ul: warningLines.map(t => ({ text: t, fontSize: FONT_SIZE.body, color: theme.textPrimary })),
      margin: [0, 0, 0, SPACING.lg],
    });
  }

  // ── Field and unit dictionary ──────────────────────────────────────────
  content.push({
    text: 'Field & Unit Dictionary',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, 0, 0, SPACING.sm],
  });

  content.push(kvBlock([
    ['confidence', '0–100 (analysis confidence)'],
    ['predicted_probability', '0–100 (percentage, displayed as %)'],
    ['score_points', '0–100 (prediction score)'],
    ['bot confidence', '0–1 (ratio, displayed as %)'],
    ['pnl_pct', 'Percentage'],
    ['pnl_amount / pnl', 'Absolute currency amount (₹ or $ per market)'],
    ['thresholdPct', 'Percentage (price alert threshold)'],
    ['rating', '1–5 (journal trade rating)'],
    ['mfe_pct / mae_pct', 'Percentage (max favorable / adverse excursion)'],
  ]));

  // ── Identifiers ────────────────────────────────────────────────────────
  content.push({
    text: 'Report Identifiers',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, SPACING.sm, 0, SPACING.sm],
  });

  const identPairs: [string, string][] = [
    ['PDF ID', pdfId],
    ['User ID', sanitize(userId)],
    ['Time zone', timeZone],
    ['Generated (local)', fmtDateTimeFull(generatedAt)],
    ['Generated (UTC)', fmtIsoUtc(generatedAt)],
  ];
  if (fingerprint) {
    identPairs.push(['Record fingerprint', fingerprint]);
  } else {
    identPairs.push(['Record fingerprint', 'Unavailable (non-secure context)']);
  }
  content.push(kvBlock(identPairs));

  // ── Library versions ───────────────────────────────────────────────────
  content.push({
    text: 'Libraries',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, SPACING.sm, 0, SPACING.sm],
  });

  content.push(kvBlock([
    ['PDF engine', 'pdfmake 0.3.14'],
    ['Primary font', 'Roboto (bundled with pdfmake)'],
    ['Devanagari font', 'Noto Sans Devanagari (conditional)'],
    ['Encryption', 'AES-256 (PDF 1.7ext3, /V=5, /R=5)'],
  ]));

  // ── PIN notice ─────────────────────────────────────────────────────────
  content.push({
    text: 'Password & Security',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, SPACING.sm, 0, SPACING.sm],
  });

  content.push({
    text: [
      'This PDF is protected with your 4-digit engine PIN. ',
      'Your PIN is the password. Keep the PDF private. ',
      'A 4-digit PIN has only 10,000 possibilities, so it will not stop a determined person who gets the file. ',
      'The password is the PIN you had when the PDF was created; changing your PIN later does not change an existing PDF.',
    ].join(''),
    fontSize: FONT_SIZE.body,
    color: theme.textPrimary,
    lineHeight: 1.3,
    margin: [0, 0, 0, SPACING.lg],
  });

  // ── Disclaimer ─────────────────────────────────────────────────────────
  content.push({
    text: 'Disclaimer',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, 0, 0, SPACING.sm],
  });

  content.push({
    text: 'Generated from your data. AI analyses are informational and are not financial advice.',
    fontSize: FONT_SIZE.body,
    color: theme.textPrimary,
    italics: true,
    lineHeight: 1.3,
    margin: [0, 0, 0, SPACING.lg],
  });

  // ── Confidentiality (also in footer) ───────────────────────────────────
  content.push({
    text: 'Confidential — contains your complete trading data.',
    style: 'confidential',
    alignment: 'center' as const,
    margin: [0, SPACING.md, 0, 0],
  });

  return content;
}
