// src/pdf/chartBuilders.ts
// ─────────────────────────────────────────────────────────────────────────
// Pure SVG chart builders for PDF statistics figures.
// Section 14.2: dedicated, pure, themed, return SVG strings.
//
// Each builder returns an SVG string that pdfmake embeds as vector graphics.
// All colours from PdfTheme. All measurements from layout.ts.
// No DOM, no animation, deterministic, testable in Node.
// ─────────────────────────────────────────────────────────────────────────

import type { PdfTheme } from './theme';
import { COLUMN_WIDTH, CONTENT_WIDTH, FONT_SIZE } from './layout';

// ── Shared helpers ───────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function svgWrap(width: number, height: number, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${inner}</svg>`;
}

// ── Bar chart ────────────────────────────────────────────────────────────

export interface BarChartData {
  label: string;
  value: number;
  color?: string;
}

/**
 * Horizontal bar chart.
 * @param data  Array of { label, value, color? }
 * @param theme  PDF theme
 * @param width  Chart width in points (default half-width)
 */
export function buildBarChart(
  data: BarChartData[],
  theme: PdfTheme,
  width: number = COLUMN_WIDTH,
  title?: string,
): string {
  if (data.length === 0) return '';

  const barHeight = 16;
  const gap = 6;
  const labelWidth = 70;
  const valueWidth = 40;
  const chartLeft = labelWidth + 4;
  const chartWidth = width - chartLeft - valueWidth - 8;
  const topPad = title ? 22 : 4;
  const height = topPad + data.length * (barHeight + gap) + 4;
  const maxVal = Math.max(...data.map(d => d.value), 1);

  let svg = '';

  if (title) {
    svg += `<text x="${width / 2}" y="14" text-anchor="middle" font-size="${FONT_SIZE.caption}" font-family="Roboto, sans-serif" fill="${esc(theme.textPrimary)}">${esc(title)}</text>`;
  }

  data.forEach((d, i) => {
    const y = topPad + i * (barHeight + gap);
    const barW = Math.max(1, (d.value / maxVal) * chartWidth);
    const color = d.color || theme.accentFill;

    // Label
    svg += `<text x="${labelWidth}" y="${y + barHeight / 2 + 4}" text-anchor="end" font-size="${FONT_SIZE.footer}" font-family="Roboto, sans-serif" fill="${esc(theme.textSecondary)}">${esc(d.label)}</text>`;

    // Bar
    svg += `<rect x="${chartLeft}" y="${y}" width="${barW}" height="${barHeight}" rx="2" fill="${esc(color)}" />`;

    // Value
    svg += `<text x="${chartLeft + chartWidth + 6}" y="${y + barHeight / 2 + 4}" font-size="${FONT_SIZE.footer}" font-family="Roboto, sans-serif" fill="${esc(theme.textPrimary)}">${d.value}</text>`;
  });

  return svgWrap(width, height, svg);
}

// ── Donut chart ──────────────────────────────────────────────────────────

export interface DonutChartData {
  label: string;
  value: number;
  color: string;
}

/**
 * Donut / ring chart.
 */
