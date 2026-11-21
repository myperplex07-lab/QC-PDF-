// src/pdf/sections/presets.ts
// ─────────────────────────────────────────────────────────────────────────
// Context Presets — Section 11.10 of the prompt.
// ─────────────────────────────────────────────────────────────────────────

import type { DocBuilderContext, BuildWarnings } from '../docBuilder';
import { sectionPageBreak, emptyState, themedTableLayout } from '../docBuilder';
import { FONT_SIZE, SPACING, MAX_TEXT_FIELD_CHARS } from '../layout';
import { fmtDateTime, titleCase, MISSING } from '../formatters';
import { sanitize, prepareText, wrapLongTokens } from '../sanitizer';

const TRUNCATION_MARKER = '…[shortened in PDF; full text in the ZIP export]';

function truncateText(text: string, warnings: BuildWarnings): string {
  if (text.length <= MAX_TEXT_FIELD_CHARS) return text;
  warnings.fieldsShortened++;
  return [...text].slice(0, MAX_TEXT_FIELD_CHARS).join('') + TRUNCATION_MARKER;
}

/** Build the Context Presets section. */
export function buildPresetsSection(ctx: DocBuilderContext, warnings: BuildWarnings): any[] {
  const { theme, data } = ctx;
  const presets = data.contextPresets;
  const content: any[] = [];

  content.push(sectionPageBreak());
  content.push({
    text: 'Context Presets',
    fontSize: FONT_SIZE.h1,
    bold: true,
    color: theme.accentColor,
    tocItem: true,
    margin: [0, 0, 0, SPACING.lg],
  });

  if (presets.length === 0) {
    content.push(emptyState('Context Presets', theme));
    return content;
  }

  // Show each preset as a card with its fields
  for (let i = 0; i < presets.length; i++) {
    const preset = presets[i];

    // Filter out user_id and id for display
    const displayKeys = Object.keys(preset).filter(
      k => k !== 'user_id' && k !== 'id'
    );

    const pairs: [string, string][] = displayKeys.map(k => {
      const val = preset[k];
      let display: string;
      if (val === null || val === undefined) {
        display = MISSING;
      } else if (typeof val === 'object') {
        display = JSON.stringify(val, null, 2);
      } else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
        display = fmtDateTime(val);
      } else {
        display = String(val);
      }
      const { text: cleaned, replacedCount } = prepareText(display);
      warnings.charsReplaced += replacedCount;
      return [titleCase(k)!, truncateText(wrapLongTokens(cleaned), warnings)];
    });

    content.push({
      stack: [
        {
          text: `Preset ${i + 1}: ${wrapLongTokens(sanitize(String(preset.name ?? preset.label ?? `#${i + 1}`)))}`,
          fontSize: FONT_SIZE.h3,
          bold: true,
          color: theme.accentColor,
          margin: [0, i > 0 ? SPACING.md : 0, 0, SPACING.xs],
        },
        {
          table: {
            headerRows: 0,
            widths: [120, '*'],
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
        },
      ],
      unbreakable: pairs.length <= 6,
    });
  }

  return content;
}
