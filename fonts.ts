// src/pdf/fonts.ts
// ─────────────────────────────────────────────────────────────────────────
// Lazy font loader for the PDF report.
// Section 12.1–12.4 of the prompt.
//
// Primary font: Roboto (bundled with pdfmake, covers ₹, –—…''""•→←≥≤≠±×÷%°)
// Devanagari font: Noto Sans Devanagari (loaded ONLY if data contains Devanagari)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Font family name used throughout the PDF.
 * Must match the key registered with pdfmake.addFonts().
 */
export const FONT_FAMILY = 'Roboto';

/**
 * Devanagari font family name.
 * Used for text runs identified as Devanagari by the sanitizer.
 */
export const FONT_FAMILY_DEVANAGARI = 'NotoSansDevanagari';

/** Tracks whether fonts have been registered. */
let fontsRegistered = false;
let devanagariFontsRegistered = false;

/**
 * Lazily load and register the primary Roboto fonts with pdfmake.
 * Uses pdfmake's bundled Roboto TTF files.
 *
 * In the browser: dynamically imports pdfmake and uses the bundled font paths
 * through pdfmake's VFS. In Node (tests): reads from disk.
 *
 * @param pdfmakeInstance The pdfmake module instance (passed to avoid circular deps)
 */
export async function registerPrimaryFonts(pdfmakeInstance: any): Promise<void> {
  if (fontsRegistered) return;

  // In browser context, we use the VFS approach with the bundled font JS file.
  // In Node context (tests), we read the TTF files directly.
  const isNode = typeof process !== 'undefined' && process.versions?.node;

  if (isNode) {
    // Node.js: read TTF buffers from disk
    const fs = await import('fs');
    const path = await import('path');

    // pdfmake ships fonts in node_modules/pdfmake/build/fonts/Roboto/
    const fontDir = path.resolve('node_modules/pdfmake/build/fonts/Roboto');

    pdfmakeInstance.addFonts({
      [FONT_FAMILY]: {
        normal: fs.readFileSync(path.join(fontDir, 'Roboto-Regular.ttf')),
        bold: fs.readFileSync(path.join(fontDir, 'Roboto-Medium.ttf')),
        italics: fs.readFileSync(path.join(fontDir, 'Roboto-Italic.ttf')),
        bolditalics: fs.readFileSync(path.join(fontDir, 'Roboto-MediumItalic.ttf')),
      },
    });
  } else {
    // Browser / Web Worker: use pdfmake's bundled VFS fonts.
    //
    // vfs_fonts.js auto-registers fonts via `globalThis.pdfMake.addVirtualFileSystem`
    // during module evaluation.  We must set the global reference BEFORE importing
    // vfs_fonts.js so that auto-registration finds the pdfmake instance.
    // (In a Worker, pdfmake is loaded lazily into a local variable — it's NOT on
    // the global scope unless we put it there.)
    (globalThis as any).pdfMake = pdfmakeInstance;

    await import('pdfmake/build/vfs_fonts.js');

    // Verify auto-registration worked
    if (pdfmakeInstance.sharedVirtualfs &&
        !pdfmakeInstance.sharedVirtualfs.existsSync('Roboto-Regular.ttf')) {
      // Fallback: auto-registration didn't fire (Vite dev wrapping may prevent it).
      // Manually extract VFS data and write to sharedVirtualfs.
      const vfsModule = await import('pdfmake/build/vfs_fonts.js');
      const vfs: Record<string, string> =
        vfsModule.default?.pdfMake?.vfs ||
        vfsModule.pdfMake?.vfs ||
        vfsModule.default ||
        vfsModule;
      for (const [filename, data] of Object.entries(vfs)) {
        if (typeof data === 'string' && filename.endsWith('.ttf')) {
          pdfmakeInstance.sharedVirtualfs.writeFileSync(filename, data);
        }
      }
    }

    pdfmakeInstance.addFonts({
      [FONT_FAMILY]: {
        normal: 'Roboto-Regular.ttf',
        bold: 'Roboto-Medium.ttf',
        italics: 'Roboto-Italic.ttf',
        bolditalics: 'Roboto-MediumItalic.ttf',
      },
    });
  }

  fontsRegistered = true;
}

/**
 * Lazily load and register Noto Sans Devanagari fonts.
 * Called ONLY if data contains Devanagari text.
 *
 * The font files must be placed in public/fonts/ and served from the app origin.
 * In Node tests, they should be in tests/fonts/.
 *
 * @param pdfmakeInstance The pdfmake module instance
 */
export async function registerDevanagariFonts(pdfmakeInstance: any): Promise<void> {
  if (devanagariFontsRegistered) return;

  const isNode = typeof process !== 'undefined' && process.versions?.node;

  if (isNode) {
    const fs = await import('fs');
    const path = await import('path');
    const fontDir = path.resolve('public/fonts');

    // Check if font files exist
    const regularPath = path.join(fontDir, 'NotoSansDevanagari-Regular.ttf');
    if (!fs.existsSync(regularPath)) {
      throw new Error(
        `Devanagari font not found at ${regularPath}. ` +
        `Place Noto Sans Devanagari TTF files in public/fonts/.`
      );
    }

    pdfmakeInstance.addFonts({
      [FONT_FAMILY_DEVANAGARI]: {
        normal: fs.readFileSync(regularPath),
        bold: fs.readFileSync(path.join(fontDir, 'NotoSansDevanagari-Bold.ttf')),
        // Devanagari typically has no italic; use regular as fallback
        italics: fs.readFileSync(regularPath),
        bolditalics: fs.readFileSync(path.join(fontDir, 'NotoSansDevanagari-Bold.ttf')),
      },
    });
  } else {
    // Browser: fetch from origin-relative path
    const fontPaths = [
      { key: 'normal', url: '/fonts/NotoSansDevanagari-Regular.ttf' },
      { key: 'bold', url: '/fonts/NotoSansDevanagari-Bold.ttf' },
    ];

    const fontBuffers: Record<string, ArrayBuffer> = {};
    for (const { key, url } of fontPaths) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Failed to load Devanagari font from ${url}: ${response.status} ${response.statusText}`
        );
      }
      fontBuffers[key] = await response.arrayBuffer();
    }

    pdfmakeInstance.addFonts({
      [FONT_FAMILY_DEVANAGARI]: {
        normal: fontBuffers.normal,
        bold: fontBuffers.bold,
        italics: fontBuffers.normal,
        bolditalics: fontBuffers.bold,
      },
    });
  }

  devanagariFontsRegistered = true;
}

/**
 * Reset registration state (for testing).
 */
export function _resetFontRegistration(): void {
  fontsRegistered = false;
  devanagariFontsRegistered = false;
}

/**
 * Get the font version info for the appendix.
 */
export function getFontInfo(): { primary: string; devanagari: string | null } {
  return {
    primary: `${FONT_FAMILY} (bundled with pdfmake, TTF)`,
    devanagari: devanagariFontsRegistered
      ? `${FONT_FAMILY_DEVANAGARI} (Noto Sans Devanagari, SIL OFL, TTF)`
      : null,
  };
}
