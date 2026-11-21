// src/pdf/sanitizer.ts
// ─────────────────────────────────────────────────────────────────────────
// Text sanitizer, script-run splitter, and wrap helper.
// Section 12.2–12.5 of the prompt.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Sanitize a string for safe PDF embedding.
 * 1. Unicode NFC normalize
 * 2. Strip control characters (keep \n, \t)
 * 3. Collapse odd whitespace
 * 4. Consistent line breaks (\r\n → \n)
 */
export function sanitize(input: string | null | undefined): string {
  if (input == null) return '';
  let s = String(input);

  // NFC normalize
  s = s.normalize('NFC');

  // Consistent line breaks
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Strip control characters except \n (0x0A) and \t (0x09)
  // Control chars: U+0000–U+0008, U+000B–U+000C, U+000E–U+001F, U+007F, U+0080–U+009F
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/g, '');

  // Collapse runs of spaces/tabs (but keep newlines)
  s = s.replace(/[^\S\n]+/g, ' ');

  // Trim each line
  s = s.split('\n').map(line => line.trim()).join('\n');

  // Collapse 3+ consecutive newlines to 2
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}

// ─────────────────────────────────────────────────────────────────────────
// Wrapping helper (Section 12.5)
// Long unbroken tokens get break opportunities after /, _, - and every
// 24 chars so nothing overflows table cells.
// ─────────────────────────────────────────────────────────────────────────

const BREAK_AFTER = /([/_\-])/g;
const MAX_UNBROKEN = 24;

/** Zero-width space for soft break opportunities. */
const ZWSP = '\u200B';

/**
 * Insert soft-break opportunities into long unbroken strings.
 * Breaks after `/`, `_`, `-`, and every 24 characters in any
 * remaining unbroken run.
 */
export function wrapLongTokens(input: string): string {
  if (!input || input.length < MAX_UNBROKEN) return input;

  // Phase 1: insert ZWSPs after break characters
  let result = input.replace(BREAK_AFTER, `$1${ZWSP}`);

  // Phase 2: break any remaining run of MAX_UNBROKEN+ chars
  result = result.replace(
    new RegExp(`([^\\s${ZWSP}]{${MAX_UNBROKEN}})`, 'g'),
    `$1${ZWSP}`,
  );

  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Script-run splitter (Section 12.3)
// Split text into runs by Unicode script so each run can be assigned
// the correct font (Latin vs Devanagari).
// ─────────────────────────────────────────────────────────────────────────

export type ScriptName = 'latin' | 'devanagari' | 'common';

export interface ScriptRun {
  text: string;
  script: ScriptName;
}

// Devanagari range: U+0900–U+097F, U+A8E0–U+A8FF (vedic extensions),
// U+1CD0–U+1CFF (vedic extensions 2)
const DEVANAGARI_RE = /[\u0900-\u097F\uA8E0-\uA8FF\u1CD0-\u1CFF]/;

// Basic Latin + Latin Extended + Latin Supplement
const LATIN_RE = /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/;

function classifyChar(ch: string): ScriptName {
  if (DEVANAGARI_RE.test(ch)) return 'devanagari';
  if (LATIN_RE.test(ch)) return 'latin';
  return 'common';
}

/**
 * Split text into runs of the same script.
 * 'common' characters (digits, punctuation, symbols, ₹) join the
 * adjacent non-common script. This keeps "₹१,२३४.५०" as one Devanagari
 * run and "$1,234.50" as one Latin run.
 */
export function splitByScript(text: string): ScriptRun[] {
  if (!text) return [];

  const chars = [...text]; // proper code-point iteration
  const rawRuns: { text: string; script: ScriptName }[] = [];

  let currentScript: ScriptName = 'common';
  let currentText = '';

  for (const ch of chars) {
    const sc = classifyChar(ch);
    if (sc !== 'common' && sc !== currentScript && currentScript !== 'common') {
      // Script boundary — flush
      rawRuns.push({ text: currentText, script: currentScript });
      currentText = ch;
      currentScript = sc;
    } else {
      if (sc !== 'common') currentScript = sc;
      currentText += ch;
    }
  }
  if (currentText) {
    rawRuns.push({ text: currentText, script: currentScript });
  }

  // Assign 'common'-only runs to the previous non-common script, or 'latin' default
  let lastNonCommon: ScriptName = 'latin';
  return rawRuns.map(run => {
    if (run.script !== 'common') {
      lastNonCommon = run.script;
      return run;
    }
    return { text: run.text, script: lastNonCommon };
  });
}

/**
 * Returns true if the text contains any Devanagari characters.
 * Used to decide whether to load the Devanagari font.
 */
export function containsDevanagari(text: string): boolean {
  return DEVANAGARI_RE.test(text);
}

// ─────────────────────────────────────────────────────────────────────────
// Unsupported character replacement (Section 12.2)
// Characters that no loaded font covers (emoji, rare symbols) are replaced
// with a visible placeholder and counted.
// ─────────────────────────────────────────────────────────────────────────

/** Placeholder for unsupported characters. */
export const UNSUPPORTED_PLACEHOLDER = '◻';

// Emoji regex: common emoji ranges (simplified, covers most)
const EMOJI_RE = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

/**
 * Replace unsupported characters (emoji, rare symbols) with a visible
 * placeholder. Returns the cleaned text and the count of replacements.
 */
export function replaceUnsupported(text: string): { cleaned: string; replacedCount: number } {
  let count = 0;
  const cleaned = text.replace(EMOJI_RE, () => {
    count++;
    return UNSUPPORTED_PLACEHOLDER;
  });
  return { cleaned, replacedCount: count };
}

/**
 * Full sanitization pipeline for a string going into the PDF.
 * 1. sanitize (NFC, control chars, whitespace)
 * 2. replaceUnsupported (emoji → placeholder)
 * 3. wrapLongTokens (break opportunities)
 * Returns the processed string and counts.
 */
export function prepareText(input: string | null | undefined): {
  text: string;
  replacedCount: number;
} {
  const s = sanitize(input);
  const { cleaned, replacedCount } = replaceUnsupported(s);
  return { text: wrapLongTokens(cleaned), replacedCount };
}
