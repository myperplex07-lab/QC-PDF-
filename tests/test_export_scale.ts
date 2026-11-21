/**
 * Task 5 — Scale Test (Section 4.1 — Second Review)
 *
 * Two runs with realistic data sizes:
 *
 * Run 1 (images OFF):
 *   - trade_history: 5,000 rows, full_result ~30 KB each (Gemini JSON + rag_context + wss_context)
 *   - bot_signals: 20,000 rows, ~1 KB each
 *   - trade_journal: 1,000 rows, ~2 KB each
 *
 * Run 2 (images ON):
 *   - 500 analyses with 2 images each, ~300 KB base64 per image
 *
 * Size assumptions (stated):
 *   full_result is built in App.tsx L3886-3890 as {...data, rag_context, wss_context} where data
 *   is the Gemini JSON response containing synthesis_summary (~500 chars), extracted_data (~2 KB),
 *   pattern_detected (~500 bytes), prediction (~1 KB), technical_indicators (~1 KB),
 *   analysis (~2 KB), key_levels (~1 KB), trade_setup (~1 KB), thinking_process (~5-10 KB),
 *   cross_chart_correlation (~500 bytes), image_quality (~50 bytes). Plus rag_context (~5 KB)
 *   and wss_context (~2 KB). Total ~20-50 KB per row. We use ~30 KB.
 *
 *   Images: App.tsx stores base64 data-URIs in image_1/image_2 columns.
 *   Canvas-to-base64 output for a chart screenshot is typically 200-400 KB.
 *   We use ~300 KB of base64 per image.
 *
 * Reports: total time, peak memory (RSS + heap), ZIP size, longest sync block.
 *
 * Run:  npx tsx tests/test_export_scale.ts
 */

import JSZip from "jszip";
import { buildExportZip, type ExportDeps, type ExportProgress } from "../src/exportService.js";
import { performance, monitorEventLoopDelay } from "perf_hooks";

// ---------------------------------------------------------------------------
// Mock Supabase (same pattern as e2e, supporting large datasets + images)
// ---------------------------------------------------------------------------

interface MockTableData {
  rows: Record<string, unknown>[];
}

function createMockSupabase(tables: Record<string, MockTableData>) {
  return {
    from(table: string) {
      const tableData = tables[table] || { rows: [] };
      let userId: string | null = null;
      let selectStr = "*";
      let headOnly = false;
      let wantCount: "exact" | null = null;
      let rangeStart = 0;
      let rangeEnd = Infinity;
      let limitVal: number | null = null;
      let maybeSingle = false;
      let inColumn: string | null = null;
      let inValues: unknown[] | null = null;

      const builder: any = {
        select(s: string, opts?: { count?: "exact"; head?: boolean }) {
          selectStr = s;
          if (opts?.count) wantCount = opts.count;
          if (opts?.head) headOnly = true;
          return builder;
        },
        eq(col: string, val: string) { if (col === "user_id") userId = val; return builder; },
        in(col: string, vals: unknown[]) { inColumn = col; inValues = vals; return builder; },
        order() { return builder; },
        range(start: number, end: number) { rangeStart = start; rangeEnd = end; return builder; },
        limit(n: number) { limitVal = n; return builder; },
        maybeSingle() { maybeSingle = true; return builder; },
        then(resolve: (val: any) => void) {
          let rows = [...tableData.rows];
          if (userId) rows = rows.filter((r) => r.user_id === userId);
          if (inColumn && inValues) rows = rows.filter((r) => inValues!.includes(r[inColumn!]));

          if (headOnly && wantCount === "exact") {
            resolve({ data: null, error: null, count: rows.length });
            return;
          }
          if (limitVal !== null) rows = rows.slice(0, limitVal);
          if (rangeStart > 0 || rangeEnd < Infinity) rows = rows.slice(rangeStart, rangeEnd + 1);

          if (selectStr !== "*") {
            const cols = selectStr.split(",").map((c) => c.trim());
            rows = rows.map((r) => {
              const out: Record<string, unknown> = {};
              for (const c of cols) { if (c in r) out[c] = r[c]; }
              return out;
            });
          }

          if (maybeSingle) {
            resolve({ data: rows.length > 0 ? rows[0] : null, error: null });
            return;
          }
          resolve({ data: rows, error: null, count: wantCount === "exact" ? tableData.rows.filter((r) => userId ? r.user_id === userId : true).length : null });
        },
      };
      return builder;
    },
  };
}

