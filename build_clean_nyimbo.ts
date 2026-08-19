// Builds public/nyimbo.db from nyimbo-source.json.
//
// The previous builder parsed Nyimbo-Za-Kristo-Kk.txt, an OCR of the printed
// hymnal. That text carried word-level corruption ("Huongoza" for "yu Mwongozi"
// in 20, "la watakatifu" for "La mababa yetu" in 65), merged stanza lines into
// run-ons, and silently swallowed hymns 26a and 131a because its header pattern
// only matched a bare number. The OCR is kept in _archive/ for reference only.
//
// nyimbo-source.json is now the source of truth and is meant to be hand-edited:
// fix a word there and re-run this script. See docs/nyimbo-review.md for the
// places the two sources disagree.
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

interface SourceStanza { is_chorus: number; stanza_number: string | null; content: string; }
interface SourceSong {
  number: number;
  title: string;
  alt_title: string | null;
  english_title: string | null;
  english_ref: string | null;   // SDAH./C.S. cross-reference
  doh: string | null;           // musical key
  stanzas: SourceStanza[];
}

function run() {
  const srcPath = "nyimbo-source.json";
  console.log(`Reading ${srcPath}...`);
  const { songs } = JSON.parse(fs.readFileSync(srcPath, "utf8")) as { songs: SourceSong[] };

  if (!songs?.length) throw new Error(`${srcPath} contains no songs`);
  const empty = songs.filter(s => !s.stanzas?.length);
  if (empty.length) throw new Error(`hymns with no stanzas: ${empty.map(s => s.number).join(", ")}`);
  const seen = new Set<number>();
  for (const s of songs) {
    if (seen.has(s.number)) throw new Error(`duplicate hymn number ${s.number}`);
    seen.add(s.number);
  }
  console.log(`Loaded ${songs.length} hymns, ${songs.reduce((a, s) => a + s.stanzas.length, 0)} stanzas.`);

  // Only mirrors into an ALREADY generated native project — see the same note
  // in build_clean_bible.ts. Creating `android/` here breaks `cap add android`.
  const dbPaths = [
    "./public/nyimbo.db",
    ...(fs.existsSync("./android") ? ["./android/app/src/main/assets/public/nyimbo.db"] : []),
  ];

  for (const dbPath of dbPaths) {
    const parentDir = path.dirname(dbPath);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    console.log(`Creating SQLite database: ${dbPath}`);
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");

    db.exec(`
      CREATE TABLE songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT NOT NULL,
        title TEXT NOT NULL,
        alt_title TEXT,
        english_ref TEXT,
        english_title TEXT,
        doh TEXT
      );
      CREATE TABLE stanzas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id INTEGER NOT NULL,
        is_chorus INTEGER NOT NULL,
        stanza_number TEXT,
        order_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY(song_id) REFERENCES songs(id)
      );
      CREATE INDEX idx_stanzas_song ON stanzas(song_id, order_index);
    `);

    const insertSong = db.prepare(
      `INSERT INTO songs (number, title, alt_title, english_ref, english_title, doh)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const insertStanza = db.prepare(
      `INSERT INTO stanzas (song_id, is_chorus, stanza_number, order_index, content)
       VALUES (?, ?, ?, ?, ?)`
    );

    db.transaction(() => {
      for (const song of [...songs].sort((a, b) => a.number - b.number)) {
        const { lastInsertRowid } = insertSong.run(
          String(song.number), song.title, song.alt_title,
          song.english_ref, song.english_title, song.doh
        );
        let orderIndex = 1;
        for (const st of song.stanzas)
          insertStanza.run(lastInsertRowid, st.is_chorus, st.stanza_number, orderIndex++, st.content);
      }
    })();

    console.log("Consolidating database from WAL mode back to standard single-file mode...");
    db.pragma("journal_mode = DELETE");
    console.log("Integrity:", db.prepare("PRAGMA integrity_check").get());
    console.log(`  songs   ${(db.prepare("SELECT COUNT(*) c FROM songs").get() as any).c}`);
    console.log(`  stanzas ${(db.prepare("SELECT COUNT(*) c FROM stanzas").get() as any).c}`);
    db.close();
  }

  // src/lib/db.ts fetches nyimbo.db with a hardcoded byte size (for the progress
  // bar) and a ?v= cache-buster. Both go stale the moment the hymnal is edited,
  // and a stale ?v= means users keep reading the OLD text. Fail loudly instead.
  const size = fs.statSync("./public/nyimbo.db").size;
  const dbTs = fs.readFileSync("./src/lib/db.ts", "utf8");
  const declared = dbTs.match(/fetchWithProgress\("\.\/nyimbo\.db\?v=(\d+)",\s*(\d+)/);
  if (!declared) {
    console.warn("WARNING: could not find the nyimbo.db fetch in src/lib/db.ts to verify its size.");
  } else if (Number(declared[2]) !== size) {
    const nextV = Number(declared[1]) + 1;
    console.error(
      [
        "",
        `ERROR: src/lib/db.ts expects nyimbo.db to be ${declared[2]} bytes, but it is now ${size}.`,
        `       Set that number to ${size} AND bump ?v=${declared[1]} to ?v=${nextV} in src/lib/db.ts,`,
        "       otherwise browsers and installed apps keep serving the old hymnal from cache.",
        "",
      ].join("\n")
    );
    process.exit(1);
  }


  console.log("Hymnal database build finished.");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exit(1);
}
