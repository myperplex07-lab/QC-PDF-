// src/pdf/pdfService.ts
// ─────────────────────────────────────────────────────────────────────────
// Main PDF report orchestrator.
// Sections 5–7, 11, 13, 15 of the prompt.
//
// Lazy-loads pdfmake, fonts, and all section builders.
// Never creates an unencrypted PDF — self-check mandatory.
// PIN never stored/logged/sent — only in local variable during generation.
// ─────────────────────────────────────────────────────────────────────────

import type { PdfTheme, AccentName } from './theme';
import type { MarketSource } from './formatters';
import type { ImageQualityKey } from './layout';

// ── Types ────────────────────────────────────────────────────────────────

/** Date range option for the PDF report. */
export type PdfRangeOption =
  | { kind: 'all' }
  | { kind: 'last12m' }
  | { kind: 'last90d' }
  | { kind: 'last30d' }
  | { kind: 'custom'; start: Date; end: Date };

/** Options passed to the PDF generator. */
export interface PdfGenerateOptions {
  range: PdfRangeOption;
  includeImages: boolean;
  imageQuality: ImageQualityKey;
  /** Already-verified PIN (only lives in this variable during generation). */
  pin: string;
}

/** Progress callback for the UI. */
export type PdfProgressCallback = (message: string, detail?: string) => void;

/** Counts per dataset for the estimate and cover. */
export interface DatasetCounts {
  auditTrail: number;
  journal: number;
  predictions: number;
  watchlist: number;
  contextPresets: number;
  botSignals: number;
  priceAlerts: number;
}

/** Full fetched data for the PDF. */
export interface PdfData {
  auditTrail: Record<string, unknown>[];
  journal: Record<string, unknown>[];
  predictions: Record<string, unknown>[];
  watchlist: Record<string, unknown>[];
  contextPresets: Record<string, unknown>[];
  botSignals: Record<string, unknown>[];
  settings: Record<string, unknown>;
  localPreferences: Record<string, unknown>;
  priceAlerts: Record<string, unknown>[];
  counts: DatasetCounts;
  /** db_count_at_start per dataset */
  dbCounts: Record<string, number>;
  snapshotTime: Date;
  /** Count of rows added during the run, per dataset */
  rowsAdded: Record<string, number>;
}

/** Result returned on success. */
export interface PdfResult {
  pdfId: string;
  fileName: string;
  pageCount: number;
  fileSizeBytes: number;
}

// ── Range filter helpers (Section 7.3) ───────────────────────────────────

/**
 * Compute UTC ISO start/end for the range filter.
 * Start: 00:00:00.000 local → UTC
 * End: 23:59:59.999 local → UTC
 */
export function computeRangeBounds(range: PdfRangeOption): { start: string | null; end: string | null } {
  if (range.kind === 'all') {
    return { start: null, end: null };
  }

  const now = new Date();
  let startDate: Date;
  let endDate: Date;

  switch (range.kind) {
    case 'last12m': {
      startDate = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
      endDate = now;
      break;
    }
    case 'last90d': {
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      endDate = now;
      break;
    }
    case 'last30d': {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      endDate = now;
      break;
    }
    case 'custom': {
      startDate = range.start;
      endDate = range.end;
      break;
    }
  }

  // Start of day in local → UTC
  const localStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0, 0);
  // End of day in local → UTC
  const localEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999);

  return {
    start: localStart.toISOString(),
    end: localEnd.toISOString(),
  };
}

// ── Count-only query (for estimate before heavy work) ────────────────────

/**
 * Run count-only queries for the estimate (Section 7.9).
 * Allowed before PIN verification per Section 6.4.
 */
export async function fetchCounts(
  supabase: any,
  userId: string,
  range: PdfRangeOption,
  signal: AbortSignal,
): Promise<DatasetCounts> {
  const { start, end } = computeRangeBounds(range);

  async function countTable(table: string, rangeCol?: string): Promise<number> {
    if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
    let query = supabase.from(table).select('*', { count: 'exact', head: true }).eq('user_id', userId);
    if (rangeCol && start) query = query.gte(rangeCol, start);
    if (rangeCol && end) query = query.lte(rangeCol, end);
    const { count, error } = await query;
    if (error) throw new Error(`Count query failed for ${table}: ${error.message}`);
    return count ?? 0;
  }

  const [auditTrail, journal, predictions, watchlist, contextPresets, botSignals] = await Promise.all([
    countTable('trade_history', 'created_at'),
    countTable('trade_journal', 'created_at'),
    countTable('prediction_scores', 'created_at'),
    countTable('watchlist'),
    countTable('context_presets'),
    countTable('bot_signals', 'created_at'),
  ]);

  // Price alerts are localStorage — count them locally
  let priceAlerts = 0;
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem('qc_price_alerts');
      if (raw) {
        const parsed = JSON.parse(raw);
        priceAlerts = Array.isArray(parsed) ? parsed.length : 0;
      }
    } catch { /* ignore */ }
  }

  return { auditTrail, journal, predictions, watchlist, contextPresets, botSignals, priceAlerts };
}

