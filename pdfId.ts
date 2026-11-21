// src/pdf/pdfId.ts
// ─────────────────────────────────────────────────────────────────────────
// PDF ID generator and record fingerprint.
// Section 9.4: QCP-YYYYMMDD-HHMMSS-XXXXXXXX
// Section 9.5: SHA-256 fingerprint over sorted record ids
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate a PDF ID: `QCP-YYYYMMDD-HHMMSS-XXXXXXXX`
 * - Date and time are UTC.
 * - 8 random uppercase hex characters from crypto.getRandomValues.
 */
export function generatePdfId(now?: Date): string {
  const d = now ?? new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');

  const datePart = [
    d.getUTCFullYear(),
    pad2(d.getUTCMonth() + 1),
    pad2(d.getUTCDate()),
  ].join('');

  const timePart = [
    pad2(d.getUTCHours()),
    pad2(d.getUTCMinutes()),
    pad2(d.getUTCSeconds()),
  ].join('');

  // 8 random hex uppercase chars
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const randomHex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  return `QCP-${datePart}-${timePart}-${randomHex}`;
}

/** Regex for validating a PDF ID. */
export const PDF_ID_RE = /^QCP-\d{8}-\d{6}-[0-9A-F]{8}$/;

/**
 * Generate a record fingerprint: SHA-256 over sorted record IDs,
 * first 16 hex characters. (Section 9.5)
 *
 * @param recordIds Array of record ID strings from all datasets.
 * @returns First 16 hex chars of the SHA-256 hash, or null if
 *          crypto.subtle is unavailable (non-secure context).
 */
export async function generateFingerprint(recordIds: string[]): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return null; // non-secure context
  }

  const sorted = [...recordIds].sort();
  const payload = sorted.join(',');
  const encoded = new TextEncoder().encode(payload);

  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const fullHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return fullHex.substring(0, 16);
}

/**
 * Generate the PDF file name.
 * Format: quantcontext-report-<PDF-ID>.pdf (Section 9.4)
 */
export function pdfFileName(pdfId: string): string {
  return `quantcontext-report-${pdfId}.pdf`;
}