// ---------------------------------------------------------------------------
// Data generators
// ---------------------------------------------------------------------------

const USER_ID = "user_scale_test";

/**
 * Generate a realistic full_result object of ~30 KB.
 * Mirrors the structure from App.tsx L3886-3890 where:
 *   fullPayload = { ...data, rag_context, wss_context }
 * and data is the Gemini API response JSON.
 */
function makeFullResult(i: number): Record<string, unknown> {
  // ~1.5 KB synthesis summary (realistic multi-paragraph analysis summary)
  const synthesisSummary = `Analysis #${i}: The chart shows a ${i % 2 === 0 ? "bullish" : "bearish"} pattern forming. ` +
    `Price action suggests a potential ${i % 3 === 0 ? "breakout" : "reversal"} near the ${1000 + i * 10} level. ` +
    `Volume is ${i % 2 === 0 ? "increasing" : "declining"}, indicating ${i % 2 === 0 ? "strong" : "weak"} conviction. ` +
    `Risk-reward ratio appears favorable at approximately ${(1.5 + (i % 30) / 10).toFixed(1)}:1. ` +
    `The overall market sentiment aligns with this setup. Additional confluence from moving averages and RSI support the bias. ` +
    `Fibonacci retracement levels at 0.382 and 0.618 coincide with horizontal support and resistance zones. ` +
    `The MACD histogram is showing divergence which often precedes significant price moves in this timeframe. ` +
    `Sector rotation analysis indicates money flowing into this asset class with increasing institutional participation. ` +
    `Options open interest data shows significant put writing at lower strikes suggesting strong support. ` +
    `The broader market context remains constructive with the index trading above its 200-day moving average. `.repeat(2);

  // ~2 KB extracted_data
  const extractedData = {
    visible_assets: [`ASSET_${i % 200}`, `INDEX_${i % 50}`],
    timeframe: ["1H", "4H", "1D", "1W"][i % 4],
    key_metrics: Array.from({ length: 8 }, (_, j) => `Metric ${j}: ${(100 + Math.random() * 50).toFixed(2)}`),
    detected_patterns: Array.from({ length: 3 }, (_, j) => ({
      name: ["Head and Shoulders", "Double Bottom", "Flag", "Wedge", "Triangle"][j % 5],
      confidence: (0.5 + Math.random() * 0.5).toFixed(2),
      location: `Near ${(1000 + i * 10 + j * 5).toFixed(0)}`,
    })),
    price_levels: {
      current: 1000 + i * 10,
      open: 998 + i * 10,
      high: 1005 + i * 10,
      low: 995 + i * 10,
      vwap: 1001 + i * 10,
    },
  };

  // ~1 KB prediction
  const prediction = {
    predicted_direction: i % 2 === 0 ? "up" : "down",
    predicted_probability: (0.5 + Math.random() * 0.4).toFixed(3),
    target_price: 1000 + i * 10 + (i % 2 === 0 ? 50 : -50),
    stop_loss: 1000 + i * 10 + (i % 2 === 0 ? -20 : 20),
    timeframe: ["1H", "4H", "1D"][i % 3],
    confidence_factors: ["Volume", "Trend", "Support/Resistance", "Momentum"].slice(0, 2 + (i % 3)),
  };

  // ~1 KB technical_indicators
  const technicalIndicators = {
    trend_direction: ["Up", "Down", "Sideways"][i % 3],
    trend_strength: ["Strong", "Moderate", "Weak"][i % 3],
    rsi_reading: `${40 + (i % 40)}`,
    macd_signal: ["Bullish Crossover", "Bearish Crossover", "Neutral"][i % 3],
    ema_position: `Price ${i % 2 === 0 ? "above" : "below"} 20 EMA`,
    volume_verdict: ["Above Average", "Below Average", "Spike"][i % 3],
    additional_notes: `Fibonacci retracement at ${(0.382 + (i % 3) * 0.236).toFixed(3)} level.`,
  };

  // ~2 KB analysis
  const analysis = {
    market_sentiment: ["bullish", "bearish", "neutral", "highly_volatile"][i % 4],
    risk_level: ["low", "medium", "high", "extreme"][i % 4],
    structure_analysis: `Market structure analysis: ${i % 2 === 0 ? "Higher highs and higher lows" : "Lower highs and lower lows"} observed. ` +
      `Key structure break at ${(1000 + i * 10).toFixed(0)} level. Volume profile confirms the move. ` +
      `Internal trend lines converging near the ${(1000 + i * 10 + 20).toFixed(0)} area.`,
    contextual_alignment: `The analysis aligns with the broader market context. Sector rotation favors this setup.`,
  };

  // ~1 KB key_levels
  const keyLevels = {
    support: Array.from({ length: 3 }, (_, j) => (1000 + i * 10 - (j + 1) * 15).toFixed(1)),
    resistance: Array.from({ length: 3 }, (_, j) => (1000 + i * 10 + (j + 1) * 15).toFixed(1)),
  };

  // ~1 KB trade_setup
  const tradeSetup = {
    bias: i % 2 === 0 ? "long" : "short",
    entry_zone: `${(1000 + i * 10).toFixed(1)} - ${(1002 + i * 10).toFixed(1)}`,
    stop_loss: `${(1000 + i * 10 + (i % 2 === 0 ? -20 : 20)).toFixed(1)}`,
    target_1: `${(1000 + i * 10 + (i % 2 === 0 ? 30 : -30)).toFixed(1)}`,
    target_2: `${(1000 + i * 10 + (i % 2 === 0 ? 60 : -60)).toFixed(1)}`,
    risk_reward_ratio: `${(1.5 + (i % 20) / 10).toFixed(1)}`,
  };

  // ~15 KB thinking_process (each step ~1.8 KB × 8 = ~14.4 KB)
  const thinkingProcess = Array.from({ length: 8 }, (_, j) =>
    `Step ${j + 1}: ${["Analyzing chart patterns", "Checking volume profile", "Evaluating trend direction",
      "Calculating risk-reward", "Assessing market context", "Reviewing technical indicators",
      "Identifying key levels", "Formulating trade setup"][j]}. ` +
    `The ${["price action", "volume", "momentum", "structure", "context", "indicators", "levels", "setup"][j]} ` +
    `suggests a ${i % 2 === 0 ? "favorable" : "cautious"} outlook. ` +
    `Additional details: ${("Analysis detail for step " + (j + 1) + ". Reviewing confluence of signals across timeframes. Checking for confirmation from multiple technical indicators. ").repeat(20)}`
  );

  // ~500 bytes cross_chart_correlation
  const crossChartCorrelation = {
    strength: ["strong", "moderate", "weak"][i % 3],
    direction: ["positive", "negative", "neutral"][i % 3],
    note: `Correlation observed between the primary and secondary charts. ${i % 2 === 0 ? "Confirmation" : "Divergence"} signals present.`,
  };

  // ~8 KB rag_context (retrieved analysis rules — realistic RAG retrieval size)
  const ragContext = `[RAG Context for analysis ${i}]\n` +
    `Rule 1: Always check volume before entering trades. Volume is the most important confirmation signal and should be above the 20-period average.\n`.repeat(20) +
    `Rule 2: Use fibonacci levels for target projection. Key levels are 0.382, 0.5, 0.618, 0.786, and 1.0 extensions.\n`.repeat(15) +
    `Rule 3: Consider broader market context. Nifty and BankNifty trends influence individual stock movements significantly.\n`.repeat(15);

  // ~4 KB wss_context (live tick data with full order book depth)
  const wssContext = JSON.stringify({
    ticker: `ASSET_${i % 200}`,
    ltp: 1000 + i * 10,
    change: (i % 50) - 25,
    change_pct: ((i % 50) - 25) / 10,
    volume: 1000000 + i * 100,
    bid: 999 + i * 10,
    ask: 1001 + i * 10,
    oi: 50000 + i * 10,
    prev_close: 998 + i * 10,
    day_high: 1008 + i * 10,
    day_low: 992 + i * 10,
    timestamp: new Date(2024, 0, 1 + Math.floor(i / 50), 10, i % 60).toISOString(),
    depth: {
      bids: Array.from({ length: 10 }, (_, j) => ({ price: 999 - j + i * 10, qty: 100 * (j + 1), orders: 5 + j })),
      asks: Array.from({ length: 10 }, (_, j) => ({ price: 1001 + j + i * 10, qty: 100 * (j + 1), orders: 3 + j })),
    },
    greeks: { delta: 0.5 + (i % 10) / 20, gamma: 0.01 + (i % 5) / 100, theta: -0.05 - (i % 3) / 100, vega: 0.1 + (i % 7) / 50, iv: 15 + (i % 30) },
  });

  return {
    synthesis_summary: synthesisSummary,
    confidence_score: String(50 + (i % 50)),
    image_quality: ["Excellent", "Good", "Fair"][i % 3],
    extracted_data: extractedData,
    pattern_detected: {
      name: ["Double Bottom", "Head and Shoulders", "Bull Flag", "Rising Wedge", "Descending Triangle"][i % 5],
      confidence: (0.5 + Math.random() * 0.5).toFixed(2),
    },
    prediction,
    technical_indicators: technicalIndicators,
    analysis,
    key_levels: keyLevels,
    trade_setup: tradeSetup,
    thinking_process: thinkingProcess,
    cross_chart_correlation: crossChartCorrelation,
    rag_context: ragContext,
    wss_context: wssContext,
    user_pattern_tag: i % 10 === 0 ? "double_bottom" : null,
  };
}

