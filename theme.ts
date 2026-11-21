// src/pdf/theme.ts
// ─────────────────────────────────────────────────────────────────────────
// PDF theme tokens for all 6 combinations (2 modes × 3 accents).
// ALL colour values live here. No colour literals anywhere else in src/pdf/.
// ─────────────────────────────────────────────────────────────────────────

export type AccentName = 'emerald' | 'blue' | 'red';
export type ModeName = 'dark' | 'light';

/** Full token set used by every PDF section and chart builder. */
export interface PdfTheme {
  mode: ModeName;
  accent: AccentName;
  /** Human label for cover/appendix, e.g. "Dark · Emerald Vector" */
  label: string;

  // ── Page ───────────────────────────────────────────────────────────────
  pageBg: string;

  // ── Surfaces ───────────────────────────────────────────────────────────
  surface: string;
  surfaceAlt: string;

  // ── Borders ────────────────────────────────────────────────────────────
  border: string;

  // ── Text ───────────────────────────────────────────────────────────────
  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  // ── Accent ─────────────────────────────────────────────────────────────
  /** Headings, links, chart highlights */
  accentColor: string;
  /** Solid fills: table headers, badges */
  accentFill: string;
  /** Text drawn ON accentFill backgrounds */
  onAccent: string;
  /** Light tint for subtle accent backgrounds */
  accentSoft: string;

  // ── Meaning colours (independent of accent) ────────────────────────────
  bullish: string;
  bearish: string;
  neutral: string;
  volatile: string;
  riskLow: string;
  riskMed: string;
  riskHigh: string;
  riskExtreme: string;
  info: string;

  // ── Chart palette (≥ 8 distinguishable colours) ────────────────────────
  chartPalette: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Source accent RGB values — from App.tsx THEME_RGB (L1165-1168)
//   emerald: [16, 185, 129]   → Tailwind emerald-500 #10b981
//   blue:    [59, 130, 246]   → Tailwind blue-500    #3b82f6
//   red:     [239, 68, 68]    → Tailwind red-500     #ef4444
// ─────────────────────────────────────────────────────────────────────────

/** Tailwind accent-500 hex values (source of truth for the PDF). */
export const ACCENT_HEX: Record<AccentName, string> = {
  emerald: '#10b981',
  blue: '#3b82f6',
  red: '#ef4444',
};

/** Accent labels matching App.tsx THEME_COLORS (L165-167). */
export const ACCENT_LABELS: Record<AccentName, string> = {
  emerald: 'Emerald Vector',
  blue: 'Cyber Blue',
  red: 'Neon Red',
};

// ─────────────────────────────────────────────────────────────────────────
// Colour helpers — used only within this file
// ─────────────────────────────────────────────────────────────────────────

/** Parse "#rrggbb" → [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/** [r, g, b] → "#rrggbb". */
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
}

/**
 * Mix a colour toward white or black by `amount` (0–1).
 * direction > 0 → lighten (mix toward white), < 0 → darken (mix toward black).
 */
function adjustBrightness(hex: string, amount: number, direction: 1 | -1): string {
  const [r, g, b] = hexToRgb(hex);
  const target = direction > 0 ? 255 : 0;
  return rgbToHex(
    r + (target - r) * amount,
    g + (target - g) * amount,
    b + (target - b) * amount,
  );
}

/** Lighten by mixing toward white. */
export function lighten(hex: string, amount: number): string {
  return adjustBrightness(hex, amount, 1);
}

/** Darken by mixing toward black. */
export function darken(hex: string, amount: number): string {
  return adjustBrightness(hex, amount, -1);
}

/**
 * WCAG 2.x relative luminance of a hex colour.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.x contrast ratio between two hex colours.
 * Returns a value ≥ 1 (1 = identical, 21 = black on white).
 */
export function contrastRatio(fg: string, bg: string): number {
  const lFg = relativeLuminance(fg);
  const lBg = relativeLuminance(bg);
  const lighter = Math.max(lFg, lBg);
  const darker = Math.min(lFg, lBg);
  return (lighter + 0.05) / (darker + 0.05);
}

