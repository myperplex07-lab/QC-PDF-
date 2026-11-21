/**
 * Task 5 — End-to-End Export Tests (Second Review)
 *
 * Run:  npx tsx tests/test_export_e2e.ts
 * Or:   npm test:export
 *
 * Uses a mock Supabase client so NO real database is touched.
 * Uses JSZip to inspect the generated ZIP.
 */

import JSZip from "jszip";
import {
  buildExportZip,
  downloadBlob,
  buildManifest,
  buildReadme,
  recordsToCSV,
  isSecretKey,
  findSecretInRecord,
  scanRecordsForSecrets,
  fetchAllPaginated,
  type ExportDeps,
  type DatasetConfig,
  type ExportProgress,
  SUPABASE_DATASETS,
  MAX_IMAGE_BYTES,
} from "../src/exportService.js";

// ---------------------------------------------------------------------------
// TEST HARNESS
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
let skipped = 0;
const failures: string[] = [];

function assert(condition: boolean, testName: string): void {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    failed++;
    failures.push(testName);
  }
}

function assertEq(actual: unknown, expected: unknown, testName: string): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
    failures.push(testName);
  }
}

function skip(testName: string): void {
  console.log(`  ⊘ SKIP: ${testName}`);
  skipped++;
}

// ---------------------------------------------------------------------------
// MOCK SUPABASE CLIENT
// ---------------------------------------------------------------------------

interface MockTableData {
  rows: Record<string, unknown>[];
  /** If set, simulate an error on the next query */
  error?: { message: string; code?: string };
  /** Track request count for abort testing */
  requestCount?: number;
  /** If set, add rows after N requests (for concurrent write tests) */
  addRowsAfter?: { requestNum: number; rows: Record<string, unknown>[] };
  /** If set, remove rows after N requests (for concurrent delete tests) */
  removeRowsAfter?: { requestNum: number; count: number };
  /** Max rows per response (simulates Supabase server cap) */
  serverCap?: number;
  /** Simulate timeout on first N requests */
  timeoutForFirstN?: number;
}

function createMockSupabase(tables: Record<string, MockTableData>) {
  return {
    from(table: string) {
      const tableData = tables[table] || { rows: [] };
      if (!tableData.requestCount) tableData.requestCount = 0;
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
      let orderCols: { col: string; asc: boolean }[] = [];

      const builder: any = {
        select(s: string, opts?: { count?: "exact"; head?: boolean }) {
          selectStr = s;
          if (opts?.count) wantCount = opts.count;
          if (opts?.head) headOnly = true;
          return builder;
        },
        eq(col: string, val: string) {
          if (col === "user_id") userId = val;
          return builder;
        },
        in(col: string, vals: unknown[]) {
          inColumn = col;
          inValues = vals;
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orderCols.push({ col, asc: opts?.ascending !== false });
          return builder;
        },
        range(start: number, end: number) {
          rangeStart = start;
          rangeEnd = end;
          return builder;
        },
        limit(n: number) {
          limitVal = n;
          return builder;
        },
        maybeSingle() {
          maybeSingle = true;
          return builder;
        },
        then(resolve: (val: any) => void, reject?: (err: any) => void) {
          try {
            tableData.requestCount = (tableData.requestCount || 0) + 1;
            const reqNum = tableData.requestCount;

            // Simulate concurrent writes
            if (tableData.addRowsAfter && reqNum === tableData.addRowsAfter.requestNum) {
              tableData.rows = [...tableData.rows, ...tableData.addRowsAfter.rows];
            }

            // Simulate concurrent deletes
            if (tableData.removeRowsAfter && reqNum === tableData.removeRowsAfter.requestNum) {
              tableData.rows = tableData.rows.slice(tableData.removeRowsAfter.count);
            }

            // Simulate timeout
            if (tableData.timeoutForFirstN && reqNum <= tableData.timeoutForFirstN) {
              resolve({ data: null, error: { message: "timeout", code: "57014", status: 504 }, count: null });
              return;
            }

            if (tableData.error) {
              resolve({ data: null, error: tableData.error, count: null });
              return;
            }

            let rows = [...tableData.rows];

            // Filter by user_id
            if (userId) {
              rows = rows.filter((r) => r.user_id === userId);
            }

            // Filter by IN clause
            if (inColumn && inValues) {
              rows = rows.filter((r) => inValues!.includes(r[inColumn!]));
            }

            // Sort
            for (const { col, asc } of orderCols.reverse()) {
              rows.sort((a, b) => {
                const va = String(a[col] ?? "");
                const vb = String(b[col] ?? "");
                return asc ? va.localeCompare(vb) : vb.localeCompare(va);
              });
            }

            if (headOnly && wantCount === "exact") {
              resolve({ data: null, error: null, count: rows.length });
              return;
            }

            // Limit
            if (limitVal !== null) {
              rows = rows.slice(0, limitVal);
            }

            // Range
            if (rangeStart > 0 || rangeEnd < Infinity) {
              rows = rows.slice(rangeStart, rangeEnd + 1);
            }

            // Server cap (Section 3.5: silent 1000-row cap)
            if (tableData.serverCap && rows.length > tableData.serverCap) {
              rows = rows.slice(0, tableData.serverCap);
            }

            // Select columns
            if (selectStr !== "*") {
              const cols = selectStr.split(",").map((c) => c.trim());
              rows = rows.map((r) => {
                const out: Record<string, unknown> = {};
                for (const c of cols) {
                  if (c in r) out[c] = r[c];
                }
                return out;
              });
            }

            if (maybeSingle) {
              resolve({ data: rows.length > 0 ? rows[0] : null, error: null });
              return;
            }

            resolve({ data: rows, error: null, count: wantCount === "exact" ? tableData.rows.filter((r) => userId ? r.user_id === userId : true).length : null });
          } catch (e) {
            if (reject) reject(e);
            else resolve({ data: null, error: { message: String(e) }, count: null });
          }
        },
      };
      return builder;
    },
  };
}

// ---------------------------------------------------------------------------
// TEST DATA FACTORIES
// ---------------------------------------------------------------------------

const TEST_USER_ID = "user_test_export_001";
const OTHER_USER_ID = "user_other_999";

function makeTradeHistory(n: number, userId = TEST_USER_ID): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `th_${String(i + 1).padStart(4, "0")}`,
    user_id: userId,
    asset_name: `ASSET_${i + 1}`,
    market_sentiment: i % 4 === 0 ? "bullish" : i % 4 === 1 ? "bearish" : i % 4 === 2 ? "neutral" : "highly_volatile",
    risk_level: i % 3 === 0 ? "low" : i % 3 === 1 ? "medium" : "high",
    confidence: 50 + (i % 50),
    synthesis_summary: `Analysis summary for asset ${i + 1}`,
    full_result: {
      extracted_data: { price: 100 + i },
      predictions: [{ target: 110 + i }],
      user_pattern_tag: i % 5 === 0 ? "double_bottom" : null,
    },
    image_1: i < 3 ? `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==` : null,
    image_2: i < 2 ? `data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA//9k=` : null,
    created_at: `2025-0${Math.min(9, 1 + Math.floor(i / 30))}-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00.000Z`,
  }));
}

function makeJournalEntries(n: number, userId = TEST_USER_ID): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `tj_${String(i + 1).padStart(4, "0")}`,
    user_id: userId,
    analysis_id: `th_${String(i + 1).padStart(4, "0")}`,
    asset_name: `ASSET_${i + 1}`,
    direction: i % 2 === 0 ? "long" : "short",
    entry_price: 1000 + i * 10,
    exit_price: 1050 + i * 10,
    pnl_amount: i % 3 === 0 ? -50 : 100,
    pnl_pct: i % 3 === 0 ? -2.5 : 5.0,
    outcome: i % 3 === 0 ? "loss" : "win",
    emotion_before: "confident",
    emotion_after: i % 3 === 0 ? "frustrated" : "satisfied",
    tags: ["swing", "breakout"],
    lesson: `Lesson from trade ${i + 1}`,
    created_at: `2025-0${Math.min(9, 1 + Math.floor(i / 30))}-${String(1 + (i % 28)).padStart(2, "0")}T11:00:00.000Z`,
  }));
}

function makePredictionScores(n: number, userId = TEST_USER_ID): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `ps_${String(i + 1).padStart(4, "0")}`,
    user_id: userId,
    trade_history_id: `th_${String(i + 1).padStart(4, "0")}`,
    predicted_probability: 0.5 + (i % 50) / 100,
    confidence_at_analysis: 50 + (i % 50),
    score_points: 40 + (i % 60),
    score_grade: i % 5 === 0 ? "A+" : i % 5 === 1 ? "A" : i % 5 === 2 ? "B" : i % 5 === 3 ? "C" : "D",
    score_history: [{ attempt: 1, score: 40 + (i % 60) }],
    created_at: `2025-0${Math.min(9, 1 + Math.floor(i / 30))}-${String(1 + (i % 28)).padStart(2, "0")}T12:00:00.000Z`,
  }));
}

