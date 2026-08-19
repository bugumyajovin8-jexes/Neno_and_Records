export interface Testament {
  id: number;
  name: string;
}

export interface Book {
  id: number;
  testament_id: number;
  name: string;
  order_num: number;
  chapter_count: number;
}

export interface Verse {
  id: number;
  book_id: number;
  chapter: number;
  verse: number;
  text: string;
  book_name?: string;
  testament_name?: string;
}

export interface Song {
  id: number;
  number: string;
  title: string;
  alt_title?: string;
  english_ref?: string;
  english_title?: string;
  doh?: string;
  stanzas?: SongStanza[];
}

export interface SongStanza {
  id: number;
  is_chorus: boolean;
  stanza_number?: number;
  order_index: number;
  content: string;
}