// ─────────────────────────────────────────────────────────────────────────
// Meaning colours — these are INDEPENDENT of the accent.
// Derived from Tailwind defaults used in the app.
//
// App evidence:
//   bullish → t.accent (emerald-400 #34d399) or emerald-500 #10b981
//   bearish → text-red-400 #f87171 or red-500 #ef4444
//   neutral → text-zinc-400 #a1a1aa
//   volatile → text-amber-400 #fbbf24
//   risk low → accent (green shades)
//   risk med → amber-500 #f59e0b
//   risk high → amber-500 #f59e0b (App.tsx:4762)
//   risk extreme → red-500 #ef4444
// ─────────────────────────────────────────────────────────────────────────

const MEANING_DARK = {
  bullish: '#34d399',   // emerald-400 — always green, never the accent
  bearish: '#f87171',   // red-400
  neutral: '#a1a1aa',   // zinc-400
  volatile: '#fbbf24',  // amber-400
  riskLow: '#34d399',   // emerald-400
  riskMed: '#fbbf24',   // amber-400
  riskHigh: '#f59e0b',  // amber-500
  riskExtreme: '#ef4444', // red-500
  info: '#60a5fa',      // blue-400
};

const MEANING_LIGHT = {
  bullish: '#059669',   // emerald-600 (darker for contrast on light bg)
  bearish: '#dc2626',   // red-600
  neutral: '#71717a',   // zinc-500
  volatile: '#b45309',  // amber-700 (amber-600 #d97706 fails 3:1 on #f0f0f2)
  riskLow: '#059669',   // emerald-600
  riskMed: '#b45309',   // amber-700 (matches volatile)
  riskHigh: '#92400e',  // amber-800 (darker than volatile for distinction)
  riskExtreme: '#dc2626', // red-600
  info: '#2563eb',      // blue-600
};

// ─────────────────────────────────────────────────────────────────────────
// Chart palettes — ≥ 8 distinguishable colours per mode
// ─────────────────────────────────────────────────────────────────────────

const CHART_PALETTE_DARK: readonly string[] = [
  '#34d399', // emerald-400
  '#60a5fa', // blue-400
  '#f87171', // red-400
  '#fbbf24', // amber-400
  '#a78bfa', // violet-400
  '#fb923c', // orange-400
  '#2dd4bf', // teal-400
  '#f472b6', // pink-400
  '#818cf8', // indigo-400
  '#38bdf8', // sky-400
] as const;

const CHART_PALETTE_LIGHT: readonly string[] = [
  '#059669', // emerald-600
  '#2563eb', // blue-600
  '#dc2626', // red-600
  '#d97706', // amber-600
  '#7c3aed', // violet-600
  '#ea580c', // orange-600
  '#0d9488', // teal-600
  '#db2777', // pink-600
  '#4f46e5', // indigo-600
  '#0284c7', // sky-600
] as const;

// ─────────────────────────────────────────────────────────────────────────
// Dark mode base colours
// Source: index.css — dark body bg #030303 (L15), panels #050505,
//         cards bg-zinc-900 #18181b, alt bg-zinc-800 #27272a,
//         borders border-zinc-800 #27272a / border-zinc-700 #3f3f46,
//         text zinc-100 #f4f4f5, zinc-300 #d4d4d8, zinc-500 #71717a
// ─────────────────────────────────────────────────────────────────────────

const DARK_BASE = {
  pageBg: '#0a0a0a',
  surface: '#18181b',    // zinc-900
  surfaceAlt: '#1e1e22', // between zinc-900 and zinc-800 for zebra contrast
  border: '#636370',     // derived: zinc-700 lightened for ≥ 3:1 on #0a0a0a (3.35:1)
  textPrimary: '#f4f4f5',   // zinc-100
  textSecondary: '#d4d4d8', // zinc-300
  textMuted: '#71717a',     // zinc-500
};

// ─────────────────────────────────────────────────────────────────────────
// Light mode base colours
// Source: index.css — light body bg #ebebef (L259),
//         surfaces #f8f8fa (L267), cards #f0f0f2 (L283),
//         alt #e0e0e4 (L286), borders #d4d4d8 (L292),
//         text zinc-900 #18181b (L300), zinc-700 #3f3f46 (L306),
//         zinc-500 #71717a (L312)
// ─────────────────────────────────────────────────────────────────────────

