// src/pdf/imagePipeline.ts
// ─────────────────────────────────────────────────────────────────────────
// Image decode, downscale, convert, budget tracking — Section 13.
//
// Pipeline per image (one at a time):
//   1. Read MIME from data URI
//   2. Decode (createImageBitmap, respecting orientation)
//   3. Draw to canvas
//   4. Downscale to max width (never upscale)
//   5. Encode as JPEG (or PNG if transparency)
//   6. Keep only final bytes, close bitmap, release canvas
//   7. Add to running byte total
//
// pdfmake embeds only JPEG and PNG — convert anything else (WebP, GIF, AVIF).
// ─────────────────────────────────────────────────────────────────────────

import type { ImageQualityKey } from './layout';
import { IMAGE_QUALITY, CONTENT_WIDTH, MAX_IMAGE_HEIGHT } from './layout';

/** Result of processing one image. */
export interface ProcessedImage {
  /** data URL (data:image/jpeg;base64,... or data:image/png;base64,...) */
  dataUrl: string;
  /** Width in points for pdfmake (fit within CONTENT_WIDTH). */
  widthPt: number;
  /** Height in points for pdfmake. */
  heightPt: number;
  /** Byte size of the encoded image data. */
  byteSize: number;
  /** Effective DPI at the placed width. */
  effectiveDpi: number;
}

/** Image pipeline state for budget tracking. */
export interface ImageBudget {
  totalBytes: number;
  imageCount: number;
  skipped: number;
  failed: number;
}

/**
 * Compute the effective DPI when placing an image of `pixelWidth` pixels
 * at `placedWidthPt` points.
 *   DPI = pixelWidth / (placedWidthPt / 72)
 */
export function effectiveDpi(pixelWidth: number, placedWidthPt: number): number {
  if (placedWidthPt <= 0) return 0;
  return Math.round(pixelWidth / (placedWidthPt / 72));
}

/**
 * Compute the fit dimensions to place an image inside a box,
 * keeping aspect ratio, never upscaling.
 */
export function fitDimensions(
  srcWidth: number,
  srcHeight: number,
  maxWidthPt: number,
  maxHeightPt: number,
): { width: number; height: number } {
  if (srcWidth <= 0 || srcHeight <= 0) return { width: 0, height: 0 };

  const aspect = srcWidth / srcHeight;
  let w = Math.min(srcWidth, maxWidthPt);
  let h = w / aspect;

  if (h > maxHeightPt) {
    h = maxHeightPt;
    w = h * aspect;
  }

  return { width: Math.round(w * 100) / 100, height: Math.round(h * 100) / 100 };
}

/**
 * Detect MIME type from a data URI prefix.
 */
function detectMime(dataUri: string): string {
  const match = dataUri.match(/^data:([^;,]+)/);
  return match ? match[1].toLowerCase() : 'application/octet-stream';
}

/**
 * Check if a MIME type needs conversion for pdfmake (only JPEG and PNG accepted).
 */
function needsConversion(mime: string): boolean {
  return mime !== 'image/jpeg' && mime !== 'image/png';
}

/**
 * Check if a data URI represents an image with potential transparency.
 * PNG, WebP, GIF, AVIF can have alpha. JPEG cannot.
 */
function mightHaveAlpha(mime: string): boolean {
  return mime !== 'image/jpeg';
}

/**
 * Process a single image through the pipeline.
 *
 * @param dataUri  The image as a data URI string.
 * @param quality  Image quality key ('smaller', 'standard', 'high').
 * @param budget   Running budget tracker (mutated in place).
 * @param maxBytes Maximum total image bytes allowed.
 * @returns ProcessedImage or null if the image failed or was skipped.
 */
export async function processImage(
  dataUri: string,
  quality: ImageQualityKey,
  budget: ImageBudget,
  maxBytes: number,
): Promise<ProcessedImage | null> {
  if (!dataUri || typeof dataUri !== 'string') {
    budget.failed++;
    return null;
  }

  const preset = IMAGE_QUALITY[quality];
  const mime = detectMime(dataUri);

  try {
    // ── 1. Decode ──────────────────────────────────────────────────────
    // Convert data URI to Blob for createImageBitmap
    const response = await fetch(dataUri);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    const srcW = bitmap.width;
    const srcH = bitmap.height;

    if (srcW <= 0 || srcH <= 0) {
      bitmap.close();
      budget.failed++;
      return null;
    }

    // ── 2. Determine target size (downscale only, never upscale) ───────
    let targetW = srcW;
    let targetH = srcH;

    if (srcW > preset.maxWidth) {
      targetW = preset.maxWidth;
      targetH = Math.round(srcH * (preset.maxWidth / srcW));
    }

    // ── 3. Draw to canvas ──────────────────────────────────────────────
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) {
      bitmap.close();
      budget.failed++;
      return null;
    }

    ctx2d.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close(); // release source

    // ── 4. Encode ──────────────────────────────────────────────────────
    // Use PNG if original might have alpha and needs it; otherwise JPEG
    let outputMime: string;
    let outputBlob: Blob;

    if (mightHaveAlpha(mime) && !needsConversion(mime) && mime === 'image/png') {
      // Keep as PNG for transparency
      outputMime = 'image/png';
      outputBlob = await canvas.convertToBlob({ type: 'image/png' });
    } else {
      // Convert to JPEG (pdfmake accepts it, smaller size)
      outputMime = 'image/jpeg';
      outputBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: preset.jpegQuality });
    }

    const arrayBuf = await outputBlob.arrayBuffer();
    const byteSize = arrayBuf.byteLength;

    // ── 5. Budget check ────────────────────────────────────────────────
    // After the first 10 images, estimate total and check
    if (budget.imageCount >= 10) {
      const avgBytes = budget.totalBytes / budget.imageCount;
      // This is a rough estimate — be conservative
      if (budget.totalBytes + byteSize > maxBytes) {
        budget.skipped++;
        return null;
      }
    }

    if (budget.totalBytes + byteSize > maxBytes) {
      budget.skipped++;
      return null;
    }

    budget.totalBytes += byteSize;
    budget.imageCount++;

    // ── 6. Convert to data URL ─────────────────────────────────────────
    // Build base64 data URL from the ArrayBuffer
    const uint8 = new Uint8Array(arrayBuf);
    let binary = '';
    // Process in chunks to avoid call-stack limits with large images
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      const slice = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
      binary += String.fromCharCode(...slice);
    }
    const base64 = btoa(binary);
    const outputDataUrl = `data:${outputMime};base64,${base64}`;

    // ── 7. Compute placement dimensions ────────────────────────────────
    const maxPlacedWidth = CONTENT_WIDTH - 2; // 2pt for card border
    const { width: placedW, height: placedH } = fitDimensions(
      targetW, targetH, maxPlacedWidth, MAX_IMAGE_HEIGHT,
    );

    const dpi = effectiveDpi(targetW, placedW);

    return {
      dataUrl: outputDataUrl,
      widthPt: placedW,
      heightPt: placedH,
      byteSize,
      effectiveDpi: dpi,
    };
  } catch {
    budget.failed++;
    return null;
  }
}

/**
 * Create a fresh ImageBudget tracker.
 */
export function createImageBudget(): ImageBudget {
  return { totalBytes: 0, imageCount: 0, skipped: 0, failed: 0 };
}
