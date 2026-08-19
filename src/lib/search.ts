// Scripture search helpers shared by both Bible search bars (the book-selector
// sheet and the full search modal), so ranking and highlighting stay identical.

/** How many results either search bar will render. */
export const SEARCH_LIMIT = 500;

/**
 * When a query matches more verses than we will render, take at most this many
 * from each book. A common word like "basi" hits 2,824 verses; without this the
 * cap fills from Genesis alone and the reader never sees the rest of the Bible.
 * Four is the largest value that still fits all 59 matching books inside the
 * limit for that query.
 */
export const SEARCH_PER_BOOK = 4;

/** Safety valve on how many rows we pull out of SQLite before ranking in JS. */
export const SEARCH_FETCH_CEILING = 5000;

export interface ScriptureSearch {
  /** Ranked, possibly spread across books. */
  results: import("../types").Verse[];
  /** How many verses matched in total, before any capping. */
  total: number;
  /** How many distinct books those matches span. */
  books: number;
  /** True when `results` is a subset of `total`. */
  truncated: boolean;
}

/**
 * Splits a query into the terms the SQL layer ANDs together.
 * Callers must treat the result as data — every term is bound as a parameter,
 * never concatenated into SQL.
 */
export function searchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 0);
}

/** Escapes the LIKE wildcards so a query of "100%" matches literally. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => "\\" + c);
}

/* ---------------------------------------------------------------------------
   Reference lookup — "Yakobo 4:7", "yak 4", "1 Wafalme 3:5"

   Typing a reference used to match nothing, because it was searched as text
   against verse CONTENT. Anyone who already knows the verse they want types the
   reference, so recognise that shape before falling back to a text search.
   --------------------------------------------------------------------------- */

export interface ParsedReference {
  bookQuery: string;
  chapter: number;
  verse: number | null;
}

/**
 * Reads a reference out of a query, or returns null if it isn't one.
 * The book part is returned as free text for the caller to match against the
 * book table — abbreviations ("yak") are resolved there, not here.
 */
export function parseReference(query: string): ParsedReference | null {
  const q = query.trim().replace(/\s+/g, " ");
  if (!q) return null;

  // Book name, then chapter, optionally ":verse" (or "." / " " as separator).
  // The book may itself start with a digit — "1 Wafalme", "2 Samweli".
  const m = /^(\d?\s?[A-Za-zÀ-ÿ'’.\- ]+?)\s+(\d{1,3})(?:\s*[:.\s]\s*(\d{1,3}))?$/.exec(q);
  if (!m) return null;

  const bookQuery = m[1].trim().replace(/\.$/, "");
  if (bookQuery.length < 2) return null;

  const chapter = parseInt(m[2], 10);
  if (!Number.isFinite(chapter) || chapter < 1) return null;

  const verse = m[3] ? parseInt(m[3], 10) : null;
  if (verse !== null && (!Number.isFinite(verse) || verse < 1)) return null;

  return { bookQuery, chapter, verse };
}

/**
 * Picks the book a reference names. Prefers an exact name, then a name that
 * starts with the query ("yak" → Yakobo), then any book containing it.
 * Returns null when the query is ambiguous between two different books, so a
 * guess is never silently substituted for what the reader asked for.
 */
export function matchBook<T extends { id: number; name: string }>(
  books: T[],
  bookQuery: string
): T | null {
  const q = bookQuery.trim().toLowerCase();
  if (!q) return null;

  const norm = (s: string) => s.trim().toLowerCase();
  const exact = books.filter((b) => norm(b.name) === q);
  if (exact.length === 1) return exact[0];

  const starts = books.filter((b) => norm(b.name).startsWith(q));
  if (starts.length === 1) return starts[0];
  if (starts.length > 1) return null; // e.g. "1" — ambiguous, don't guess

  const has = books.filter((b) => norm(b.name).includes(q));
  return has.length === 1 ? has[0] : null;
}

/* ---------------------------------------------------------------------------
   Highlighting
   --------------------------------------------------------------------------- */

export interface TextSegment {
  text: string;
  match: boolean;
}

/**
 * Splits `text` into alternating plain and matching segments.
 *
 * Returns data, not markup — the caller renders each segment as its own React
 * node, so verse text can never be interpreted as HTML.
 */
export function highlightSegments(text: string, terms: string[]): TextSegment[] {
  const clean = terms.filter((t) => t.length > 0);
  if (!clean.length || !text) return [{ text, match: false }];

  const lower = text.toLowerCase();
  // Mark every character covered by any term, then coalesce into runs. This
  // handles overlapping terms ("basi" and "asi") without emitting nested spans.
  const hit = new Array<boolean>(text.length).fill(false);

  for (const term of clean) {
    const t = term.toLowerCase();
    let from = 0;
    for (;;) {
      const at = lower.indexOf(t, from);
      if (at === -1) break;
      for (let i = at; i < at + t.length; i++) hit[i] = true;
      from = at + t.length;
    }
  }

  const out: TextSegment[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || hit[i] !== hit[start]) {
      out.push({ text: text.slice(start, i), match: hit[start] });
      start = i;
    }
  }
  return out.length ? out : [{ text, match: false }];
}