const LIGHT_BASE = {
  pageBg: '#f8f8fa',
  surface: '#f0f0f2',
  surfaceAlt: '#e8e8ec',    // between #f0f0f2 and #e0e0e4 for zebra
  border: '#8e8e96',        // derived: darkened for ≥ 3:1 on #f8f8fa (3.06:1)
  textPrimary: '#18181b',   // zinc-900
  textSecondary: '#3f3f46', // zinc-700
  textMuted: '#71717a',     // zinc-500
};

// ─────────────────────────────────────────────────────────────────────────
// Accent-specific overrides per mode
// ─────────────────────────────────────────────────────────────────────────

interface AccentTokens {
  accentColor: string;
  accentFill: string;
  onAccent: string;
  accentSoft: string;
}

function darkAccentTokens(name: AccentName): AccentTokens {
  const hex = ACCENT_HEX[name];
  // For table headers/badges, darken the fill so white text meets 4.5:1.
  // emerald-500 (#10b981) → darken 0.35 ≈ #0a7853 (ratio ~6.1:1 with white)
  // blue-500 (#3b82f6) already close, darken 0.20 ≈ #2f68c5 (ratio ~5.4:1)
  // red-500 (#ef4444) → darken 0.25 ≈ #b33333 (ratio ~5.0:1)
  const fillDarkenMap: Record<AccentName, number> = { emerald: 0.35, blue: 0.20, red: 0.25 };
  const accentFill = darken(hex, fillDarkenMap[name]);
  return {
    accentColor: hex,
    accentFill,
    onAccent: '#ffffff',
    accentSoft: darken(hex, 0.7), // very dark tint for dark backgrounds
  };
}

function lightAccentTokens(name: AccentName): AccentTokens {
  const hex = ACCENT_HEX[name];
  // For light mode, darken accent text for contrast, darken fill for 4.5:1 with white
  const darker = darken(hex, 0.15);
  const fillDarkenMap: Record<AccentName, number> = { emerald: 0.35, blue: 0.20, red: 0.25 };
  const accentFill = darken(hex, fillDarkenMap[name]);
  return {
    accentColor: darker,
    accentFill,
    onAccent: '#ffffff',
    accentSoft: lighten(hex, 0.85), // very light tint for light backgrounds
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Theme builder
// ─────────────────────────────────────────────────────────────────────────

function buildTheme(mode: ModeName, accent: AccentName): PdfTheme {
  const isDark = mode === 'dark';
  const base = isDark ? DARK_BASE : LIGHT_BASE;
  const accentTokens = isDark ? darkAccentTokens(accent) : lightAccentTokens(accent);
  const meaning = isDark ? MEANING_DARK : MEANING_LIGHT;

  return {
    mode,
    accent,
    label: `${isDark ? 'Dark' : 'Light'} · ${ACCENT_LABELS[accent]}`,
    ...base,
    ...accentTokens,
    ...meaning,
    chartPalette: isDark ? CHART_PALETTE_DARK : CHART_PALETTE_LIGHT,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Prebuilt themes — keyed by "dark-emerald" etc.
// ─────────────────────────────────────────────────────────────────────────

export type ThemeKey = `${ModeName}-${AccentName}`;

const ALL_ACCENTS: AccentName[] = ['emerald', 'blue', 'red'];
const ALL_MODES: ModeName[] = ['dark', 'light'];

export const PDF_THEMES: Record<ThemeKey, PdfTheme> = {} as Record<ThemeKey, PdfTheme>;

for (const mode of ALL_MODES) {
  for (const accent of ALL_ACCENTS) {
    const key: ThemeKey = `${mode}-${accent}`;
    (PDF_THEMES as any)[key] = buildTheme(mode, accent);
  }
}

/** Get the theme for the user's current mode and accent. */
export function getPdfTheme(isDarkMode: boolean, accentTheme: AccentName): PdfTheme {
  const mode: ModeName = isDarkMode ? 'dark' : 'light';
  const key: ThemeKey = `${mode}-${accentTheme}`;
  return PDF_THEMES[key];
}

/** All 6 theme keys for iteration (tests, samples). */
export const ALL_THEME_KEYS: ThemeKey[] = ALL_MODES.flatMap(
  m => ALL_ACCENTS.map(a => `${m}-${a}` as ThemeKey)
);
