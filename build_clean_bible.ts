import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

interface BookMeta {
  id: number;
  testament_id: number;
  name: string;
  order_num: number;
  pdfKeys: string[];
}

const standardBooks: BookMeta[] = [
  { id: 1, testament_id: 1, name: "Mwanzo", order_num: 1, pdfKeys: ["MWANZO"] },
  { id: 2, testament_id: 1, name: "Kutoka", order_num: 2, pdfKeys: ["KUTOKA"] },
  { id: 3, testament_id: 1, name: "Mambo ya Walawi", order_num: 3, pdfKeys: ["WALAWI"] },
  { id: 4, testament_id: 1, name: "Hesabu", order_num: 4, pdfKeys: ["HESABU"] },
  { id: 5, testament_id: 1, name: "Kumbukumbu la Torati", order_num: 5, pdfKeys: ["KUMBU", "KUMBUKUMBU"] },
  { id: 6, testament_id: 1, name: "Yoshua", order_num: 6, pdfKeys: ["YOSHUA"] },
  { id: 7, testament_id: 1, name: "Waamuzi", order_num: 7, pdfKeys: ["WAAMUZI"] },
  { id: 8, testament_id: 1, name: "Ruthi", order_num: 8, pdfKeys: ["RUTHU", "RUTHI"] },
  { id: 9, testament_id: 1, name: "1 Samweli", order_num: 9, pdfKeys: ["1 SAMWELI"] },
  { id: 10, testament_id: 1, name: "2 Samweli", order_num: 10, pdfKeys: ["2 SAMWELI"] },
  { id: 11, testament_id: 1, name: "1 Wafalme", order_num: 11, pdfKeys: ["1 WAFALME"] },
  { id: 12, testament_id: 1, name: "2 Wafalme", order_num: 12, pdfKeys: ["2 WAFALME"] },
  { id: 13, testament_id: 1, name: "1 Mambo ya Nyakati", order_num: 13, pdfKeys: ["1 NYAKATI"] },
  { id: 14, testament_id: 1, name: "2 Mambo ya Nyakati", order_num: 14, pdfKeys: ["2 NYAKATI"] },
  { id: 15, testament_id: 1, name: "Ezra", order_num: 15, pdfKeys: ["EZRA"] },
  { id: 16, testament_id: 1, name: "Nehemia", order_num: 16, pdfKeys: ["NEHEMIA"] },
  { id: 17, testament_id: 1, name: "Esta", order_num: 17, pdfKeys: ["ESTA"] },
  { id: 18, testament_id: 1, name: "Ayubu", order_num: 18, pdfKeys: ["AYUBU"] },
  { id: 19, testament_id: 1, name: "Zaburi", order_num: 19, pdfKeys: ["ZABURI"] },
  { id: 20, testament_id: 1, name: "Mithali", order_num: 20, pdfKeys: ["MITHALI"] },
  { id: 21, testament_id: 1, name: "Mhubiri", order_num: 21, pdfKeys: ["MHUBIRI"] },
  { id: 22, testament_id: 1, name: "Wimbo ulio Bora", order_num: 22, pdfKeys: ["WIMBO"] },
  { id: 23, testament_id: 1, name: "Isaya", order_num: 23, pdfKeys: ["ISAYA"] },
  { id: 24, testament_id: 1, name: "Yeremia", order_num: 24, pdfKeys: ["YEREMIA"] },
  { id: 25, testament_id: 1, name: "Maombolezo", order_num: 25, pdfKeys: ["MAOMBOLEZO"] },
  { id: 26, testament_id: 1, name: "Ezekieli", order_num: 26, pdfKeys: ["EZEKIELI"] },
  { id: 27, testament_id: 1, name: "Danieli", order_num: 27, pdfKeys: ["DANIELI"] },
  { id: 28, testament_id: 1, name: "Hosea", order_num: 28, pdfKeys: ["HOSEA"] },
  { id: 29, testament_id: 1, name: "Yoeli", order_num: 29, pdfKeys: ["YOELI"] },
  { id: 30, testament_id: 1, name: "Amosi", order_num: 30, pdfKeys: ["AMOSI"] },
  { id: 31, testament_id: 1, name: "Obadia", order_num: 31, pdfKeys: ["OBADIA"] },
  { id: 32, testament_id: 1, name: "Yona", order_num: 32, pdfKeys: ["YONA"] },
  { id: 33, testament_id: 1, name: "Mika", order_num: 33, pdfKeys: ["MIKA"] },
  { id: 34, testament_id: 1, name: "Nahumu", order_num: 34, pdfKeys: ["NAHUMU"] },
  { id: 35, testament_id: 1, name: "Habakuki", order_num: 35, pdfKeys: ["HABAKUKI"] },
  { id: 36, testament_id: 1, name: "Sefania", order_num: 36, pdfKeys: ["SEFANIA"] },
  { id: 37, testament_id: 1, name: "Hagai", order_num: 37, pdfKeys: ["HAGAI"] },
  { id: 38, testament_id: 1, name: "Zekaria", order_num: 38, pdfKeys: ["ZEKARIA"] },
  { id: 39, testament_id: 1, name: "Malaki", order_num: 39, pdfKeys: ["MALAKI"] },
  { id: 40, testament_id: 2, name: "Mathayo", order_num: 40, pdfKeys: ["MATHAYO"] },
  { id: 41, testament_id: 2, name: "Marko", order_num: 41, pdfKeys: ["MARKO"] },
  { id: 42, testament_id: 2, name: "Luka", order_num: 42, pdfKeys: ["LUKA"] },
  { id: 43, testament_id: 2, name: "Yohana", order_num: 43, pdfKeys: ["YOHANA"] },
  { id: 44, testament_id: 2, name: "Matendo ya Mitume", order_num: 44, pdfKeys: ["MATENDO YA MITUME", "MATENDO"] },
  { id: 45, testament_id: 2, name: "Warumi", order_num: 45, pdfKeys: ["WARUMI"] },
  { id: 46, testament_id: 2, name: "1 Wakorintho", order_num: 46, pdfKeys: ["1 WAKORINTHO"] },
  { id: 47, testament_id: 2, name: "2 Wakorintho", order_num: 47, pdfKeys: ["2 WAKORINTHO"] },
  { id: 48, testament_id: 2, name: "Wagalatia", order_num: 48, pdfKeys: ["WAGALATIA"] },
  { id: 49, testament_id: 2, name: "Waefeso", order_num: 49, pdfKeys: ["WAEFESO"] },
  { id: 50, testament_id: 2, name: "Wafilipi", order_num: 50, pdfKeys: ["WAFILIPI"] },
  { id: 51, testament_id: 2, name: "Wakolosai", order_num: 51, pdfKeys: ["WAKOLOSAI"] },
  { id: 52, testament_id: 2, name: "1 Wathesalonike", order_num: 52, pdfKeys: ["1 WATHESALONIKE"] },
  { id: 53, testament_id: 2, name: "2 Wathesalonike", order_num: 53, pdfKeys: ["2 WATHESALONIKE"] },
  { id: 54, testament_id: 2, name: "1 Timotheo", order_num: 54, pdfKeys: ["1 TIMOTHEO"] },
  { id: 55, testament_id: 2, name: "2 Timotheo", order_num: 55, pdfKeys: ["2 TIMOTHEO"] },
  { id: 56, testament_id: 2, name: "Tito", order_num: 56, pdfKeys: ["TITO"] },
  { id: 57, testament_id: 2, name: "Filemoni", order_num: 57, pdfKeys: ["FILEMONI"] },
  { id: 58, testament_id: 2, name: "Waebrania", order_num: 58, pdfKeys: ["WAEBRANIA"] },
  { id: 59, testament_id: 2, name: "Yakobo", order_num: 59, pdfKeys: ["YAKOBO"] },
  { id: 60, testament_id: 2, name: "1 Petro", order_num: 60, pdfKeys: ["1 PETRO"] },
  { id: 61, testament_id: 2, name: "2 Petro", order_num: 61, pdfKeys: ["2 PETRO"] },
  { id: 62, testament_id: 2, name: "1 Yohana", order_num: 62, pdfKeys: ["1 YOHANA"] },
  { id: 63, testament_id: 2, name: "2 Yohana", order_num: 63, pdfKeys: ["2 YOHANA"] },
  { id: 64, testament_id: 2, name: "3 Yohana", order_num: 64, pdfKeys: ["3 YOHANA"] },
  { id: 65, testament_id: 2, name: "Yuda", order_num: 65, pdfKeys: ["YUDA"] },
  { id: 66, testament_id: 2, name: "Ufunuo wa Yohana", order_num: 66, pdfKeys: ["UFUNUO WA YOHANA", "UFUNUO"] }
];