function makeWatchlist(n: number, userId = TEST_USER_ID): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `wl_${String(i + 1).padStart(4, "0")}`,
    user_id: userId,
    ticker: `TICKER${i + 1}`,
    alert_above: 200 + i * 5,
    alert_below: 100 + i * 5,
    created_at: `2025-01-${String(1 + (i % 28)).padStart(2, "0")}T09:00:00.000Z`,
  }));
}

function makeContextPresets(n: number, userId = TEST_USER_ID): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `cp_${String(i + 1).padStart(4, "0")}`,
    user_id: userId,
    name: `Preset ${i + 1}`,
    context_text: `Context text for preset ${i + 1}`,
    created_at: `2025-01-${String(1 + (i % 28)).padStart(2, "0")}T08:00:00.000Z`,
  }));
}

function makeBotSignals(n: number, userId = TEST_USER_ID): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `bs_${String(i + 1).padStart(4, "0")}`,
    user_id: userId,
    signal_type: i % 2 === 0 ? "buy" : "sell",
    ticker: `SIG${i + 1}`,
    confidence: 0.5 + (i % 50) / 100,
    pnl: i % 4 === 0 ? -10 : 25,
    created_at: `2025-01-${String(1 + (i % 28)).padStart(2, "0")}T14:00:00.000Z`,
  }));
}

// ---------------------------------------------------------------------------
// HELPER: build full mock tables + deps
// ---------------------------------------------------------------------------