export function buildDonutChart(
  data: DonutChartData[],
  theme: PdfTheme,
  size: number = 120,
  title?: string,
  centerLabel?: string,
): string {
  if (data.length === 0 || data.every(d => d.value === 0)) return '';

  const cx = size / 2;
  const cy = size / 2 + (title ? 14 : 0);
  const totalHeight = size + (title ? 20 : 0) + 4;
  const r = size / 2 - 8;
  const strokeWidth = r * 0.35;
  const innerR = r - strokeWidth / 2;
  const total = data.reduce((s, d) => s + d.value, 0);

  let svg = '';

  if (title) {
    svg += `<text x="${size / 2}" y="12" text-anchor="middle" font-size="${FONT_SIZE.caption}" font-family="Roboto, sans-serif" fill="${esc(theme.textPrimary)}">${esc(title)}</text>`;
  }

  // Background ring
  svg += `<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="none" stroke="${esc(theme.border)}" stroke-width="${strokeWidth}" />`;

  // Segments
  const circumference = 2 * Math.PI * innerR;
  let offset = 0;

  for (const d of data) {
    if (d.value === 0) continue;
    const pct = d.value / total;
    const dash = pct * circumference;
    const gap = circumference - dash;

    svg += `<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="none" stroke="${esc(d.color)}" stroke-width="${strokeWidth}" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" />`;

    offset += dash;
  }

  // Center label
  if (centerLabel) {
    svg += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="${FONT_SIZE.body}" font-family="Roboto, sans-serif" fill="${esc(theme.textPrimary)}" font-weight="bold">${esc(centerLabel)}</text>`;
  }

  return svgWrap(size, totalHeight, svg);
}

// ── Gauge chart ──────────────────────────────────────────────────────────

/**
 * Semi-circular gauge (0–100).
 */
export function buildGaugeChart(
  value: number,
  theme: PdfTheme,
  size: number = 120,
  title?: string,
  label?: string,
): string {
  const cx = size / 2;
  const topPad = title ? 18 : 4;
  const gaugeR = size / 2 - 12;
  const cy = topPad + gaugeR + 4;
  const totalHeight = cy + 20;
  const strokeW = 10;

  const pct = Math.max(0, Math.min(100, value)) / 100;
  const arcLen = Math.PI * gaugeR; // semicircle
  const filled = pct * arcLen;

  let svg = '';

  if (title) {
    svg += `<text x="${cx}" y="14" text-anchor="middle" font-size="${FONT_SIZE.caption}" font-family="Roboto, sans-serif" fill="${esc(theme.textPrimary)}">${esc(title)}</text>`;
  }

  // Background arc (semicircle, left to right)
  svg += `<path d="M ${cx - gaugeR} ${cy} A ${gaugeR} ${gaugeR} 0 0 1 ${cx + gaugeR} ${cy}" fill="none" stroke="${esc(theme.border)}" stroke-width="${strokeW}" stroke-linecap="round" />`;

  // Filled arc
  svg += `<path d="M ${cx - gaugeR} ${cy} A ${gaugeR} ${gaugeR} 0 0 1 ${cx + gaugeR} ${cy}" fill="none" stroke="${esc(theme.accentColor)}" stroke-width="${strokeW}" stroke-linecap="round" stroke-dasharray="${filled} ${arcLen - filled}" />`;

  // Value text
  svg += `<text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="16" font-family="Roboto, sans-serif" fill="${esc(theme.textPrimary)}" font-weight="bold">${Math.round(value)}%</text>`;

  if (label) {
    svg += `<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="${FONT_SIZE.footer}" font-family="Roboto, sans-serif" fill="${esc(theme.textMuted)}">${esc(label)}</text>`;
  }

  return svgWrap(size, totalHeight, svg);
}

// ── Line chart ───────────────────────────────────────────────────────────

export interface LineChartPoint {
  label: string;
  value: number;
}

/**
 * Simple line chart with optional area fill.
 */
export function buildLineChart(
  points: LineChartPoint[],
  theme: PdfTheme,
  width: number = CONTENT_WIDTH,
  height: number = 150,
  title?: string,
): string {
  if (points.length < 2) return '';

  const padL = 32, padR = 8, padT = title ? 24 : 8, padB = 20;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const values = points.map(p => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const rangeV = maxV - minV || 1;

  function x(i: number) { return padL + (i / (points.length - 1)) * plotW; }
  function y(v: number) { return padT + plotH - ((v - minV) / rangeV) * plotH; }

  let svg = '';

  if (title) {
    svg += `<text x="${width / 2}" y="14" text-anchor="middle" font-size="${FONT_SIZE.caption}" font-family="Roboto, sans-serif" fill="${esc(theme.textPrimary)}">${esc(title)}</text>`;
  }

  // Y-axis labels
  for (let i = 0; i <= 4; i++) {
    const val = minV + (rangeV * i) / 4;
    const yPos = y(val);
    svg += `<text x="${padL - 4}" y="${yPos + 3}" text-anchor="end" font-size="6" font-family="Roboto, sans-serif" fill="${esc(theme.textMuted)}">${Math.round(val)}</text>`;
    svg += `<line x1="${padL}" y1="${yPos}" x2="${padL + plotW}" y2="${yPos}" stroke="${esc(theme.border)}" stroke-width="0.5" stroke-dasharray="2 2" />`;
  }

  // Area fill
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
  svg += `<path d="${pathD} L${x(points.length - 1)},${padT + plotH} L${x(0)},${padT + plotH} Z" fill="${esc(theme.accentColor)}" fill-opacity="0.1" />`;

  // Line
  svg += `<path d="${pathD}" fill="none" stroke="${esc(theme.accentColor)}" stroke-width="1.5" />`;

  // Dots
  points.forEach((p, i) => {
    svg += `<circle cx="${x(i)}" cy="${y(p.value)}" r="2" fill="${esc(theme.accentColor)}" />`;
  });

  // X-axis labels (every few points to avoid overlap)
  const step = Math.max(1, Math.floor(points.length / 6));
  for (let i = 0; i < points.length; i += step) {
    svg += `<text x="${x(i)}" y="${padT + plotH + 14}" text-anchor="middle" font-size="5" font-family="Roboto, sans-serif" fill="${esc(theme.textMuted)}">${esc(points[i].label)}</text>`;
  }

  return svgWrap(width, height, svg);
}

// ── Stacked bar (horizontal) for calibration ─────────────────────────────

export interface StackedBarEntry {
  label: string;
  segments: { value: number; color: string }[];
}

/**
 * Horizontal stacked bar chart (e.g., calibration or distribution).
 */
export function buildStackedBarChart(
  entries: StackedBarEntry[],
  theme: PdfTheme,
  width: number = CONTENT_WIDTH,
  title?: string,
): string {
  if (entries.length === 0) return '';

  const barH = 18;
  const gap = 6;
  const labelW = 50;
  const chartLeft = labelW + 4;
  const chartW = width - chartLeft - 8;
  const topPad = title ? 22 : 4;
  const height = topPad + entries.length * (barH + gap) + 4;

  const maxTotal = Math.max(...entries.map(e => e.segments.reduce((s, seg) => s + seg.value, 0)), 1);

  let svg = '';

  if (title) {
    svg += `<text x="${width / 2}" y="14" text-anchor="middle" font-size="${FONT_SIZE.caption}" font-family="Roboto, sans-serif" fill="${esc(theme.textPrimary)}">${esc(title)}</text>`;
  }

  entries.forEach((entry, i) => {
    const y = topPad + i * (barH + gap);
    // Label
    svg += `<text x="${labelW}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="${FONT_SIZE.footer}" font-family="Roboto, sans-serif" fill="${esc(theme.textSecondary)}">${esc(entry.label)}</text>`;

    let xOffset = chartLeft;
    for (const seg of entry.segments) {
      if (seg.value <= 0) continue;
      const w = Math.max(0.5, (seg.value / maxTotal) * chartW);
      svg += `<rect x="${xOffset}" y="${y}" width="${w}" height="${barH}" fill="${esc(seg.color)}" />`;
      xOffset += w;
    }
  });

  return svgWrap(width, height, svg);
}

