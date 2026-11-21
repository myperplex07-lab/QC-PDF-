// src/pdf/pdfStats.ts
// ─────────────────────────────────────────────────────────────────────────
// Pure stat functions duplicated from AnalyticsDashboard.tsx:52-186
// and App.tsx:6078-6103 for PDF chart/table data.
// Section 14.3: duplicated with parity tests against hand-computed values.
//
// These are PURE functions — no React, no DOM, no imports from components.
// ─────────────────────────────────────────────────────────────────────────

/** Minimal trade log shape needed for stat computation. */
export interface StatTradeLog {
  id?: string;
  created_at: string;
  asset_name?: string;
  ticker?: string;
  market_sentiment: string;
  risk_level: string;
  confidence: number;
}

/** Minimal prediction score shape. */
export interface StatPredictionScore {
  id?: string;
  predicted_probability?: number;
  direction_correct?: boolean;
  score_points?: number;
  score_grade?: string;
  pattern_name?: string;
}

// ── Computed stats (matching AnalyticsDashboard computeStats L52-186) ─────

export interface ComputedStats {
  total: number;
  avgConf: number;
  sentiments: Record<string, number>;
  risks: Record<string, number>;
  topAssets: { name: string; count: number; avgConf: number }[];
  mostAnalyzed: { name: string; count: number; avgConf: number }[];
  confBuckets: number[];         // 5 buckets: 0-20, 20-40, 40-60, 60-80, 80-100
  streak: number;                // consecutive days with analyses ending today
  confTimeline: { date: string; avg: number }[];  // last 30 date averages
  best: StatTradeLog | null;
  worst: StatTradeLog | null;
  uniqueAssets: number;
  bullishConvictionRate: number; // % of bullish analyses with confidence >= 60
  highConfRate: number;          // % of analyses with confidence >= 75
  dayOfWeekActivity: number[];   // [Sun=0 .. Sat=6]
  mostActiveDay: string;
  avgRiskLabel: string;
  sentimentTimeline: { date: string; [sentiment: string]: string | number }[];
  monthlyVolume: { month: string; count: number }[];
}

/**
 * Compute all stats from audit-trail analyses.
 * Duplicated from AnalyticsDashboard.tsx:52-186 with identical logic.
 */
