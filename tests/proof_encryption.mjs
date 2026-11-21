// tests/proof_encryption.mjs
// ─────────────────────────────────────────────────────────────────────────
// Phase B.8: Prove encryption on a 2-page PDF.
//
// 1. Build a minimal 2-page PDF (cover + one table) with pdfmake 0.3.14
// 2. Encrypt with userPassword="1234" + random ownerPassword
// 3. Verify /Encrypt entry in raw PDF bytes
// 4. Verify AES algorithm (/V and /R values)
// 5. Test with pdfjs-dist: no password → fail, wrong PIN → fail, correct → success
// 6. Control test: build unencrypted PDF, confirm readable; encrypted is not.
// ─────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// pdfmake is CJS — use require
const pdfmake = require('pdfmake');

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('  PASS:', msg);
}

// ── Setup pdfmake ────────────────────────────────────────────────────────

pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(() => true);

const fontDir = path.join(__dirname, '..', 'node_modules/pdfmake/build/fonts/Roboto');
pdfmake.addFonts({
  Roboto: {
    normal: fs.readFileSync(path.join(fontDir, 'Roboto-Regular.ttf')),
    bold: fs.readFileSync(path.join(fontDir, 'Roboto-Medium.ttf')),
    italics: fs.readFileSync(path.join(fontDir, 'Roboto-Italic.ttf')),
    bolditalics: fs.readFileSync(path.join(fontDir, 'Roboto-MediumItalic.ttf')),
  },
});

// ── Document definition (2 pages: cover + table) ─────────────────────────

function makeDocDef(options = {}) {
  return {
    pageSize: 'A4',
    pageMargins: [42, 64, 42, 56],
    defaultStyle: { font: 'Roboto', fontSize: 10 },
    content: [
      // Page 1: Cover
      { text: 'QuantContext Engine', fontSize: 30, bold: true, margin: [0, 100, 0, 10] },
      { text: 'Account Data Report', fontSize: 20, margin: [0, 0, 0, 20] },
      { text: 'PDF ID: QCP-20261117-093300-A1B2C3D4', fontSize: 10, margin: [0, 0, 0, 5] },
      { text: 'User ID: user_test_123', fontSize: 10, margin: [0, 0, 0, 5] },
      { text: 'Confidential — contains your complete trading data.', fontSize: 8, color: '#71717a' },
      { text: '', pageBreak: 'after' },

      // Page 2: Table
      { text: 'Audit Trail', fontSize: 20, bold: true, margin: [0, 0, 0, 10] },
      {
        table: {
          headerRows: 1,
          widths: ['*', '*', 'auto', 'auto'],
          body: [
            ['Date', 'Ticker', 'Sentiment', 'Confidence'],
            ['17 Nov 2026', 'AAPL', 'Bullish', '85/100'],
            ['16 Nov 2026', 'TSLA', 'Bearish', '72/100'],
            ['15 Nov 2026', 'NIFTY', 'Neutral', '65/100'],
            ['14 Nov 2026', 'RELIANCE', 'Bullish', '91/100'],
          ],
        },
      },
    ],
    info: {
      title: 'QuantContext Engine — Account Data Report',
      author: 'QuantContext Engine',
      subject: 'Report for user user_test_123',
      keywords: 'QCP-20261117-093300-A1B2C3D4',
      creator: 'QuantContext Engine',
      producer: 'QuantContext Engine (pdfmake)',
    },
    ...options,
  };
}

// ── Main test ────────────────────────────────────────────────────────────

const TEST_PIN = '1234';
const WRONG_PIN = '9999';
const OWNER_PASSWORD = crypto.randomBytes(32).toString('hex');

console.log('=== Phase B.8: Encryption Proof ===\n');
console.log('pdfmake version:', require('pdfmake/package.json').version);
console.log('pdfjs-dist version:', require('pdfjs-dist/package.json').version);
console.log('Owner password length:', OWNER_PASSWORD.length, 'chars');
console.log('');

// ── Step 1: Build encrypted PDF ──────────────────────────────────────

console.log('Step 1: Build encrypted PDF (version 1.7ext3, AES-256)...');
const encryptedDoc = pdfmake.createPdf(makeDocDef({
  version: '1.7ext3',
  userPassword: TEST_PIN,
  ownerPassword: OWNER_PASSWORD,
  permissions: {
    printing: 'highResolution',
    modifying: false,
    copying: true,
    annotating: false,
    fillingForms: false,
    contentAccessibility: true,
    documentAssembly: false,
  },
}));

const encryptedBuffer = await encryptedDoc.getBuffer();
const encryptedPath = path.join(__dirname, 'proof_encrypted.pdf');
fs.writeFileSync(encryptedPath, encryptedBuffer);
console.log('  Encrypted PDF written:', encryptedPath, '(' + encryptedBuffer.length + ' bytes)');

// ── Step 2: Build unencrypted control PDF ────────────────────────────

console.log('\nStep 2: Build unencrypted control PDF (compress: false)...');
const controlDoc = pdfmake.createPdf(makeDocDef({
  compress: false,
}));

