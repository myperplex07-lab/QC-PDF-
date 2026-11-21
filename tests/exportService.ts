/**
 * exportService.ts — Full Account Data Export
 *
 * Task 5: Read-only export of all user-owned data as a single ZIP file.
 *
 * Rules:
 *   - Read-only: no insert/update/delete/upsert calls
 *   - Uses the app's existing Supabase client (anon key + user auth)
 *   - Never calls Gemini, Pinecone, Finnhub, or Angel One
 *   - Exports values exactly as stored — no rounding, reformatting, or unit conversion
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface DatasetConfig {
  name: string;
  table: string;
  pk: string;
  /** Preferred order column. null = order by pk only. */
  orderCol: string | null;
  csv: boolean;
  batchSize: number;
  /** Columns to select. null = discover via probe. */
  selectColumns: string[] | null;
  /** Columns to exclude from select when images are off (for trade_history) */
  imageColumns?: string[];
}

export interface ExportProgress {
  phase: "fetching" | "packaging" | "done" | "error";
  currentDataset?: string;
  currentFetched?: number;
  currentTotal?: number;
  imagesCurrent?: number;
  imagesTotal?: number;
  packagingPercent?: number;
  message: string;
  datasetCounts?: Record<string, number>;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  datasetCounts: Record<string, number>;
  /** Number of CSV cells truncated for Excel compatibility */
  truncatedCells: number;
}

/** Dependencies injectable for testing */
export interface ExportDeps {
  supabase: SupabaseClient;
  userId: string;
  includeImages: boolean;
  signal: AbortSignal;
  onProgress: (progress: ExportProgress) => void;
  /** Override for localStorage (testing) */
  storage?: { getItem(key: string): string | null };
  /** Override for download (testing) */
  downloadFn?: (blob: Blob, filename: string) => void;
}

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

/**
 * Per-dataset batch sizes tuned for row size:
 * - trade_history: rows have full_result (large JSON). ~5-20KB per row without images.
 *   200 rows ≈ 2-4MB. Images are always fetched in a separate pass.
 * - bot_signals: ~0.5-1KB per row. 500 rows ≈ 0.25-0.5MB.
 * - Others: small rows, 1000 is fine.
 */
export const SUPABASE_DATASETS: DatasetConfig[] = [
  { name: "audit_trail",       table: "trade_history",     pk: "id", orderCol: "created_at", csv: true,  batchSize: 200,  selectColumns: null, imageColumns: ["image_1", "image_2"] },
  { name: "trade_journal",     table: "trade_journal",     pk: "id", orderCol: "created_at", csv: true,  batchSize: 1000, selectColumns: null },
  { name: "prediction_scores", table: "prediction_scores", pk: "id", orderCol: "created_at", csv: true,  batchSize: 1000, selectColumns: null },
  { name: "watchlist",         table: "watchlist",         pk: "id", orderCol: "created_at", csv: true,  batchSize: 1000, selectColumns: null },
  { name: "context_presets",   table: "context_presets",   pk: "id", orderCol: "created_at", csv: true,  batchSize: 1000, selectColumns: null },
  { name: "bot_signals",       table: "bot_signals",       pk: "id", orderCol: "created_at", csv: true,  batchSize: 500,  selectColumns: null },
];

/** Allow-list of safe settings keys to export */
const SETTINGS_ALLOW_LIST = new Set([
  "hum_enabled", "thud_enabled", "ai_temperature",
  "accent_theme", "market_source", "updated_at",
]);

/** Max characters for a single CSV cell (Excel limit is 32,767) */
const CSV_CELL_MAX = 32000;

/** Max decoded image bytes — desktop (200 MB) */
export const MAX_IMAGE_BYTES_DESKTOP = 200 * 1024 * 1024;

/** Max decoded image bytes — mobile (80 MB) */
export const MAX_IMAGE_BYTES_MOBILE = 80 * 1024 * 1024;

/** Detect mobile and choose the appropriate cap */
function getMaxImageBytes(): number {
  if (typeof navigator !== "undefined") {
    // navigator.userAgentData?.mobile (User-Agent Client Hints)
    if ((navigator as any).userAgentData?.mobile) return MAX_IMAGE_BYTES_MOBILE;
    // Fallback: check deviceMemory (available in Chrome/Edge)
    if (typeof (navigator as any).deviceMemory === "number" && (navigator as any).deviceMemory <= 4) {
      return MAX_IMAGE_BYTES_MOBILE;
    }
    // Fallback: user agent string check
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return MAX_IMAGE_BYTES_MOBILE;
  }
  return MAX_IMAGE_BYTES_DESKTOP;
}

/** Exported for backward-compat with tests that reference MAX_IMAGE_BYTES */
export const MAX_IMAGE_BYTES = MAX_IMAGE_BYTES_DESKTOP;

/** Max retries for column discovery probe */
const PROBE_MAX_RETRIES = 2;

/** Batch size for image fetching */
const IMAGE_BATCH_SIZE = 20;

/** Min interval between UI progress updates (ms) — max ~10 updates/sec */
const PROGRESS_THROTTLE_MS = 100;

// ---------------------------------------------------------------------------
// SECRET GUARD — deny-by-default, word-based
// ---------------------------------------------------------------------------

const BLOCKED_WORDS = new Set([
  "password", "passwd", "pin", "salt", "secret", "token",
  "jwt", "bearer", "authorization", "apikey", "credential",
  "credentials", "totp", "otp",
]);

const BLOCKED_PAIRS: [string, string][] = [
  ["api", "key"], ["private", "key"], ["access", "key"],
  ["secret", "key"], ["security", "answer"], ["security", "question"],
];

/** Explicit exceptions: real trading/data fields that happen to contain blocked words */
const SECRET_EXCEPTIONS = new Set<string>([
  // Angel One instrument token — static lookup data in nse_stocks.ts, not saved to exported tables.
  // If bot_signals ever contains an "instrument_token" or "token" column, add it here after verification.
  // No exceptions needed currently — all known exported columns are safe.
]);

/** Split a key name into lowercase words on _, -, spaces, and camelCase boundaries */
function splitKeyWords(key: string): string[] {
  return key
    .replace(/([a-z])([A-Z])/g, "$1_$2") // camelCase → camel_Case
    .toLowerCase()
    .split(/[_\-\s]+/)
    .filter(w => w.length > 0);
}

const keyDecisionCache = new Map<string, boolean>();

/** Returns true if the key name looks like a secret */
export function isSecretKey(key: string): boolean {
  if (SECRET_EXCEPTIONS.has(key)) return false;

  const cached = keyDecisionCache.get(key);
  if (cached !== undefined) return cached;

  const words = splitKeyWords(key);

  // Check single blocked words
  for (const w of words) {
    if (BLOCKED_WORDS.has(w)) {
      keyDecisionCache.set(key, true);
      return true;
    }
  }

  // Check blocked word pairs
  for (const [a, b] of BLOCKED_PAIRS) {
    const idxA = words.indexOf(a);
    const idxB = words.indexOf(b);
    if (idxA >= 0 && idxB >= 0) {
      keyDecisionCache.set(key, true);
      return true;
    }
  }

  keyDecisionCache.set(key, false);
  return false;
}