// ── Fetch all data for the PDF (Section 7) ───────────────────────────────

/**
 * Fetch all datasets for the PDF. Called ONLY after PIN verification.
 * Uses the same fetch layer as the ZIP export.
 */
export async function fetchPdfData(
  supabase: any,
  userId: string,
  range: PdfRangeOption,
  options: { includeImages: boolean; maxBotRows: number },
  signal: AbortSignal,
  onProgress: PdfProgressCallback,
): Promise<PdfData> {
  // Lazy import of exportService functions
  const {
    SUPABASE_DATASETS,
    fetchAllPaginated,
    discoverColumns,
    resolveOrderColumns,
    fetchSettings,
    fetchLocalPreferences,
    fetchPriceAlerts,
  } = await import('../exportService');

  const { start, end } = computeRangeBounds(range);
  const snapshotTime = new Date();
  const dbCounts: Record<string, number> = {};
  const rowsAdded: Record<string, number> = {};

  // Helper: fetch a dataset with range filter
  async function fetchDataset(
    name: string,
    rangeCol?: string,
  ): Promise<Record<string, unknown>[]> {
    if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

    const config = SUPABASE_DATASETS.find(d => d.name === name);
    if (!config) return [];

    // Discover columns
    const cols = await discoverColumns(supabase, config.table, userId, signal);
    if (!cols || cols.length === 0) return [];

    const { orderCol } = resolveOrderColumns(config, cols);

    // Determine select string (all columns, or exclude images if not needed)
    let selectString = '*';
    if (name === 'audit_trail' && !options.includeImages) {
      // Exclude image columns to save bandwidth
      const imageCols = ['image_1', 'image_2'];
      const filteredCols = cols.filter(c => !imageCols.includes(c));
      selectString = filteredCols.join(',');
    }

    // Build the query with range filter
    // We use fetchAllPaginated directly but add range filters
    // fetchAllPaginated takes: supabase, config, userId, signal, onProgress, selectString, batchSize, orderCol
    const batchSize = 500;

    // For range filtering, we need to add .gte/.lte to the query
    // But fetchAllPaginated builds queries internally.
    // So we create a modified config with the range filter built in.
    // Actually, fetchAllPaginated uses config.table and builds the query,
    // but it doesn't support range filters directly.
    // We'll fetch all and filter client-side, OR use a direct approach.
    
    // Direct approach: query with pagination and range filter
    let allRows: Record<string, unknown>[] = [];
    let cursor: unknown = null;
    let total = 0;

    // First get count with range filter
    let countQuery = supabase.from(config.table).select('*', { count: 'exact', head: true }).eq('user_id', userId);
    if (rangeCol && start) countQuery = countQuery.gte(rangeCol, start);
    if (rangeCol && end) countQuery = countQuery.lte(rangeCol, end);
    const { count: rangeCount, error: countErr } = await countQuery;
    if (countErr) throw new Error(`Count failed for ${name}: ${countErr.message}`);
    total = rangeCount ?? 0;
    dbCounts[name] = total;

    if (total === 0) {
      rowsAdded[name] = 0;
      return [];
    }

    // Paginated fetch with range filter (ascending order per Section 7.6)
    let fetched = 0;
    const effectiveOrderCol = orderCol || config.pk;
    
    while (true) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

      let query = supabase
        .from(config.table)
        .select(selectString)
        .eq('user_id', userId)
        .order(effectiveOrderCol, { ascending: true })
        .limit(batchSize);

      if (rangeCol && start) query = query.gte(rangeCol, start);
      if (rangeCol && end) query = query.lte(rangeCol, end);
      if (cursor != null) query = query.gt(effectiveOrderCol, cursor);

      const { data, error } = await query;
      if (error) throw new Error(`Fetch failed for ${name}: ${error.message}`);
      if (!data || data.length === 0) break;

      allRows = allRows.concat(data as Record<string, unknown>[]);
      fetched += data.length;

      onProgress(`Fetching ${name.replace(/_/g, ' ')} ${fetched.toLocaleString()} / ${total.toLocaleString()}`);

      cursor = (data[data.length - 1] as any)[effectiveOrderCol];
      if (data.length < batchSize) break;
    }

    rowsAdded[name] = Math.max(0, allRows.length - total);
    return allRows;
  }

  // Fetch all datasets
  onProgress('Fetching Audit Trail…');
  const auditTrail = await fetchDataset('audit_trail', 'created_at');

  onProgress('Fetching Trade Journal…');
  const journal = await fetchDataset('trade_journal', 'created_at');

  onProgress('Fetching Prediction Scores…');
  const predictions = await fetchDataset('prediction_scores', 'created_at');

  onProgress('Fetching Watchlist…');
  const watchlist = await fetchDataset('watchlist');

  onProgress('Fetching Context Presets…');
  const contextPresets = await fetchDataset('context_presets');

  onProgress('Fetching Bot Signals…');
  let botSignals = await fetchDataset('bot_signals', 'created_at');
  // Cap bot signals (Section 7.5)
  if (botSignals.length > options.maxBotRows) {
    // Keep the latest N rows (data is in ascending order, so take from end)
    botSignals = botSignals.slice(-options.maxBotRows);
  }

  onProgress('Fetching Settings…');
  const { data: settings } = await fetchSettings(supabase, userId, signal);

  const localPreferences = fetchLocalPreferences(localStorage);
  const priceAlerts = fetchPriceAlerts(localStorage);

  const counts: DatasetCounts = {
    auditTrail: auditTrail.length,
    journal: journal.length,
    predictions: predictions.length,
    watchlist: watchlist.length,
    contextPresets: contextPresets.length,
    botSignals: botSignals.length,
    priceAlerts: priceAlerts.length,
  };

  return {
    auditTrail,
    journal,
    predictions,
    watchlist,
    contextPresets,
    botSignals,
    settings,
    localPreferences,
    priceAlerts,
    counts,
    dbCounts,
    snapshotTime,
    rowsAdded,
  };
}