function makeTradeHistoryRows(n: number, withImages: boolean): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => {
    const fullResult = makeFullResult(i);
    const row: Record<string, unknown> = {
      id: `th_${String(i + 1).padStart(6, "0")}`,
      user_id: USER_ID,
      created_at: new Date(2024, 0, 1 + Math.floor(i / 50), 10, i % 60).toISOString(),
      asset_name: `ASSET_${i % 200}`,
      market_sentiment: ["bullish", "bearish", "neutral", "highly_volatile"][i % 4],
      risk_level: ["low", "medium", "high", "extreme"][i % 4],
      confidence: 50 + (i % 50),
      synthesis_summary: fullResult.synthesis_summary as string,
      full_result: fullResult,
      image_1: null as string | null,
      image_2: null as string | null,
    };

    if (withImages) {
      // ~300 KB base64 per image → ~225 KB decoded
      // Generate repeating base64 data (not real image, but same memory footprint)
      const base64Chunk = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      const targetBase64Length = 300 * 1024; // ~300 KB of base64 characters
      let imgData = "";
      while (imgData.length < targetBase64Length) {
        imgData += base64Chunk;
      }
      imgData = imgData.substring(0, targetBase64Length);
      // Pad to valid base64 length
      while (imgData.length % 4 !== 0) imgData += "=";
      row.image_1 = `data:image/png;base64,${imgData}`;
      row.image_2 = `data:image/png;base64,${imgData}`;
    }

    return row;
  });
}

