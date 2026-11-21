// src/pdf/pdfWorker.ts
// ─────────────────────────────────────────────────────────────────────────
// Web Worker for PDF generation — Section 15.1
//
// pdfmake lays out pages synchronously, blocking the main thread for tens
// of seconds on large reports (measured: ~55 s / 2,875 pages for 300
// analyses). This worker runs doc building, pdfmake layout, and
// encryption in a background thread so the UI stays responsive.
//
// CRITICAL: The very first import MUST be `./pdfWorkerShim` — it sets
// `globalThis.window = self` before any other module evaluates.
// pdfmake's browser UMD bundle (and embedded FileSaver / core-js)
// references `window` during module evaluation.  Vite's
// `define: { global: 'window' }` also rewrites `global → window`
// everywhere, including inside the worker.  The shim ensures `window`
// exists in both dev (native ESM) and production (Rollup bundle).
//
// pdfmake is loaded DYNAMICALLY inside the message handler to defer
// evaluation until needed.
//
// PIN handling: received once via message, used as userPassword, cleared
// when the run ends. Never stored in worker global state (Section 6.5).
// ─────────────────────────────────────────────────────────────────────────

// ⚠️  This MUST be the first import — see pdfWorkerShim.ts
import './pdfWorkerShim';

import { getPdfTheme } from './theme';
import { registerPrimaryFonts, registerDevanagariFonts, FONT_FAMILY } from './fonts';
import { buildDocDefinition } from './docBuilder';
import { containsDevanagari } from './sanitizer';

// pdfmake is loaded lazily — see onmessage handler below.
let pdfmake: any;

// ── Message types (exported for pdfService.ts to reference) ──────────

export interface WorkerGeneratePayload {
  isDarkMode: boolean;
  accentTheme: 'emerald' | 'blue' | 'red';
  userId: string;
  marketSource: 'us' | 'india';
  data: any;              // PdfData — all serializable
  counts: any;            // DatasetCounts
  pdfId: string;
  fingerprint: string | null;
  options: {
    range: any;
    includeImages: boolean;
    imageQuality: 'smaller' | 'standard' | 'high';
    pin: string;
  };
  timeZone: string;
  isMobile: boolean;
  limits: { MAX_PDF_IMAGE_BYTES: number; MAX_PDF_PAGES: number; MAX_BOT_ROWS_IN_PDF: number };
  generatedAt: string;    // ISO string (Dates can't be structured-cloned)
}

export type WorkerInbound =
  | { type: 'generate'; payload: WorkerGeneratePayload }
  | { type: 'cancel' };

export type WorkerOutbound =
  | { type: 'progress'; message: string }
  | { type: 'done'; buffer: Uint8Array; pageCount: number }
  | { type: 'error'; message: string };

// ── Worker logic ────────────────────────────────────────────────────────

let aborted = false;

function checkAbort(): void {
  if (aborted) throw new DOMException('Export cancelled', 'AbortError');
}

function sendProgress(message: string): void {
  (self as any).postMessage({ type: 'progress', message } as WorkerOutbound);
}

(self as any).onmessage = async (event: MessageEvent<WorkerInbound>) => {
  const msg = event.data;

  if (msg.type === 'cancel') {
    aborted = true;
    return;
  }

  if (msg.type !== 'generate') return;

  const payload = msg.payload;
  aborted = false;

  try {
    // ── 0. Lazy-load pdfmake (once) ──────────────────────────────────
    // Window shim is handled by pdfWorkerShim.ts (first import above).
    // pdfmake is still loaded dynamically to defer its heavy evaluation.
    if (!pdfmake) {
      const pdfmakeNs = await import('pdfmake');
      pdfmake = (pdfmakeNs as any).default || pdfmakeNs;
    }

    // ── 1. Theme ──────────────────────────────────────────────────────
    sendProgress('Loading PDF engine…');
    const theme = getPdfTheme(payload.isDarkMode, payload.accentTheme);

    checkAbort();

    // ── 2. Register fonts ─────────────────────────────────────────────
    sendProgress('Loading fonts…');
    await registerPrimaryFonts(pdfmake);

    // Conditionally load Devanagari
    const allText = JSON.stringify(payload.data);
    if (containsDevanagari(allText)) {
      await registerDevanagariFonts(pdfmake);
    }

    checkAbort();

    // ── 3. Build doc definition ───────────────────────────────────────
    sendProgress('Building report sections…');

    // Create a mock AbortSignal that checks the worker's aborted flag.
    // The real AbortSignal can't be transferred to a worker.
    const signal = {
      get aborted() { return aborted; },
      addEventListener() { /* no-op */ },
      removeEventListener() { /* no-op */ },
    } as unknown as AbortSignal;

    const ctx = {
      theme,
      pdfId: payload.pdfId,
      userId: payload.userId,
      generatedAt: new Date(payload.generatedAt),
      timeZone: payload.timeZone,
      marketSource: payload.marketSource,
      data: payload.data,
      counts: payload.counts,
      fingerprint: payload.fingerprint,
      options: payload.options,
      isMobile: payload.isMobile,
      limits: payload.limits,
      signal,
      onProgress: sendProgress,
    };

    const docDef = await buildDocDefinition(ctx);
    checkAbort();

    // ── 4. Generate PDF bytes with encryption ─────────────────────────
    sendProgress('Laying out pages…');

    // Random owner password (Section 4.2)
    const ownerPasswordBytes = new Uint8Array(32);
    crypto.getRandomValues(ownerPasswordBytes);
    const ownerPassword = Array.from(ownerPasswordBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const fullDocDef = {
      ...docDef,
      version: '1.7ext3' as const,
      userPassword: payload.options.pin,
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

    sendProgress('Encrypting…');
    const pdfDoc = pdfmake.createPdf(fullDocDef);
    const pdfBuffer: Uint8Array = await pdfDoc.getBuffer();

    checkAbort();

    // ── 5. Encryption self-check (Section 4.2) ────────────────────────
    const pdfStr = new TextDecoder('latin1').decode(pdfBuffer);
    if (!pdfStr.includes('/Encrypt')) {
      throw new Error(
        'Encryption self-check failed: no /Encrypt entry in PDF trailer. ' +
        'Aborting — no unencrypted PDF will be created.',
      );
    }

    // ── 6. Count pages ────────────────────────────────────────────────
    const pageMatches = pdfStr.match(/\/Type\s*\/Page\b/g);
    const pageCount = pageMatches ? Math.max(1, pageMatches.length) : 1;

    // ── 7. Clear PIN from worker memory (Section 6.5) ─────────────────
    (payload.options as any).pin = null;
    (payload as any).options = null;

    // ── 8. Transfer buffer back (zero-copy) ───────────────────────────
    const buffer = pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer);
    (self as any).postMessage(
      { type: 'done', buffer, pageCount } as WorkerOutbound,
      [buffer.buffer],
    );

  } catch (err: any) {
    // Clear PIN on error too
    if (payload?.options) (payload.options as any).pin = null;

    const message = err?.name === 'AbortError'
      ? 'Export cancelled'
      : (err?.message || String(err));
    (self as any).postMessage({ type: 'error', message } as WorkerOutbound);
  }
};