// ── Self-check: verify /Encrypt in built PDF bytes (Section 4.2) ─────────

function verifyEncryption(pdfBytes: Uint8Array | Buffer): void {
  // Convert to string for searching (latin1 preserves raw bytes)
  const str = typeof Buffer !== 'undefined' && Buffer.isBuffer(pdfBytes)
    ? pdfBytes.toString('latin1')
    : new TextDecoder('latin1').decode(pdfBytes);

  if (!str.includes('/Encrypt')) {
    throw new Error(
      'ENCRYPTION SELF-CHECK FAILED: The generated PDF does not contain an /Encrypt entry. ' +
      'No file will be downloaded. This is a critical error — please report it.'
    );
  }
}

// ── Main generate function ───────────────────────────────────────────────

/**
 * Generate the full PDF report.
 *
 * @param supabase  Supabase client instance
 * @param userId    Clerk user ID
 * @param isDarkMode  Current dark mode state
 * @param accentTheme  Current accent theme
 * @param marketSource  'us' or 'india'
 * @param options  Generation options (range, images, quality, PIN)
 * @param signal  AbortSignal for cancellation
 * @param onProgress  Progress callback
 * @returns  PdfResult on success
 */
export async function generatePdfReport(
  supabase: any,
  userId: string,
  isDarkMode: boolean,
  accentTheme: AccentName,
  marketSource: MarketSource,
  options: PdfGenerateOptions,
  signal: AbortSignal,
  onProgress: PdfProgressCallback,
): Promise<PdfResult> {
  // ── 0. Progress throttle (Section 5.3 / 15.2) ────────────────────────
  // Same pattern as the ZIP export: leading + trailing, 100 ms interval,
  // duplicate messages dropped, latest always delivered on flush.
  const THROTTLE_MS = 100;
  let lastTime = 0;
  let lastMsg = '';
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const deliver = (msg: string) => {
    lastTime = Date.now();
    lastMsg = msg;
    onProgress(msg);
  };

  const flushProgress = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (pending !== null) { deliver(pending); pending = null; }
  };

  const throttledProgress: PdfProgressCallback = (msg: string) => {
    if (msg === lastMsg) return; // drop identical consecutive
    const elapsed = Date.now() - lastTime;
    if (elapsed >= THROTTLE_MS || lastTime === 0) {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      pending = null;
      deliver(msg);
    } else {
      pending = msg;
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          if (pending !== null) { deliver(pending); pending = null; }
        }, THROTTLE_MS - elapsed);
      }
    }
  };

  try {
  // ── 1. Lazy-load modules ─────────────────────────────────────────────
  throttledProgress('Loading PDF engine…');

  const [
    { getPdfTheme },
    { registerPrimaryFonts, FONT_FAMILY },
    { generatePdfId, pdfFileName, generateFingerprint },
    { estimatePages, getLimits, detectMobile, CONTENT_WIDTH, MAX_TEXT_FIELD_CHARS },
    { getUserTimeZone, fmtDateTimeFull, fmtIsoUtc },
    { downloadBlob },
  ] = await Promise.all([
    import('./theme'),
    import('./fonts'),
    import('./pdfId'),
    import('./layout'),
    import('./formatters'),
    import('../exportService'),
  ]);

  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

  // ── 2. Snapshot theme ────────────────────────────────────────────────
  const theme = getPdfTheme(isDarkMode, accentTheme);
  const pdfId = generatePdfId();
  const generatedAt = new Date();
  const timeZone = getUserTimeZone();
  const isMobile = detectMobile();
  const limits = getLimits(isMobile);

  // ── 3. Count records (estimate) ──────────────────────────────────────
  throttledProgress('Counting records…');
  const counts = await fetchCounts(supabase, userId, options.range, signal);

  const estimatedPages = estimatePages({
    analyses: counts.auditTrail,
    journal: counts.journal,
    predictions: counts.predictions,
    botRows: counts.botSignals,
    isMobile,
    includeImages: options.includeImages,
  });

  if (estimatedPages > limits.MAX_PDF_PAGES) {
    throw new Error(
      `The estimated report is about ${estimatedPages.toLocaleString()} pages, ` +
      `which exceeds the ${limits.MAX_PDF_PAGES.toLocaleString()}-page limit. ` +
      `Try a shorter date range, turn off images, or use a smaller image quality.`
    );
  }

  // ── 4. Fetch data ────────────────────────────────────────────────────
  throttledProgress('Fetching data…');
  const data = await fetchPdfData(supabase, userId, options.range, {
    includeImages: options.includeImages,
    maxBotRows: limits.MAX_BOT_ROWS_IN_PDF,
  }, signal, throttledProgress);

  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

  // ── 5. Generate fingerprint ──────────────────────────────────────────
  const allIds: string[] = [];
  for (const row of data.auditTrail) if (row.id) allIds.push(String(row.id));
  for (const row of data.journal) if (row.id) allIds.push(String(row.id));
  for (const row of data.predictions) if (row.id) allIds.push(String(row.id));
  for (const row of data.watchlist) if (row.id) allIds.push(String(row.id));
  for (const row of data.contextPresets) if (row.id) allIds.push(String(row.id));
  for (const row of data.botSignals) if (row.id) allIds.push(String(row.id));
  const fingerprint = await generateFingerprint(allIds);

  // ── 6–11. Build PDF via Web Worker (Section 15.1) ───────────────────
  //
  // pdfmake lays out pages synchronously (measured: ~55 s for 300 analyses).
  // To keep the UI responsive, the entire doc building + pdfmake layout +
  // encryption runs in a Web Worker. The worker terminates after each run
  // (Section 6.5). Falls back to main-thread if Web Workers are unavailable
  // (Node tests, SSR, legacy browsers).
  //
  const useWorker = typeof window !== 'undefined' && typeof Worker !== 'undefined';

  let pdfBuffer: Uint8Array;
  let pageCount: number;

  if (useWorker) {
    // ── Worker path (browser) ───────────────────────────────────────
    throttledProgress('Starting PDF worker…');
    const workerResult = await runPdfInWorker({
      isDarkMode,
      accentTheme,
      userId,
      marketSource,
      data,
      counts: data.counts,
      pdfId,
      fingerprint,
      options,
      timeZone,
      isMobile,
      limits,
      generatedAt: generatedAt.toISOString(),
    }, signal, throttledProgress);

    pdfBuffer = workerResult.buffer;
    pageCount = workerResult.pageCount;
  } else {
    // ── Direct path (Node / tests / no-Worker environments) ─────────
    throttledProgress('Loading fonts…');
    const pdfmake = (await import('pdfmake')).default || (await import('pdfmake'));
    await registerPrimaryFonts(pdfmake);

    const { containsDevanagari } = await import('./sanitizer');
    const allText = JSON.stringify(data);
    if (containsDevanagari(allText)) {
      const { registerDevanagariFonts } = await import('./fonts');
      await registerDevanagariFonts(pdfmake);
    }

    if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

    throttledProgress('Building report sections…');
    const { buildDocDefinition } = await import('./docBuilder');

    const docDef = await buildDocDefinition({
      theme,
      pdfId,
      userId,
      generatedAt,
      timeZone,
      marketSource,
      data,
      counts: data.counts,
      fingerprint,
      options,
      isMobile,
      limits,
      signal,
      onProgress: throttledProgress,
    });

    if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

    throttledProgress('Laying out pages…');
    const ownerPasswordBytes = new Uint8Array(32);
    crypto.getRandomValues(ownerPasswordBytes);
    const ownerPassword = Array.from(ownerPasswordBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const fullDocDef = {
      ...docDef,
      version: '1.7ext3' as const,
      userPassword: options.pin,
      ownerPassword,
      permissions: {
        printing: 'highResolution' as const,
        modifying: false,
        copying: true,
        annotating: false,
        fillingForms: false,
        contentAccessibility: true,
        documentAssembly: false,
      },
      defaultStyle: {
        font: FONT_FAMILY,
        fontSize: 9.5,
      },
    };

    throttledProgress('Encrypting…');
    const pdfDoc = pdfmake.createPdf(fullDocDef);
    const rawBuffer: Buffer | Uint8Array = await pdfDoc.getBuffer();

    if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

    verifyEncryption(rawBuffer);

    pdfBuffer = rawBuffer instanceof Uint8Array ? rawBuffer : new Uint8Array(rawBuffer);

    const pdfStr = typeof Buffer !== 'undefined' && Buffer.isBuffer(rawBuffer)
      ? rawBuffer.toString('latin1')
      : new TextDecoder('latin1').decode(pdfBuffer);
    const pageMatches = pdfStr.match(/\/Type\s*\/Page\b/g);
    pageCount = pageMatches ? Math.max(1, pageMatches.length) : estimatedPages;
  }

  // ── 12. Download ─────────────────────────────────────────────────────
  const fileName = pdfFileName(pdfId);
  const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
  downloadBlob(blob, fileName);

  flushProgress();
  onProgress('Done');

  return {
    pdfId,
    fileName,
    pageCount: Math.max(1, pageCount),
    fileSizeBytes: pdfBuffer.length,
  };
  } finally {
    // Always flush trailing throttled message and clear the timer
    flushProgress();
  }
}

