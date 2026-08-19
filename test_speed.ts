import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

async function testSpeed() {
  const dataBuffer = fs.readFileSync('bible.pdf');
  console.log('PDF file read successfully. Starting parser...');
  const start = Date.now();
  try {
    const parser = new pdf.PDFParse({ data: dataBuffer });
    const textResult = await parser.getText({
      first: 100 // parse first 100 pages
    });
    const duration = Date.now() - start;
    console.log(`Parsed ${textResult.pages.length} pages in ${duration}ms (${(duration / 100).toFixed(1)}ms per page).`);
    console.log(`Extracted text length: ${textResult.text.length} chars.`);
    await parser.destroy();
  } catch (error: any) {
    console.error('Error parsing PDF:', error);
  }
}

testSpeed();
