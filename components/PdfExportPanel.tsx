// src/components/PdfExportPanel.tsx
// ─────────────────────────────────────────────────────────────────────────
// PDF Export Panel — Section 5 of the prompt.
// Button + dialog: range, images, quality, theme (read-only), estimate,
// PIN field, progress, cancel, success/error states.
// Shares running guard with ZIP export via exportRunningRef.
// ─────────────────────────────────────────────────────────────────────────

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { MutableRefObject } from 'react';
import type { PdfRangeOption } from '../pdf/pdfService';
import type { ImageQualityKey } from '../pdf/layout';
import type { AccentName } from '../pdf/theme';
import type { MarketSource } from '../pdf/formatters';

// ── Props ────────────────────────────────────────────────────────────────

export interface PdfExportPanelProps {
  userId: string | null | undefined;
  supabase: any;
  isDarkMode: boolean;
  accentTheme: AccentName;
  marketSource: MarketSource;
  /** Shared running guard with ZIP export (Section 5.6). */
  exportRunningRef: MutableRefObject<boolean>;
  /** Accent Tailwind class (e.g. 'text-emerald-400') for spinner. */
  accentClass: string;
}

// ── Range options ────────────────────────────────────────────────────────

type RangeKind = 'all' | 'last12m' | 'last90d' | 'last30d' | 'custom';

const RANGE_LABELS: Record<RangeKind, string> = {
  all: 'All time',
  last12m: 'Last 12 months',
  last90d: 'Last 90 days',
  last30d: 'Last 30 days',
  custom: 'Custom range',
};

const QUALITY_LABELS: Record<ImageQualityKey, string> = {
  smaller: 'Smaller file',
  standard: 'Standard',
  high: 'High quality',
};

// ── Theme labels ─────────────────────────────────────────────────────────

const ACCENT_DISPLAY: Record<AccentName, string> = {
  emerald: 'Emerald Vector',
  blue: 'Cyber Blue',
  red: 'Neon Red',
};

// ── Component ────────────────────────────────────────────────────────────