// Helper mapping uppercase strings to Book ID
function findBookByPdfKey(key: string): BookMeta | null {
  const k = key.toUpperCase().trim();
  for (const book of standardBooks) {
    if (book.pdfKeys.includes(k) || book.name.toUpperCase() === k) {
      return book;
    }
  }
  return null;
}

interface ParsedVerse {
  book_id: number;
  chapter: number;
  verse: number;
  text: string;
}

async function run() {
  console.log("Reading bible.pdf into memory...");
  const dataBuffer = fs.readFileSync("bible.pdf");
  const parser = new pdf.PDFParse({ data: dataBuffer });
  const result = await parser.getText();
  const lines = result.text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  console.log("Lines loaded:", lines.length);

  let currentBook: BookMeta | null = null;
  let currentChapter = 0;
  let currentVerseNum = 0;
  let currentVerseText = "";
  const parsedVerses: ParsedVerse[] = [];

  const commitVerse = () => {
    if (currentBook && currentChapter > 0 && currentVerseNum > 0 && currentVerseText.trim().length > 0) {
      parsedVerses.push({
        book_id: currentBook.id,
        chapter: currentChapter,
        verse: currentVerseNum,
        text: currentVerseText.trim()
      });
    }
    currentVerseText = "";
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip page headers/footers or TOC triggers
    if (line.match(/^--\s*\d+\s+of\s+969\s*--$/)) continue; // Footer page marker
    if (line.match(/^\d+$/)) continue; // Page number alone
    if (line === "NEW TESTAMENT" || line.includes("FAHIRISI")) continue;

    // Transition book if we hit a line that is entirely a known uppercase Bible book name
    const bookCheck = findBookByPdfKey(line);
    if (bookCheck && line.toUpperCase() === line && isNaN(Number(line))) {
      commitVerse();
      currentBook = bookCheck;
      // If we transition to a book with only 1 chapter (like Obadia, Filemoni, 2 Yohana, etc.), we can pre-set chapter to 1
      if (bookCheck.id === 31 || bookCheck.id === 57 || bookCheck.id === 62 || bookCheck.id === 63 || bookCheck.id === 64) {
        currentChapter = 1;
      } else {
        currentChapter = 0;
      }
      currentVerseNum = 0;
      // console.log(`Active book transition: ${currentBook.name}`);
      continue;
    }

    // Check for chapter markers
    let matchedChapter: number | null = null;
    let matchedBook: BookMeta | null = null;

    // 1. Genesis Style ("MLANGO 1")
    const genMatch = line.match(/^MLANGO\s+(\d+)$/);
    if (genMatch) {
      matchedChapter = parseInt(genMatch[1]);
      // If book is not set yet, default to Mwanzo (book 1)
      if (!currentBook) {
        currentBook = findBookByPdfKey("MWANZO")!;
      }
    } 
    // 2. Other OT Style ("KUTOKA: MLANGO 1")
    else if (line.match(/^(.+?):\s*MLANGO\s+(\d+)$/)) {
      const parts = line.match(/^(.+?):\s*MLANGO\s+(\d+)$/)!;
      matchedBook = findBookByPdfKey(parts[1]);
      matchedChapter = parseInt(parts[2]);
    } 
    // 3. Psalms ("ZABURI 1")
    else if (line.match(/^ZABURI\s+(\d+)$/)) {
      const parts = line.match(/^ZABURI\s+(\d+)$/)!;
      matchedBook = findBookByPdfKey("ZABURI");
      matchedChapter = parseInt(parts[1]);
    } 
    // 4. NT Style ("Mathayo 1 : 1-25")
    else if (line.match(/^(.+?)\s+(\d+)\s*:\s*\d+-\d+$/)) {
      const parts = line.match(/^(.+?)\s+(\d+)\s*:\s*\d+-\d+$/)!;
      matchedBook = findBookByPdfKey(parts[1]);
      matchedChapter = parseInt(parts[2]);
    }

    if (matchedChapter !== null) {
      commitVerse();
      if (matchedBook) {
        currentBook = matchedBook;
      }
      currentChapter = matchedChapter;
      currentVerseNum = 0;
      // console.log(`Chapter active: ${currentBook?.name} ${currentChapter}`);
      continue;
    }

    // Now process verses within the current active book and chapter context
    if (!currentBook || currentChapter === 0) {
      continue; 
    }

    // Check for verse line indicators
    let isNewVerse = false;
    let verseNumber = 0;
    let remainingLineText = "";

    if (currentBook.testament_id === 1) {
      // Old Testament verse lines: start with a digit (e.g. "1Hapo mwanzo..." or "1 Hapo mwanzo...")
      const otMatch = line.match(/^(\d+)\s*(.*)/);
      if (otMatch) {
        const num = parseInt(otMatch[1]);
        // Simple sanity check: verse numbers must be reasonably sequential/small (up to 176 in Zaburi, in other books up to ~80)
        if (num > 0 && num <= 180) {
          isNewVerse = true;
          verseNumber = num;
          remainingLineText = otMatch[2];
        }
      }
    } else {
      // New Testament verse lines: start with Chapter.Verse (e.g. "1.1 Kitabu cha ukoo...")
      const ntMatch = line.match(/^(\d+)\.(\d+)\s*(.*)/);
      if (ntMatch) {
        const ch = parseInt(ntMatch[1]);
        const v = parseInt(ntMatch[2]);
        if (ch === currentChapter) {
          isNewVerse = true;
          verseNumber = v;
          remainingLineText = ntMatch[3];
        }
      }
    }

    if (isNewVerse) {
      commitVerse();
      currentVerseNum = verseNumber;
      currentVerseText = remainingLineText;
    } else {
      // Continuous verse text append
      if (currentVerseNum > 0) {
        currentVerseText += " " + line;
      }
    }
  }

  // Commit last verse
  commitVerse();

  console.log(`Successfully parsed ${parsedVerses.length} verses from PDF!`);

  // Write out stats
  const bibleStats: any = {};
  for (const v of parsedVerses) {
    if (!bibleStats[v.book_id]) bibleStats[v.book_id] = {};
    bibleStats[v.book_id][v.chapter] = (bibleStats[v.book_id][v.chapter] || 0) + 1;
  }
  const populatedBooksCount = Object.keys(bibleStats).length;
  console.log(`Populated ${populatedBooksCount} of 66 books.`);

  // Write new database using better-sqlite3!
  // The android copy only keeps an ALREADY generated native project in step.
  // It must never bring `android/` into existence: `npx cap add android`
  // aborts outright if that directory is present, and in a fresh checkout
  // `npm run build` runs before it. Creating the folder here turned a clean
  // build into "android platform already exists".
  const dbPaths = [
    "./public/bible.db",
    ...(fs.existsSync("./android") ? ["./android/app/src/main/assets/public/bible.db"] : [])
  ];

  for (const dbPath of dbPaths) {
    const parentDir = path.dirname(dbPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }

    console.log(`Creating SQLite database: ${dbPath}`);
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");

    // Create tables
    db.exec(`
      CREATE TABLE testaments (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE books (
        id INTEGER PRIMARY KEY,
        testament_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        order_num INTEGER NOT NULL,
        FOREIGN KEY(testament_id) REFERENCES testaments(id)
      );
      CREATE TABLE verses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        text TEXT NOT NULL,
        FOREIGN KEY(book_id) REFERENCES books(id)
      );
    `);

    // Insert testaments
    const insertTestament = db.prepare("INSERT INTO testaments (id, name) VALUES (?, ?)");
    insertTestament.run(1, "Agano la Kale");
    insertTestament.run(2, "Agano Jipya");

    // Insert books
    const insertBook = db.prepare("INSERT INTO books (id, testament_id, name, order_num) VALUES (?, ?, ?, ?)");
    const stmtInsertBook = db.transaction(() => {
      for (const b of standardBooks) {
        insertBook.run(b.id, b.testament_id, b.name, b.order_num);
      }
    });
    stmtInsertBook();

    // Insert verses
    const insertVerse = db.prepare("INSERT INTO verses (book_id, chapter, verse, text) VALUES (?, ?, ?, ?)");
    const stmtInsertVerses = db.transaction(() => {
      for (const v of parsedVerses) {
        insertVerse.run(v.book_id, v.chapter, v.verse, v.text);
      }
    });
    stmtInsertVerses();

    console.log(`Consolidating database from WAL mode back to standard single-file mode...`);
    db.pragma("journal_mode = DELETE");

    console.log(`Verifying database integrity...`);
    const integrity = db.prepare("PRAGMA integrity_check").get();
    console.log(`Database Integrity check:`, integrity);
    
    // Check record count
    const totalVersesInDb = (db.prepare("SELECT COUNT(*) as cnt FROM verses").get() as any).cnt;
    console.log(`Total verses inserted in ${dbPath}: ${totalVersesInDb}`);
    db.close();
  }

  console.log("Database reconstruction finished perfectly!");
}

run().catch(console.error);
