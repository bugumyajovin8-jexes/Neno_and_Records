import express from "express";
import path from "path";
import fs from "fs";
import initSqlJs from "sql.js";
import { createServer as createViteServer } from "vite";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import cors from "cors";
import { normalizeContributions, summarizeContributions } from "./src/lib/contributions";

const app = express();
app.use(cors());
app.use(express.json());

/* -------------------------------------------------------------------------- */
/* Supabase helpers                                                            */
/* -------------------------------------------------------------------------- */

const getSupabaseEnv = () => ({
  url: process.env.SUPABASE_URL || "",
  anonKey: process.env.SUPABASE_ANON_KEY || "",
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
});

/**
 * Privileged client. Only for operations that legitimately act on behalf of the
 * system (sign-up, sign-in, verifying a bearer token). Never use it to read or
 * write member records on behalf of a request — it bypasses row-level security.
 */
const getAdminClient = (): SupabaseClient | null => {
  const { url, anonKey, serviceKey } = getSupabaseEnv();
  const key = serviceKey || anonKey;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
};

/**
 * Client scoped to one member's access token. Every query it makes runs as that
 * user, so row-level security applies exactly as it would in the browser.
 *
 * Deliberately requires the anon key. Pairing a service-role key with a user's
 * bearer token gives inconsistent results across PostgREST versions and can end
 * up bypassing RLS entirely — the one thing this client exists to preserve.
 */
const getUserClient = (accessToken: string): SupabaseClient | null => {
  const { url, anonKey } = getSupabaseEnv();
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
};

const bearerFrom = (req: express.Request): string => {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : "";
};

interface AuthedRequest extends express.Request {
  member?: { id: string; email: string | null; phone: string | null; client: SupabaseClient };
}

/**
 * Authenticates /api/member/* from the bearer token alone.
 *
 * These endpoints previously took an `email` query/body parameter and returned
 * whatever they found — anyone able to reach the server could read any member's
 * giving history by guessing an address. The caller's identity now comes only
 * from a token Supabase has verified; a client-supplied identifier is ignored.
 */
const requireMember: express.RequestHandler = async (req: AuthedRequest, res, next) => {
  const token = bearerFrom(req);
  if (!token) {
    return res.status(401).json({ error: "Tafadhali ingia kwenye akaunti yako kwanza." });
  }

  const admin = getAdminClient();
  if (!admin) {
    return res.status(503).json({ error: "Supabase haijasanidiwa bado." });
  }

  try {
    const { data, error } = await admin.auth.getUser(token);
    // Was `!data?.user?.email`, which rejected every phone-only account with
    // "your session has expired" — an account that had just been created and
    // whose token was perfectly valid. The id is the thing that always exists.
    if (error || !data?.user?.id) {
      return res.status(401).json({ error: "Kipindi chako kimeisha. Tafadhali ingia tena." });
    }

    const client = getUserClient(token);
    if (!client) {
      return res.status(503).json({ error: "Supabase haijasanidiwa bado." });
    }

    req.member = {
      id: data.user.id,
      email: data.user.email || null,
      phone: data.user.phone || null,
      client,
    };
    next();
  } catch (err: any) {
    console.error("Token verification failed:", err);
    res.status(401).json({ error: "Uthibitishaji umeshindikana." });
  }
};

/**
 * The caller's own congregant record, resolved by the database.
 *
 * Never match on an identifier here. "Mine" means a NORMALISED phone number (or
 * an e-mail address, for members enrolled before phone auth), and
 * `.eq('phone', …)` compares stored text — so a record typed as '0754 112 233'
 * is invisible to a token that says '255754112233'. my_congregant_id() applies
 * the same rule the RLS policies do, and `client` is scoped to the member's
 * token, so this can only ever return their own row.
 */
const resolveMember = async (client: SupabaseClient) => {
  const { data: congregantId, error: idError } = await client.rpc("my_congregant_id");
  if (idError) return { congregant: null, error: idError.message };
  if (!congregantId) return { congregant: null, error: null };

  const { data, error } = await client
    .from("congregants")
    .select("*")
    .eq("id", congregantId)
    .maybeSingle();

  return { congregant: data, error: error?.message || null };
};

const MEMBER_NOT_FOUND =
  "Rekodi yako haijapatikana kwenye mfumo wa kanisa. Wasiliana na mhazini wa kanisa lako.";

// --- Database Init ---
let bibleDb: any = null;
let nyimboDb: any = null;
let dbInitPromise: Promise<void> | null = null;

