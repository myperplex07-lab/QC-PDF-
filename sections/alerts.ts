// src/pdf/sections/alerts.ts
// ─────────────────────────────────────────────────────────────────────────
// Price Alerts — Section 11.9 of the prompt.
// Labelled "this device only; may include items from other accounts
// used on this browser".
// ─────────────────────────────────────────────────────────────────────────

import type { DocBuilderContext, BuildWarnings } from '../docBuilder';
import { sectionPageBreak, emptyState, themedTableLayout } from '../docBuilder';
import { FONT_SIZE, SPACING } from '../layout';
import { fmtDateTime, fmtDecimal, fmtPercent, fmtCurrency, titleCase, MISSING } from '../formatters';
import { sanitize, wrapLongTokens } from '../sanitizer';

/** Build the Price Alerts section. */
export function buildAlertsSection(ctx: DocBuilderContext, _warnings: BuildWarnings): any[] {
  const { theme, data, marketSource } = ctx;
  const alerts = data.priceAlerts;
  const content: any[] = [];

  content.push(sectionPageBreak());
  content.push({
    text: 'Price Alerts',
    fontSize: FONT_SIZE.h1,
    bold: true,
    color: theme.accentColor,
    tocItem: true,
    margin: [0, 0, 0, SPACING.sm],
  });

  // Device-only notice (Section 11.9)
  content.push({
    text: 'This device only — may include items from other accounts used on this browser.',
    fontSize: FONT_SIZE.caption,
    color: theme.textMuted,
    italics: true,
    margin: [0, 0, 0, SPACING.lg],
  });

  if (alerts.length === 0) {
    content.push(emptyState('Price Alerts', theme));
    return content;
  }

  // Build table from alert objects
  // Common alert fields: ticker/symbol, type, threshold/targetPrice, direction, active/enabled, createdAt
  const tableBody: any[][] = [
    [
      { text: '#', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Ticker', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Type', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Target', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent, alignment: 'right' as const },
      { text: 'Direction', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Active', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
      { text: 'Created', fontSize: FONT_SIZE.table, bold: true, color: theme.onAccent },
    ],
  ];

  for (let i = 0; i < alerts.length; i++) {
    const a = alerts[i];

    // Resolve ticker from various possible key names
    const ticker = sanitize(String(a.ticker ?? a.symbol ?? a.stock ?? ''));

    // Type
    const alertType = a.type ?? a.alertType ?? '';

    // Target value
    const targetPrice = a.targetPrice ?? a.target_price ?? a.threshold ?? a.thresholdPct;
    let targetDisplay: string;
    if (targetPrice != null) {
      // If it's a percentage type
      if (String(alertType).toLowerCase().includes('pct') || String(alertType).toLowerCase().includes('percent') || a.thresholdPct != null) {
        targetDisplay = fmtPercent(Number(targetPrice));
      } else {
        targetDisplay = fmtCurrency(Number(targetPrice), marketSource);
      }
    } else {
      targetDisplay = MISSING;
    }

    // Direction
    const direction = a.direction ?? a.condition ?? '';

    // Active status
    const active = a.active ?? a.enabled;
    const activeDisplay = active === true ? 'Yes' : active === false ? 'No' : MISSING;

    // Created
    const created = a.createdAt ?? a.created_at ?? a.created;

    tableBody.push([
      { text: String(i + 1), fontSize: FONT_SIZE.table, color: theme.textMuted },
      { text: wrapLongTokens(ticker), fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: titleCase(String(alertType)), fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: targetDisplay, fontSize: FONT_SIZE.table, color: theme.textPrimary, alignment: 'right' as const },
      { text: titleCase(String(direction)), fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: activeDisplay, fontSize: FONT_SIZE.table, color: theme.textPrimary },
      { text: created ? fmtDateTime(created as string) : MISSING, fontSize: FONT_SIZE.table, color: theme.textPrimary },
    ]);
  }

  content.push({
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [20, 65, 55, 60, 55, 35, 75],
      body: tableBody,
    },
    layout: themedTableLayout(theme),
  });

  return content;
}
