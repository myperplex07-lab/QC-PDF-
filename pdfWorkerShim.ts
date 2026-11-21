// src/pdf/pdfWorkerShim.ts
// ─────────────────────────────────────────────────────────────────────────
// MUST be the very first import in pdfWorker.ts.
//
// Web Workers don't have `window` — only `self` / `globalThis`.
// pdfmake's browser UMD bundle (and its embedded FileSaver / core-js)
// accesses `window` during module evaluation.  Additionally, Vite's
// `define: { global: 'window' }` in vite.config.ts rewrites every
// `global` reference to `window` — including inside worker code.
//
// This side-effect module aliases `window → self` at the earliest
// possible moment in the ES module evaluation chain, so that any
// downstream code (pdfmake, Vite-rewritten `global`, etc.) finds the
// global it expects.
//
// ESM evaluation order guarantees: static side-effect imports run in
// declaration order, before the importing module's own body.  Because
// this file has zero dependencies it evaluates first — both in Vite
// dev mode (native ESM) and in the production build (Rollup bundle).
// ─────────────────────────────────────────────────────────────────────────

if (typeof window === 'undefined') {
  // In a Worker context, `self` is the global scope.
  (globalThis as any).window = self;
}

export {};
