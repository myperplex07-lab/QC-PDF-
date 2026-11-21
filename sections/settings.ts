// src/pdf/sections/settings.ts
// ─────────────────────────────────────────────────────────────────────────
// Settings and Preferences — Section 11.12 of the prompt.
// Allow-listed settings + local preferences.
// ─────────────────────────────────────────────────────────────────────────

import type { DocBuilderContext, BuildWarnings } from '../docBuilder';
import { sectionPageBreak, emptyState } from '../docBuilder';
import { FONT_SIZE, SPACING } from '../layout';
import { fmtDateTime, titleCase, MISSING } from '../formatters';
import { sanitize } from '../sanitizer';

/** Build the Settings section. */
export function buildSettingsSection(ctx: DocBuilderContext, _warnings: BuildWarnings): any[] {
  const { theme, data } = ctx;
  const settings = data.settings;
  const localPrefs = data.localPreferences;
  const content: any[] = [];

  content.push(sectionPageBreak());
  content.push({
    text: 'Settings & Preferences',
    fontSize: FONT_SIZE.h1,
    bold: true,
    color: theme.accentColor,
    tocItem: true,
    margin: [0, 0, 0, SPACING.lg],
  });

  // ── Cloud settings (allow-listed) ──────────────────────────────────────
  const settingsKeys = Object.keys(settings ?? {});

  if (settingsKeys.length > 0) {
    content.push({
      text: 'Engine Settings',
      fontSize: FONT_SIZE.h2,
      bold: true,
      color: theme.accentColor,
      margin: [0, 0, 0, SPACING.sm],
    });

    const pairs: [string, string][] = settingsKeys.map(k => {
      const val = settings[k];
      let display: string;
      if (val === null || val === undefined) {
        display = MISSING;
      } else if (typeof val === 'boolean') {
        display = val ? 'Enabled' : 'Disabled';
      } else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
        display = fmtDateTime(val);
      } else {
        display = String(val);
      }
      return [titleCase(k)!, sanitize(display)];
    });

    content.push({
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
      margin: [0, 0, 0, SPACING.lg],
    });
  } else {
    content.push({
      text: 'No settings found.',
      fontSize: FONT_SIZE.body,
      color: theme.textMuted,
      italics: true,
      margin: [0, 0, 0, SPACING.lg],
    });
  }

  // ── Local preferences ──────────────────────────────────────────────────
  const prefKeys = Object.keys(localPrefs ?? {});

  content.push({
    text: 'Local Preferences',
    fontSize: FONT_SIZE.h2,
    bold: true,
    color: theme.accentColor,
    margin: [0, 0, 0, SPACING.sm],
  });

  content.push({
    text: 'Stored in this browser only.',
    fontSize: FONT_SIZE.caption,
    color: theme.textMuted,
    italics: true,
    margin: [0, 0, 0, SPACING.sm],
  });

  if (prefKeys.length > 0) {
    const prefPairs: [string, string][] = prefKeys.map(k => {
      const val = localPrefs[k];
      let display: string;
      if (val === null || val === undefined) {
        display = MISSING;
      } else if (typeof val === 'boolean') {
        display = val ? 'Yes' : 'No';
      } else {
        display = String(val);
      }
      return [titleCase(k)!, sanitize(display)];
    });

    content.push({
      table: {
        headerRows: 0,
        widths: [160, '*'],
        body: prefPairs.map(([k, v]) => [
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
    });
  } else {
    content.push({
      text: 'No local preferences found.',
      fontSize: FONT_SIZE.body,
      color: theme.textMuted,
      italics: true,
    });
  }

  return content;
}