// ── Web Worker helper (Section 15.1) ──────────────────────────────────

/**
 * Run the PDF generation in a Web Worker and return the encrypted buffer.
 * The worker is created, used once, and terminated (Section 6.5).
 */
async function runPdfInWorker(
  payload: import('./pdfWorker').WorkerGeneratePayload,
  signal: AbortSignal,
  onProgress: PdfProgressCallback,
): Promise<{ buffer: Uint8Array; pageCount: number }> {
  return new Promise((resolve, reject) => {
    // Vite module worker: bundled separately, lazy-loaded
    const worker = new Worker(
      new URL('./pdfWorker.ts', import.meta.url),
      { type: 'module' },
    );

    let settled = false;

    const cleanup = () => {
      settled = true;
      signal.removeEventListener('abort', onAbort);
      // Terminate the worker after each run (Section 6.5)
      worker.terminate();
    };

    const onAbort = () => {
      if (settled) return;
      worker.postMessage({ type: 'cancel' });
      // Give the worker a moment to acknowledge, then terminate
      setTimeout(() => {
        if (!settled) {
          cleanup();
          reject(new DOMException('Export cancelled', 'AbortError'));
        }
      }, 200);
    };

    signal.addEventListener('abort', onAbort);

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (settled) return;

      switch (msg.type) {
        case 'progress':
          onProgress(msg.message);
          break;

        case 'done':
          cleanup();
          resolve({ buffer: msg.buffer, pageCount: msg.pageCount });
          break;

        case 'error':
          cleanup();
          if (msg.message === 'Export cancelled') {
            reject(new DOMException('Export cancelled', 'AbortError'));
          } else {
            reject(new Error(msg.message));
          }
          break;
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      if (settled) return;
      cleanup();
      reject(new Error(`PDF worker error: ${event.message}`));
    };

    // Send data to the worker
    worker.postMessage({ type: 'generate', payload });
  });
}