export function computeStats(logs: StatTradeLog[]): ComputedStats | null {
  if (logs.length === 0) return null;

  const total = logs.length;
  const avgConf = logs.reduce((s, l) => s + (Number(l.confidence) || 0), 0) / total;

  // Sentiment distribution
  const sentiments: Record<string, number> = {};
  logs.forEach(l => { sentiments[l.market_sentiment] = (sentiments[l.market_sentiment] || 0) + 1; });

  // Risk distribution
  const risks: Record<string, number> = {};
  logs.forEach(l => { risks[l.risk_level] = (risks[l.risk_level] || 0) + 1; });

  // Top assets by count
  const assetKey = (l: StatTradeLog) => l.asset_name || l.ticker || '';
  const assetCounts: Record<string, { count: number; totalConf: number }> = {};
  logs.forEach(l => {
    const name = assetKey(l);
    if (!assetCounts[name]) assetCounts[name] = { count: 0, totalConf: 0 };
    assetCounts[name].count++;
    assetCounts[name].totalConf += Number(l.confidence) || 0;
  });

  const topAssets = Object.entries(assetCounts)
    .map(([name, d]) => ({ name, count: d.count, avgConf: d.totalConf / d.count }))
    .sort((a, b) => b.avgConf - a.avgConf)
    .slice(0, 5);

  const mostAnalyzed = Object.entries(assetCounts)
    .map(([name, d]) => ({ name, count: d.count, avgConf: d.totalConf / d.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Confidence distribution (buckets: 0-20, 20-40, 40-60, 60-80, 80-100)
  const confBuckets = [0, 0, 0, 0, 0];
  logs.forEach(l => {
    const c = Number(l.confidence) || 0;
    const idx = Math.min(4, Math.floor(c / 20));
    confBuckets[idx]++;
  });

  // Analysis streak (consecutive days ending today)
  const daySet = new Set<string>();
  logs.forEach(l => daySet.add(new Date(l.created_at).toISOString().slice(0, 10)));
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (daySet.has(d.toISOString().slice(0, 10))) streak++;
    else break;
  }

  // Confidence over time (last 30 data points grouped by date)
  const byDate: Record<string, { sum: number; count: number }> = {};
  logs.forEach(l => {
    const d = new Date(l.created_at).toISOString().slice(0, 10);
    if (!byDate[d]) byDate[d] = { sum: 0, count: 0 };
    byDate[d].sum += Number(l.confidence) || 0;
    byDate[d].count++;
  });
  const confTimeline = Object.entries(byDate)
    .map(([date, d]) => ({ date, avg: d.sum / d.count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  // Best & worst single analysis
  const sorted = [...logs].sort((a, b) => b.confidence - a.confidence);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  // Unique assets
  const uniqueAssets = Object.keys(assetCounts).length;

  // Bullish conviction rate (bullish with confidence >= 60)
  const bullishConvictionCount = logs.filter(l => l.market_sentiment === 'bullish' && l.confidence >= 60).length;
  const bullishConvictionRate = total > 0 ? (bullishConvictionCount / total) * 100 : 0;

  // High-confidence rate (>= 75%)
  const highConfCount = logs.filter(l => (Number(l.confidence) || 0) >= 75).length;
  const highConfRate = total > 0 ? (highConfCount / total) * 100 : 0;

  // Day-of-week activity (0=Sun, 6=Sat)
  const dayOfWeekActivity = [0, 0, 0, 0, 0, 0, 0];
  logs.forEach(l => { dayOfWeekActivity[new Date(l.created_at).getDay()]++; });

  // Most active day
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const maxDayIdx = dayOfWeekActivity.indexOf(Math.max(...dayOfWeekActivity));
  const mostActiveDay = dayNames[maxDayIdx];

  // Average risk level
  const riskOrder: Record<string, number> = { low: 1, moderate: 2, medium: 2, high: 3, extreme: 4 };
  const avgRiskNum = logs.reduce((s, l) => s + (riskOrder[l.risk_level] || 2), 0) / total;
  const avgRiskLabel = avgRiskNum <= 1.5 ? 'low' : avgRiskNum <= 2.5 ? 'medium' : avgRiskNum <= 3.5 ? 'high' : 'extreme';

  // Sentiment over time (last 20 sessions grouped by date)
  const sentByDate: Record<string, Record<string, number>> = {};
  logs.forEach(l => {
    const d = new Date(l.created_at).toISOString().slice(0, 10);
    if (!sentByDate[d]) sentByDate[d] = {};
    sentByDate[d][l.market_sentiment] = (sentByDate[d][l.market_sentiment] || 0) + 1;
  });
  const sentimentTimeline = Object.entries(sentByDate)
    .map(([date, sents]) => ({ date, ...sents }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-20);

  // Monthly volume (last 6 months)
  const monthlyVolume: { month: string; count: number }[] = [];
  const monthMap: Record<string, number> = {};
  logs.forEach(l => {
    const m = new Date(l.created_at).toISOString().slice(0, 7);
    monthMap[m] = (monthMap[m] || 0) + 1;
  });
  const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  Object.entries(monthMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .forEach(([month, count]) => {
      const [y, m] = month.split('-');
      monthlyVolume.push({ month: `${mNames[parseInt(m) - 1]} ${y.slice(2)}`, count });
    });

  return {
    total, avgConf, sentiments, risks, topAssets, mostAnalyzed,
    confBuckets, streak, confTimeline, best, worst, uniqueAssets,
    bullishConvictionRate, highConfRate, dayOfWeekActivity,
    mostActiveDay, avgRiskLabel, sentimentTimeline, monthlyVolume,
  };
}

// ── Confidence calibration buckets (from App.tsx:6090-6103) ───────────────

export interface CalibrationBucket {
  label: string;
  total: number;
  wins: number;
  rate: number; // wins/total as %
}

/** 5-bucket calibration matching App.tsx:6090-6103. */
export function computeCalibration(scores: StatPredictionScore[]): CalibrationBucket[] {
  const CALIB_LABELS = ['0-20', '20-40', '40-60', '60-80', '80-100'];
  const buckets = CALIB_LABELS.map(label => ({ label, total: 0, wins: 0, rate: 0 }));

  for (const ps of scores) {
    const p = ps.predicted_probability || 0;
    const idx = Math.min(4, Math.max(0, Math.floor(p / 20)));
    buckets[idx].total++;
    if (ps.direction_correct) buckets[idx].wins++;
  }

  // Compute rate
  for (const b of buckets) {
    b.rate = b.total > 0 ? (b.wins / b.total) * 100 : 0;
  }

  return buckets;
}

// ── Pattern performance (from App.tsx:6078-6088) ─────────────────────────

export interface PatternPerf {
  name: string;
  count: number;
  wins: number;
  winRate: number;      // %
  avgScore: number;
}

/** Performance by pattern matching App.tsx:6078-6088. */
export function computePatternPerformance(scores: StatPredictionScore[]): PatternPerf[] {
  const byPattern: Record<string, { count: number; wins: number; totalPts: number }> = {};

  for (const ps of scores) {
    const pn = ps.pattern_name || 'No Pattern';
    if (!byPattern[pn]) byPattern[pn] = { count: 0, wins: 0, totalPts: 0 };
    byPattern[pn].count++;
    if (ps.direction_correct) byPattern[pn].wins++;
    byPattern[pn].totalPts += ps.score_points || 0;
  }

  return Object.entries(byPattern)
    .map(([name, d]) => ({
      name,
      count: d.count,
      wins: d.wins,
      winRate: d.count > 0 ? (d.wins / d.count) * 100 : 0,
      avgScore: d.count > 0 ? d.totalPts / d.count : 0,
    }))
    .sort((a, b) => b.winRate - a.winRate);
}

// ── Grade distribution ───────────────────────────────────────────────────

export interface GradeDistribution {
  grade: string;
  count: number;
}

export function computeGradeDistribution(scores: StatPredictionScore[]): GradeDistribution[] {
  const grades: Record<string, number> = {};
  for (const ps of scores) {
    const g = ps.score_grade || 'N/A';
    grades[g] = (grades[g] || 0) + 1;
  }

  const gradeOrder = ['A+', 'A', 'B', 'C', 'D', 'F', 'N/A'];
  return gradeOrder
    .filter(g => (grades[g] ?? 0) > 0)
    .map(grade => ({ grade, count: grades[grade] ?? 0 }));
}

// ── Sentiment heatmap data (from SentimentHeatmap.tsx:41-72) ──────────────

export interface HeatmapDay {
  date: string;      // YYYY-MM-DD
  count: number;
  sentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  avgConfidence: number;
}

/** Build 365-day heatmap data from trade logs. */
export function buildHeatmapData(logs: StatTradeLog[]): Map<string, HeatmapDay> {
  const map = new Map<string, HeatmapDay>();

  for (const log of logs) {
    const dateKey = new Date(log.created_at).toISOString().slice(0, 10);
    const existing = map.get(dateKey);

    if (existing) {
      existing.count += 1;
      existing.avgConfidence =
        (existing.avgConfidence * (existing.count - 1) + (Number(log.confidence) || 0)) /
        existing.count;
      if (log.market_sentiment !== existing.sentiment && existing.sentiment !== 'mixed') {
        existing.sentiment = 'mixed';
      }
    } else {
      map.set(dateKey, {
        date: dateKey,
        count: 1,
        sentiment: (log.market_sentiment as HeatmapDay['sentiment']) || 'neutral',
        avgConfidence: Number(log.confidence) || 0,
      });
    }
  }

  return map;
}