async function initDatabases() {
  if (bibleDb && nyimboDb) return;
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      console.log("Initializing in-memory SQLite databases using sql.js WASM...");
      const SQL = await initSqlJs();
      
      const getDatabaseBuffer = (filename: string): Buffer => {
        const publicPath = path.join(process.cwd(), "public", filename);
        const rootPath = path.join(process.cwd(), filename);
        if (fs.existsSync(publicPath)) {
          return fs.readFileSync(publicPath);
        }
        return fs.readFileSync(rootPath);
      };

      const bibleBuffer = getDatabaseBuffer("bible.db");
      bibleDb = new SQL.Database(bibleBuffer);
      console.log("Biblia Takatifu (bible.db) database loaded successfully into memory!");

      const nyimboBuffer = getDatabaseBuffer("nyimbo.db");
      nyimboDb = new SQL.Database(nyimboBuffer);
      console.log("Nyimbo za Kristo (nyimbo.db) database loaded successfully into memory!");
    })();
  }
  await dbInitPromise;
}

// Middleware to ensure sqlite databases are loaded before serving APIs
app.use("/api", async (req, res, next) => {
  try {
    await initDatabases();
    next();
  } catch (err: any) {
    console.error("Failed to initialize system databases:", err);
    res.status(500).json({ error: "System initialization failed." });
  }
});

// Helper to query Bible DB
const query = (sql: string, params: any[] = []): any[] => {
  const stmt = bibleDb.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
};

// Helper to query Nyimbo DB
const queryNyimbo = (sql: string, params: any[] = []): any[] => {
  const stmt = nyimboDb.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
};

// Helper to get day of the year
const getDayOfYear = (): number => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime() + (start.getTimezoneOffset() - now.getTimezoneOffset()) * 60000;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
};

// --- API Endpoints ---