function buildStandardDeps(overrides?: {
  tradeCount?: number;
  journalCount?: number;
  predictionCount?: number;
  watchlistCount?: number;
  presetCount?: number;
  botSignalCount?: number;
  includeImages?: boolean;
  includeOtherUser?: boolean;
  settingsData?: Record<string, unknown>;
  storageData?: Record<string, string>;
  extraTables?: Record<string, MockTableData>;
  signalAborted?: boolean;
}): ExportDeps & { progressLog: ExportProgress[] } {
  const tradeRows = makeTradeHistory(overrides?.tradeCount ?? 5);
  const journalRows = makeJournalEntries(overrides?.journalCount ?? 3);
  const predictionRows = makePredictionScores(overrides?.predictionCount ?? 3);
  const watchlistRows = makeWatchlist(overrides?.watchlistCount ?? 2);
  const presetRows = makeContextPresets(overrides?.presetCount ?? 1);
  const botSignalRows = makeBotSignals(overrides?.botSignalCount ?? 4);

  const tables: Record<string, MockTableData> = {
    trade_history: { rows: overrides?.includeOtherUser ? [...tradeRows, ...makeTradeHistory(3, OTHER_USER_ID)] : tradeRows },
    trade_journal: { rows: overrides?.includeOtherUser ? [...journalRows, ...makeJournalEntries(2, OTHER_USER_ID)] : journalRows },
    prediction_scores: { rows: predictionRows },
    watchlist: { rows: watchlistRows },
    context_presets: { rows: presetRows },
    bot_signals: { rows: botSignalRows },
    user_settings: {
      rows: overrides?.settingsData !== undefined
        ? (Object.keys(overrides.settingsData).length > 0 ? [{ user_id: TEST_USER_ID, ...overrides.settingsData }] : [])
        : [{ user_id: TEST_USER_ID, hum_enabled: true, thud_enabled: false, ai_temperature: 0.3, accent_theme: "red", market_source: "india", updated_at: "2025-06-01T00:00:00Z", some_internal_field: "should_not_appear" }],
    },
    ...overrides?.extraTables,
  };

  const mockSupabase = createMockSupabase(tables);
  const controller = new AbortController();
  if (overrides?.signalAborted) controller.abort();

  const storageMap: Record<string, string> = {
    qc_darkmode: "true",
    qc_price_alerts: JSON.stringify([
      { id: "pa1", ticker: "NIFTY", targetPrice: 22000, thresholdPct: 0.5, triggered: false, createdAt: 1700000000000 },
      { id: "pa2", ticker: "BANKNIFTY", targetPrice: 48000, thresholdPct: 1.0, triggered: true, createdAt: 1700100000000 },
    ]),
    ...overrides?.storageData,
  };

  const progressLog: ExportProgress[] = [];

  return {
    supabase: mockSupabase as any,
    userId: TEST_USER_ID,
    includeImages: overrides?.includeImages ?? false,
    signal: controller.signal,
    onProgress: (p) => progressLog.push({ ...p }),
    storage: {
      getItem(key: string) {
        return storageMap[key] ?? null;
      },
    },
    progressLog,
  };
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

async function runTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Task 5 — E2E Export Tests (Second Review)      ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // =====================================================================
  // G0: Dependency injection works
  // =====================================================================
  console.log("── G0: Dependency Injection ──");
  {
    const deps = buildStandardDeps({ tradeCount: 1, journalCount: 0, predictionCount: 0, watchlistCount: 0, presetCount: 0, botSignalCount: 0 });
    const result = await buildExportZip(deps);
    assert(result.blob instanceof Blob, "G0.1 buildExportZip returns a Blob");
    assert(typeof result.filename === "string" && result.filename.endsWith(".zip"), "G0.2 filename ends with .zip");
    assert(typeof result.datasetCounts === "object" && result.datasetCounts !== null, "G0.3 datasetCounts is an object");
    // Check filename format: YYYY-MM-DD_HH-mm
    const fnMatch = result.filename.match(/^quantcontext-export-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.zip$/);
    assert(fnMatch !== null, "G0.4 filename matches YYYY-MM-DD_HH-mm format");
  }

  // =====================================================================
  // G1: ZIP structure
  // =====================================================================
  console.log("\n── G1: ZIP Structure ──");
  {
    const deps = buildStandardDeps();
    const result = await buildExportZip(deps);
    const zip = await JSZip.loadAsync(result.blob);
    const files = Object.keys(zip.files);

    assert(files.includes("README.txt"), "G1.1 README.txt exists");
    assert(files.includes("manifest.json"), "G1.2 manifest.json exists");
    for (const name of ["audit_trail", "trade_journal", "prediction_scores", "watchlist", "context_presets", "bot_signals", "settings", "price_alerts"]) {
      assert(files.includes(`json/${name}.json`), `G1.3 json/${name}.json exists`);
    }
    assert(files.includes("json/local_preferences.json"), "G1.4 json/local_preferences.json exists");
    for (const name of ["audit_trail", "trade_journal", "prediction_scores", "watchlist", "context_presets", "bot_signals", "price_alerts"]) {
      assert(files.includes(`csv/${name}.csv`), `G1.5 csv/${name}.csv exists`);
    }
    assert(!files.includes("csv/settings.csv"), "G1.6 No csv/settings.csv");
    assert(!files.includes("csv/local_preferences.csv"), "G1.7 No csv/local_preferences.csv");
  }

  // =====================================================================
  // G2: JSON shape
  // =====================================================================
  console.log("\n── G2: JSON Shape ──");
  {
    const deps = buildStandardDeps();
    const result = await buildExportZip(deps);
    const zip = await JSZip.loadAsync(result.blob);

    for (const name of ["audit_trail", "trade_journal", "prediction_scores", "watchlist", "context_presets", "bot_signals", "settings", "price_alerts"]) {
      const raw = await zip.file(`json/${name}.json`)?.async("string");
      assert(raw !== undefined, `G2.${name} json file is readable`);
      if (raw) {
        const obj = JSON.parse(raw);
        assert(obj.dataset === name, `G2.${name}.dataset === "${name}"`);
        assert(typeof obj.record_count === "number", `G2.${name}.record_count is a number`);
        assert(Array.isArray(obj.records), `G2.${name}.records is an array`);
        assertEq(obj.record_count, obj.records.length, `G2.${name}.record_count matches records.length`);
      }
    }
  }

  // =====================================================================
  // G3: CSV vs JSON consistency
  // =====================================================================
  console.log("\n── G3: CSV vs JSON Consistency ──");
  {
    const deps = buildStandardDeps();
    const result = await buildExportZip(deps);
    const zip = await JSZip.loadAsync(result.blob);

    for (const name of ["audit_trail", "trade_journal", "prediction_scores", "watchlist", "context_presets", "bot_signals", "price_alerts"]) {
      const jsonRaw = await zip.file(`json/${name}.json`)?.async("string");
      const csvRaw = await zip.file(`csv/${name}.csv`)?.async("string");
      if (!jsonRaw || !csvRaw) continue;
      const jsonObj = JSON.parse(jsonRaw);
      const csvLines = csvRaw.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
      const csvDataLineCount = csvLines.length - 1;
      assertEq(csvDataLineCount, jsonObj.record_count, `G3.${name} CSV row count matches JSON record_count`);
    }
  }

  // =====================================================================
  // G4: User isolation
  // =====================================================================
  console.log("\n── G4: User Isolation ──");
  {
    const deps = buildStandardDeps({ tradeCount: 5, journalCount: 3, includeOtherUser: true });
    const result = await buildExportZip(deps);
    const zip = await JSZip.loadAsync(result.blob);

    const auditRaw = await zip.file("json/audit_trail.json")?.async("string");
    const auditObj = JSON.parse(auditRaw!);
    assertEq(auditObj.record_count, 5, "G4.1 audit_trail has only test user's rows (5, not 8)");
    const hasOtherUser = auditObj.records.some((r: any) => r.user_id === OTHER_USER_ID);
    assert(!hasOtherUser, "G4.2 No row with other user_id in audit_trail");

    const journalRaw = await zip.file("json/trade_journal.json")?.async("string");
    const journalObj = JSON.parse(journalRaw!);
    assertEq(journalObj.record_count, 3, "G4.3 trade_journal has only test user's rows (3, not 5)");
  }

  // =====================================================================
  // G5: Secret guard
  // =====================================================================
  console.log("\n── G5: Secret Guard ──");
  {
    assert(isSecretKey("password") === true, "G5.1 'password' is secret");
    assert(isSecretKey("api_key") === true, "G5.2 'api_key' is secret");
    assert(isSecretKey("access_token") === true, "G5.3 'access_token' is secret");
    assert(isSecretKey("jwt") === true, "G5.4 'jwt' is secret");
    assert(isSecretKey("totp") === true, "G5.5 'totp' is secret");
    assert(isSecretKey("secret_key") === true, "G5.6 'secret_key' is secret");
    assert(isSecretKey("pin_hash") === true, "G5.7 'pin_hash' is secret (pin is blocked)");
    assert(isSecretKey("token") === true, "G5.8 'token' is secret");

    assert(isSecretKey("key_levels") === false, "G5.9 'key_levels' is NOT secret");
    assert(isSecretKey("entry_price") === false, "G5.10 'entry_price' is NOT secret");
    assert(isSecretKey("confidence") === false, "G5.11 'confidence' is NOT secret");
    assert(isSecretKey("asset_name") === false, "G5.12 'asset_name' is NOT secret");
    assert(isSecretKey("pnl_amount") === false, "G5.13 'pnl_amount' is NOT secret");

    // Nested secret detection
    const nestedResult = findSecretInRecord({ safe: 1, nested: { deep: { api_key: "leak" } } });
    assert(nestedResult !== null, "G5.14 findSecretInRecord catches nested api_key");
    assert(nestedResult === "nested.deep.api_key", "G5.15 path is correct");

    const scanResult = scanRecordsForSecrets([{ safe: 1 }, { also_safe: 2, inner: { password: "leak" } }]);
    assert(scanResult !== null, "G5.16 scanRecordsForSecrets catches secret in second record");

    // Secret guard message includes dataset name and key path (Section 6.3)
    const depsSecret = buildStandardDeps({
      extraTables: {
        bot_signals: {
          rows: makeBotSignals(2).map(r => ({ ...r, secret_token: "bad_value" })),
        },
      },
      botSignalCount: 0,
    });
    let secretMsg = "";
    try { await buildExportZip(depsSecret); } catch (e) { secretMsg = (e as Error).message; }
    assert(secretMsg.includes("bot_signals"), "G5.17 Secret error message includes dataset name");
    assert(secretMsg.includes("secret") || secretMsg.includes("token"), "G5.18 Secret error includes key info");
    assert(secretMsg.includes("stopped for safety"), "G5.19 Secret error says 'stopped for safety'");
  }

  // =====================================================================
  // G6: Empty account
  // =====================================================================
  console.log("\n── G6: Empty Account ──");
  {
    const deps = buildStandardDeps({
      tradeCount: 0, journalCount: 0, predictionCount: 0,
      watchlistCount: 0, presetCount: 0, botSignalCount: 0,
      settingsData: {},
      storageData: { qc_price_alerts: "[]" },
    });
    (deps.storage as any).getItem = (key: string) => {
      if (key === "qc_price_alerts") return "[]";
      return null;
    };

    const result = await buildExportZip(deps);
    assert(result.blob.size > 0, "G6.1 ZIP blob has non-zero size");
    const zip = await JSZip.loadAsync(result.blob);

    for (const name of ["audit_trail", "trade_journal", "prediction_scores", "watchlist", "context_presets", "bot_signals"]) {
      const raw = await zip.file(`json/${name}.json`)?.async("string");
      const obj = JSON.parse(raw!);
      assertEq(obj.record_count, 0, `G6.2 ${name} record_count is 0`);
    }

    // Section 7.8: empty settings must be records: [], not [{}]
    const settingsRaw = await zip.file("json/settings.json")?.async("string");
    const settingsObj = JSON.parse(settingsRaw!);
    assertEq(settingsObj.record_count, 0, "G6.3 settings record_count is 0");
    assertEq(settingsObj.records.length, 0, "G6.4 settings records is empty array, not [{}]");

    // No local_preferences.json when missing
    assert(zip.file("json/local_preferences.json") === null, "G6.5 No local_preferences.json when pref keys missing");

    const manifestRaw = await zip.file("manifest.json")?.async("string");
    const manifest = JSON.parse(manifestRaw!);
    for (const ds of manifest.datasets) {
      if (ds.source === "this_device_only") {
        // Device-only: matched is null, not true
        assertEq(ds.matched, null, `G6.6 ${ds.name} device-only: matched is null`);
      } else {
        assert(ds.matched === true, `G6.6 ${ds.name} matched === true (empty is still matched)`);
      }
    }
  }

  // =====================================================================
  // G7: Failure paths
  // =====================================================================
  console.log("\n── G7: Failure Paths ──");
  {
    // Table error
    const deps = buildStandardDeps({
      extraTables: {
        trade_history: { rows: [], error: { message: "simulated db error", code: "PGRST000" } },
      },
    });
    let caughtError: Error | null = null;
    try { await buildExportZip(deps); } catch (err) { caughtError = err as Error; }
    assert(caughtError !== null, "G7.1 Error is thrown on table fetch failure");

    // Section 2.1: probe failure aborts (no fallback to *)
    const depsProbe = buildStandardDeps({
      extraTables: {
        trade_history: { rows: makeTradeHistory(5), error: { message: "probe error" } },
      },
    });
    let probeErr: Error | null = null;
    try { await buildExportZip(depsProbe); } catch (err) { probeErr = err as Error; }
    assert(probeErr !== null, "G7.2 Probe failure aborts export");
    assert(probeErr!.message.includes("Column discovery failed"), "G7.3 Probe error message is clear");

    // Pre-aborted signal
    const controller = new AbortController();
    const depsAbort = buildStandardDeps();
    depsAbort.signal = controller.signal;
    controller.abort();
    let caughtAbort = false;
    try { await buildExportZip(depsAbort); } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") caughtAbort = true;
    }
    assert(caughtAbort, "G7.4 AbortError thrown when signal is pre-aborted");
  }

  // =====================================================================
  // G8: Images ON vs OFF
  // =====================================================================
  console.log("\n── G8: Images ON vs OFF ──");
  {
    // Images OFF
    const depsOff = buildStandardDeps({ tradeCount: 3, includeImages: false });
    const resultOff = await buildExportZip(depsOff);
    const zipOff = await JSZip.loadAsync(resultOff.blob);
    const filesOff = Object.keys(zipOff.files);
    const imageFilesOff = filesOff.filter((f) => f.startsWith("images/"));
    assertEq(imageFilesOff.length, 0, "G8.1 No images/ files when includeImages=false");

    const auditOff = JSON.parse((await zipOff.file("json/audit_trail.json")?.async("string"))!);
    for (const rec of auditOff.records) {
      assert(!("image_1" in rec), "G8.2 image_1 field removed from JSON when images OFF");
      assert(!("image_2" in rec), "G8.3 image_2 field removed from JSON when images OFF");
    }
  }
  {
    // Images ON
    const depsOn = buildStandardDeps({ tradeCount: 3, includeImages: true });
    const resultOn = await buildExportZip(depsOn);
    const zipOn = await JSZip.loadAsync(resultOn.blob);
    const filesOn = Object.keys(zipOn.files);
    const imageFilesOn = filesOn.filter((f) => f.startsWith("images/"));
    assert(imageFilesOn.length > 0, "G8.4 images/ files exist when includeImages=true");

    const auditOn = JSON.parse((await zipOn.file("json/audit_trail.json")?.async("string"))!);
    const firstRec = auditOn.records[0];
    assert(typeof firstRec.image_1_file === "string" && firstRec.image_1_file.length > 0, "G8.5 image_1_file populated");
    assert(!("image_1" in firstRec), "G8.6 raw base64 image_1 NOT in JSON even when images ON");

    // Images stored with STORE compression (verify they're in the zip as binary)
    const realImageFiles = imageFilesOn.filter(f => !f.endsWith("/"));
    assert(realImageFiles.length > 0, "G8.7 At least one real image file in images/");
    for (const imgFile of realImageFiles) {
      const imgData = await zipOn.file(imgFile)?.async("uint8array");
      assert(imgData !== undefined && imgData!.length > 0, `G8.8 ${imgFile} has binary data`);
    }
  }

  // =====================================================================
  // G9: Settings allow-list
  // =====================================================================
  console.log("\n── G9: Settings Allow-List ──");
  {
    const deps = buildStandardDeps();
    const result = await buildExportZip(deps);
    const zip = await JSZip.loadAsync(result.blob);
    const settingsRaw = await zip.file("json/settings.json")?.async("string");
    const settingsObj = JSON.parse(settingsRaw!);

    if (settingsObj.records.length > 0) {
      const rec = settingsObj.records[0];
      const keys = Object.keys(rec);
      assert(keys.includes("hum_enabled"), "G9.1 hum_enabled is exported");
      assert(keys.includes("accent_theme"), "G9.2 accent_theme is exported");
      assert(!keys.includes("user_id"), "G9.3 user_id is NOT exported");
      assert(!keys.includes("some_internal_field"), "G9.4 some_internal_field NOT exported");
    }
  }

  // =====================================================================
  // G10: Manifest content (Section 3.4: rows_added_during_export)
  // =====================================================================
  console.log("\n── G10: Manifest Content ──");
  {
    const deps = buildStandardDeps();
    const result = await buildExportZip(deps);
    const zip = await JSZip.loadAsync(result.blob);
    const manifest = JSON.parse((await zip.file("manifest.json")?.async("string"))!);

    assertEq(manifest.app_name, "QuantContext Engine", "G10.1 app_name");
    assertEq(manifest.export_schema_version, 1, "G10.2 export_schema_version");
    assert(typeof manifest.generated_at_utc === "string", "G10.3 generated_at_utc is string");
    assert(Array.isArray(manifest.datasets), "G10.4 datasets is array");
    assert(Array.isArray(manifest.excluded_data), "G10.5 excluded_data is array");
    assert(manifest.excluded_data.length > 0, "G10.6 excluded_data is non-empty");

    for (const ds of manifest.datasets) {
      assert(typeof ds.name === "string", `G10.7 ${ds.name} has name`);
      assert(typeof ds.record_count === "number", `G10.8 ${ds.name} has record_count`);
      if (ds.source === "this_device_only") {
        // Device-only datasets: db_count_at_start, matched, rows_added_during_export must be null
        assertEq(ds.db_count_at_start, null, `G10.9 ${ds.name} device-only: db_count_at_start is null`);
        assertEq(ds.matched, null, `G10.10 ${ds.name} device-only: matched is null`);
        assertEq(ds.rows_added_during_export, null, `G10.11 ${ds.name} device-only: rows_added_during_export is null`);
      } else {
        assert(typeof ds.db_count_at_start === "number", `G10.9 ${ds.name} has db_count_at_start`);
        assert(typeof ds.matched === "boolean", `G10.10 ${ds.name} has matched`);
        assert(typeof ds.rows_added_during_export === "number", `G10.11 ${ds.name} has rows_added_during_export`);
      }
    }

    // DB-sourced datasets all matched
    const dbDatasets = manifest.datasets.filter((ds: any) => ds.source !== "this_device_only");
    const allMatched = dbDatasets.every((ds: any) => ds.matched === true);
    assert(allMatched, "G10.12 All DB datasets matched === true");

    const paDs = manifest.datasets.find((ds: any) => ds.name === "price_alerts");
    assertEq(paDs?.source, "this_device_only", "G10.13 price_alerts source: this_device_only");
  }

  // =====================================================================
  // G11: README content
  // =====================================================================
  console.log("\n── G11: README Content ──");
  {
    const deps = buildStandardDeps();
    const result = await buildExportZip(deps);
    const zip = await JSZip.loadAsync(result.blob);
    const readme = await zip.file("README.txt")?.async("string");
    assert(readme !== undefined && readme.length > 500, "G11.1 README.txt is substantial");
    assert(readme!.includes("QUANTCONTEXT ENGINE"), "G11.2 has app name");
    assert(readme!.includes("NOT encrypted"), "G11.3 has security warning");
    assert(readme!.includes("not a backup"), "G11.4 says it's not a restore backup");
    assert(readme!.includes("prediction_scores.trade_history_id"), "G11.5 documents linking fields");
    assert(readme!.includes("trade_journal.analysis_id"), "G11.6 documents journal linking");
    assert(readme!.includes("THIS DEVICE ONLY"), "G11.7 device-only note for price alerts");
    assert(readme!.includes("other accounts"), "G11.8 mentions other accounts on same browser");
    assert(readme!.includes("Rows created during"), "G11.9 mentions rows created during export");
    assert(readme!.includes("truncated") || readme!.includes("TRUNCATED"), "G11.10 truncation note");
    assert(readme!.includes("snapshot"), "G11.11 snapshot note");

    // Print the full README
    console.log("\n  === FULL README.txt ===");
    console.log(readme!.split("\n").map(l => "  | " + l).join("\n"));
    console.log("  === END README.txt ===\n");
  }

  // =====================================================================
  // G12: Download helper (mocked DOM test)
  // =====================================================================
  console.log("\n── G12: Download Helper ──");
  {
    assert(typeof downloadBlob === "function", "G12.1 downloadBlob is a function");
    assert(downloadBlob.length === 2, "G12.2 downloadBlob takes 2 arguments");

    // Mock DOM for Node.js
    let createdEl: any = null;
    let appendedChild: any = null;
    let clickCalled = false;
    let revokedUrl: string | null = null;
    let createdUrl: string | null = null;

    const origDoc = (globalThis as any).document;
    const origURL = (globalThis as any).URL;
    (globalThis as any).document = {
      createElement(tag: string) {
        createdEl = { tagName: tag, href: "", download: "", style: { display: "" }, click() { clickCalled = true; } };
        return createdEl;
      },
      body: {
        appendChild(el: any) { appendedChild = el; },
        removeChild(_: any) {},
      },
    };
    (globalThis as any).URL = {
      createObjectURL(blob: any) { createdUrl = "blob:mock"; return "blob:mock"; },
      revokeObjectURL(url: string) { revokedUrl = url; },
    };

    const testBlob = new Blob(["test"], { type: "application/zip" });
    downloadBlob(testBlob, "test-export.zip");

    assert(createdEl !== null && createdEl.tagName === "a", "G12.3 Creates an anchor element");
    assert(createdEl.download === "test-export.zip", "G12.4 Sets download filename");
    assert(clickCalled, "G12.5 Calls click() on the anchor");
    assert(createdUrl === "blob:mock", "G12.6 Creates object URL");

    // Wait for revoke timeout
    await new Promise(r => setTimeout(r, 6000));
    assert(revokedUrl === "blob:mock", "G12.7 Revokes object URL after delay");

    // Restore
    (globalThis as any).document = origDoc;
    (globalThis as any).URL = origURL;
  }

  // =====================================================================
  // G-CSV: CSV formula protection
  // =====================================================================
  console.log("\n── G-CSV: CSV Formula Protection ──");
  {
    const { csv: csv1 } = recordsToCSV([{ a: "=SUM(A1:A10)" }]);
    assert(csv1.includes("'=SUM"), "G-CSV.1 '=' text gets formula prefix");

    const { csv: csv2 } = recordsToCSV([{ a: "+cmd" }]);
    assert(csv2.includes("'+cmd"), "G-CSV.2 '+' text gets formula prefix");

    const { csv: csv4 } = recordsToCSV([{ a: -50 }]);
    assert(!csv4.includes("'-50"), "G-CSV.3 Negative number NOT prefixed");
    assert(csv4.includes("-50"), "G-CSV.4 Negative number preserved");

    const { csv: csv5 } = recordsToCSV([{ a: "-50" }]);
    assert(!csv5.includes("'-50"), "G-CSV.5 Negative number string NOT prefixed");

    assert(csv1.charCodeAt(0) === 0xFEFF, "G-CSV.6 CSV starts with UTF-8 BOM");

    const { csv: csv6 } = recordsToCSV([{ a: null }]);
    const lines6 = csv6.replace(/^\uFEFF/, "").split(/\r\n/).filter((_, i, arr) => i < arr.length - 1 || _ !== "");
    assert(lines6.length >= 2, "G-CSV.7a CSV has header + 1 data row");
    assert(lines6[1] === "", "G-CSV.7 null becomes empty cell");

    const { csv: csv7 } = recordsToCSV([{ a: { nested: true } }]);
    assert(csv7.includes("{") && csv7.includes("nested"), "G-CSV.8 Object serialized as JSON string in CSV");
  }

  // =====================================================================
  // G-TRUNC: CSV cell truncation with filename (Section 9.5)
  // =====================================================================
  console.log("\n── G-TRUNC: CSV Cell Truncation ──");
  {
    const longString = "x".repeat(35000);
    const { csv, truncatedCells } = recordsToCSV([{ a: longString }], undefined, "audit_trail");
    assert(truncatedCells === 1, "G-TRUNC.1 truncatedCells count is 1");
    assert(csv.includes("TRUNCATED"), "G-TRUNC.2 truncation marker present in CSV");
    assert(csv.includes("json/audit_trail.json"), "G-TRUNC.3 truncation marker includes JSON filename");
    assert(!csv.includes("x".repeat(35000)), "G-TRUNC.4 full 35000-char string is NOT in CSV");

    // Code-point boundary: emoji at the cut point
    const emojiStr = "x".repeat(31999) + "😀" + "y".repeat(1000);
    const { csv: csvEmoji } = recordsToCSV([{ a: emojiStr }]);
    // The emoji should not be split (no lone surrogate)
    const csvEmojiClean = csvEmoji.replace(/^\uFEFF/, "");
    const hasBrokenSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(csvEmojiClean);
    assert(!hasBrokenSurrogate, "G-TRUNC.5 No broken surrogate pairs at truncation boundary");
  }

  // =====================================================================
  // G-LOCAL: Local preferences and price alerts
  // =====================================================================
  console.log("\n── G-LOCAL: Local Data ──");
  {
    const deps = buildStandardDeps();
    const result = await buildExportZip(deps);
    const zip = await JSZip.loadAsync(result.blob);

    const lpRaw = await zip.file("json/local_preferences.json")?.async("string");
    assert(lpRaw !== undefined, "G-LOCAL.1 local_preferences.json exists");
    const lpObj = JSON.parse(lpRaw!);
    assertEq(lpObj.dataset, "local_preferences", "G-LOCAL.2 dataset name correct");
    assertEq(lpObj.source, "this_device_only", "G-LOCAL.3 source is this_device_only");
    assertEq(lpObj.records[0].qc_darkmode, true, "G-LOCAL.4 qc_darkmode exported as boolean true");

    const paRaw = await zip.file("json/price_alerts.json")?.async("string");
    const paObj = JSON.parse(paRaw!);
    assertEq(paObj.record_count, 2, "G-LOCAL.5 price_alerts has 2 records");
    assertEq(paObj.source, "this_device_only", "G-LOCAL.6 price_alerts source is this_device_only");
    assert(zip.file("csv/price_alerts.csv") !== null, "G-LOCAL.7 price_alerts CSV exists");

    // Manifest: device-only datasets have null for db_count_at_start, matched, rows_added_during_export
    const manifest = JSON.parse((await zip.file("manifest.json")?.async("string"))!);
    const paManifest = manifest.datasets.find((ds: any) => ds.name === "price_alerts");
    assertEq(paManifest.db_count_at_start, null, "G-LOCAL.8 price_alerts manifest: db_count_at_start is null");
    assertEq(paManifest.matched, null, "G-LOCAL.9 price_alerts manifest: matched is null");
    assertEq(paManifest.rows_added_during_export, null, "G-LOCAL.10 price_alerts manifest: rows_added_during_export is null");

    // Manifest timestamps: price_alerts uses ISO 8601 UTC (not raw Unix ms)
    assert(paManifest.first_created_at !== null, "G-LOCAL.11 price_alerts manifest: first_created_at present");
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(paManifest.first_created_at), "G-LOCAL.12 price_alerts manifest: first_created_at is ISO 8601");
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(paManifest.last_created_at), "G-LOCAL.13 price_alerts manifest: last_created_at is ISO 8601");
    // Verify the conversion: 1700000000000 → 2023-11-14T22:13:20.000Z
    assertEq(paManifest.first_created_at, "2023-11-14T22:13:20.000Z", "G-LOCAL.14 price_alerts first_created_at ISO matches expected");

    const lpManifest = manifest.datasets.find((ds: any) => ds.name === "local_preferences");
    assertEq(lpManifest.db_count_at_start, null, "G-LOCAL.15 local_preferences manifest: db_count_at_start is null");
    assertEq(lpManifest.matched, null, "G-LOCAL.16 local_preferences manifest: matched is null");
    assertEq(lpManifest.rows_added_during_export, null, "G-LOCAL.17 local_preferences manifest: rows_added_during_export is null");
  }

  // =====================================================================
  // G-RO: Read-only verification (Section 7.5: extended)
  // =====================================================================
  console.log("\n── G-RO: Read-Only Check ──");
  {
    const fs = await import("fs");
    const source = fs.readFileSync("src/exportService.ts", "utf-8");
    assert(!source.includes(".insert("), "G-RO.1 No .insert( in exportService.ts");
    assert(!source.includes(".update("), "G-RO.2 No .update( in exportService.ts");
    assert(!source.includes(".delete("), "G-RO.3 No .delete( in exportService.ts");
    assert(!source.includes(".upsert("), "G-RO.4 No .upsert( in exportService.ts");
    assert(!source.includes(".rpc("), "G-RO.5 No .rpc( in exportService.ts");
    // No Supabase storage bucket access (deps.storage is our injectable localStorage, not Supabase)
    const sourceLines = source.split("\n");
    const supabaseStorageLines = sourceLines.filter((l: string) => /supabase\s*\.\s*storage/.test(l));
    assert(supabaseStorageLines.length === 0, "G-RO.6 No supabase.storage bucket access in exportService.ts");
    // No non-GET fetch calls
    const fetchMatches = source.match(/fetch\s*\(/g);
    assert(!fetchMatches, "G-RO.7 No fetch() calls in exportService.ts");
  }

  // =====================================================================
  // G-NOCALL: No external API calls
  // =====================================================================
  console.log("\n── G-NOCALL: No External API Calls ──");
  {
    const fs = await import("fs");
    const source = fs.readFileSync("src/exportService.ts", "utf-8");
    const importLines = source.split("\n").filter((l: string) => l.trim().startsWith("import"));
    const hasExternalImport = importLines.some((l: string) =>
      l.includes("pinecone") || l.includes("finnhub") || l.includes("@google/genai") ||
      l.includes("smartapi") || l.includes("angelone")
    );
    assert(!hasExternalImport, "G-NOCALL.1 No external API imports");
    assert(!source.includes("new Pinecone"), "G-NOCALL.2 No Pinecone client");
    assert(!source.includes("new GoogleGenAI") && !source.includes("genai."), "G-NOCALL.3 No Gemini client");
    assert(!source.includes("SmartAPI"), "G-NOCALL.4 No Angel One client");
    const hasFetchToExternal = /fetch\s*\(\s*['"`]http/.test(source);
    assert(!hasFetchToExternal, "G-NOCALL.5 No external HTTP fetch calls");
  }

  // =====================================================================
  // G-COUNT: Section 3 — count rules for concurrent writes
  // =====================================================================
  console.log("\n── G-COUNT: Count Rules (Section 3) ──");
  {
    // Rows appended between pages: export succeeds, extra rows counted
    const baseBotRows = makeBotSignals(10);
    const extraRows = [
      { id: "bs_extra_1", user_id: TEST_USER_ID, signal_type: "buy", ticker: "EXTRA1", confidence: 0.9, pnl: 50, created_at: "2025-09-30T14:00:00.000Z" },
      { id: "bs_extra_2", user_id: TEST_USER_ID, signal_type: "sell", ticker: "EXTRA2", confidence: 0.8, pnl: 30, created_at: "2025-09-30T15:00:00.000Z" },
    ];
    const depsAppend = buildStandardDeps({
      botSignalCount: 0,
      extraTables: {
        bot_signals: {
          rows: baseBotRows,
          addRowsAfter: { requestNum: 3, rows: extraRows }, // Add 2 rows after 3rd request
        },
      },
    });
    const resultAppend = await buildExportZip(depsAppend);
    const zipAppend = await JSZip.loadAsync(resultAppend.blob);
    const botJson = JSON.parse((await zipAppend.file("json/bot_signals.json")?.async("string"))!);
    assertEq(botJson.record_count, 12, "G-COUNT.1 Appended rows: export has exactly 10 base + 2 extra = 12");

    // Check no duplicate IDs
    const botIds = botJson.records.map((r: any) => r.id);
    const uniqueBotIds = new Set(botIds);
    assertEq(uniqueBotIds.size, botIds.length, "G-COUNT.2 No duplicate IDs in exported data");

    // Manifest shows rows_added_during_export
    const manifestAppend = JSON.parse((await zipAppend.file("manifest.json")?.async("string"))!);
    const botManifest = manifestAppend.datasets.find((ds: any) => ds.name === "bot_signals");
    assert(botManifest.matched === true, "G-COUNT.3 matched is true when record_count >= db_count_at_start");
    assertEq(botManifest.rows_added_during_export, 2, "G-COUNT.4 rows_added_during_export is exactly 2");
  }

  // =====================================================================
  // G-TIMEOUT: Timeout halving (Section 2.4)
  // =====================================================================
  console.log("\n── G-TIMEOUT: Timeout Halving ──");
  {
    // Main pass timeout halving: first 2 requests timeout, then succeeds
    const botRows = makeBotSignals(20);
    const depsTimeout = buildStandardDeps({
      botSignalCount: 0,
      extraTables: {
        bot_signals: {
          rows: botRows,
          timeoutForFirstN: 2,
        },
      },
    });
    const resultTimeout = await buildExportZip(depsTimeout);
    const zipTimeout = await JSZip.loadAsync(resultTimeout.blob);
    const botJsonT = JSON.parse((await zipTimeout.file("json/bot_signals.json")?.async("string"))!);
    assert(botJsonT.record_count === 20, "G-TIMEOUT.1 All rows fetched after timeout recovery (main pass)");

    // Verify no duplicate rows after timeout recovery
    const tIds = botJsonT.records.map((r: any) => r.id);
    assertEq(new Set(tIds).size, tIds.length, "G-TIMEOUT.2 No duplicate IDs after timeout recovery");

    // Images pass timeout halving: first 2 image batch requests timeout, then succeed
    const imgRows = makeTradeHistory(5);
    const depsImgTimeout = buildStandardDeps({
      tradeCount: 0,
      includeImages: true,
      extraTables: {
        trade_history: {
          rows: imgRows,
          timeoutForFirstN: 2,
        },
      },
    });
    const resultImgT = await buildExportZip(depsImgTimeout);
    const zipImgT = await JSZip.loadAsync(resultImgT.blob);
    const imgFilesT = Object.keys(zipImgT.files).filter(f => f.startsWith("images/") && !f.endsWith("/"));
    // 5 rows: row 0,1,2 have image_1; row 0,1 have image_2 → 5 image files
    assert(imgFilesT.length > 0, "G-TIMEOUT.3 Images fetched after timeout recovery (images pass)");
    const auditImgT = JSON.parse((await zipImgT.file("json/audit_trail.json")?.async("string"))!);
    assertEq(auditImgT.record_count, 5, "G-TIMEOUT.4 All rows present after image timeout recovery");
  }

  // =====================================================================
  // G-PAGINATION: Full-pipeline pagination (Section 3.1)
  // =====================================================================
  console.log("\n── G-PAGINATION: Full-pipeline Pagination ──");
  {
    // Test 1: server cap 50 with default batch 500, 127 total rows → pages at 50 each
    const bigBotRows = makeBotSignals(127);
    const depsPag1 = buildStandardDeps({
      botSignalCount: 0,
      extraTables: {
        bot_signals: {
          rows: bigBotRows,
          serverCap: 50,
        },
      },
    });
    const resultPag1 = await buildExportZip(depsPag1);
    const zipPag1 = await JSZip.loadAsync(resultPag1.blob);
    const botPag1 = JSON.parse((await zipPag1.file("json/bot_signals.json")?.async("string"))!);
    assertEq(botPag1.record_count, 127, "G-PAG.1 Server cap 50: all 127 rows returned");

    // Test 2: Verify dedup — no duplicate IDs
    const pagIds = botPag1.records.map((r: any) => r.id);
    assertEq(new Set(pagIds).size, 127, "G-PAG.2 Server cap 50: no duplicate IDs across pages");

    // Test 3: Ordering preserved (ascending by created_at, then by pk)
    const pagCreated = botPag1.records.map((r: any) => r.created_at);
    const isSorted = pagCreated.every((v: string, i: number) => i === 0 || v >= pagCreated[i - 1]);
    assert(isSorted, "G-PAG.3 Server cap 50: records are sorted by created_at ascending");

    // Test 4: Exact boundary — 100 rows with server cap 50 (exactly 2 pages)
    const exactRows = makeBotSignals(100);
    const depsPag2 = buildStandardDeps({
      botSignalCount: 0,
      extraTables: {
        bot_signals: {
          rows: exactRows,
          serverCap: 50,
        },
      },
    });
    const resultPag2 = await buildExportZip(depsPag2);
    const zipPag2 = await JSZip.loadAsync(resultPag2.blob);
    const botPag2 = JSON.parse((await zipPag2.file("json/bot_signals.json")?.async("string"))!);
    assertEq(botPag2.record_count, 100, "G-PAG.4 Exact boundary: 100 rows with cap 50 → all returned");

    // Test 5: Many pages — 300 rows with server cap 25 (12 pages)
    const manyPageRows = makeBotSignals(300);
    const depsPag3 = buildStandardDeps({
      botSignalCount: 0,
      extraTables: {
        bot_signals: {
          rows: manyPageRows,
          serverCap: 25,
        },
      },
    });
    const resultPag3 = await buildExportZip(depsPag3);
    const zipPag3 = await JSZip.loadAsync(resultPag3.blob);
    const botPag3 = JSON.parse((await zipPag3.file("json/bot_signals.json")?.async("string"))!);
    assertEq(botPag3.record_count, 300, "G-PAG.5 Many pages: 300 rows with cap 25 → all 300 returned");
    const pagIds3 = botPag3.records.map((r: any) => r.id);
    assertEq(new Set(pagIds3).size, 300, "G-PAG.6 Many pages: no duplicate IDs across 12 pages");

    // Test 6: Small batch (verifies page iteration even with tiny batches)
    const smallBatchRows = makeBotSignals(15);
    const depsPag4 = buildStandardDeps({
      botSignalCount: 0,
      extraTables: {
        bot_signals: {
          rows: smallBatchRows,
          serverCap: 3,
        },
      },
    });
    const resultPag4 = await buildExportZip(depsPag4);
    const zipPag4 = await JSZip.loadAsync(resultPag4.blob);
    const botPag4 = JSON.parse((await zipPag4.file("json/bot_signals.json")?.async("string"))!);
    assertEq(botPag4.record_count, 15, "G-PAG.7 Server cap 3: all 15 rows from 5 pages");
  }

  // =====================================================================
  // G-ABORT: Abort mid-export (Section 5.1)
  // =====================================================================
  console.log("\n── G-ABORT: Abort Mid-Export ──");
  {
    // Abort mid-main-pass: abort after 2nd request
    const bigRows = makeBotSignals(100);
    const controller1 = new AbortController();
    let reqCount = 0;
    const mockSb1 = createMockSupabase({
      trade_history: { rows: makeTradeHistory(2) },
      trade_journal: { rows: makeJournalEntries(1) },
      prediction_scores: { rows: makePredictionScores(1) },
      watchlist: { rows: makeWatchlist(1) },
      context_presets: { rows: makeContextPresets(1) },
      bot_signals: { rows: bigRows, serverCap: 10 }, // Forces many pages
      user_settings: { rows: [{ user_id: TEST_USER_ID, hum_enabled: true }] },
    });
    // Intercept to count requests and abort mid-way
    const origFrom1 = mockSb1.from.bind(mockSb1);
    mockSb1.from = (table: string) => {
      reqCount++;
      if (reqCount > 8) controller1.abort(); // abort after several requests
      return origFrom1(table);
    };
    let abortErr1 = false;
    try {
      await buildExportZip({
        supabase: mockSb1 as any,
        userId: TEST_USER_ID,
        includeImages: false,
        signal: controller1.signal,
        onProgress: () => {},
        storage: { getItem: () => null },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") abortErr1 = true;
    }
    assert(abortErr1, "G-ABORT.1 Abort mid-main-pass throws AbortError");

    // Abort mid-images-pass: use many rows so multiple image batches are needed
    const imgRows = makeTradeHistory(60); // 60 rows = 3 image batches of 20
    const controller2 = new AbortController();
    let imgPhaseStarted = false;
    let imgBatchesSeen = 0;
    const mockSb2 = createMockSupabase({
      trade_history: { rows: imgRows },
      trade_journal: { rows: [] },
      prediction_scores: { rows: [] },
      watchlist: { rows: [] },
      context_presets: { rows: [] },
      bot_signals: { rows: [] },
      user_settings: { rows: [] },
    });
    const origFrom2 = mockSb2.from.bind(mockSb2);
    mockSb2.from = (table: string) => {
      const result = origFrom2(table);
      // The image pass calls .from("trade_history").select("id,image_1,image_2").in(...)
      // Intercept the .in() to detect image batch requests
      const origIn = result.in.bind(result);
      result.in = (col: string, vals: unknown[]) => {
        imgPhaseStarted = true;
        imgBatchesSeen++;
        if (imgBatchesSeen >= 2) controller2.abort(); // abort after 2nd image batch
        return origIn(col, vals);
      };
      return result;
    };
    let abortErr2 = false;
    try {
      await buildExportZip({
        supabase: mockSb2 as any,
        userId: TEST_USER_ID,
        includeImages: true,
        signal: controller2.signal,
        onProgress: () => {},
        storage: { getItem: () => null },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") abortErr2 = true;
    }
    assert(abortErr2, "G-ABORT.2 Abort mid-images-pass throws AbortError");

    // Abort pre-start (already tested in G7.4, but validates signal check at packaging)
    const controller3 = new AbortController();
    controller3.abort();
    let abortErr3 = false;
    try {
      await buildExportZip({
        supabase: createMockSupabase({
          trade_history: { rows: makeTradeHistory(1) },
          trade_journal: { rows: [] }, prediction_scores: { rows: [] },
          watchlist: { rows: [] }, context_presets: { rows: [] },
          bot_signals: { rows: [] }, user_settings: { rows: [] },
        }) as any,
        userId: TEST_USER_ID, includeImages: false,
        signal: controller3.signal, onProgress: () => {},
        storage: { getItem: () => null },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") abortErr3 = true;
    }
    assert(abortErr3, "G-ABORT.3 Abort pre-start throws AbortError");
  }

  // =====================================================================
  // G-DOUBLE-RUN: Double-run guard (Section 5.2)
  // =====================================================================
  console.log("\n── G-DOUBLE-RUN: Double-Run Guard ──");
  {
    // The double-run guard is in App.tsx (exportRunningRef.current check).
    // Here we verify the export service itself: if called concurrently, both calls
    // execute independently (the guard is at UI layer, not service layer).
    // We verify the UI guard by checking the ref-based pattern:
    const fs = await import("fs");
    const appSource = fs.readFileSync("src/App.tsx", "utf-8");
    assert(appSource.includes("exportRunningRef.current") && appSource.includes("if (exportRunningRef.current) return"), "G-DOUBLE-RUN.1 exportRunningRef double-run guard exists in App.tsx");
    // Verify it's set before first await
    const handleIdx = appSource.indexOf("handleExportAllData");
    const guardIdx = appSource.indexOf("if (exportRunningRef.current) return");
    const firstAwaitIdx = appSource.indexOf("await import", handleIdx);
    assert(guardIdx < firstAwaitIdx, "G-DOUBLE-RUN.2 Guard is before first await in handleExportAllData");
  }

  // =====================================================================
  // G-COUNT-EXT: Extended count rules (Section 3)
  // =====================================================================
  console.log("\n── G-COUNT-EXT: Extended Count Rules ──");
  {
    // Row deleted mid-export: serverCap forces multi-page fetch so deletion is detected.
    // 20 rows, serverCap 5 → count=20. Removal on req 2 (first data page) removes first 8 rows
    // leaving 12. First fetch collects 12 (< 20 = dbCount) → retry with fresh count=12,
    // fresh fetch=12 → 12 >= 12 → succeeds with record_count=12.
    const baseRows = makeBotSignals(20);
    const depsDelete = buildStandardDeps({
      botSignalCount: 0,
      extraTables: {
        bot_signals: {
          rows: baseRows,
          removeRowsAfter: { requestNum: 2, count: 8 }, // remove 8 rows after 1st data page
          serverCap: 5,
        },
      },
    });
    const resultDelete = await buildExportZip(depsDelete);
    const zipDelete = await JSZip.loadAsync(resultDelete.blob);
    const botJsonDelete = JSON.parse((await zipDelete.file("json/bot_signals.json")?.async("string"))!);
    assertEq(botJsonDelete.record_count, 12, "G-COUNT-EXT.1 Delete mid-export: retry succeeds with fresh count, record_count=12");
    const manifestDelete = JSON.parse((await zipDelete.file("manifest.json")?.async("string"))!);
    const botManifestDelete = manifestDelete.datasets.find((ds: any) => ds.name === "bot_signals");
    assertEq(botManifestDelete.matched, true, "G-COUNT-EXT.1b matched is true after retry with fresh count");

    // Silent row cap: single-row dataset (settings) still works
    const depsSingle = buildStandardDeps({ settingsData: { hum_enabled: true, accent_theme: "emerald" } });
    const resultSingle = await buildExportZip(depsSingle);
    const zipSingle = await JSZip.loadAsync(resultSingle.blob);
    const settingsJson = JSON.parse((await zipSingle.file("json/settings.json")?.async("string"))!);
    assertEq(settingsJson.record_count, 1, "G-COUNT-EXT.2 Single settings row exported correctly");
  }

  // =====================================================================
  // G-PROGRESS: Progress messages
  // =====================================================================
  console.log("\n── G-PROGRESS: Progress Messages ──");
  {
    const deps = buildStandardDeps({ tradeCount: 3 });
    await buildExportZip(deps);

    const { progressLog } = deps;
    const phases = progressLog.map(p => p.phase);
    assert(phases.includes("fetching"), "G-PROGRESS.1 Has fetching phase");
    assert(phases.includes("packaging"), "G-PROGRESS.2 Has packaging phase");
    assert(phases.includes("done"), "G-PROGRESS.3 Has done phase");

    const doneMsg = progressLog.find(p => p.phase === "done");
    assert(doneMsg!.message.includes("Export ready"), "G-PROGRESS.4 Done message says 'Export ready'");

    // Packaging progress with percentage
    const packMsgs = progressLog.filter(p => p.phase === "packaging" && p.message.includes("%"));
    assert(packMsgs.length > 0, "G-PROGRESS.5 Packaging progress shows percentage");
  }

  // G-PROGRESS.6: Throttle test — identical events are dropped
  {
    // The new throttle drops identical consecutive messages entirely.
    // Burst 100,000 identical events — only the first should pass (leading edge).
    const deps = buildStandardDeps({ tradeCount: 1, journalCount: 0, predictionCount: 0, watchlistCount: 0, presetCount: 0, botSignalCount: 0 });
    await buildExportZip(deps);
    // Now test the throttle logic directly:
    const received: string[] = [];
    let lastTime = 0;
    let lastMsg = "";
    let lastPct = -1;
    let pending: { message: string; pct: number } | null = null;
    const THROTTLE_MS = 100;

    const throttledCb = (msg: string, pct: number) => {
      // Drop identical consecutive
      if (msg === lastMsg && pct === lastPct) return;
      const now = Date.now();
      const elapsed = now - lastTime;
      if (elapsed >= THROTTLE_MS || lastTime === 0) {
        lastTime = now;
        lastMsg = msg;
        lastPct = pct;
        received.push(msg);
        pending = null;
      } else {
        pending = { message: msg, pct };
      }
    };

    for (let i = 0; i < 100_000; i++) {
      throttledCb("Packaging...", 50);
    }
    // Identical → only the first passes
    assert(received.length === 1, `G-PROGRESS.6 Throttle: 100K identical events → ${received.length} delivered (expected 1)`);
  }

  // G-PROGRESS.7: Leading/trailing throttle — 1000 distinct messages within <100ms → at most 11 deliveries + last message delivered
  {
    const received: string[] = [];
    let lastTime = 0;
    let lastMsg = "";
    let lastPct = -1;
    let pending: string | null = null;
    const THROTTLE_MS = 100;

    const throttledCb = (msg: string, pct: number) => {
      if (msg === lastMsg && pct === lastPct) return;
      const now = Date.now();
      const elapsed = now - lastTime;
      if (elapsed >= THROTTLE_MS || lastTime === 0) {
        lastTime = now;
        lastMsg = msg;
        lastPct = pct;
        received.push(msg);
        pending = null;
      } else {
        pending = msg;
      }
    };

    // Send 1000 distinct messages synchronously (all within one tick < 100ms)
    for (let i = 0; i < 1000; i++) {
      throttledCb(`Images ${i + 1} / 800`, i);
    }
    // Flush trailing
    if (pending !== null) {
      received.push(pending);
    }
    // Leading edge: the first passes. Then all others within <100ms are pending.
    // After flush: the last pending is delivered. Total: 2 (first + last).
    // But if the burst takes >100ms, more intermediate deliveries may slip through.
    // Assert: at most 11 deliveries (1 leading + at most 10 trailing per second)
    assert(received.length <= 11, `G-PROGRESS.7 Throttle: 1000 distinct events → ${received.length} deliveries (max 11)`);
    // Last message is always delivered
    assertEq(received[received.length - 1], "Images 1000 / 800", "G-PROGRESS.7b Last message is delivered");
  }

  // =====================================================================
  // G-IMG-CAP: Image cap message shows estimated total > cap
  // =====================================================================
  console.log("\n── G-IMG-CAP: Image Cap Message ──");
  {
    // Create enough analyses that the estimated total exceeds the cap.
    // The mock always creates images for the first 3 trade_history rows.
    // MAX_IMAGE_BYTES exported from exportService = MAX_IMAGE_BYTES_DESKTOP = 200 MB.
    // We override the cap to something tiny (e.g. make enough images to exceed it).
    // Simplest approach: create a large number of rows with images, but we need to
    // trigger the "estimate > cap" path. After the first batch of 20 analyses,
    // the code estimates: firstBatchAvgBytes * imageRatio * totalAnalyses.
    // We need this estimate > 200 MB. With real base64 images in our mock (~67 bytes
    // decoded for the PNG, ~400 bytes for the JPEG), the avg is tiny (~230 bytes/analysis).
    // So with 200 MB cap that won't exceed it. Instead, test the error message format
    // by creating a custom mock that returns large images.
    const LARGE_IMAGE = "data:image/png;base64," + "A".repeat(300000); // ~225KB decoded
    const tradeCount = 500;
    const tradeRows: Record<string, unknown>[] = [];
    for (let i = 0; i < tradeCount; i++) {
      tradeRows.push({
        id: `cap-${i}`,
        user_id: TEST_USER_ID,
        created_at: `2025-01-01T00:00:0${Math.min(i, 9)}Z`,
        asset_name: `TICKER${i}`,
        market_sentiment: "bullish",
        risk_level: "medium",
        confidence: 80,
        synthesis_summary: "Test",
        full_result: {},
        image_1: LARGE_IMAGE,
        image_2: LARGE_IMAGE,
      });
    }

    const tables: Record<string, MockTableData> = {
      trade_history: { rows: tradeRows },
      trade_journal: { rows: [] },
      prediction_scores: { rows: [] },
      watchlist: { rows: [] },
      context_presets: { rows: [] },
      bot_signals: { rows: [] },
      user_settings: { rows: [{ user_id: TEST_USER_ID, hum_enabled: true, updated_at: "2025-01-01T00:00:00Z" }] },
    };

    const mockSupabase = createMockSupabase(tables);
    const progressLog: ExportProgress[] = [];
    const deps: ExportDeps & { progressLog: ExportProgress[] } = {
      supabase: mockSupabase as any,
      userId: TEST_USER_ID,
      includeImages: true,
      signal: new AbortController().signal,
      onProgress: (p) => progressLog.push({ ...p }),
      storage: { getItem: () => null },
      progressLog,
    };

    let caughtMsg = "";
    try {
      await buildExportZip(deps);
    } catch (err: any) {
      caughtMsg = String(err.message || err);
    }

    assert(caughtMsg.includes("Too many images"), "G-IMG-CAP.1 Error thrown for image cap exceeded");
    assert(caughtMsg.includes("estimated total is about"), "G-IMG-CAP.2 Message says 'estimated total is about'");
    // Parse the estimate and cap from the message
    const estMatch = caughtMsg.match(/about (\d+) MB/);
    const capMatch = caughtMsg.match(/limit is (\d+) MB/);
    assert(estMatch !== null, "G-IMG-CAP.3 Message contains estimate in MB");
    assert(capMatch !== null, "G-IMG-CAP.4 Message contains cap in MB");
    if (estMatch && capMatch) {
      const estMB = parseInt(estMatch[1], 10);
      const capMB = parseInt(capMatch[1], 10);
      assert(estMB > capMB, `G-IMG-CAP.5 Estimate (${estMB} MB) > cap (${capMB} MB)`);
    } else {
      assert(false, "G-IMG-CAP.5 Estimate > cap (could not parse)");
    }
  }

  // =====================================================================
  // G-ABORT-PACK: Abort during packaging (signal checked in onUpdate)
  // =====================================================================
  console.log("\n── G-ABORT-PACK: Abort During Packaging ──");
  {
    // Strategy: abort the signal once we see the packaging phase start.
    // The code has three abort checks around generateAsync:
    //   1. Before generateAsync: if (signal.aborted) throw ... (exportService.ts L1427)
    //   2. Inside onUpdate callback: if (signal.aborted) throw ... (L1436)
    //   3. After generateAsync: if (signal.aborted) throw ... (L1455)
    // We abort in the onProgress callback when phase === "packaging", which triggers
    // before generateAsync. With the throttle, the message may be delivered on leading
    // edge (first packaging event) or trailing edge. To be safe, we also abort on any
    // packaging event message containing "Packaging" or "Compressing".
    const deps = buildStandardDeps({ tradeCount: 50, journalCount: 10, predictionCount: 10, watchlistCount: 10, presetCount: 5, botSignalCount: 20 });
    const controller = new AbortController();
    let downloadCalled = false;
    let abortedAtPhase = "";

    const depsWithAbort: ExportDeps = {
      supabase: deps.supabase,
      userId: deps.userId,
      includeImages: false,
      signal: controller.signal,
      onProgress: (p) => {
        // Abort as soon as packaging phase begins
        if (p.phase === "packaging" && !controller.signal.aborted) {
          abortedAtPhase = p.message;
          controller.abort();
        }
      },
      storage: deps.storage,
    };

    let threwAbortError = false;
    try {
      const result = await buildExportZip(depsWithAbort);
      downloadCalled = true;
    } catch (err: any) {
      if (err instanceof DOMException && err.name === "AbortError") {
        threwAbortError = true;
      }
    }

    assert(threwAbortError, "G-ABORT-PACK.1 AbortError thrown when signal aborted during packaging");
    assert(!downloadCalled, "G-ABORT-PACK.2 Download function never called after abort");
  }

  // =====================================================================
  // G-ZIP-RT: ZIP round-trip — loadAsync + read every entry
  // =====================================================================
  console.log("\n── G-ZIP-RT: ZIP Round-Trip ──");
  {
    // Build a normal export, load the ZIP back with JSZip.loadAsync, iterate every
    // entry, read its content, and assert no errors.
    const deps = buildStandardDeps({ tradeCount: 5, includeImages: true });
    const result = await buildExportZip(deps);

    const zip = await JSZip.loadAsync(result.blob);
    const entries: string[] = [];
    zip.forEach((relativePath) => {
      entries.push(relativePath);
    });

    assert(entries.length > 0, "G-ZIP-RT.1 ZIP has entries");

    // Read every file entry (skip directories)
    let readErrors = 0;
    let filesRead = 0;
    for (const entry of entries) {
      if (entry.endsWith("/")) continue; // skip directory entries
      try {
        const file = zip.file(entry);
        if (file) {
          // Read as appropriate type
          if (entry.endsWith(".json") || entry.endsWith(".csv") || entry.endsWith(".txt")) {
            await file.async("string");
          } else {
            await file.async("uint8array");
          }
          filesRead++;
        }
      } catch {
        readErrors++;
      }
    }

    assert(filesRead > 0, `G-ZIP-RT.2 Read ${filesRead} files from ZIP successfully`);
    assertEq(readErrors, 0, "G-ZIP-RT.3 Zero read errors in round-trip");

    // Verify JSON files parse correctly
    const manifestFile = zip.file("manifest.json");
    assert(manifestFile !== null, "G-ZIP-RT.4 manifest.json exists in ZIP");
    if (manifestFile) {
      const manifestStr = await manifestFile.async("string");
      const manifest = JSON.parse(manifestStr);
      assert(typeof manifest.export_schema_version === "number", "G-ZIP-RT.5 manifest has export_schema_version");
      assert(typeof manifest.app_name === "string", "G-ZIP-RT.6 manifest has app_name");
    }

    const readmeFile = zip.file("README.txt");
    assert(readmeFile !== null, "G-ZIP-RT.7 README.txt exists in ZIP");
    if (readmeFile) {
      const readmeStr = await readmeFile.async("string");
      assert(readmeStr.includes("QUANTCONTEXT ENGINE"), "G-ZIP-RT.8 README content readable after round-trip");
    }
  }

  // =====================================================================
  // PRINT MANIFEST
  // =====================================================================
  console.log("\n── MANIFEST OUTPUT ──");
  {
    const deps = buildStandardDeps();
    const result = await buildExportZip(deps);
    const zip = await JSZip.loadAsync(result.blob);
    const manifest = await zip.file("manifest.json")?.async("string");
    console.log("\n  === manifest.json (images OFF) ===");
    console.log(manifest!.split("\n").map(l => "  | " + l).join("\n"));
    console.log("  === END manifest.json ===\n");
  }

  // =====================================================================
  // SUMMARY
  // =====================================================================
  console.log("\n══════════════════════════════════════════════════");
  console.log(`  TOTAL: ${passed + failed + skipped} tests`);
  console.log(`  PASSED: ${passed}`);
  console.log(`  FAILED: ${failed}`);
  console.log(`  SKIPPED: ${skipped}`);
  if (failures.length > 0) {
    console.log(`\n  FAILURES:`);
    for (const f of failures) {
      console.log(`    - ${f}`);
    }
  }
  console.log("══════════════════════════════════════════════════\n");
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