function makeBotSignalRows(n: number): Record<string, unknown>[] {
  // ~1 KB per row
  return Array.from({ length: n }, (_, i) => ({
    id: `bs_${String(i + 1).padStart(6, "0")}`,
    user_id: USER_ID,
    created_at: new Date(2024, 0, 1 + Math.floor(i / 200), 10, i % 60, i % 60).toISOString(),
    signal_type: i % 2 === 0 ? "buy" : "sell",
    ticker: `SIG${i % 500}`,
    confidence: (0.5 + (i % 50) / 100).toFixed(3),
    pnl: i % 4 === 0 ? -10.50 : 25.75,
    entry_price: (1000 + i * 0.1).toFixed(2),
    exit_price: (1005 + i * 0.1).toFixed(2),
    quantity: 10 + (i % 100),
    strategy: ["momentum", "mean_reversion", "breakout", "scalp"][i % 4],
    exchange: i % 2 === 0 ? "NSE" : "BSE",
    timeframe: ["1m", "5m", "15m"][i % 3],
    notes: `Signal generated at ${new Date(2024, 0, 1 + Math.floor(i / 200)).toISOString().slice(0, 10)} for ${i % 500} with confidence ${(0.5 + (i % 50) / 100).toFixed(3)}.`,
  }));
}