// Health check
app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Check if Supabase keys are setup
  app.get("/api/supabase-config-check", (req, res) => {
    const supabaseUrl = process.env.SUPABASE_URL || "";
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
    res.json({
      isConfigured: !!(supabaseUrl && supabaseKey),
      supabaseUrl: supabaseUrl ? `${supabaseUrl.substring(0, 20)}...` : ""
    });
  });

  // User authentication: registration flow with congregant verification
  app.post("/api/auth/register", async (req, res) => {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: "Tafadhali jaza namba ya simu na nenosiri." });
    }

    const supabase = getAdminClient();
    if (!supabase) {
      return res.status(503).json({
        error: "Supabase haijasanidiwa bado. Tafadhali weka secrets za SUPABASE_URL na SUPABASE_ANON_KEY!"
      });
    }

    try {
      // 1. Je, namba hii ipo kwenye orodha ya washirika?
      //
      // Through the RPC, not by reading the table. That matters beyond
      // tidiness: the old `select * from congregants` only returned anything
      // when the server held a SERVICE-ROLE key, because RLS grants `anon`
      // nothing. This works on the anon key alone, so the member API no longer
      // needs a credential that bypasses every policy in the database.
      const { data: isMember, error: cgError } = await supabase
        .rpc("congregant_phone_registered", { p_phone: phone });

      if (cgError) {
        console.error("Database query error on congregants check:", cgError);
        return res.status(500).json({ error: "Imefeli kuangalia orodha ya washirika: " + cgError.message });
      }

      if (!isMember) {
        return res.status(400).json({
          error: "Namba yako ya simu haijasajiliwa kama mshiriki katika mfumo wa kanisa. Tafadhali wasiliana na viongozi au mhazini wa kanisa lako kukusajili kwanza!"
        });
      }

      // 2. Usajili wa akaunti mpya ya Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        phone,
        password,
      });

      if (authError) {
        console.error("Supabase Auth error during signup:", authError);
        let errorMsg = authError.message;
        if (errorMsg.includes("User already registered") || errorMsg.includes("already registered")) {
          errorMsg = "Akaunti yako imeshasajiliwa! Tafadhali bofya 'Ingia Kwenye Akaunti' (Login) ili kuendelea.";
        } else {
          errorMsg = "Usajili kwenye mfumo umefeli: " + errorMsg;
        }
        return res.status(400).json({ error: errorMsg });
      }

      const authUser = authData.user;
      if (!authUser) {
        return res.status(400).json({ error: "Haikuweza kupata taarifa za mtumiaji aliyesajiliwa." });
      }

      // 3. Profile HAIWEKWI hapa — handle_new_user() (database/schema.sql)
      // huitengeneza ndani ya muamala ule ule wa usajili na ndiyo inayoamua
      // jukumu. Andiko la hapa lilikuwa linarudia kazi hiyo, na lilihitaji
      // ufunguo wa service-role ili kufanikiwa.

      // 4. Taarifa za mshiriki zinasomwa kwa kutumia kipindi chake mwenyewe,
      // hivyo RLS inatumika. Bila kipindi (OTP ikiwashwa) hazipatikani bado —
      // atazipata atakapoingia.
      const token = authData.session?.access_token || null;
      const memberClient = token ? getUserClient(token) : null;
      const { congregant } = memberClient
        ? await resolveMember(memberClient)
        : { congregant: null };

      res.json({
        success: true,
        token,
        user: {
          id: authUser.id,
          email: authUser.email || null,
          phoneLogin: authUser.phone || null,
          role: "mshiriki",
          fullName: congregant?.full_name || null,
          congregantId: congregant?.id || null,
          churchId: congregant?.church_id || null,
          phone: congregant?.phone || null,
          parental_church: congregant?.parental_church || null
        }
      });
    } catch (err: any) {
      console.error("System error on register:", err);
      res.status(500).json({ error: "Hitilafu imetokea wakati wa usajili: " + err.message });
    }
  });

  // User authentication: login flow
  app.post("/api/auth/login", async (req, res) => {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: "Tafadhali jaza namba ya simu na nenosiri." });
    }

    const supabase = getAdminClient();
    if (!supabase) {
      return res.status(503).json({ error: "Server error: Supabase haijasanidiwa bado." });
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        phone,
        password
      });

      if (authError) {
        return res.status(400).json({ error: "Kuingia imefeli: " + authError.message });
      }

      const authUser = authData.user;
      if (!authUser) {
        return res.status(400).json({ error: "Mtumiaji hajapatikana." });
      }

      // Everything below is read through the member's OWN session, so RLS
      // applies and the server needs no privileged key to serve a login.
      const token = authData.session?.access_token || null;
      const memberClient = token ? getUserClient(token) : null;

      const { data: profile } = memberClient
        ? await memberClient.from("profiles").select("*").eq("id", authUser.id).maybeSingle()
        : { data: null };

      const { congregant } = memberClient
        ? await resolveMember(memberClient)
        : { congregant: null };

      res.json({
        success: true,
        // Authenticates the member's subsequent /api/member/* requests.
        token,
        user: {
          id: authUser.id,
          email: authUser.email || null,
          phoneLogin: authUser.phone || null,
          role: profile?.role || "mshiriki",
          fullName: profile?.full_name || congregant?.full_name || null,
          congregantId: congregant?.id || null,
          churchId: congregant?.church_id || null,
          phone: congregant?.phone || null,
          parental_church: congregant?.parental_church || null
        }
      });
    } catch (err: any) {
      console.error("System error on login:", err);
      res.status(500).json({ error: "Hitilafu ya kuingia katika mfumo: " + err.message });
    }
  });

  // Member contributions fetch — scoped to the authenticated member only.
  app.get("/api/member/contributions", requireMember, async (req: AuthedRequest, res) => {
    const { client: supabase } = req.member!;

    try {
      // 1. Tafuta congregant details — resolved from the token, never from a
      // client-supplied identifier.
      const { congregant, error: cgError } = await resolveMember(supabase);

      if (cgError || !congregant) {
        return res.status(404).json({ error: MEMBER_NOT_FOUND });
      }

      // 2. Chora kanisa la mshiriki, mipangilio ya stakabadhi na michango
      const [churchRes, receiptRes, contribRes] = await Promise.all([
        supabase.from("churches").select("*").eq("id", congregant.church_id).maybeSingle(),
        // Letterhead for the member's receipts. Absent until a pastor or
        // treasurer fills it in, which is not an error — the receipt simply
        // prints without it.
        supabase.from("church_receipt_settings").select("*").eq("church_id", congregant.church_id).maybeSingle(),
        supabase.from("contributions").select("*").eq("congregant_id", congregant.id).order("created_at", { ascending: false })
      ]);

      if (contribRes.error) {
        return res.status(500).json({ error: "Imeshindwa kusoma michango yako: " + contribRes.error.message });
      }

      // Un-map the categories the Pastor app stores in `payment_method` before
      // totalling — see src/lib/contributions.ts.
      const normalized = normalizeContributions(contribRes.data);

      res.json({
        congregant,
        church: churchRes.data,
        receiptSettings: receiptRes.data || null,
        contributions: normalized,
        stats: summarizeContributions(normalized)
      });
    } catch (err: any) {
      console.error("System error on retrieving data:", err);
      res.status(500).json({ error: "Hitilafu imetokea: " + err.message });
    }
  });

  // Account deletion, for the same Play requirement the client-side path serves.
  // The work is done by delete_my_account() so both paths behave identically and
  // there is one definition of what "delete" means — see database/rls_policies.sql.
  app.post("/api/member/delete-account", requireMember, async (req: AuthedRequest, res) => {
    const { client: supabase } = req.member!;

    try {
      const { error } = await supabase.rpc("delete_my_account");
      if (error) {
        return res.status(400).json({ error: "Imeshindwa kufuta akaunti: " + error.message });
      }
      res.json({ success: true, message: "Akaunti imefutwa." });
    } catch (err: any) {
      console.error("Error deleting account:", err);
      res.status(500).json({ error: "Hitilafu imetokea wakati wa kufuta akaunti: " + err.message });
    }
  });

  // Update congregant profile values for empty/null fields — the member may
  // only ever touch their own record, resolved from the bearer token.
  app.post("/api/member/update-profile", requireMember, async (req: AuthedRequest, res) => {
    // `phone` is deliberately not accepted. It is the member's login, so it is
    // always already set — and it decides which account owns this record, which
    // makes it the one field a member must never be able to rewrite.
    const { marital_status, gender, residence, age } = req.body;
    const { client: supabase } = req.member!;

    try {
      // 1. Tafuta congregant details ya sasa
      const { congregant, error: cgError } = await resolveMember(supabase);

      if (cgError || !congregant) {
        return res.status(404).json({ error: MEMBER_NOT_FOUND });
      }

      // 2. Jenga payload pekee kwa ajili ya field ambazo kwa sasa ni tupu au null (mshiriki asiruhusiwe kuandika upya thamani zilizopo tayari)
      const updatePayload: Record<string, any> = {};

      if (congregant.age === null || congregant.age === undefined) {
        const parsedAge = Number(age);
        if (age !== undefined && age !== null && age !== ""
            && Number.isInteger(parsedAge) && parsedAge >= 1 && parsedAge <= 120) {
          updatePayload.age = parsedAge;
        }
      }
      if (!congregant.marital_status || congregant.marital_status.trim() === "") {
        if (marital_status && marital_status.trim() !== "") {
          updatePayload.marital_status = marital_status.trim();
        }
      }
      if (!congregant.gender || congregant.gender.trim() === "") {
        if (gender && gender.trim() !== "") {
          updatePayload.gender = gender.trim();
        }
      }
      if (!congregant.residence || congregant.residence.trim() === "") {
        if (residence && residence.trim() !== "") {
          updatePayload.residence = residence.trim();
        }
      }

      // 3. Sasisha kama kuna mabadiliko
      if (Object.keys(updatePayload).length > 0) {
        const { data: updatedData, error: updateError } = await supabase
          .from("congregants")
          .update(updatePayload)
          .eq("id", congregant.id)
          .select("*")
          .maybeSingle();

        if (updateError) {
          console.error("Supabase update error:", updateError);
          return res.status(500).json({ error: "Imeshindwa kusasisha taarifa: " + updateError.message });
        }

        return res.json({
          success: true,
          message: "Taarifa zimesasishwa kikamilifu kwenye mfumo!",
          congregant: updatedData || congregant
        });
      } else {
        return res.json({
          success: true,
          message: "Taarifa zote tayari zimeshajazwa na haziruhusiwi kufutwa au kufunikwa tena.",
          congregant
        });
      }
    } catch (err: any) {
      console.error("Error updating profile in server:", err);
      res.status(500).json({ error: "Hitilafu imetokea wakati wa kusasisha taarifa: " + err.message });
    }
  });

  // Get testaments
  app.get("/api/testaments", (req, res) => {
    try {
      const testaments = query("SELECT * FROM testaments ORDER BY id");
      res.json(testaments);
    } catch (err: any) {
      console.error("Failed to query testaments:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get books with their chapter count!
  app.get("/api/books", (req, res) => {
    try {
      const books = query(`
        SELECT b.id, b.testament_id, b.name, b.order_num, COUNT(DISTINCT v.chapter) as chapter_count 
        FROM books b
        LEFT JOIN verses v ON v.book_id = b.id
        GROUP BY b.id
        ORDER BY b.order_num
      `);
      res.json(books);
    } catch (err: any) {
      console.error("Failed to query books:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get verses for a specific book and chapter
  app.get("/api/book/:bookId/chapter/:chapter/verses", (req, res) => {
    try {
      const bookId = parseInt(req.params.bookId);
      const chapter = parseInt(req.params.chapter);
      
      const verses = query(
        "SELECT id, book_id, chapter, verse, text FROM verses WHERE book_id = ? AND chapter = ? ORDER BY verse",
        [bookId, chapter]
      );
      res.json(verses);
    } catch (err: any) {
      console.error("Failed to query verses:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Scripture search with multiple keyword matching
  app.get("/api/search", (req, res) => {
    try {
      const q = req.query.q as string;
      if (!q || q.trim().length === 0) {
        return res.json([]);
      }

      const terms = q.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0);
      if (terms.length === 0) {
        return res.json([]);
      }

      // Build SQL query matching each word using LIKE
      const whereClauses = terms.map(() => "v.text LIKE ?").join(" AND ");
      const params = terms.map(t => `%${t}%`);

      const verses = query(
        `SELECT v.id, v.chapter, v.verse, v.text, b.name as book_name, b.id as book_id, t.name as testament_name
         FROM verses v 
         JOIN books b ON v.book_id = b.id
         JOIN testaments t ON b.testament_id = t.id
         WHERE ${whereClauses} 
         LIMIT 150`,
        params
      );
      res.json(verses);
    } catch (err: any) {
      console.error("Failed to search scriptures:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Verse of the Day (Fungu la Siku) - consistent design based on date index
  app.get("/api/daily-verse", (req, res) => {
    try {
      // Swahili Bibles have roughly 31102 verses
      const countRes = query("SELECT COUNT(*) as total FROM verses");
      const total = countRes[0]?.total || 31013;

      const dayIdx = getDayOfYear();
      // Safe seed offset using year and day to give a randomized but stable daily verse selection
      const seedVal = (new Date().getFullYear() * 137 + dayIdx * 541) % total;
      const offset = seedVal > 0 ? seedVal : 1;

      const dailyVerse = query(`
        SELECT v.id, v.chapter, v.verse, v.text, b.name as book_name, b.id as book_id, t.name as testament_name
        FROM verses v
        JOIN books b ON v.book_id = b.id
        JOIN testaments t ON b.testament_id = t.id
        LIMIT 1 OFFSET ?
      `, [offset]);

      res.json(dailyVerse[0] || null);
    } catch (err: any) {
      console.error("Failed to load daily verse:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Nyimbo za Kristo API Endpoints ---

  // Get all songs
  app.get("/api/songs", (req, res) => {
    try {
      const songs = queryNyimbo(`
        SELECT id, number, title, english_ref, english_title 
        FROM songs 
        ORDER BY cast(number as integer), number
      `);
      res.json(songs);
    } catch (err: any) {
      console.error("Failed to query songs:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Search songs by number, Swahili title, English title, or lyric content
  app.get("/api/songs/search", (req, res) => {
    try {
      const q = req.query.q as string;
      if (!q || q.trim().length === 0) {
        return res.json([]);
      }

      const matchParam = `%${q.trim()}%`;
      const songs = queryNyimbo(`
        SELECT DISTINCT s.id, s.number, s.title, s.english_ref, s.english_title 
        FROM songs s
        LEFT JOIN stanzas st ON st.song_id = s.id
        WHERE s.number LIKE ? 
           OR s.title LIKE ? 
           OR s.english_title LIKE ? 
           OR st.content LIKE ?
        ORDER BY cast(s.number as integer), s.number
        LIMIT 50
      `, [matchParam, matchParam, matchParam, matchParam]);

      res.json(songs);
    } catch (err: any) {
      console.error("Failed to search songs:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get a single song by ID with its ordered stanzas
  app.get("/api/songs/:id", (req, res) => {
    try {
      const songId = parseInt(req.params.id);
      const songList = queryNyimbo(
        "SELECT id, number, title, english_ref, english_title FROM songs WHERE id = ?",
        [songId]
      );

      if (songList.length === 0) {
        return res.status(404).json({ error: "Song not found" });
      }

      const song = songList[0];
      const stanzas = queryNyimbo(
        "SELECT id, is_chorus, stanza_number, order_index, content FROM stanzas WHERE song_id = ? ORDER BY order_index",
        [songId]
      );

      res.json({
        ...song,
        stanzas: stanzas.map((st: any) => ({
          ...st,
          is_chorus: !!st.is_chorus
        }))
      });
    } catch (err: any) {
      console.error("Failed to retrieve song:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Vite & Client Asset Middleware Setup ---

  if (process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1") {
    (async () => {
      console.log("Configuring Vite Development Middleware...");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      
      const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Swahili Bible dev server listening at http://localhost:${PORT}`);
      });
    })().catch(console.error);
  } else if (process.env.NODE_ENV === "production" && !process.env.VERCEL) {
    console.log("Configuring Production Static Middlewares...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });

    const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Production server listening at http://localhost:${PORT}`);
    });
  }

  // Export for Vercel Serverless Function
  export default app;
