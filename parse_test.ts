import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

async function main() {
  const dataBuffer = fs.readFileSync("bible.pdf");
  const parser = new pdf.PDFParse({ data: dataBuffer });
  const result = await parser.getText();
  
  // Print some MLANGO lines and their surroundings
  const lines = result.text.split("\n");
  console.log(`Loaded ${lines.length} lines.`);
  
  // Find lines with MLANGO or book titles to see how they look
  let mlangoCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("MLANGO") || line.toUpperCase() === "ZABURI" || line.toUpperCase() === "YOHANA") {
      mlangoCount++;
      if (mlangoCount <= 12) {
        console.log(`\n--- Match ${mlangoCount} at line ${i} ---`);
        for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 10); j++) {
          const marker = j === i ? ">>> " : "    ";
          console.log(`${marker}${j}: "${lines[j]}"`);
        }
      }
    }
  }
}

main().catch(console.error);