/** Recursively scan all keys in a record (including nested objects/arrays).
 *  Returns the full key path of the first secret found, or null. */
export function findSecretInRecord(record: unknown, path: string = ""): string | null {
  if (record === null || record === undefined || typeof record !== "object") return null;

  if (Array.isArray(record)) {
    for (let i = 0; i < record.length; i++) {
      const found = findSecretInRecord(record[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }

  for (const key of Object.keys(record as Record<string, unknown>)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (isSecretKey(key)) return fullPath;

    const val = (record as Record<string, unknown>)[key];
    if (val && typeof val === "object") {
      const found = findSecretInRecord(val, fullPath);
      if (found) return found;
    }
  }
  return null;
}

/** Scan all records in a dataset. Returns the first secret key path, or null. */
export function scanRecordsForSecrets(records: Record<string, unknown>[]): string | null {
  for (let i = 0; i < records.length; i++) {
    const found = findSecretInRecord(records[i], `records[${i}]`);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// COLUMN DISCOVERY — probe one row to get the real column list (Section 2.1)
// ---------------------------------------------------------------------------

/**
 * Discovers column names by fetching a single row with select("*").
 * Retries up to PROBE_MAX_RETRIES times on error, then ABORTS (no fallback to *).
 * Returns null ONLY when the table has zero rows for this user (empty dataset, not an error).
 */
export async function discoverColumns(
  supabase: SupabaseClient,
  table: string,
  userId: string,
  signal: AbortSignal,
): Promise<string[] | null> {
  let lastError: any = null;

  for (let attempt = 0; attempt <= PROBE_MAX_RETRIES; attempt++) {
    if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");

    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");

    if (error) {
      lastError = error;
      if (attempt < PROBE_MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1))); // backoff
        continue;
      }
      // All retries exhausted — abort (Section 2.1: no fallback to select("*"))
      throw new Error(
        `Column discovery failed for "${table}" after ${PROBE_MAX_RETRIES + 1} attempts: ${error.message}. Export aborted.`
      );
    }

    if (!data) return null; // no rows — empty dataset, will be skipped with count 0
    return Object.keys(data);
  }

  // Should not reach here, but just in case
  throw new Error(`Column discovery failed for "${table}": ${lastError?.message ?? "unknown error"}`);
}

/**
 * Validate that the required columns (pk, orderCol) exist in the discovered column list.
 * Section 2.5: prefer created_at, then id. If neither exists, abort.
 */
export function resolveOrderColumns(
  config: DatasetConfig,
  discoveredCols: string[],
): { orderCol: string | null; pk: string } {
  const colSet = new Set(discoveredCols);

  // Validate PK
  if (!colSet.has(config.pk)) {
    throw new Error(
      `Schema error for "${config.name}": primary key column "${config.pk}" not found in table "${config.table}". ` +
      `Available columns: ${discoveredCols.join(", ")}. Export aborted.`
    );
  }

  // Validate user_id
  if (!colSet.has("user_id")) {
    throw new Error(
      `Schema error for "${config.name}": column "user_id" not found in table "${config.table}". Export aborted.`
    );
  }

  // Section 2.5: choose order column from probe row's keys
  if (config.orderCol && colSet.has(config.orderCol)) {
    return { orderCol: config.orderCol, pk: config.pk };
  }

  // Fallback: prefer created_at, then id-only
  if (colSet.has("created_at")) {
    return { orderCol: "created_at", pk: config.pk };
  }

  // No created_at — order by pk only
  return { orderCol: null, pk: config.pk };
}

// ---------------------------------------------------------------------------
// PAGINATION (Section 2.4 + 3.1-3.4)
// ---------------------------------------------------------------------------

/** Check if an error is a timeout/network type that warrants retry with smaller batch */
function isTimeoutError(error: { code?: string; message?: string; status?: number } | null): boolean {
  if (!error) return false;
  if (error.code === "57014") return true; // Postgres statement timeout
  const status = (error as any).status;
  if (status === 500 || status === 502 || status === 503 || status === 504) return true;
  const msg = (error.message || "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("network") || msg.includes("abort") || msg.includes("fetch failed")) return true;
  return false;
}

/** Check if an error is a "column does not exist" error */
function isColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703") return true; // Postgres "column does not exist"
  const status = (error as any).status;
  if (status === 400) {
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("column") && msg.includes("does not exist")) return true;
  }
  return false;
}

export async function fetchAllPaginated(
  supabase: SupabaseClient,
  config: DatasetConfig,
  userId: string,
  signal: AbortSignal,
  onProgress: (fetched: number, total: number) => void,
  selectString: string,
  batchSize: number,
  orderCol: string | null,
): Promise<{ rows: Record<string, unknown>[]; dbCount: number }> {
  // 1. Get exact count (Section 3: countAtStart)
  const { count, error: countError } = await supabase
    .from(config.table)
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
  if (countError) {
    if (isColumnError(countError)) {
      throw new Error(`Column error for "${config.name}": ${countError.message}. Check that the table schema matches the export configuration.`);
    }
    throw new Error(`Count failed for ${config.name}: ${countError.message}`);
  }
  const dbCount = count ?? 0;

  if (dbCount === 0) {
    onProgress(0, 0);
    return { rows: [], dbCount: 0 };
  }

  // 2. Fetch in batches with dedup (Section 3.1)
  const allRows: Record<string, unknown>[] = [];
  const seenPks = new Set<string>();
  let offset = 0;
  let currentBatchSize = batchSize;

  while (true) {
    if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");

    let query = supabase
      .from(config.table)
      .select(selectString)
      .eq("user_id", userId);

    // Section 3.3: ascending order so new rows land at end
    if (orderCol) {
      query = query.order(orderCol, { ascending: true }).order(config.pk, { ascending: true });
    } else {
      query = query.order(config.pk, { ascending: true });
    }

    const rangeEnd = offset + currentBatchSize - 1;
    query = query.range(offset, rangeEnd);

    let retries = 0;
    let data: Record<string, unknown>[] | null = null;

    // Retry loop: up to 2 retries with backoff; on timeout, halve batch size
    while (retries <= 2) {
      const result = await query;
      if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");

      if (result.error) {
        if (isColumnError(result.error)) {
          throw new Error(`Column error for "${config.name}": ${result.error.message}. Export aborted.`);
        }
        if (isTimeoutError(result.error) && retries < 2) {
          retries++;
          // Section 2.4: halve and KEEP the smaller size for the rest
          currentBatchSize = Math.max(10, Math.floor(currentBatchSize / 2));
          // Rebuild query with smaller batch
          query = supabase
            .from(config.table)
            .select(selectString)
            .eq("user_id", userId);
          if (orderCol) {
            query = query.order(orderCol, { ascending: true }).order(config.pk, { ascending: true });
          } else {
            query = query.order(config.pk, { ascending: true });
          }
          query = query.range(offset, offset + currentBatchSize - 1);
          await new Promise(r => setTimeout(r, 500 * retries)); // backoff
          continue;
        }
        throw new Error(`Fetch failed for ${config.name} at offset ${offset}: ${result.error.message}`);
      }

      if (result.data === null) {
        throw new Error(`Fetch returned null data for ${config.name} at offset ${offset} (no error reported)`);
      }

      data = result.data as unknown as Record<string, unknown>[];
      break;
    }

    if (!data || data.length === 0) break;

    // Dedup by primary key (Section 3.1)
    for (const row of data) {
      const pkVal = String(row[config.pk]);
      if (!seenPks.has(pkVal)) {
        seenPks.add(pkVal);
        allRows.push(row);
      }
    }

    offset += data.length;
    onProgress(allRows.length, dbCount);
    await new Promise(r => setTimeout(r, 0)); // yield to UI

    // If we got fewer rows than requested, check if we've collected enough.
    // A server row cap may return fewer than batchSize even when more rows exist.
    // Continue paginating if we haven't reached dbCount yet. (Section 3.5)
    if (data.length < currentBatchSize) {
      if (allRows.length >= dbCount) break; // truly done
      // Server cap: lower batchSize to what the server actually returned to avoid
      // requesting more than the server will give, and continue.
      if (data.length > 0) {
        currentBatchSize = data.length;
      } else {
        break; // empty page = truly done
      }
    }
  }

  return { rows: allRows, dbCount };
}

/**
 * Fetch with count-check retry (Section 3.1-3.2).
 * Rule: uniqueCollected >= countAtStart.
 * On mismatch: take a FRESH count, re-fetch once, compare against fresh count.
 */
export async function fetchWithRetry(
  supabase: SupabaseClient,
  config: DatasetConfig,
  userId: string,
  signal: AbortSignal,
  onProgress: (fetched: number, total: number) => void,
  selectString: string,
  batchSize: number,
  orderCol: string | null,
): Promise<{ rows: Record<string, unknown>[]; dbCount: number }> {
  let result = await fetchAllPaginated(supabase, config, userId, signal, onProgress, selectString, batchSize, orderCol);

  // Section 3.1: uniqueCollected >= countAtStart is OK (rows added during export are fine)
  if (result.rows.length >= result.dbCount) {
    return result;
  }

  // Section 3.2: re-fetch with FRESH count
  result = await fetchAllPaginated(supabase, config, userId, signal, onProgress, selectString, batchSize, orderCol);
  if (result.rows.length >= result.dbCount) {
    return result;
  }

  throw new Error(
    `Count mismatch for ${config.name}: expected at least ${result.dbCount} rows but got ${result.rows.length}. ` +
    `Rows may have been deleted during the export. Export cancelled for data integrity.`
  );
}

// ---------------------------------------------------------------------------
// SETTINGS — allow-list filter, with duplicate-row safety (Section 10.3)
// ---------------------------------------------------------------------------

export async function fetchSettings(
  supabase: SupabaseClient,
  userId: string,
  signal: AbortSignal,
): Promise<{ data: Record<string, unknown>; hasDuplicates: boolean }> {
  // Use .select().limit(2) instead of .maybeSingle() to detect duplicates
  // without throwing on >1 row (Section 10.3)
  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(2);

  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
  if (error) throw new Error(`Failed to fetch settings: ${error.message}`);
  if (!data || data.length === 0) return { data: {}, hasDuplicates: false };

  const hasDuplicates = data.length > 1;
  const row = data[0] as Record<string, unknown>;

  const safe: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (SETTINGS_ALLOW_LIST.has(key)) {
      safe[key] = row[key];
    }
  }
  return { data: safe, hasDuplicates };
}

