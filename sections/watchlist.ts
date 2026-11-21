// src/pdf/sections/watchlist.ts
// ─────────────────────────────────────────────────────────────────────────
// Watchlist — Section 11.8 of the prompt.
// ─────────────────────────────────────────────────────────────────────────

import type { DocBuilderContext, BuildWarnings } from '../docBuilder';
import { sectionPageBreak, emptyState, themedTableLayout } from '../docBuilder';
import { FONT_SIZE, SPACING } from '../layout';
import { fmtDateTime, titleCase, MISSING } from '../formatters';
import { sanitize, wrapLongTokens } from '../sanitizer';

/** Build the Watchlist section. */
export function buildWatchlistSection(ctx: DocBuilderContext, _warnings: BuildWarnings): any[] {
  const { theme, data } = ctx;
  const items = data.watchlist;
  const content: any[] = [];

  content.push(sectionPageBreak());
  content.push({
    text: 'Watchlist',
    fontSize: FONT_SIZE.h1,
    bold: true,
    color: theme.accentColor,
    tocItem: true,
    margin: [0, 0, 0, SPACING.lg],
  });

  if (items.length === 0) {
    content.push(emptyState('Watchlist', theme));
    return content;
  }

  // Discover columns dynamically from the first row
  const sampleRow = items[0];
  const columnKeys = Object.keys(sampleRow).filter(
    k => k !== 'user_id' && k !== 'id'
  );

  // Build a table with discovered columns
  const widths = columnKeys.map(() => '*');
  const headerRow = columnKeys.map(k => ({
    text: titleCase(k),
    fontSize: FONT_SIZE.table,
    bold: true,
    color: theme.onAccent,
  }));

  const bodyRows = items.map(row =>
    columnKeys.map(k => {
      const val = row[k];
      let display: string;
      if (val === null || val === undefined) {
        display = MISSING;
      } else if (val instanceof Date || (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val))) {
        display = fmtDateTime(val as string);
      } else if (typeof val === 'object') {
        display = JSON.stringify(val);
      } else {
        display = String(val);
      }
      return {
        text: wrapLongTokens(sanitize(display)),
        fontSize: FONT_SIZE.table,
        color: theme.textPrimary,
      };
    })
  );

  content.push({
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths,
      body: [headerRow, ...bodyRows],
    },
    layout: themedTableLayout(theme),
  });

  return content;
}
