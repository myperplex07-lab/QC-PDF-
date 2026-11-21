// src/pdf/sections/botSignals.ts
// ─────────────────────────────────────────────────────────────────────────
// Bot Signals — Section 11.11 of the prompt.
// Summary (counts by status, totals) + latest N rows.
// Note about ZIP for full history.
// ─────────────────────────────────────────────────────────────────────────

import type { DocBuilderContext, BuildWarnings } from '../docBuilder';
import { sectionPageBreak, emptyState, themedTableLayout } from '../docBuilder';
import { FONT_SIZE, SPACING } from '../layout';
import {
  fmtDateTime, fmtInt, fmtRatio, fmtCurrency, fmtDecimal,
  titleCase, badgeLabel, MISSING,
} from '../formatters';
import { sanitize, wrapLongTokens } from '../sanitizer';

function statusColor(status: string, theme: any): string {
  switch (status.toLowerCase()) {
    case 'completed': case 'filled': case 'executed': return theme.bullish;
    case 'cancelled': case 'canceled': case 'failed': return theme.bearish;
    case 'pending': case 'open': return theme.info;
    case 'active': return theme.neutral;
    default: return theme.textPrimary;
  }
}

/** Build the Bot Signals section. */
export function buildBotSignalsSection(ctx: DocBuilderContext, _warnings: BuildWarnings): any[] {
  const { theme, data, marketSource, counts } = ctx;
  const signals = [...data.botSignals].reverse(); // newest first
  const content: any[] = [];

  content.push(sectionPageBreak());
  content.push({
    text: 'Bot Signals',
    fontSize: FONT_SIZE.h1,
    bold: true,
    color: theme.accentColor,
    tocItem: true,
    margin: [0, 0, 0, SPACING.lg],
  });

  if (signals.length === 0) {
    content.push(emptyState('Bot Signals', theme));
    return content;
  }

  // ── Summary: counts by status ──────────────────────────────────────────
  const statusCounts = new Map<string, number>();
  let totalPnl = 0;
  let pnlCount = 0;

  for (const sig of signals) {
    const status = String(sig.status ?? 'unknown').toLowerCase();
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

    const pnl = sig.pnl as number | null | undefined;
    if (pnl != null && !isNaN(pnl)) {
      totalPnl += pnl;
      pnlCount++;
    }
  }

  const summaryPairs: [string, string][] = [
    ['Signals shown', `${fmtInt(signals.length)} of ${fmtInt(counts.botSignals)}`],
  ];

  // Sort statuses alphabetically for consistent display
  const sortedStatuses = [...statusCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [status, count] of sortedStatuses) {
    summaryPairs.push([titleCase(status)!, fmtInt(count)]);
  }

  if (pnlCount > 0) {
    summaryPairs.push(['Total P&L', fmtCurrency(totalPnl, marketSource)]);
  }

  content.push({
    text: 'Summary',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, 0, 0, SPACING.sm],
  });

  content.push({
    table: {
      headerRows: 0,
      widths: [140, '*'],
      body: summaryPairs.map(([k, v]) => [
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
    margin: [0, 0, 0, SPACING.lg],
  });

  // ── Note about full history ────────────────────────────────────────────
  if (counts.botSignals > signals.length) {
    content.push({
      text: `Showing the latest ${fmtInt(signals.length)} signals. The full history (${fmtInt(counts.botSignals)} signals) is available in the ZIP export.`,
      fontSize: FONT_SIZE.caption,
      color: theme.textMuted,
      italics: true,
      margin: [0, 0, 0, SPACING.md],
    });
  }

  // ── Signal rows table ──────────────────────────────────────────────────
  content.push({
    text: `Latest Signals`,
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, 0, 0, SPACING.sm],
  });

  const tableBody: any[][] = [
    [
      { text: '#', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Date', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Ticker', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Signal', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Status', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Conf', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
      { text: 'P&L', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
    ],
  ];

  for (let i = 0; i < signals.length; i++) {
    const sig = signals[i];
    const status = String(sig.status ?? '');
    const conf = sig.confidence as number | null | undefined;
    const pnl = sig.pnl as number | null | undefined;

    tableBody.push([
      { text: String(i + 1), fontSize: FONT_SIZE.table, color: theme.textMuted },
      { text: fmtDateTime(sig.created_at as string | null), fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: wrapLongTokens(sanitize(String(sig.ticker ?? sig.symbol ?? ''))), fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: titleCase(String(sig.signal_type ?? sig.type ?? sig.action ?? '')), fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: badgeLabel(status), fontSize: FONT_SIZE.table, color: statusColor(status, theme), bold: true },
      { text: conf != null ? fmtRatio(conf) : MISSING, fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
      {
        text: pnl != null ? fmtCurrency(pnl, marketSource) : MISSING,
        fontSize: FONT_SIZE.table,
        color: pnl != null && pnl > 0 ? theme.bullish : pnl != null && pnl < 0 ? theme.bearish : theme.textPrimary,
        alignment: 'right' as const,
      },
    ]);
  }

  content.push({
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [20, 72, 60, 60, 55, 36, 60],
      body: tableBody,
    },
    layout: themedTableLayout(theme),
  });

  return content;
}