// ---------------------------------------------------------------------------
// LOCAL PREFERENCES — non-secret, non-workspace, non-cloud-duplicated
// ---------------------------------------------------------------------------

/** localStorage keys that are local-only user preferences (no cloud copy) */
const LOCAL_PREF_KEYS: { key: string; type: "boolean" | "string" }[] = [
  { key: "qc_darkmode", type: "boolean" },
];

export function fetchLocalPreferences(
  storage: { getItem(key: string): string | null },
): Record<string, unknown> {
  const prefs: Record<string, unknown> = {};
  for (const { key, type } of LOCAL_PREF_KEYS) {
    const val = storage.getItem(key);
    if (val !== null) {
      if (type === "boolean") {
        prefs[key] = val === "true";
      } else {
        prefs[key] = val;
      }
    }
  }
  return prefs;
}

// ---------------------------------------------------------------------------
// PRICE ALERTS from localStorage
// ---------------------------------------------------------------------------

export function fetchPriceAlerts(
  storage: { getItem(key: string): string | null },
): Record<string, unknown>[] {
  try {
    const raw = storage.getItem("qc_price_alerts");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// CSV SERIALIZER (Section 9.5: truncation marker with filename, code-point boundary)
// ---------------------------------------------------------------------------

const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

function csvEscapeValue(value: unknown, isText: boolean, truncate: boolean, datasetName?: string): { str: string; truncated: boolean } {
  if (value === null || value === undefined) {
    return { str: "", truncated: false };
  }

  let str: string;
  let wasTruncated = false;

  if (typeof value === "object") {
    str = JSON.stringify(value);
  } else if (typeof value === "number" || typeof value === "boolean") {
    return { str: String(value), truncated: false };
  } else {
    str = String(value);
  }

  // Formula protection: only for text values
  if (isText && str.length > 0 && FORMULA_TRIGGER_CHARS.has(str[0])) {
    if (!(str[0] === "-" && !isNaN(Number(str)))) {
      str = "'" + str;
    }
  }

  // Section 9.5: Truncate for Excel cell limit (CSV only), at code-point boundary
  if (truncate && str.length > CSV_CELL_MAX) {
    // Find a safe cut point that doesn't split a surrogate pair
    let cutAt = CSV_CELL_MAX;
    // If cutAt lands on a low surrogate (second half), back up one
    if (cutAt > 0 && str.charCodeAt(cutAt - 1) >= 0xD800 && str.charCodeAt(cutAt - 1) <= 0xDBFF) {
      cutAt--;
    }
    const jsonFileName = datasetName ? `json/${datasetName}.json` : "the JSON file";
    str = str.substring(0, cutAt) + `…[TRUNCATED - full value in ${jsonFileName}]`;
    wasTruncated = true;
  }

  // RFC 4180: quote if contains comma, double-quote, or line break
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }

  return { str, truncated: wasTruncated };
}

export function recordsToCSV(records: Record<string, unknown>[], stableColumnHints?: string[], datasetName?: string): { csv: string; truncatedCells: number } {
  const keySet = new Set<string>();
  const keyOrder: string[] = [];
  let truncatedCells = 0;

  if (stableColumnHints) {
    for (const k of stableColumnHints) {
      if (!keySet.has(k)) { keySet.add(k); keyOrder.push(k); }
    }
  }

  for (const record of records) {
    for (const k of Object.keys(record)) {
      if (!keySet.has(k)) { keySet.add(k); keyOrder.push(k); }
    }
  }

  if (keyOrder.length === 0 && records.length === 0) {
    return { csv: "\uFEFF", truncatedCells: 0 };
  }

  const BOM = "\uFEFF";
  const lines: string[] = [];
  lines.push(keyOrder.join(","));

  for (const record of records) {
    const cells = keyOrder.map((key) => {
      const val = record[key];
      const isText = typeof val === "string";
      const { str, truncated } = csvEscapeValue(val, isText, true, datasetName);
      if (truncated) truncatedCells++;
      return str;
    });
    lines.push(cells.join(","));
  }

  return { csv: BOM + lines.join("\r\n") + "\r\n", truncatedCells };
}

// ---------------------------------------------------------------------------
// IMAGE EXTRACTION (Section 4.2: decode to Uint8Array, drop base64)
// ---------------------------------------------------------------------------

interface ImageFile {
  filename: string;
  data: Uint8Array;
  mimeType: string;
  byteLength: number;
}

/** Decode a base64 string to Uint8Array */
function base64ToUint8Array(base64: string): Uint8Array {
  // Use atob in browser, Buffer in Node (for tests)
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  // Node.js fallback for tests
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function extractImagesFromRecord(record: Record<string, unknown>, analysisId: string): ImageFile[] {
  const images: ImageFile[] = [];
  for (const field of ["image_1", "image_2"] as const) {
    const val = record[field];
    if (typeof val !== "string" || !val.startsWith("data:")) continue;
    const commaIdx = val.indexOf(",");
    if (commaIdx === -1) continue;
    const header = val.substring(0, commaIdx);
    const base64Data = val.substring(commaIdx + 1);
    const mimeMatch = header.match(/data:([^;]+);/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
    const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : mimeType === "image/gif" ? "gif" : "bin";
    const suffix = field === "image_1" ? "_chart1" : "_chart2";

    // Section 4.2: decode immediately, drop base64 string
    const decoded = base64ToUint8Array(base64Data);
    images.push({ filename: `${analysisId}${suffix}.${ext}`, data: decoded, mimeType, byteLength: decoded.byteLength });
  }
  return images;
}

// ---------------------------------------------------------------------------
// MANIFEST BUILDER (Section 3.4: rows_added_during_export)
// ---------------------------------------------------------------------------

/**
 * Convert a value to ISO 8601 UTC if it looks like a Unix timestamp in milliseconds.
 * Returns the ISO string, or null if the value is null/undefined/unparseable.
 */
function toIsoIfUnixMs(val: unknown): string | null {
  if (val == null) return null;
  const num = typeof val === "number" ? val : Number(val);
  // Unix ms timestamps are > 1e12 (Sep 2001) and < 1e14 (year ~5138)
  if (!Number.isFinite(num) || num < 1e12 || num > 1e14) {
    // Not a unix ms — return as string if already ISO-like
    const s = String(val);
    return s === "null" ? null : s;
  }
  return new Date(num).toISOString();
}

interface DatasetManifestEntry {
  name: string;
  json_file: string;
  csv_file: string | null;
  record_count: number;
  db_count_at_start: number | null;
  matched: boolean | null;
  rows_added_during_export: number | null;
  first_created_at: string | null;
  last_created_at: string | null;
  source?: string;
}

export function buildManifest(
  datasets: { config: DatasetConfig; rows: Record<string, unknown>[]; dbCount: number; _rowCount?: number; _firstCreatedAt?: string | null; _lastCreatedAt?: string | null }[],
  settingsData: Record<string, unknown>,
  priceAlerts: Record<string, unknown>[],
  localPrefs: Record<string, unknown>,
  imagesIncluded: boolean,
  totalTruncatedCells: number,
  settingsHasDuplicates: boolean,
): {
  app_name: string; export_schema_version: number; generated_at_utc: string;
  images_included: boolean; csv_truncated_cells: number;
  datasets: DatasetManifestEntry[];
  excluded_data: { name: string; reason: string }[];
  warnings: string[];
} {
  const datasetEntries: DatasetManifestEntry[] = [];

  for (const ds of datasets) {
    // Use cached metadata if available (rows may have been released for memory)
    const rowCount = ds._rowCount ?? ds.rows.length;
    const firstTs = ds._firstCreatedAt !== undefined ? ds._firstCreatedAt
      : (ds.rows.length > 0 ? (ds.rows[0]?.["created_at"] != null ? String(ds.rows[0]["created_at"]) : null) : null);
    const lastTs = ds._lastCreatedAt !== undefined ? ds._lastCreatedAt
      : (ds.rows.length > 0 ? (ds.rows[ds.rows.length - 1]?.["created_at"] != null ? String(ds.rows[ds.rows.length - 1]["created_at"]) : null) : null);
    const rowsAdded = Math.max(0, rowCount - ds.dbCount);
    datasetEntries.push({
      name: ds.config.name,
      json_file: `json/${ds.config.name}.json`,
      csv_file: ds.config.csv ? `csv/${ds.config.name}.csv` : null,
      record_count: rowCount,
      db_count_at_start: ds.dbCount,
      matched: rowCount >= ds.dbCount,
      rows_added_during_export: rowsAdded,
      first_created_at: firstTs,
      last_created_at: lastTs,
    });
  }

  const hasSettings = Object.keys(settingsData).length > 0;
  datasetEntries.push({
    name: "settings",
    json_file: "json/settings.json",
    csv_file: null,
    record_count: hasSettings ? 1 : 0,
    db_count_at_start: hasSettings ? 1 : 0,
    matched: true,
    rows_added_during_export: 0,
    first_created_at: null,
    last_created_at: hasSettings ? String(settingsData["updated_at"] ?? null) : null,
  });

  datasetEntries.push({
    name: "price_alerts",
    json_file: "json/price_alerts.json",
    csv_file: priceAlerts.length > 0 ? "csv/price_alerts.csv" : null,
    record_count: priceAlerts.length,
    db_count_at_start: null,
    matched: null,
    rows_added_during_export: null,
    first_created_at: priceAlerts.length > 0 ? toIsoIfUnixMs((priceAlerts[0] as any)?.createdAt) : null,
    last_created_at: priceAlerts.length > 0 ? toIsoIfUnixMs((priceAlerts[priceAlerts.length - 1] as any)?.createdAt) : null,
    source: "this_device_only",
  });

  const hasLocalPrefs = Object.keys(localPrefs).length > 0;
  if (hasLocalPrefs) {
    datasetEntries.push({
      name: "local_preferences",
      json_file: "json/local_preferences.json",
      csv_file: null,
      record_count: 1,
      db_count_at_start: null,
      matched: null,
      rows_added_during_export: null,
      first_created_at: null,
      last_created_at: null,
      source: "this_device_only",
    });
  }

  const warnings: string[] = [];
  if (totalTruncatedCells > 0) {
    warnings.push(`${totalTruncatedCells} CSV cell(s) were truncated to ${CSV_CELL_MAX} characters for Excel compatibility. Full values are in the JSON files.`);
  }
  if (settingsHasDuplicates) {
    warnings.push("Multiple settings rows found for this user. Only the most recently updated row was exported.");
  }

  return {
    app_name: "QuantContext Engine",
    export_schema_version: 1,
    generated_at_utc: new Date().toISOString(),
    images_included: imagesIncluded,
    csv_truncated_cells: totalTruncatedCells,
    datasets: datasetEntries,
    excluded_data: [
      { name: "PIN & Security Data (user_pins)", reason: "Contains pin_hash, security_answer_hash, lockout counters — sensitive security data" },
      { name: "Pinecone Vectors / Embeddings", reason: "Rebuilt automatically from the Audit Trail. Extremely large and not human-readable" },
      { name: "Workspace Cache (qc_ws_*, qc_workspaces, qc_active_tab, qc_active_view)", reason: "Temporary device-local working state, not account data" },
      { name: "Bot Metrics", reason: "Single aggregate row of live operational state, not historical user data" },
      { name: "Bot Positions", reason: "Transient live positions — changes continuously" },
      { name: "Bot Commands", reason: "Transient command queue" },
      { name: "Tick Subscriptions & Live Ticks", reason: "Real-time market data infrastructure" },
      { name: "Score Requests & Option Chain Requests", reason: "Transient processing queues" },
      { name: "API Keys & Tokens", reason: "Security credentials are never included" },
      { name: "Export Templates", reason: "Not persisted — stateless UI configuration" },
    ],
    warnings,
  };
}

// ---------------------------------------------------------------------------
// README BUILDER (Section 3.4 + 9.2 + 9.4)
// ---------------------------------------------------------------------------

export function buildReadme(
  manifest: ReturnType<typeof buildManifest>,
  imagesIncluded: boolean,
): string {
  return `QUANTCONTEXT ENGINE — DATA EXPORT
====================================

This archive contains a copy of your QuantContext Engine account data,
taken at ${manifest.generated_at_utc} (UTC).

This is a snapshot, not a backup that can be restored automatically.
Rows created while the export was running may be included.

WARNING: This file is NOT encrypted. It contains your full trading analysis history,
journal entries, prediction scores, and other personal trading data.
Keep this file private and store it securely.


FILES AND FOLDERS
-----------------

README.txt          — This file.
manifest.json       — Machine-readable metadata: record counts, timestamps,
                      excluded data, and data integrity checks.

json/               — JSON files (the source of truth). One file per dataset.
                      Format: { "dataset": "...", "record_count": N, "records": [...] }
                      Field names are exactly as stored in the database.
                      Timestamps are ISO 8601 in UTC. Numbers, booleans, and null preserved.

csv/                — CSV files (for Excel / Google Sheets convenience).
                      Standard RFC 4180 format, UTF-8 with BOM.
                      Same column names as the JSON keys.
                      Nested objects appear as JSON strings in a single cell.
                      Text values starting with =, +, -, @, tab, or carriage return
                      are prefixed with ' to prevent spreadsheet formula injection.
                      Negative numbers (like P&L) are NOT prefixed — they remain numbers.
                      Cells longer than ${CSV_CELL_MAX} characters are truncated with a marker
                      naming the JSON file that has the full value.
${imagesIncluded ? `
images/             — Chart images extracted from Audit Trail analyses.
                      Named {analysis_id}_chart1.{ext} and {analysis_id}_chart2.{ext}.
                      The corresponding audit_trail record has image_1_file / image_2_file
                      fields pointing to the filenames.
` : ""}

DATASETS INCLUDED
-----------------

1. audit_trail.json / audit_trail.csv
   Source: trade_history table
   All AI analysis records. Fields include: asset_name (text), market_sentiment
   (text: bullish/bearish/neutral/highly_volatile), risk_level (text: low/medium/high/extreme),
   confidence (integer 0-100), synthesis_summary (text), full_result (nested JSON object
   containing extracted_data, predictions, trade setups, key levels, pattern detection,
   cross-chart correlation).
   image_1 and image_2: ${imagesIncluded ? "extracted to images/ folder; base64 data removed from JSON/CSV" : "not included (checkbox was off); base64 data excluded from export"}.
   Pattern tags are stored inside full_result.user_pattern_tag.

2. trade_journal.json / trade_journal.csv
   Source: trade_journal table
   Trade diary entries. Fields: asset_name (text), direction (text: long/short),
   entry_price/exit_price (decimal, native currency), stop_loss/take_profit (decimal),
   outcome (text: win/loss/breakeven/pending), pnl_amount (decimal, absolute currency amount),
   pnl_pct (decimal, percentage), emotion_before/emotion_after (text), tags (JSON array),
   rating (integer 1-5 or null), lesson (text).
   mfe_pct/mae_pct: Maximum Favorable/Adverse Excursion as percentage relative to entry price.
   entry_time/exit_time: ISO 8601 timestamps for MFE/MAE calculation windows.

3. prediction_scores.json / prediction_scores.csv
   Source: prediction_scores table
   Prediction accuracy snapshots. predicted_probability is a 0-1 decimal.
   confidence_at_analysis is an integer 0-100.
   score_points is an integer 0-100. score_grade is text (A+/A/B/C/D/F).
   score_history is a JSON array of previous scoring attempts.

4. settings.json (no CSV)
   Source: user_settings table (allow-listed keys only)
   hum_enabled (boolean), thud_enabled (boolean), ai_temperature (decimal 0.0-1.0),
   accent_theme (text: emerald/blue/red), market_source (text: us/india).

5. watchlist.json / watchlist.csv
   Source: watchlist table
   Saved tickers. alert_above/alert_below are decimal prices in the ticker's native currency.

6. context_presets.json / context_presets.csv
   Source: context_presets table
   Saved analysis context/override strategies (name + context_text).

7. bot_signals.json / bot_signals.csv
   Source: bot_signals table
   HFT bot signal history. confidence is a 0-1 decimal. pnl is absolute currency.

8. price_alerts.json / price_alerts.csv
   Source: browser localStorage (THIS DEVICE ONLY — may differ on other devices
   and may include items from other accounts used on this browser).
   Price alert rules. targetPrice is decimal. thresholdPct is percentage (e.g. 0.5 = 0.5%).
   createdAt is a Unix timestamp (milliseconds).

9. local_preferences.json (no CSV) — if present
   Source: browser localStorage (THIS DEVICE ONLY — may include preferences
   from other accounts used on this browser).
   Device-local preferences not synced to cloud (e.g. dark mode).


HOW RECORDS LINK TOGETHER
--------------------------

- prediction_scores.trade_history_id → audit_trail "id" field
  (each prediction snapshot links to the analysis that created it)

- trade_journal.analysis_id → audit_trail "id" field
  (journal entries can optionally link to the analysis they were based on)


WHAT IS EXCLUDED AND WHY
--------------------------

- PIN & Security Data: pin_hash, security_answer_hash, lockout counters.
- Pinecone Vectors / Embeddings: Rebuilt automatically from the Audit Trail.
  Extremely large numeric arrays and not useful to read directly.
- Workspace Cache: Temporary browser state, not permanent account data.
- Bot Metrics, Positions, Commands: Live operational state, not historical records.
- Tick Subscriptions, Live Ticks: Real-time market data infrastructure.
- Score Requests, Option Chain Requests: Transient processing queues.
- API Keys & Tokens: Security credentials are never included.
- Export Templates: Not persisted — only exist during a session.

See manifest.json → excluded_data for the complete list.


NOTES
-----

- This export is a snapshot at the time shown in manifest.json.
  Changes made after the export are not included.
- Rows created during the export may have been captured.
- This export did not modify any data in your account.
`;
}

// ---------------------------------------------------------------------------
// MAIN EXPORT ORCHESTRATOR (Sections 2, 3, 4)
// ---------------------------------------------------------------------------

export async function buildExportZip(deps: ExportDeps): Promise<ExportResult> {
  const { supabase, userId, includeImages, signal } = deps;
  const rawOnProgress = deps.onProgress;

  // Section 2.4: Leading-and-trailing throttle for UI progress updates.
  // - First event passes immediately (leading edge).
  // - Subsequent events pass at most once per PROGRESS_THROTTLE_MS.
  // - Identical consecutive messages (same text AND same rounded %) are dropped.
  // - Packaging percentage is rounded to a whole number.
  // - The latest pending message is flushed at end/error/cancel via flushProgress().
  let lastProgressTime = 0;
  let lastProgressMsg = "";
  let lastProgressPct = -1;
  let pendingProgress: ExportProgress | null = null;
  let progressTimer: ReturnType<typeof setTimeout> | null = null;

  const deliverProgress = (p: ExportProgress) => {
    lastProgressTime = Date.now();
    lastProgressMsg = p.message;
    lastProgressPct = p.packagingPercent ?? -1;
    rawOnProgress(p);
  };

  const flushProgress = () => {
    if (progressTimer !== null) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
    if (pendingProgress !== null) {
      deliverProgress(pendingProgress);
      pendingProgress = null;
    }
  };

  const onProgress = (p: ExportProgress) => {
    // Round packaging percentage to whole number
    if (p.packagingPercent !== undefined) {
      p = { ...p, packagingPercent: Math.round(p.packagingPercent) };
    }
    const roundedPct = p.packagingPercent ?? -1;
    // Drop identical consecutive messages (same text + same rounded %)
    if (p.message === lastProgressMsg && roundedPct === lastProgressPct) {
      return;
    }
    const now = Date.now();
    const elapsed = now - lastProgressTime;
    if (elapsed >= PROGRESS_THROTTLE_MS || lastProgressTime === 0) {
      // Enough time has passed (or first call) — deliver immediately (leading edge)
      if (progressTimer !== null) {
        clearTimeout(progressTimer);
        progressTimer = null;
      }
      pendingProgress = null;
      deliverProgress(p);
    } else {
      // Too soon — store as pending and schedule trailing delivery
      pendingProgress = p;
      if (progressTimer === null) {
        const delay = PROGRESS_THROTTLE_MS - elapsed;
        progressTimer = setTimeout(() => {
          progressTimer = null;
          if (pendingProgress !== null) {
            deliverProgress(pendingProgress);
            pendingProgress = null;
          }
        }, delay);
      }
    }
  };
  const storage = deps.storage || localStorage;

  try {
  // Lazy-load JSZip
  const JSZip = (await import("jszip")).default;

  const datasetCounts: Record<string, number> = {};
  const fetchedDatasets: {
    config: DatasetConfig;
    rows: Record<string, unknown>[];
    dbCount: number;
    /** Cached for manifest after rows are released */
    _rowCount?: number;
    _firstCreatedAt?: string | null;
    _lastCreatedAt?: string | null;
  }[] = [];
  let totalTruncatedCells = 0;

  // ── Phase 1: Fetch all Supabase datasets ──
  for (const config of SUPABASE_DATASETS) {
    if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");

    onProgress({ phase: "fetching", currentDataset: config.name, currentFetched: 0, currentTotal: 0, message: `Fetching ${config.name}...` });

    // Discover columns via probe (Section 2.1)
    const allCols = await discoverColumns(supabase, config.table, userId, signal);

    let selectString: string;
    let batchSize = config.batchSize;
    let orderCol = config.orderCol;

    if (allCols === null) {
      // No rows — skip to count check (will be 0)
      selectString = "*";
    } else {
      // Validate order columns from probe row keys (Section 2.5)
      const resolved = resolveOrderColumns(config, allCols);
      orderCol = resolved.orderCol;

      if (config.imageColumns && !includeImages) {
        // Exclude image columns from select (Section 2.1)
        const imgSet = new Set(config.imageColumns);
        const cols = allCols.filter(c => !imgSet.has(c));
        selectString = cols.join(",");
      } else if (config.imageColumns && includeImages) {
        // Images ON: still exclude image columns from main pass (fetched separately)
        const imgSet = new Set(config.imageColumns);
        const cols = allCols.filter(c => !imgSet.has(c));
        selectString = cols.join(",");
      } else {
        selectString = allCols.join(",");
      }
    }

    const result = await fetchWithRetry(
      supabase, config, userId, signal,
      (fetched, total) => {
        onProgress({ phase: "fetching", currentDataset: config.name, currentFetched: fetched, currentTotal: total, message: `${config.name} ${fetched.toLocaleString()} / ${total.toLocaleString()}` });
      },
      selectString, batchSize, orderCol,
    );

    // Secret field guard — recursive scan
    if (result.rows.length > 0) {
      const secretPath = scanRecordsForSecrets(result.rows);
      if (secretPath) {
        throw new Error(`Security check failed: dataset "${config.name}" contains a field that looks like a secret at "${secretPath}". Export stopped for safety.`);
      }
    }

    fetchedDatasets.push({
      config, rows: result.rows, dbCount: result.dbCount,
      // Cache manifest metadata so rows can be released early
      _rowCount: result.rows.length,
      _firstCreatedAt: result.rows.length > 0 ? (result.rows[0]?.["created_at"] != null ? String(result.rows[0]["created_at"]) : null) : null,
      _lastCreatedAt: result.rows.length > 0 ? (result.rows[result.rows.length - 1]?.["created_at"] != null ? String(result.rows[result.rows.length - 1]["created_at"]) : null) : null,
    });
    datasetCounts[config.name] = result.rows.length;
  }

  // ── Fetch settings (Section 10.3: handles duplicates) ──
  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
  onProgress({ phase: "fetching", currentDataset: "settings", message: "Fetching settings..." });
  const { data: settingsData, hasDuplicates: settingsHasDuplicates } = await fetchSettings(supabase, userId, signal);
  datasetCounts["settings"] = Object.keys(settingsData).length > 0 ? 1 : 0;

  // ── Fetch localStorage data ──
  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
  const priceAlerts = fetchPriceAlerts(storage);
  datasetCounts["price_alerts"] = priceAlerts.length;
  const localPrefs = fetchLocalPreferences(storage);

  // ── Phase 2: Build ZIP ──
  onProgress({ phase: "packaging", message: "Packaging..." });
  const zip = new JSZip();

  /** Threshold for compact JSON (no indentation) — ~20 MB of estimated JSON */
  const COMPACT_JSON_THRESHOLD = 20 * 1024 * 1024;
  /** Records per chunk for yielding to the event loop */
  const CHUNK_SIZE = 300;

  // JSON + CSV for Supabase datasets (chunked to avoid sync blocks)
  for (const ds of fetchedDatasets) {
    if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");

    // For audit_trail: add image_1_file / image_2_file fields
    let exportRows = ds.rows;
    if (ds.config.name === "audit_trail") {
      exportRows = ds.rows.map(row => {
        const r = { ...row };
        if (includeImages) {
          r.image_1_file = null; // will be populated during image extraction
          r.image_2_file = null;
        } else {
          r.image_1_file = null;
          r.image_2_file = null;
        }
        // base64 images are never in the main pass (excluded from select)
        // but if they somehow leaked through, remove them
        delete r.image_1;
        delete r.image_2;
        return r;
      });
    }

    // Estimate JSON size: sample first row and multiply
    const sampleSize = exportRows.length > 0 ? JSON.stringify(exportRows[0]).length : 0;
    const estimatedJsonBytes = sampleSize * exportRows.length;
    const useCompact = estimatedJsonBytes > COMPACT_JSON_THRESHOLD;
    const indent = useCompact ? undefined : 2;

    // Build JSON in chunks to avoid long sync blocks
    // Wrap result in Blob to release the intermediate string from heap
    const jsonParts: string[] = [];
    const header = `{"dataset":${JSON.stringify(ds.config.name)},"record_count":${exportRows.length},"records":[\n`;
    jsonParts.push(header);

    for (let ci = 0; ci < exportRows.length; ci += CHUNK_SIZE) {
      if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
      const end = Math.min(ci + CHUNK_SIZE, exportRows.length);
      const chunkLines: string[] = [];
      for (let ri = ci; ri < end; ri++) {
        const comma = ri < exportRows.length - 1 ? "," : "";
        chunkLines.push(JSON.stringify(exportRows[ri], null, indent) + comma + "\n");
      }
      jsonParts.push(chunkLines.join(""));
      if (ci + CHUNK_SIZE < exportRows.length) {
        await new Promise(r => setTimeout(r, 0)); // yield between chunks
      }
    }

    jsonParts.push("]}");
    // Create Blob from parts → add to zip → release string references
    const jsonBlob = new Blob(jsonParts, { type: "application/json" });
    zip.file(`json/${ds.config.name}.json`, jsonBlob);
    jsonParts.length = 0;

    if (ds.config.csv) {
      // Build CSV in chunks to avoid long sync blocks (same approach as JSON)
      const csvKeySet = new Set<string>();
      const csvKeyOrder: string[] = [];
      // Gather all keys
      for (const record of exportRows) {
        for (const k of Object.keys(record)) {
          if (!csvKeySet.has(k)) { csvKeySet.add(k); csvKeyOrder.push(k); }
        }
      }
      const csvChunks: string[] = [];
      csvChunks.push("\uFEFF" + csvKeyOrder.join(",") + "\r\n");

      for (let ci = 0; ci < exportRows.length; ci += CHUNK_SIZE) {
        if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
        const end = Math.min(ci + CHUNK_SIZE, exportRows.length);
        for (let ri = ci; ri < end; ri++) {
          const cells = csvKeyOrder.map((key) => {
            const val = exportRows[ri][key];
            const isText = typeof val === "string";
            const { str, truncated } = csvEscapeValue(val, isText, true, ds.config.name);
            if (truncated) totalTruncatedCells++;
            return str;
          });
          csvChunks.push(cells.join(",") + "\r\n");
        }
        if (ci + CHUNK_SIZE < exportRows.length) {
          await new Promise(r => setTimeout(r, 0)); // yield between chunks
        }
      }

      const csvBlob = new Blob(csvChunks, { type: "text/csv" });
      zip.file(`csv/${ds.config.name}.csv`, csvBlob);
      csvChunks.length = 0; // release references
    }

    // Release rows that are no longer needed to reduce peak memory.
    // audit_trail rows are needed for the image pass, so skip them.
    // Manifest metadata is already cached in _rowCount/_firstCreatedAt/_lastCreatedAt.
    if (ds.config.name !== "audit_trail") {
      ds.rows.length = 0;
    }

    await new Promise(r => setTimeout(r, 0)); // yield
  }

  // Settings JSON
  zip.file("json/settings.json", JSON.stringify({ dataset: "settings", record_count: Object.keys(settingsData).length > 0 ? 1 : 0, records: Object.keys(settingsData).length > 0 ? [settingsData] : [] }, null, 2));

  // Price alerts
  zip.file("json/price_alerts.json", JSON.stringify({ dataset: "price_alerts", record_count: priceAlerts.length, records: priceAlerts, source: "this_device_only" }, null, 2));
  if (priceAlerts.length > 0) {
    const { csv, truncatedCells } = recordsToCSV(priceAlerts, undefined, "price_alerts");
    totalTruncatedCells += truncatedCells;
    zip.file("csv/price_alerts.csv", csv);
  }

  // Local preferences
  if (Object.keys(localPrefs).length > 0) {
    zip.file("json/local_preferences.json", JSON.stringify({ dataset: "local_preferences", record_count: 1, records: [localPrefs], source: "this_device_only" }, null, 2));
  }

  // ── Phase 2b: Extract images (Section 4.2, 4.3) ──
  const imageBytesCap = getMaxImageBytes();
  if (includeImages) {
    const auditDs = fetchedDatasets.find(ds => ds.config.name === "audit_trail");
    if (auditDs && auditDs.rows.length > 0) {
      onProgress({ phase: "packaging", message: "Fetching images..." });

      const ids = auditDs.rows.map(r => String(r.id));
      let imgIdx = 0;
      let totalImageBytes = 0;
      let firstBatchAvgBytes: number | null = null;
      let estimatedTotalBytes: number | null = null;
      let imageCapped = false;

      // Build a lookup for updating audit trail JSON with image filenames
      const imageFileMap = new Map<string, { image_1_file: string | null; image_2_file: string | null }>();
      let currentImgBatchSize = IMAGE_BATCH_SIZE;

      for (let i = 0; i < ids.length; i += currentImgBatchSize) {
        if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
        const batchIds = ids.slice(i, i + currentImgBatchSize);

        let retries = 0;
        let imgRows: any[] | null = null;

        // Section 2.4: retry and halve for images too
        while (retries <= 2) {
          const { data, error: imgErr } = await supabase
            .from("trade_history")
            .select("id,image_1,image_2")
            .eq("user_id", userId)
            .in("id", batchIds);

          if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");

          if (imgErr) {
            if (isTimeoutError(imgErr) && retries < 2) {
              retries++;
              currentImgBatchSize = Math.max(5, Math.floor(currentImgBatchSize / 2));
              await new Promise(r => setTimeout(r, 500 * retries));
              continue;
            }
            throw new Error(`Image fetch failed: ${imgErr.message}`);
          }
          imgRows = data;
          break;
        }

        for (const row of (imgRows || [])) {
          const images = extractImagesFromRecord(row as Record<string, unknown>, String(row.id));
          const fileInfo: { image_1_file: string | null; image_2_file: string | null } = { image_1_file: null, image_2_file: null };

          for (const img of images) {
            totalImageBytes += img.byteLength;

            // Section 4.3: check cap (desktop 200MB, mobile 80MB)
            if (totalImageBytes > imageBytesCap) {
              imageCapped = true;
              break;
            }

            // Section 4.2: add as Uint8Array with compression: "STORE" (already compressed)
            zip.file(`images/${img.filename}`, img.data, { compression: "STORE" });

            if (img.filename.includes("_chart1")) fileInfo.image_1_file = img.filename;
            if (img.filename.includes("_chart2")) fileInfo.image_2_file = img.filename;
          }

          if (imageCapped) break;

          imageFileMap.set(String(row.id), fileInfo);
          imgIdx++;
        }

        if (imageCapped) break;

        // Section 4.3: estimate total after first batch
        if (firstBatchAvgBytes === null && imgIdx > 0) {
          firstBatchAvgBytes = totalImageBytes / imgIdx;
          // Count analyses with images (approximate: use ratio from this batch)
          const batchWithImages = (imgRows || []).filter((r: any) => r.image_1 || r.image_2).length;
          const imageRatio = batchWithImages / Math.max(1, (imgRows || []).length);
          const estimatedWithImages = ids.length * imageRatio;
          estimatedTotalBytes = firstBatchAvgBytes * estimatedWithImages;

          if (estimatedTotalBytes > imageBytesCap) {
            imageCapped = true;
            break;
          }
        }

        onProgress({
          phase: "packaging",
          imagesCurrent: Math.min(imgIdx, ids.length),
          imagesTotal: ids.length,
          message: `Images ${Math.min(imgIdx, ids.length)} / ${ids.length}`
        });
        await new Promise(r => setTimeout(r, 0));
      }

      if (imageCapped) {
        // Show estimated total if available, otherwise actual downloaded bytes
        const displayBytes = estimatedTotalBytes !== null ? estimatedTotalBytes : totalImageBytes;
        const capMB = (imageBytesCap / 1048576).toFixed(0);
        const estMB = (displayBytes / 1048576).toFixed(0);
        throw new Error(
          `Too many images: estimated total is about ${estMB} MB, the limit is ${capMB} MB. ` +
          `Export without images (all your other data is unaffected), or use a desktop browser.`
        );
      }

      // Update the audit_trail JSON with image filenames
      if (imageFileMap.size > 0) {
        const auditJsonFile = zip.file("json/audit_trail.json");
        if (auditJsonFile) {
          const auditJson = JSON.parse(await auditJsonFile.async("string"));
          for (const rec of auditJson.records) {
            const info = imageFileMap.get(String(rec.id));
            if (info) {
              rec.image_1_file = info.image_1_file;
              rec.image_2_file = info.image_2_file;
            }
          }
          zip.file("json/audit_trail.json", JSON.stringify(auditJson, null, 2));

          // Update CSV too
          const { csv, truncatedCells } = recordsToCSV(auditJson.records, undefined, "audit_trail");
          totalTruncatedCells += truncatedCells;
          zip.file("csv/audit_trail.csv", csv);
        }
      }
    }
  }

  // Release audit_trail rows now that image pass is done
  const auditDs = fetchedDatasets.find(d => d.config.name === "audit_trail");
  if (auditDs) auditDs.rows.length = 0;

  // Manifest and README
  const manifest = buildManifest(fetchedDatasets, settingsData, priceAlerts, localPrefs, includeImages, totalTruncatedCells, settingsHasDuplicates);
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("README.txt", buildReadme(manifest, includeImages));

  // Generate ZIP (Section 4.4: generateAsync with onUpdate for progress%)
  // Use fast compression (level 1) for large exports to avoid long sync blocks
  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
  onProgress({ phase: "packaging", message: "Compressing..." });

  let blob: Blob;
  try {
    blob = await zip.generateAsync(
      { type: "blob", compression: "DEFLATE", compressionOptions: { level: 1 } },
      (metadata: { percent: number }) => {
        // Section 2.5: check abort signal during packaging
        if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
        onProgress({
          phase: "packaging",
          packagingPercent: Math.round(metadata.percent),
          message: `Packaging… ${Math.round(metadata.percent)}%`
        });
      },
    );
  } catch (err) {
    // Re-throw AbortError from onUpdate callback
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    // Section 4.3: catch out-of-memory errors
    if (err instanceof RangeError || (err instanceof Error && err.message.includes("alloc"))) {
      throw new Error("Not enough memory to create the export file. Try exporting without images, or use a desktop browser.");
    }
    throw err;
  }

  // Section 2.5: final abort check after generateAsync — before creating any object URL or download
  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const filename = `quantcontext-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.zip`;

  // Flush any trailing throttled message before the final "done" event
  flushProgress();
  onProgress({ phase: "done", message: "Export ready. Your download should start.", datasetCounts });

  return { blob, filename, datasetCounts, truncatedCells: totalTruncatedCells };
  } finally {
    // Always flush pending progress on exit (normal, error, or abort)
    flushProgress();
  }
}

// ---------------------------------------------------------------------------
// DOWNLOAD HELPER
// ---------------------------------------------------------------------------

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 5000);
}
