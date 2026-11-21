// tests/test_pdf_contrast.cjs
// ─────────────────────────────────────────────────────────────────────────
// WCAG 2.x contrast-ratio test for all 6 PDF theme palettes.
// Section 8.4: body text ≥ 4.5:1, large text ≥ 3:1, borders/graphics ≥ 3:1.
// ─────────────────────────────────────────────────────────────────────────
// Run: node tests/test_pdf_contrast.cjs
// (CJS because the project is "type":"module" and we need require for tsx-free run)

// ── Inline the contrast helpers (theme.ts is TS, can't require directly) ──
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg, bg) {
  const lFg = relativeLuminance(fg);
  const lBg = relativeLuminance(bg);
  const lighter = Math.max(lFg, lBg);
  const darker = Math.min(lFg, lBg);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── Theme definitions (must match src/pdf/theme.ts exactly) ──────────────

const ACCENT_HEX = { emerald: '#10b981', blue: '#3b82f6', red: '#ef4444' };

function darken(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  return '#' + [r, g, b].map(c => Math.round(c + (0 - c) * amount).toString(16).padStart(2, '0')).join('');
}
function lighten(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  return '#' + [r, g, b].map(c => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0')).join('');
}

const DARK_BASE = {
  pageBg: '#0a0a0a', surface: '#18181b', surfaceAlt: '#1e1e22',
  border: '#636370',
  textPrimary: '#f4f4f5', textSecondary: '#d4d4d8', textMuted: '#71717a',
};
const LIGHT_BASE = {
  pageBg: '#f8f8fa', surface: '#f0f0f2', surfaceAlt: '#e8e8ec',
  border: '#8e8e96',
  textPrimary: '#18181b', textSecondary: '#3f3f46', textMuted: '#71717a',
};

const MEANING_DARK = {
  bullish: '#34d399', bearish: '#f87171', neutral: '#a1a1aa', volatile: '#fbbf24',
  riskLow: '#34d399', riskMed: '#fbbf24', riskHigh: '#f59e0b', riskExtreme: '#ef4444',
  info: '#60a5fa',
};
const MEANING_LIGHT = {
  bullish: '#059669', bearish: '#dc2626', neutral: '#71717a', volatile: '#b45309',
  riskLow: '#059669', riskMed: '#b45309', riskHigh: '#92400e', riskExtreme: '#dc2626',
  info: '#2563eb',
};

function buildTheme(mode, accent) {
  const isDark = mode === 'dark';
  const base = isDark ? DARK_BASE : LIGHT_BASE;
  const hex = ACCENT_HEX[accent];
  const fillDarkenMap = { emerald: 0.35, blue: 0.20, red: 0.25 };
  const accentFill = darken(hex, fillDarkenMap[accent]);
  const accentTokens = isDark
    ? { accentColor: hex, accentFill, onAccent: '#ffffff', accentSoft: darken(hex, 0.7) }
    : { accentColor: darken(hex, 0.15), accentFill, onAccent: '#ffffff', accentSoft: lighten(hex, 0.85) };
  const meaning = isDark ? MEANING_DARK : MEANING_LIGHT;
  return { mode, accent, ...base, ...accentTokens, ...meaning };
}

const ALL_THEMES = [];
for (const mode of ['dark', 'light']) {
  for (const accent of ['emerald', 'blue', 'red']) {
    ALL_THEMES.push(buildTheme(mode, accent));
  }
}

// ── Test pairs ───────────────────────────────────────────────────────────
// Each pair: [foreground_token, background_token, min_ratio, description]
//   min 4.5 for body text, min 3.0 for large text / borders / graphics

function getTestPairs(t) {
  return [
    // Body text on page background
    [t.textPrimary, t.pageBg, 4.5, 'textPrimary on pageBg'],
    [t.textSecondary, t.pageBg, 4.5, 'textSecondary on pageBg'],
    [t.textMuted, t.pageBg, 3.0, 'textMuted on pageBg (large/caption)'],

    // Body text on surface (cards, table rows)
    [t.textPrimary, t.surface, 4.5, 'textPrimary on surface'],
    [t.textSecondary, t.surface, 4.5, 'textSecondary on surface'],
    [t.textMuted, t.surface, 3.0, 'textMuted on surface (large/caption)'],

    // Body text on surfaceAlt (zebra rows)
    [t.textPrimary, t.surfaceAlt, 4.5, 'textPrimary on surfaceAlt'],
    [t.textSecondary, t.surfaceAlt, 4.5, 'textSecondary on surfaceAlt'],

    // onAccent text on accentFill (table headers, badges)
    [t.onAccent, t.accentFill, 4.5, 'onAccent on accentFill'],

    // Accent text on page background (headings — large text, 3:1)
    [t.accentColor, t.pageBg, 3.0, 'accentColor on pageBg (headings)'],
    [t.accentColor, t.surface, 3.0, 'accentColor on surface (headings)'],

    // Meaning colours on page background (badges always have text label too, so 3:1)
    [t.bullish, t.pageBg, 3.0, 'bullish on pageBg'],
    [t.bearish, t.pageBg, 3.0, 'bearish on pageBg'],
    [t.neutral, t.pageBg, 3.0, 'neutral on pageBg'],
    [t.volatile, t.pageBg, 3.0, 'volatile on pageBg'],
    [t.riskLow, t.pageBg, 3.0, 'riskLow on pageBg'],
    [t.riskMed, t.pageBg, 3.0, 'riskMed on pageBg'],
    [t.riskHigh, t.pageBg, 3.0, 'riskHigh on pageBg'],
    [t.riskExtreme, t.pageBg, 3.0, 'riskExtreme on pageBg'],
    [t.info, t.pageBg, 3.0, 'info on pageBg'],

    // Meaning colours on surface
    [t.bullish, t.surface, 3.0, 'bullish on surface'],
    [t.bearish, t.surface, 3.0, 'bearish on surface'],
    [t.volatile, t.surface, 3.0, 'volatile on surface'],
    [t.info, t.surface, 3.0, 'info on surface'],

    // Border on page background (must carry meaning, 3:1)
    [t.border, t.pageBg, 3.0, 'border on pageBg'],
  ];
}

// ── Run ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

for (const t of ALL_THEMES) {
  const label = `${t.mode}-${t.accent}`;
  const pairs = getTestPairs(t);

  for (const [fg, bg, minRatio, desc] of pairs) {
    const ratio = contrastRatio(fg, bg);
    if (ratio >= minRatio) {
      passed++;
    } else {
      failed++;
      failures.push({ theme: label, desc, fg, bg, ratio: ratio.toFixed(2), required: minRatio });
    }
  }
}

console.log(`\nWCAG Contrast Test — ${ALL_THEMES.length} themes, ${passed + failed} pairs total`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failures.length > 0) {
  console.log('\nFAILURES:');
  for (const f of failures) {
    console.log(`  [${f.theme}] ${f.desc}: ${f.ratio} < ${f.required} (fg=${f.fg}, bg=${f.bg})`);
  }
  process.exit(1);
} else {
  console.log('\nAll contrast pairs pass WCAG requirements.');
  process.exit(0);
}