// ── Heatmap (calendar-style for sentiment) ───────────────────────────────

export interface HeatmapCell {
  date: string;        // YYYY-MM-DD
  value: number;       // 0 = no data, 1+ = count
  color: string;       // fill colour
}

/**
 * Calendar-style heatmap (365-day grid).
 * Returns SVG that fits in full content width.
 */
export function buildHeatmapChart(
  cells: HeatmapCell[],
  theme: PdfTheme,
  width: number = CONTENT_WIDTH,
  title?: string,
): string {
  if (cells.length === 0) return '';

  const cellSize = Math.min(8, (width - 30) / 53); // ~53 weeks
  const gap = 1;
  const topPad = title ? 20 : 4;
  const leftPad = 20; // for day labels
  const totalH = topPad + 7 * (cellSize + gap) + 16; // 7 rows + month labels

  let svg = '';

  if (title) {
    svg += `<text x="${width / 2}" y="14" text-anchor="middle" font-size="${FONT_SIZE.caption}" font-family="Roboto, sans-serif" fill="${esc(theme.textPrimary)}">${esc(title)}</text>`;
  }

  // Day labels
  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
  dayLabels.forEach((label, i) => {
    if (!label) return;
    svg += `<text x="${leftPad - 3}" y="${topPad + i * (cellSize + gap) + cellSize / 2 + 3}" text-anchor="end" font-size="5" font-family="Roboto, sans-serif" fill="${esc(theme.textMuted)}">${label}</text>`;
  });

  // Build date→cell map
  const cellMap = new Map<string, HeatmapCell>();
  cells.forEach(c => cellMap.set(c.date, c));

  // Generate 52 weeks of cells
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 364);
  // Align to Sunday
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const current = new Date(startDate);
  let weekIdx = 0;
  const monthLabels = new Set<string>();

  while (current <= today) {
    const dayOfWeek = current.getDay();
    const dateStr = current.toISOString().slice(0, 10);
    const cell = cellMap.get(dateStr);
    const color = cell?.color || (theme.mode === 'dark' ? 'rgba(39,39,42,0.3)' : 'rgba(212,212,216,0.3)');

    const cx = leftPad + weekIdx * (cellSize + gap);
    const cy = topPad + dayOfWeek * (cellSize + gap);

    svg += `<rect x="${cx}" y="${cy}" width="${cellSize}" height="${cellSize}" rx="1" fill="${esc(color)}" />`;

    // Track month boundaries for labels
    if (current.getDate() <= 7 && dayOfWeek === 0) {
      const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthLabel = mNames[current.getMonth()];
      if (!monthLabels.has(monthLabel)) {
        monthLabels.add(monthLabel);
        svg += `<text x="${cx}" y="${topPad + 7 * (cellSize + gap) + 10}" font-size="5" font-family="Roboto, sans-serif" fill="${esc(theme.textMuted)}">${monthLabel}</text>`;
      }
    }

    current.setDate(current.getDate() + 1);
    if (dayOfWeek === 6) weekIdx++;
  }

  return svgWrap(width, totalH, svg);
}
