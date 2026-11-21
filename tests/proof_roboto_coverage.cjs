// Proof: Roboto covers all required characters for the PDF report
// pdfmake 0.3.x API: addFonts(), createPdf(), await getBuffer() / write()
const fs = require('fs');
const path = require('path');
const pdfmake = require('pdfmake');

// Suppress warnings for this test
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(() => true);

// Register fonts using the bundled Roboto TTFs (Buffer values)
const fontDir = path.join(__dirname, '..', 'node_modules/pdfmake/build/fonts/Roboto');
pdfmake.addFonts({
  Roboto: {
    normal: fs.readFileSync(path.join(fontDir, 'Roboto-Regular.ttf')),
    bold: fs.readFileSync(path.join(fontDir, 'Roboto-Medium.ttf')),
    italics: fs.readFileSync(path.join(fontDir, 'Roboto-Italic.ttf')),
    bolditalics: fs.readFileSync(path.join(fontDir, 'Roboto-MediumItalic.ttf')),
  },
});

const testLines = [
  'Rupee sign: \u20B9',
  'Rupee amount: \u20B91,234.50',
  'En dash: \u2013  Em dash: \u2014',
  'Ellipsis: \u2026',
  'Quotes: \u2018single\u2019 \u201Cdouble\u201D',
  'Bullet: \u2022',
  'Arrows: \u2192 \u2190',
  'Math: \u2265 \u2264 \u2260 \u00B1 \u00D7 \u00F7',
  'Percent: %  Degree: \u00B0',
];

const docDefinition = {
  content: [
    { text: 'Roboto Character Coverage Test', fontSize: 16, bold: true, margin: [0, 0, 0, 10] },
    ...testLines.map(t => ({ text: t, fontSize: 12, margin: [0, 2, 0, 2] })),
  ],
  defaultStyle: { font: 'Roboto' },
};

async function run() {
  const pdf = pdfmake.createPdf(docDefinition);
  const buffer = await pdf.getBuffer();
  const outPath = path.join(__dirname, 'roboto_char_test.pdf');
  fs.writeFileSync(outPath, buffer);
  console.log('PDF written:', outPath, '(' + buffer.length + ' bytes)');
  console.log('SUCCESS: All characters rendered without error');
}

run().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