function makeJournalRows(n: number): Record<string, unknown>[] {
  // ~2 KB per row
  return Array.from({ length: n }, (_, i) => ({
    id: `tj_${String(i + 1).padStart(6, "0")}`,
    user_id: USER_ID,
    created_at: new Date(2024, 0, 1 + Math.floor(i / 10), 10, i % 60).toISOString(),
    analysis_id: `th_${String(i + 1).padStart(6, "0")}`,
    asset_name: `ASSET_${i % 200}`,
    direction: i % 2 === 0 ? "long" : "short",
    entry_price: (1000 + i * 10).toFixed(2),
    exit_price: (1050 + i * 10).toFixed(2),
    stop_loss: (980 + i * 10).toFixed(2),
    take_profit: (1080 + i * 10).toFixed(2),
    pnl_amount: i % 3 === 0 ? -50.25 : 100.50,
    pnl_pct: i % 3 === 0 ? -2.5 : 5.0,
    outcome: i % 3 === 0 ? "loss" : "win",
    emotion_before: ["calm", "anxious", "excited", "fearful"][i % 4],
    emotion_after: ["satisfied", "frustrated", "neutral", "relieved"][i % 4],
    tags: JSON.stringify(["swing", "breakout", "volume_confirmation"].slice(0, 1 + (i % 3))),
    rating: 1 + (i % 5),
    lesson: `Lesson from trade #${i + 1}: ${i % 2 === 0 ? "Wait for confirmation before entering." : "Set tighter stop losses in volatile conditions."} ` +
      `The key takeaway is to ${i % 3 === 0 ? "manage risk" : "follow the plan"} consistently. ` +
      `Market conditions were ${["trending", "ranging", "volatile", "calm"][i % 4]} during this trade. ` +
      `Additional reflection: ${"Review the setup criteria and execution timing. ".repeat(3)}`,
    mfe_pct: (2 + Math.random() * 8).toFixed(2),
    mae_pct: (1 + Math.random() * 5).toFixed(2),
    entry_time: new Date(2024, 0, 1 + Math.floor(i / 10), 9, 30).toISOString(),
    exit_time: new Date(2024, 0, 1 + Math.floor(i / 10), 15, 15).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function measureRun(
  label: string,
  tables: Record<string, MockTableData>,
  includeImages: boolean,
  expectedCounts: Record<string, number>,
): Promise<boolean> {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${"═".repeat(60)}\n`);

  // Measure row sizes (average over multiple samples for accuracy)
  for (const [name, table] of Object.entries(tables)) {
    if (table.rows.length > 0) {
      const sampleCount = Math.min(10, table.rows.length);
      let totalBytes = 0;
      for (let si = 0; si < sampleCount; si++) {
        totalBytes += JSON.stringify(table.rows[si]).length;
      }
      const avgBytes = totalBytes / sampleCount;
      console.log(`  ${name}: ${table.rows.length} rows, avg row ~${formatBytes(avgBytes)} (${sampleCount}-sample avg)`);
    }
  }
  console.log();

  const mockSupabase = createMockSupabase(tables);
  const progressLog: ExportProgress[] = [];

  const deps: ExportDeps = {
    supabase: mockSupabase as any,
    userId: USER_ID,
    includeImages,
    signal: new AbortController().signal,
    onProgress: (p) => { progressLog.push({ ...p }); },
    storage: { getItem: () => null },
  };

  // Event loop delay monitoring (Section 4.1)
  const eld = monitorEventLoopDelay({ resolution: 10 });
  eld.enable();

  // GC before measuring
  if (global.gc) global.gc();
  const memBefore = process.memoryUsage();
  const startTime = performance.now();
  let peakHeap = memBefore.heapUsed;
  let peakRss = memBefore.rss;
  let peakExternal = memBefore.external;
  let peakArrayBuffers = memBefore.arrayBuffers;

  // Periodic memory sampling (all metrics)
  const memSampler = setInterval(() => {
    const mem = process.memoryUsage();
    if (mem.heapUsed > peakHeap) peakHeap = mem.heapUsed;
    if (mem.rss > peakRss) peakRss = mem.rss;
    if (mem.external > peakExternal) peakExternal = mem.external;
    if (mem.arrayBuffers > peakArrayBuffers) peakArrayBuffers = mem.arrayBuffers;
  }, 50);

  let result: any;
  try {
    result = await buildExportZip(deps);
  } catch (err) {
    clearInterval(memSampler);
    eld.disable();
    console.error(`  ✗ Export FAILED: ${err}`);
    return false;
  }

  clearInterval(memSampler);
  eld.disable();

  // Final memory check
  const memAfter = process.memoryUsage();
  if (memAfter.heapUsed > peakHeap) peakHeap = memAfter.heapUsed;
  if (memAfter.rss > peakRss) peakRss = memAfter.rss;
  if (memAfter.external > peakExternal) peakExternal = memAfter.external;
  if (memAfter.arrayBuffers > peakArrayBuffers) peakArrayBuffers = memAfter.arrayBuffers;

  const elapsed = performance.now() - startTime;

  // Export's own memory delta (separate from fake database overhead)
  const heapDelta = memAfter.heapUsed - memBefore.heapUsed;
  const rssDelta = memAfter.rss - memBefore.rss;
  const externalDelta = memAfter.external - memBefore.external;
  const abDelta = memAfter.arrayBuffers - memBefore.arrayBuffers;

  console.log(`\n── Results ──`);
  console.log(`  Total time:       ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`  ZIP size:         ${formatBytes(result.blob.size)}`);
  console.log(`  Heap before:      ${formatBytes(memBefore.heapUsed)}`);
  console.log(`  Heap after:       ${formatBytes(memAfter.heapUsed)}`);
  console.log(`  Heap delta:       ${formatBytes(heapDelta)}`);
  console.log(`  Peak heap:        ${formatBytes(peakHeap)}`);
  console.log(`  Peak RSS:         ${formatBytes(peakRss)}`);
  console.log(`  RSS delta:        ${formatBytes(rssDelta)}`);
  console.log(`  Peak external:    ${formatBytes(peakExternal)}`);
  console.log(`  External delta:   ${formatBytes(externalDelta)}`);
  console.log(`  Peak arrayBufs:   ${formatBytes(peakArrayBuffers)}`);
  console.log(`  ArrayBufs delta:  ${formatBytes(abDelta)}`);
  console.log(`  Event loop p99:   ${(eld.percentile(99) / 1e6).toFixed(1)} ms`);
  console.log(`  Event loop max:   ${(eld.max / 1e6).toFixed(1)} ms (longest sync block)`);
  console.log(`  Progress updates: ${progressLog.length}`);

  // Check thresholds (Section 4.1: flag if max > ~1s or peak > ~1 GB)
  const maxBlockMs = eld.max / 1e6;
  const peakHeapMB = peakHeap / (1024 * 1024);
  if (maxBlockMs > 1000) {
    console.warn(`  ⚠ WARNING: Longest sync block ${maxBlockMs.toFixed(0)} ms exceeds ~1s threshold`);
  } else {
    console.log(`  ✓ Sync block OK (${maxBlockMs.toFixed(0)} ms < 1000 ms)`);
  }
  if (peakHeapMB > 1024) {
    console.warn(`  ⚠ WARNING: Peak heap ${peakHeapMB.toFixed(0)} MB exceeds ~1 GB threshold`);
  } else {
    console.log(`  ✓ Peak heap OK (${peakHeapMB.toFixed(0)} MB < 1024 MB)`);
  }

  // Verify counts in ZIP
  console.log("\n── Count Verification ──");
  const zip = await JSZip.loadAsync(result.blob);
  let allOk = true;

  for (const [name, expected] of Object.entries(expectedCounts)) {
    const raw = await zip.file(`json/${name}.json`)?.async("string");
    if (!raw) {
      console.error(`  ✗ FAIL: json/${name}.json not found in ZIP`);
      allOk = false;
      continue;
    }
    const obj = JSON.parse(raw);
    if (obj.record_count === expected) {
      console.log(`  ✓ ${name}: ${obj.record_count} records (expected ${expected})`);
    } else {
      console.error(`  ✗ FAIL: ${name}: got ${obj.record_count}, expected ${expected}`);
      allOk = false;
    }
  }

  // Manifest
  const manifestRaw = await zip.file("manifest.json")?.async("string");
  const manifest = JSON.parse(manifestRaw!);
  const allMatched = manifest.datasets.every((ds: any) => ds.matched === true);
  if (allMatched) {
    console.log("  ✓ All datasets matched === true in manifest");
  } else {
    console.error("  ✗ FAIL: Some datasets have matched !== true");
    allOk = false;
  }

  // Check images if applicable (Section 2.5: exact count, unique names, max 2 per analysis)
  if (includeImages) {
    const allImgEntries = Object.keys(zip.files).filter(f => f.startsWith("images/"));
    // Exclude directory entries (JSZip counts "images/" folder entry)
    const imgFileEntries = allImgEntries.filter(f => !f.endsWith("/"));
    console.log(`  Image file entries:  ${imgFileEntries.length} (+ ${allImgEntries.length - imgFileEntries.length} dir entries)`);
    if (imgFileEntries.length === 0) {
      console.error("  ✗ FAIL: No image files found despite includeImages=true");
      allOk = false;
    }

    // Assert exactly expectedCount image files (e.g. 500 analyses × 2 = 1000)
    const expectedImgCount = Object.values(expectedCounts).reduce((a, b) => a + b, 0) > 0
      ? (expectedCounts["audit_trail"] ?? 0) * 2 // 2 images per analysis
      : 0;
    if (expectedImgCount > 0) {
      if (imgFileEntries.length === expectedImgCount) {
        console.log(`  ✓ Exactly ${expectedImgCount} image file entries (dirs excluded)`);
      } else {
        console.error(`  ✗ FAIL: Expected ${expectedImgCount} image files, got ${imgFileEntries.length}`);
        allOk = false;
      }
    }

    // Unique filenames
    const uniqueNames = new Set(imgFileEntries);
    if (uniqueNames.size === imgFileEntries.length) {
      console.log(`  ✓ All ${imgFileEntries.length} image filenames are unique`);
    } else {
      console.error(`  ✗ FAIL: Duplicate image filenames found`);
      allOk = false;
    }

    // Max 2 per analysis: parse {id}_chart{1|2}.{ext}
    const perAnalysis = new Map<string, number>();
    for (const f of imgFileEntries) {
      const name = f.replace("images/", "");
      const match = name.match(/^(.+?)_chart[12]\./);
      if (match) {
        perAnalysis.set(match[1], (perAnalysis.get(match[1]) || 0) + 1);
      }
    }
    const maxPerAnalysis = Math.max(0, ...perAnalysis.values());
    if (maxPerAnalysis <= 2) {
      console.log(`  ✓ Max images per analysis: ${maxPerAnalysis} (≤ 2)`);
    } else {
      console.error(`  ✗ FAIL: Some analysis has ${maxPerAnalysis} images (max 2)`);
      allOk = false;
    }
  }

  return allOk;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Task 5 — Scale Test (Section 4.1)             ║");
  console.log("╚══════════════════════════════════════════════════╝");

  const TRADE_COUNT = 5000;
  const BOT_COUNT = 20000;
  const JOURNAL_COUNT = 1000;

  let allPassed = true;

  // ── Run 1: Images OFF with realistic full_result ──
  console.log("\nGenerating synthetic data for Run 1 (images OFF)...");
  const tradeRowsNoImg = makeTradeHistoryRows(TRADE_COUNT, false);
  const botRows = makeBotSignalRows(BOT_COUNT);
  const journalRows = makeJournalRows(JOURNAL_COUNT);

  const tablesRun1 = {
    trade_history: { rows: tradeRowsNoImg },
    bot_signals: { rows: botRows },
    trade_journal: { rows: journalRows },
    prediction_scores: { rows: Array.from({ length: 500 }, (_, i) => ({
      id: `ps_${String(i + 1).padStart(6, "0")}`,
      user_id: USER_ID,
      created_at: new Date(2024, 0, 1 + Math.floor(i / 10), 12, i % 60).toISOString(),
      trade_history_id: `th_${String(i + 1).padStart(6, "0")}`,
      predicted_direction: i % 2 === 0 ? "up" : "down",
      predicted_probability: (0.5 + Math.random() * 0.4).toFixed(3),
      confidence_at_analysis: 50 + (i % 50),
      score_points: 30 + (i % 70),
      score_grade: ["A+", "A", "B", "C", "D", "F"][i % 6],
    })) },
    watchlist: { rows: Array.from({ length: 50 }, (_, i) => ({
      id: `wl_${String(i + 1).padStart(4, "0")}`,
      user_id: USER_ID,
      created_at: new Date(2024, 0, 1 + i).toISOString(),
      ticker: `WATCH${i}`,
      alert_above: 1100 + i * 10,
      alert_below: 900 + i * 10,
    })) },
    context_presets: { rows: Array.from({ length: 10 }, (_, i) => ({
      id: `cp_${i + 1}`,
      user_id: USER_ID,
      created_at: new Date(2024, 0, 1 + i).toISOString(),
      name: `Preset ${i + 1}`,
      context_text: `Context for preset ${i + 1}. `.repeat(20),
    })) },
    user_settings: { rows: [{
      user_id: USER_ID,
      hum_enabled: true, thud_enabled: false, ai_temperature: 0.3,
      accent_theme: "emerald", market_source: "india", updated_at: "2025-06-01T00:00:00Z",
    }] },
  };

  const run1Ok = await measureRun(
    "Run 1: Images OFF — 5,000 trade_history (30KB each), 20,000 bot_signals, 1,000 journal",
    tablesRun1,
    false,
    {
      audit_trail: TRADE_COUNT,
      bot_signals: BOT_COUNT,
      trade_journal: JOURNAL_COUNT,
      prediction_scores: 500,
      watchlist: 50,
      context_presets: 10,
    },
  );
  if (!run1Ok) allPassed = false;

  // Free Run 1 data
  (tablesRun1 as any).trade_history = null;
  (tablesRun1 as any).bot_signals = null;
  (tablesRun1 as any).trade_journal = null;
  if (global.gc) global.gc();

  // ── Run 2a: Images ON — ~90% of cap ──
  // 200 MB cap, ~225 KB decoded per image × 2 = ~450 KB per analysis
  // 90% of 200 MB = 180 MB → ~400 analyses
  const COUNT_90PCT = 400;
  console.log(`\n\nGenerating synthetic data for Run 2a (images ON, ${COUNT_90PCT} analyses, ~90% of 200 MB cap)...`);
  const tradeRows2a = makeTradeHistoryRows(COUNT_90PCT, true);

  const tablesRun2a = {
    trade_history: { rows: tradeRows2a },
    bot_signals: { rows: [] as any[] },
    trade_journal: { rows: [] as any[] },
    prediction_scores: { rows: [] as any[] },
    watchlist: { rows: [] as any[] },
    context_presets: { rows: [] as any[] },
    user_settings: { rows: [{
      user_id: USER_ID,
      hum_enabled: true, thud_enabled: false, ai_temperature: 0.3,
      accent_theme: "emerald", market_source: "india", updated_at: "2025-06-01T00:00:00Z",
    }] },
  };

  const run2aOk = await measureRun(
    `Run 2a: Images ON — ${COUNT_90PCT} analyses (~90% of 200 MB cap)`,
    tablesRun2a,
    true,
    { audit_trail: COUNT_90PCT },
  );
  if (!run2aOk) allPassed = false;

  // Free Run 2a data
  (tablesRun2a as any).trade_history = null;
  if (global.gc) global.gc();

  // ── Run 2b: Images ON — cap + 1 (should trigger clear error message) ──
  // ~456 analyses × ~450 KB decoded = ~200.39 MB > 200 MB cap
  const COUNT_OVER_CAP = 460;
  console.log(`\n\nGenerating synthetic data for Run 2b (images ON, ${COUNT_OVER_CAP} analyses, should exceed 200 MB cap)...`);
  const tradeRows2b = makeTradeHistoryRows(COUNT_OVER_CAP, true);

  const tablesRun2b = {
    trade_history: { rows: tradeRows2b },
    bot_signals: { rows: [] as any[] },
    trade_journal: { rows: [] as any[] },
    prediction_scores: { rows: [] as any[] },
    watchlist: { rows: [] as any[] },
    context_presets: { rows: [] as any[] },
    user_settings: { rows: [{
      user_id: USER_ID,
      hum_enabled: true, thud_enabled: false, ai_temperature: 0.3,
      accent_theme: "emerald", market_source: "india", updated_at: "2025-06-01T00:00:00Z",
    }] },
  };

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Run 2b: Images ON — ${COUNT_OVER_CAP} analyses (should exceed 200 MB cap)`);
  console.log(`${"═".repeat(60)}\n`);

  let run2bOk = false;
  {
    const mockSupabase2b = createMockSupabase(tablesRun2b);
    const deps2b: ExportDeps = {
      supabase: mockSupabase2b as any,
      userId: USER_ID,
      includeImages: true,
      signal: new AbortController().signal,
      onProgress: () => {},
      storage: { getItem: () => null },
    };

    try {
      await buildExportZip(deps2b);
      console.error("  ✗ FAIL: Run 2b should have thrown an image cap error but did not");
    } catch (err: any) {
      const msg = String(err.message || err);
      if (msg.includes("Too many images")) {
        console.log(`  ✓ Run 2b correctly threw image cap error`);
        console.log(`    Error message: "${msg}"`);
        run2bOk = true;
      } else {
        console.error(`  ✗ FAIL: Run 2b threw unexpected error: ${msg}`);
      }
    }
  }
  if (!run2bOk) allPassed = false;

  // ── Summary ──
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${allPassed ? "✓ ALL SCALE TESTS PASSED" : "✗ SOME SCALE TESTS FAILED"}`);
  console.log(`${"═".repeat(60)}`);

  process.exit(allPassed ? 0 : 1);
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