const controlBuffer = await controlDoc.getBuffer();
const controlPath = path.join(__dirname, 'proof_unencrypted.pdf');
fs.writeFileSync(controlPath, controlBuffer);
console.log('  Control PDF written:', controlPath, '(' + controlBuffer.length + ' bytes)');

// ── Step 3: Raw byte checks ──────────────────────────────────────────

console.log('\nStep 3: Raw byte checks...');
const encryptedStr = encryptedBuffer.toString('latin1');
const controlStr = controlBuffer.toString('latin1');

// 3a. /Encrypt present in encrypted PDF
assert(encryptedStr.includes('/Encrypt'), '/Encrypt found in encrypted PDF trailer');

// 3b. /Encrypt NOT in control PDF
assert(!controlStr.includes('/Encrypt'), '/Encrypt NOT found in control PDF');

// 3c. Known text found in unencrypted raw bytes
assert(controlStr.includes('QuantContext'), 'QuantContext found in control PDF raw bytes');

// 3d. Content streams are encrypted — readable BT operators in control but not in encrypted
const controlOperators = (controlStr.match(/\bBT\b/g) || []).length;
const encryptedOperators = (encryptedStr.match(/\bBT\b/g) || []).length;
console.log('  Control BT operators:', controlOperators);
console.log('  Encrypted BT operators:', encryptedOperators);
assert(controlOperators > 0, 'Control PDF has BT operators (readable streams)');
assert(
  encryptedOperators < controlOperators,
  'Encrypted PDF has fewer readable BT operators (streams are encrypted)'
);

// ── Step 4: Check /V and /R values in encrypted PDF ──────────────────

console.log('\nStep 4: Check encryption algorithm in raw bytes...');

const vMatch = encryptedStr.match(/\/V\s+(\d+)/);
const rMatch = encryptedStr.match(/\/R\s+(\d+)/);

console.log('  /V =', vMatch ? vMatch[1] : 'NOT FOUND');
console.log('  /R =', rMatch ? rMatch[1] : 'NOT FOUND');

if (vMatch && rMatch) {
  const v = parseInt(vMatch[1]);
  const r = parseInt(rMatch[1]);
  assert(v === 5 || v === 4, `/V is ${v} (expected 5 for AES-256 or 4 for AES-128)`);
  assert(r === 5 || r === 6 || r === 4, `/R is ${r} (expected 5 or 6 for AES-256, or 4 for AES-128)`);
  if (v === 5 && (r === 5 || r === 6)) {
    console.log(`  Algorithm: AES-256 (version 1.7ext3, /V=${v} /R=${r}) ✓`);
  } else if (v === 4 && r === 4) {
    console.log('  Algorithm: AES-128 (version 1.7) ✓');
  }
} else {
  console.error('FAIL: Could not find /V and /R in encrypted PDF');
  process.exit(1);
}

// ── Step 5: pdfjs-dist tests ─────────────────────────────────────────

console.log('\nStep 5: pdfjs-dist password tests...');

const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

// 5a. No password → PasswordRequired error
console.log('  5a. Opening without password...');
try {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(encryptedBuffer) }).promise;
  console.error('FAIL: PDF opened without password!');
  process.exit(1);
} catch (err) {
  assert(
    err.name === 'PasswordException' || err.message.includes('password') || err.message.includes('Password'),
    'No password → PasswordException (' + (err.name || err.message) + ')'
  );
}

// 5b. Wrong password → error
console.log('  5b. Opening with wrong password...');
try {
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(encryptedBuffer),
    password: WRONG_PIN,
  }).promise;
  console.error('FAIL: PDF opened with wrong password!');
  process.exit(1);
} catch (err) {
  assert(
    err.name === 'PasswordException' || err.message.includes('password') || err.message.includes('Password'),
    'Wrong password → PasswordException (' + (err.name || err.message) + ')'
  );
}

// 5c. Correct password → success
console.log('  5c. Opening with correct password...');
try {
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(encryptedBuffer),
    password: TEST_PIN,
  }).promise;
  assert(doc.numPages === 2, 'Correct password → opens successfully (' + doc.numPages + ' pages)');

  // Extract text from page 1 to verify content
  const page1 = await doc.getPage(1);
  const textContent = await page1.getTextContent();
  const page1Text = textContent.items.map(item => item.str).join(' ');
  assert(page1Text.includes('QuantContext'), 'Page 1 contains "QuantContext"');

  // Check metadata
  const metadata = await doc.getMetadata();
  if (metadata.info) {
    console.log('  Metadata title:', metadata.info.Title);
    assert(
      metadata.info.Title === 'QuantContext Engine \u2014 Account Data Report',
      'Metadata title matches'
    );
  }

  doc.destroy();
} catch (err) {
  console.error('FAIL: Could not open with correct password:', err.message);
  process.exit(1);
}

// ── Summary ──────────────────────────────────────────────────────────

console.log('\n=== ALL ENCRYPTION TESTS PASSED ===');
console.log('Encrypted PDF:', encryptedPath);
console.log('Control PDF:', controlPath);

// Clean up
fs.unlinkSync(controlPath);
console.log('Control PDF deleted (not needed).');