export function PdfExportPanel({
  userId,
  supabase,
  isDarkMode,
  accentTheme,
  marketSource,
  exportRunningRef,
  accentClass,
}: PdfExportPanelProps) {
  // Dialog state
  const [showDialog, setShowDialog] = useState(false);

  // Options
  const [rangeKind, setRangeKind] = useState<RangeKind>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [includeImages, setIncludeImages] = useState(true);
  const [imageQuality, setImageQuality] = useState<ImageQualityKey>('standard');
  const [pin, setPin] = useState('');

  // Status
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ pdfId: string; fileName: string } | null>(null);

  // Abort controller
  const abortRef = useRef<AbortController | null>(null);

  // PIN input ref for clearing
  const pinInputRef = useRef<HTMLInputElement>(null);

  // ── Cleanup on unmount / dialog close ──────────────────────────────────
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  // ── Close dialog ───────────────────────────────────────────────────────
  const closeDialog = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setShowDialog(false);
    setProgress(null);
    setError(null);
    setPin('');
    // Release running guard if we were running
    if (exportRunningRef.current && progress) {
      exportRunningRef.current = false;
    }
  }, [exportRunningRef, progress]);

  // ── Escape key ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!showDialog) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDialog();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [showDialog, closeDialog]);

  // ── Build range option ─────────────────────────────────────────────────
  function buildRange(): PdfRangeOption {
    switch (rangeKind) {
      case 'all': return { kind: 'all' };
      case 'last12m': return { kind: 'last12m' };
      case 'last90d': return { kind: 'last90d' };
      case 'last30d': return { kind: 'last30d' };
      case 'custom':
        return {
          kind: 'custom',
          start: new Date(customStart),
          end: new Date(customEnd),
        };
    }
  }

  // ── Validate inputs ────────────────────────────────────────────────────
  function validate(): string | null {
    if (!userId) return 'Please sign in to export your data.';
    if (!/^\d{4}$/.test(pin)) return 'Enter your 4-digit engine PIN.';
    if (rangeKind === 'custom') {
      if (!customStart || !customEnd) return 'Select both start and end dates.';
      if (new Date(customStart) > new Date(customEnd)) return 'Start date must be before end date.';
      if (new Date(customEnd) > new Date()) return 'End date must not be in the future.';
    }
    return null;
  }

  // ── Generate PDF ───────────────────────────────────────────────────────
  async function handleGenerate() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    // Shared running guard (Section 5.6)
    if (exportRunningRef.current) {
      setError('Another export is already running. Please wait for it to finish.');
      return;
    }

    exportRunningRef.current = true;
    setError(null);
    setSuccess(null);
    setProgress('Starting…');

    const controller = new AbortController();
    abortRef.current = controller;

    // Keep PIN in local variable only (Section 6.5)
    let localPin: string | null = pin;
    // Clear the input field immediately
    setPin('');
    if (pinInputRef.current) pinInputRef.current.value = '';

    try {
      // ── 1. Verify PIN ────────────────────────────────────────────────
      setProgress('Checking PIN…');
      const { verifyPin } = await import('../pdf/pinVerify');

      if (controller.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

      const pinResult = await verifyPin(supabase, userId!, localPin!);
      if (!pinResult.ok) {
        if (pinResult.noPinSet) {
          setError('No PIN set. Set a PIN first in the Security section above.');
          exportRunningRef.current = false;
          localPin = null;
          return;
        }
        if (pinResult.lockedUntil) {
          const lockSec = Math.max(1, Math.ceil((new Date(pinResult.lockedUntil).getTime() - Date.now()) / 1000));
          setError(`PIN locked. Try again in ${lockSec} seconds.`);
        } else if (pinResult.errorMessage) {
          setError(pinResult.errorMessage);
        } else {
          const remaining = pinResult.attemptsLeft;
          setError(`Wrong PIN. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
        }
        exportRunningRef.current = false;
        localPin = null;
        return;
      }

      if (controller.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

      // ── 2. Generate PDF report ───────────────────────────────────────
      const { generatePdfReport } = await import('../pdf/pdfService');

      const result = await generatePdfReport(
        supabase,
        userId!,
        isDarkMode,
        accentTheme,
        marketSource,
        {
          range: buildRange(),
          includeImages,
          imageQuality,
          pin: localPin!,
        },
        controller.signal,
        (message: string) => setProgress(message),
      );

      // PIN no longer needed — clear
      localPin = null;

      setSuccess({ pdfId: result.pdfId, fileName: result.fileName });
      setProgress(null);
    } catch (err: any) {
      localPin = null; // ensure PIN is cleared on error
      if (err?.name === 'AbortError') {
        setError('Export cancelled.');
      } else {
        setError(err?.message ?? 'PDF generation failed. Please try again.');
      }
      setProgress(null);
    } finally {
      localPin = null;
      exportRunningRef.current = false;
      abortRef.current = null;
    }
  }

  // ── Cancel handler ─────────────────────────────────────────────────────
  function handleCancel() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }

  // ── Copy PDF ID ────────────────────────────────────────────────────────
  function handleCopyId() {
    if (success?.pdfId) {
      navigator.clipboard.writeText(success.pdfId).catch(() => {});
    }
  }

  // ── Theme label ────────────────────────────────────────────────────────
  const themeLabel = `${isDarkMode ? 'Dark' : 'Light'} · ${ACCENT_DISPLAY[accentTheme]}`;

  return (
    <>
      {/* ── Separator ─────────────────────────────────────────────────── */}
      <div className="border-t border-zinc-800 my-3" />

      {/* ── Button ────────────────────────────────────────────────────── */}
      <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded flex flex-col gap-3">
        <p className="font-mono text-[10px] text-zinc-400">
          A colour PDF of your analyses, statistics, journal and more, protected with your PIN.
        </p>

        <button
          onClick={() => { setShowDialog(true); setError(null); setSuccess(null); }}
          disabled={exportRunningRef.current}
          className="w-full py-2.5 font-mono text-[10px] uppercase tracking-widest border rounded transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 bg-zinc-900/30 hover:bg-zinc-800/50"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          Export PDF report
        </button>
      </div>

      {/* ── Dialog ────────────────────────────────────────────────────── */}
      {showDialog && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70"
          onClick={(e) => { if (e.target === e.currentTarget) closeDialog(); }}
          role="dialog"
          aria-modal="true"
          aria-label="Export PDF report"
        >
          <div
            className="bg-[#0a0a0a] border border-zinc-800 rounded-lg w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <h2 className="font-mono text-xs text-zinc-200 uppercase tracking-widest">Export PDF Report</h2>
              <button
                onClick={closeDialog}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                aria-label="Close"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="p-4 flex flex-col gap-4">
              {/* ── Range ────────────────────────────────────────────── */}
              <div>
                <label className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest block mb-2">Date Range</label>
                <select
                  value={rangeKind}
                  onChange={(e) => setRangeKind(e.target.value as RangeKind)}
                  disabled={!!progress}
                  className="w-full bg-zinc-900 border border-zinc-700 text-zinc-300 font-mono text-[10px] rounded px-3 py-2 focus:outline-none focus:border-zinc-500"
                >
                  {(Object.keys(RANGE_LABELS) as RangeKind[]).map(k => (
                    <option key={k} value={k}>{RANGE_LABELS[k]}</option>
                  ))}
                </select>

                {rangeKind === 'custom' && (
                  <div className="flex gap-2 mt-2">
                    <input
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      disabled={!!progress}
                      className="flex-1 bg-zinc-900 border border-zinc-700 text-zinc-300 font-mono text-[10px] rounded px-2 py-1.5"
                    />
                    <span className="text-zinc-500 font-mono text-[10px] self-center">to</span>
                    <input
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      disabled={!!progress}
                      max={new Date().toISOString().split('T')[0]}
                      className="flex-1 bg-zinc-900 border border-zinc-700 text-zinc-300 font-mono text-[10px] rounded px-2 py-1.5"
                    />
                  </div>
                )}
              </div>

              {/* ── Include images ────────────────────────────────────── */}
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={includeImages}
                  onChange={(e) => setIncludeImages(e.target.checked)}
                  disabled={!!progress}
                  className="w-3.5 h-3.5 rounded border border-zinc-600 bg-zinc-800 accent-current cursor-pointer"
                />
                <span className="font-mono text-[10px] text-zinc-500 group-hover:text-zinc-300 transition-colors select-none">
                  Include chart images
                </span>
              </label>

              {/* ── Image quality ─────────────────────────────────────── */}
              <div>
                <label className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest block mb-2">Image Quality</label>
                <select
                  value={imageQuality}
                  onChange={(e) => setImageQuality(e.target.value as ImageQualityKey)}
                  disabled={!!progress || !includeImages}
                  className="w-full bg-zinc-900 border border-zinc-700 text-zinc-300 font-mono text-[10px] rounded px-3 py-2 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
                >
                  {(Object.keys(QUALITY_LABELS) as ImageQualityKey[]).map(k => (
                    <option key={k} value={k}>{QUALITY_LABELS[k]}</option>
                  ))}
                </select>
              </div>

              {/* ── Theme (read-only) ─────────────────────────────────── */}
              <div>
                <label className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest block mb-1">PDF Theme</label>
                <p className="font-mono text-[10px] text-zinc-400">
                  {themeLabel} <span className="text-zinc-600">(matches your engine)</span>
                </p>
              </div>

              {/* ── PIN ───────────────────────────────────────────────── */}
              <div>
                <label className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest block mb-2">
                  Enter your engine PIN to protect the PDF
                </label>
                <input
                  ref={pinInputRef}
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  disabled={!!progress}
                  placeholder="••••"
                  className="w-full bg-zinc-900 border border-zinc-700 text-zinc-300 font-mono text-sm rounded px-3 py-2 tracking-[0.5em] text-center focus:outline-none focus:border-zinc-500"
                />
                <p className="font-mono text-[8px] text-zinc-600 mt-1">
                  Your PIN is the password. Keep the PDF private.
                </p>
              </div>

              {/* ── Android warning ───────────────────────────────────── */}
              {typeof window !== 'undefined' && (window as any).QCAndroid && (
                <p className="font-mono text-[9px] text-amber-500/60 flex items-center gap-1">
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  Downloads may not work in the Android app. Use your phone's browser instead.
                </p>
              )}

              {/* ── Progress ──────────────────────────────────────────── */}
              <div aria-live="polite" aria-atomic="true">
                {progress && (
                  <div className="flex items-center gap-2">
                    <svg className={`w-3.5 h-3.5 animate-spin ${accentClass}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    <span className={`font-mono text-[10px] ${accentClass}`}>{progress}</span>
                    <button
                      onClick={handleCancel}
                      className="ml-auto font-mono text-[9px] text-zinc-500 hover:text-red-400 transition-colors uppercase tracking-widest"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {error && !progress && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-red-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      <span className="font-mono text-[10px] text-red-400">{error}</span>
                    </div>
                  </div>
                )}

                {success && !progress && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                      <span className="font-mono text-[10px] text-emerald-400">
                        PDF ready. Your download should start. The password is your engine PIN.
                      </span>
                    </div>
                    <div className="flex items-center gap-2 ml-5">
                      <span className="font-mono text-[9px] text-zinc-500">ID: {success.pdfId}</span>
                      <button
                        onClick={handleCopyId}
                        className="font-mono text-[8px] text-zinc-600 hover:text-zinc-400 transition-colors uppercase tracking-widest"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Footer buttons ──────────────────────────────────────── */}
            <div className="flex gap-2 p-4 border-t border-zinc-800">
              <button
                onClick={closeDialog}
                className="flex-1 py-2 font-mono text-[10px] uppercase tracking-widest border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 rounded transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={!!progress || pin.length !== 4}
                className="flex-1 py-2 font-mono text-[10px] uppercase tracking-widest border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 bg-zinc-900/30 hover:bg-zinc-800/50 rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {progress ? 'Generating…' : 'Generate PDF'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
