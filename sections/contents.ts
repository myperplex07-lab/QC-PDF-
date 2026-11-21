// src/pdf/sections/contents.ts
// ─────────────────────────────────────────────────────────────────────────
// Table of Contents — Section 11.2 of the prompt.
// Section names with page numbers. pdfmake supports toc natively.
// ─────────────────────────────────────────────────────────────────────────

import type { DocBuilderContext } from '../docBuilder';
import { sectionPageBreak } from '../docBuilder';
import { FONT_SIZE, SPACING, CONTENT_WIDTH } from '../layout';

/**
 * Build the Table of Contents section.
 *
 * Uses pdfmake's built-in TOC feature: `toc: { title }` creates a
 * table of contents populated from `tocItem` entries in other sections.
 * Section titles throughout the document use `tocItem: true` to register.
 */
export function buildContentsSection(ctx: DocBuilderContext): any[] {
  const { theme } = ctx;

  return [
    sectionPageBreak(),

    {
      text: 'Contents',
      fontSize: FONT_SIZE.h1,
      bold: true,
      color: theme.accentColor,
      margin: [0, 0, 0, SPACING.lg],
    },

    {
      toc: {
        // numberStyle controls the page number styling
        numberStyle: {
          fontSize: FONT_SIZE.body,
          color: theme.textMuted,
        },
        // textStyle controls the entry text styling
        textStyle: {
          fontSize: FONT_SIZE.body,
          color: theme.textPrimary,
        },
        // textMargin for each entry
        textMargin: [0, 4, 0, 4],
      },
    },
  ];
}
