// @ts-ignore
import initSqlJs from "sql.js/dist/sql-asm.js";
import { Database } from "sql.js";
import { Testament, Book, Verse, Song, SongStanza } from "../types";
import { SEARCH_LIMIT, SEARCH_PER_BOOK, SEARCH_FETCH_CEILING, searchTerms, escapeLike,
         parseReference, matchBook } from "./search";
import type { ScriptureSearch } from "./search";

let bibleDbInstance: Database | null = null;
let nyimboDbInstance: Database | null = null;

export interface DBProgress {
  status: "idle" | "loading" | "ready" | "error";
  percent: number;
  message: string;
}

type ProgressCallback = (progress: DBProgress) => void;
const progressCallbacks: Set<ProgressCallback> = new Set();
let currentProgress: DBProgress = { status: "idle", percent: 0, message: "" };

const updateProgress = (progress: Partial<DBProgress>) => {
  currentProgress = { ...currentProgress, ...progress };
  progressCallbacks.forEach((cb) => cb(currentProgress));
};

export const subscribeToDBProgress = (cb: ProgressCallback) => {
  progressCallbacks.add(cb);
  cb(currentProgress);
  return () => {
    progressCallbacks.delete(cb);
  };
};

export const getDBProgress = () => currentProgress;

// Helper to fetch resource with progress, falling back to estimated sizes if content-length is unavailable
async function fetchWithProgress(
  url: string,
  estimatedSize: number,
  onProgress: (loaded: number, total: number) => void
): Promise<ArrayBuffer> {
  const isNative = !!(window as any).Capacitor ||
                   window.navigator.userAgent.includes("Capacitor") ||
                   window.location.href.startsWith("file:") ||
                   window.location.href.startsWith("capacitor:") ||
                   (window.location.hostname === "localhost" && !window.location.port);

  // Use simple non-streaming fetch on native/Capacitor devices to avoid WebView stream freezes
  if (isNative) {
    onProgress(0, estimatedSize);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: Status ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    onProgress(buffer.byteLength, buffer.byteLength);
    return buffer;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: Status ${response.status}`);
  }

  const contentLength = response.headers.get("content-length");
  let total = contentLength ? parseInt(contentLength, 10) : estimatedSize;
  if (!total || isNaN(total)) {
    total = estimatedSize;
  }

  if (!response.body) {
    // Fallback if reader stream is missing
    const buffer = await response.arrayBuffer();
    onProgress(buffer.byteLength, buffer.byteLength);
    return buffer;
  }

  const reader = response.body.getReader();
  let loaded = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded, Math.max(total, loaded));
    }
  }

  const buffer = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  return buffer.buffer;
}

// Start loading the files immediately in the background upon module import for absolute maximum speed!
const initPromise = (async () => {
  try {
    updateProgress({ status: "loading", percent: 5, message: "Inapakia mfumo wa SQLite..." });

    // Initialize SQL.js compiler using the 100% pure-JavaScript ASM.js SQLite engine (no WebAssembly required!)
    const SQL = await initSqlJs();

    updateProgress({ status: "loading", percent: 15, message: "Inapakia hifadhi ya Swahili Bible..." });

    // bible.db size is 4427776 bytes
    const bibleBuffer = await fetchWithProgress("./bible.db?v=3", 4427776, (loaded, total) => {
      const pct = Math.floor((loaded / total) * 45) + 15; // scales 15% to 60%
      const mbLoaded = (loaded / (1024 * 1024)).toFixed(1);
      const mbTotal = (total / (1024 * 1024)).toFixed(1);
      updateProgress({ 
        percent: pct, 
        message: `Kupakua Biblia: ${mbLoaded}MB ya ${mbTotal}MB (${Math.min(100, Math.floor((loaded/total)*100))}%)` 
      });
    });

    updateProgress({ status: "loading", percent: 62, message: "Biblia imekamilika! Inapakia Nyimbo..." });

    // nyimbo.db size is 155648 bytes (bump ?v= and this number whenever the hymnal is rebuilt)
    const nyimboBuffer = await fetchWithProgress("./nyimbo.db?v=4", 155648, (loaded, total) => {
      const pct = Math.floor((loaded / total) * 28) + 62; // scales 62% to 90%
      const mbLoaded = (loaded / (1024 * 1024)).toFixed(2);
      const mbTotal = (total / (1024 * 1024)).toFixed(2);
      updateProgress({ 
        percent: pct, 
        message: `Kupakua Nyimbo: ${mbLoaded}MB ya ${mbTotal}MB (${Math.min(100, Math.floor((loaded/total)*100))}%)` 
      });
    });

    updateProgress({ status: "loading", percent: 92, message: "Inafungua kanzidata kwenye kumbukumbu..." });

    // Validation handler to verify that the buffers loaded are indeed valid SQLite files and not HTML/Text fallbacks
    const verifySqliteBuffer = (buffer: ArrayBuffer, name: string) => {
      const uint8 = new Uint8Array(buffer);
      const signature = "SQLite format 3";
      let headerText = "";
      for (let i = 0; i < signature.length; i++) {
        headerText += String.fromCharCode(uint8[i] || 0);
      }
      if (headerText !== signature) {
        let textSample = "";
        for (let i = 0; i < Math.min(120, uint8.length); i++) {
          const char = uint8[i];
          if (char >= 32 && char <= 126) {
            textSample += String.fromCharCode(char);
          } else if (char === 10 || char === 13) {
            textSample += " ";
          } else {
            textSample += ".";
          }
        }
        throw new Error(`Faili la ${name} si la aina ya SQLite ya kweli. Linaanza na: "${textSample}".`);
      }
    };

    verifySqliteBuffer(bibleBuffer, "Biblia");
    verifySqliteBuffer(nyimboBuffer, "Nyimbo");

    bibleDbInstance = new SQL.Database(new Uint8Array(bibleBuffer));
    nyimboDbInstance = new SQL.Database(new Uint8Array(nyimboBuffer));

    updateProgress({ status: "ready", percent: 100, message: "Kila kitu kiko tayari!" });
  } catch (error: any) {
    console.error("Database initialization failed:", error);
    updateProgress({ status: "error", percent: 0, message: `Hitilafu ya kupakia: ${error.message}` });
  }
})();

// Initialize Databases simply awaits our automatic background loader
export async function initializeDatabases(): Promise<void> {
  await initPromise;
  if (!bibleDbInstance || !nyimboDbInstance) {
    throw new Error("Kanzidata haikuweza kufunguliwa kikamilifu.");
  }
}

// Helper: Query Bible DB
function queryBible(sql: string, params: any[] = []): any[] {
  if (!bibleDbInstance) {
    throw new Error("Database la Biblia halijapakiwa bado.");
  }
  const stmt = bibleDbInstance.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper: Query Nyimbo DB
function queryNyimbo(sql: string, params: any[] = []): any[] {
  if (!nyimboDbInstance) {
    throw new Error("Database la Nyimbo halijapakiwa bado.");
  }
  const stmt = nyimboDbInstance.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper to check day of the year
function getDayOfYear(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime() + (start.getTimezoneOffset() - now.getTimezoneOffset()) * 60000;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

// ================= OFFLINE LOGIC SERVICES =================

export const dbService = {
  getTestaments(): Testament[] {
    return queryBible("SELECT * FROM testaments ORDER BY id") as Testament[];
  },

  getBooks(): Book[] {
    return queryBible(`
      SELECT b.id, b.testament_id, b.name, b.order_num, COUNT(DISTINCT v.chapter) as chapter_count 
      FROM books b
      LEFT JOIN verses v ON v.book_id = b.id
      GROUP BY b.id
      ORDER BY b.order_num
    `) as Book[];
  },

  getVerses(bookId: number, chapter: number): Verse[] {
    return queryBible(
      "SELECT id, book_id, chapter, verse, text FROM verses WHERE book_id = ? AND chapter = ? ORDER BY verse",
      [bookId, chapter]
    ) as Verse[];
  },

  /**
   * Searches the whole Bible, ranked.
   *
   * The old version was `LIMIT 150` with no ORDER BY. SQLite returns rows in
   * rowid order — canonical Bible order — so the cap always truncated inside
   * Genesis/Exodus: "basi" matches 2,824 verses across 59 books, yet only Mwanzo
   * and Kutoka were ever shown and Yakobo 4:7 sat at match #2,803.
   *
   * Ordering:
   *   tier 1 — verses that BEGIN with the query
   *   tier 2 — every other verse containing it
   * canonical book order inside each tier.
   *
   * When there are more matches than we will render, results are capped per
   * book so the list still spans the whole Bible instead of drowning in
   * Genesis. Ordering is untouched; only the surplus is dropped.
   */
  searchScriptures(queryString: string, limit: number = SEARCH_LIMIT): ScriptureSearch {
    const terms = searchTerms(queryString);
    if (terms.length === 0) return { results: [], total: 0, books: 0, truncated: false };

    const whereClauses = terms.map(() => "v.text LIKE ? ESCAPE '\\'").join(" AND ");
    const params: (string | number)[] = [escapeLike(queryString.trim().toLowerCase()) + "%"];
    for (const t of terms) params.push(`%${escapeLike(t)}%`);
    params.push(SEARCH_FETCH_CEILING);

    const rows = queryBible(
      `SELECT v.id, v.chapter, v.verse, v.text,
              b.name as book_name, b.id as book_id, t.name as testament_name,
              CASE WHEN lower(ltrim(v.text)) LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END AS tier
         FROM verses v
         JOIN books b ON v.book_id = b.id
         JOIN testaments t ON b.testament_id = t.id
        WHERE ${whereClauses}
        ORDER BY tier, b.id, v.chapter, v.verse
        LIMIT ?`,
      params
    ) as (Verse & { tier: number })[];

    const total = rows.length;
    const books = new Set(rows.map((r) => r.book_id)).size;

    if (total <= limit) {
      return { results: rows as Verse[], total, books, truncated: false };
    }

    // Too many to show. Keep the tier order but take only the first few from
    // each book, so every book that matched is still represented.
    const results: Verse[] = [];
    for (const tier of [0, 1]) {
      const perBook = new Map<number, number>();
      for (const r of rows) {
        if (r.tier !== tier) continue;
        const n = perBook.get(r.book_id) || 0;
        if (n >= SEARCH_PER_BOOK) continue;
        perBook.set(r.book_id, n + 1);
        results.push(r as Verse);
        if (results.length >= limit) return { results, total, books, truncated: true };
      }
    }
    return { results, total, books, truncated: true };
  },

  /** Resolves a reference like "Yakobo 4:7" to the verse it names. */
  lookupReference(queryString: string): Verse | null {
    const ref = parseReference(queryString);
    if (!ref) return null;

    const books = queryBible("SELECT id, name FROM books") as { id: number; name: string }[];
    const book = matchBook(books, ref.bookQuery);
    if (!book) return null;

    const rows = queryBible(
      `SELECT v.id, v.chapter, v.verse, v.text,
              b.name as book_name, b.id as book_id, t.name as testament_name
         FROM verses v
         JOIN books b ON v.book_id = b.id
         JOIN testaments t ON b.testament_id = t.id
        WHERE v.book_id = ? AND v.chapter = ? AND v.verse = ?
        LIMIT 1`,
      [book.id, ref.chapter, ref.verse ?? 1]
    );
    return (rows[0] as Verse) || null;
  },

  getDailyVerse(): Verse | null {
    try {
      const countRes = queryBible("SELECT COUNT(*) as total FROM verses");
      const total = (countRes[0] as any)?.total || 31102;

      const dayIdx = getDayOfYear();
      const seedVal = (new Date().getFullYear() * 137 + dayIdx * 541) % total;
      const offset = seedVal > 0 ? seedVal : 1;

      const results = queryBible(`
        SELECT v.id, v.chapter, v.verse, v.text, b.name as book_name, b.id as book_id, t.name as testament_name
        FROM verses v
        JOIN books b ON v.book_id = b.id
        JOIN testaments t ON b.testament_id = t.id
        LIMIT 1 OFFSET ?
      `, [offset]);

      return (results[0] as Verse) || null;
    } catch (err) {
      console.error("Failed to query daily verse client-side", err);
      return null;
    }
  },

  // --- Nyimbo za Kristo (Hymnal) Services ---

  getSongs(): Song[] {
    return queryNyimbo(`
      SELECT id, number, title, alt_title, english_ref, english_title, doh 
      FROM songs 
      ORDER BY cast(number as integer), number
    `) as Song[];
  },

  searchSongs(queryString: string): Song[] {
    const q = queryString.trim();
    if (!q) return [];

    const matchParam = `%${q}%`;
    return queryNyimbo(`
      SELECT DISTINCT s.id, s.number, s.title, s.alt_title, s.english_ref, s.english_title, s.doh 
      FROM songs s
      LEFT JOIN stanzas st ON st.song_id = s.id
      WHERE s.number LIKE ? 
         OR s.title LIKE ? 
         OR s.alt_title LIKE ? 
         OR s.english_title LIKE ? 
         OR st.content LIKE ?
      ORDER BY cast(s.number as integer), s.number
      LIMIT 50
    `, [matchParam, matchParam, matchParam, matchParam, matchParam]) as Song[];
  },

  getSongDetail(songId: number): Song | null {
    const songList = queryNyimbo(
      "SELECT id, number, title, alt_title, english_ref, english_title, doh FROM songs WHERE id = ?",
      [songId]
    );

    if (songList.length === 0) return null;

    const song = songList[0] as Song;
    const stanzas = queryNyimbo(
      "SELECT id, is_chorus, stanza_number, order_index, content FROM stanzas WHERE song_id = ? ORDER BY order_index",
      [songId]
    ) as any[];

    return {
      ...song,
      stanzas: stanzas.map((st) => ({
        ...st,
        is_chorus: !!st.is_chorus,
      })),
    };
  }
};
