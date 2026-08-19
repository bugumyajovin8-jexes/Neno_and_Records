import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { 
  BookOpen, 
  Search, 
  Sun, 
  Moon, 
  Copy, 
  Check, 
  ChevronRight, 
  ChevronLeft, 
  ChevronDown, 
  ChevronUp, 
  Type, 
  Heart, 
  Sparkles, 
  X, 
  Layers, 
  AlignLeft,
  Calendar,
  Music,
  Info,
  Settings,
  Trash2,
  ArrowLeft,
  BookText,
  Compass,
  User,
  Lock,
  Mail,
  Phone,
  FileText,
  LayoutDashboard,
  PiggyBank,
  TrendingUp,
  Coins,
  LogOut,
  Database,
  UserPlus,
  UserCheck,
  Eye,
  EyeOff,
  WifiOff
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { Variants } from "motion/react";
import { Book, Verse, Testament, Song, SongStanza } from "./types";
import { fetchWithCache, getBackendUrl, setAuthToken, clearAuthToken, clearMemberCache } from "./lib/fetchWithCache";
import { getSupabaseClient, getSupabaseConfig } from "./lib/supabaseClient";
import { toE164, isValidPhone, formatPhoneDisplay, PHONE_INVALID_MESSAGE } from "./lib/phone";
import { GENDERS, MARITAL_STATUSES, maritalLabel } from "./lib/memberFields";
import { normalizeContributions, summarizeContributions } from "./lib/contributions";
import { buildReceipts, formatMoney } from "./lib/receipt";
import type { Receipt } from "./lib/receipt";
import ReceiptModal from "./components/ReceiptModal";
import { initializeDatabases, subscribeToDBProgress, dbService, DBProgress } from "./lib/db";
import { searchTerms } from "./lib/search";
import { HighlightedText } from "./components/HighlightedText";

/**
 * Supabase answers in English, and its sentences for the mistakes people
 * actually make say "email" or "user" — words that mean nothing on a screen
 * which only ever asked for a phone number. Anything unrecognised is passed
 * through untouched: an unexpected error is worth reading.
 *
 * Kept in step with the twin in Pastor/src/features/auth/Login.tsx.
 */
function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "Akaunti yako imeshasajiliwa! Tafadhali bofya 'Ingia Kwenye Akaunti' (Login) siyo Jisajili ili kuendelea.";
  }
  if (m.includes("invalid login credentials")) {
    return "Namba ya simu au nenosiri si sahihi.";
  }
  if (m.includes("password should be at least")) {
    return "Nenosiri ni fupi mno. Tumia herufi 6 au zaidi.";
  }
  // The exact sentence Supabase returns while the Phone provider is switched
  // off — confirmed against the live project.
  if (m.includes("phone signups are disabled") || m.includes("phone_provider_disabled")
      || m.includes("signups not allowed") || m.includes("unsupported phone provider")) {
    return "Kuingia kwa namba ya simu bado hakujawashwa. Wasiliana na viongozi wa kanisa lako.";
  }
  return message;
}

// Pages slide sideways. This used to rotate the page 75 degrees on the Y axis
// with a spring, which needed a 1200px perspective and preserve-3d on the
// scroll containers, cost frames on low-end Android, and read as dated.
//
// Typed as a tuple, not number[]: Framer reads a four-number array as a cubic
// bezier, and a plain array literal widens to number[], which it rejects.
const SLIDE_EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1];
const SLIDE_TRANSITION = {
  x: { duration: 0.22, ease: SLIDE_EASE },
  opacity: { duration: 0.16 },
};

// How long the "you landed here" tint stays on a verse reached by reference.
const LANDING_HIGHLIGHT_MS = 5000;

const cubeTransitionVariants: Variants = {
  initial: (direction: number) => ({
    x: direction > 0 ? "100%" : "-100%",
    opacity: 0,
  }),
  animate: {
    x: 0,
    opacity: 1,
    transition: SLIDE_TRANSITION,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? "-100%" : "100%",
    opacity: 0,
    transition: SLIDE_TRANSITION,
  }),
};


interface ProfileCompleterFormProps {
  member: any;
  isMaritalEmpty: boolean;
  isGenderEmpty: boolean;
  isResidenceEmpty: boolean;
  isAgeEmpty: boolean;
  onUpdate: (fields: { marital_status?: string; gender?: string; residence?: string; age?: number }) => Promise<void>;
  isUpdating: boolean;
  successMsg: string;
  errorMsg: string;
  setSuccessMsg: (msg: string) => void;
  setErrorMsg: (msg: string) => void;
}

/**
 * A field the church already filled in. Shown as a plain read-only line, never
 * as a disabled input — a greyed-out box that will not accept typing reads as a
 * broken form, when in fact the value is simply already there and the database
 * will not let it be rewritten.
 */
const SetField: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <label className="block text-[12px] font-bold mb-1.5 text-[var(--muted-ink)] dark:text-slate-400 uppercase tracking-wider select-none">
      {label}
    </label>
    <div className="w-full px-3 py-2 bg-slate-100 dark:bg-[#131730] border border-slate-200 dark:border-[#1c2245] rounded-xl text-slate-600 dark:text-slate-300 text-xs flex justify-between items-center gap-2 select-none">
      <span className="truncate">{value}</span>
      <span className="shrink-0 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded uppercase">
        Imewekwa
      </span>
    </div>
  </div>
);

const ProfileCompleterForm: React.FC<ProfileCompleterFormProps> = ({
  member,
  isMaritalEmpty,
  isGenderEmpty,
  isResidenceEmpty,
  isAgeEmpty,
  onUpdate,
  isUpdating,
  successMsg,
  errorMsg,
  setSuccessMsg,
  setErrorMsg
}) => {
  const [maritalStatus, setMaritalStatus] = useState(member.marital_status || "");
  const [gender, setGender] = useState(member.gender || "");
  const [residence, setResidence] = useState(member.residence || "");
  const [age, setAge] = useState(member.age != null ? String(member.age) : "");

  useEffect(() => {
    setMaritalStatus(member.marital_status || "");
    setGender(member.gender || "");
    setResidence(member.residence || "");
    setAge(member.age != null ? String(member.age) : "");
  }, [member]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg("");
    setErrorMsg("");

    const fields: any = {};
    if (isMaritalEmpty) {
      if (!maritalStatus) {
        setErrorMsg("Tafadhali chagua hali ya ndoa.");
        return;
      }
      fields.marital_status = maritalStatus;
    }
    if (isGenderEmpty) {
      if (!gender) {
        setErrorMsg("Tafadhali chagua jinsia.");
        return;
      }
      fields.gender = gender;
    }
    if (isResidenceEmpty) {
      if (!residence.trim()) {
        setErrorMsg("Tafadhali jaza makazi yako.");
        return;
      }
      fields.residence = residence.trim();
    }
    if (isAgeEmpty) {
      const parsed = Number(age);
      if (!age.trim() || !Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 120) {
        setErrorMsg("Tafadhali jaza umri sahihi (kati ya 1 na 120).");
        return;
      }
      fields.age = parsed;
    }

    onUpdate(fields);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {successMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-400 rounded-xl text-xs font-semibold text-center select-none">
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 rounded-xl text-xs font-semibold text-center select-none">
          {errorMsg}
        </div>
      )}

      {/* Namba ya simu is not here. It is how the member signs in, so it is
          always set by the time they can see this screen — an input for it
          would only ever have been a permanently disabled box. */}
      <div className="grid grid-cols-2 gap-3 text-left">
        {isResidenceEmpty ? (
          <div>
            <label className="block text-[12px] font-bold mb-1.5 text-[var(--muted-ink)] dark:text-slate-400 uppercase tracking-wider select-none">
              Makazi (Residence)
            </label>
            <input
              type="text"
              disabled={isUpdating}
              placeholder="Mfano: Kimara, DSM"
              value={residence}
              onChange={(e) => setResidence(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-[#0d1124] border border-slate-200 dark:border-[#1c2245] rounded-xl text-[#0d1124] dark:text-white text-xs focus:outline-none focus:ring-1 focus:ring-[#d9a020]/40 transition"
            />
          </div>
        ) : (
          <SetField label="Makazi (Residence)" value={residence} />
        )}

        {isAgeEmpty ? (
          <div>
            <label className="block text-[12px] font-bold mb-1.5 text-[var(--muted-ink)] dark:text-slate-400 uppercase tracking-wider select-none">
              Umri
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={120}
              disabled={isUpdating}
              placeholder="Mfano: 34"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-[#0d1124] border border-slate-200 dark:border-[#1c2245] rounded-xl text-[#0d1124] dark:text-white text-xs focus:outline-none focus:ring-1 focus:ring-[#d9a020]/40 transition"
            />
          </div>
        ) : (
          <SetField label="Umri" value={`${member.age} miaka`} />
        )}

        {isMaritalEmpty ? (
          <div>
            <label className="block text-[12px] font-bold mb-1.5 text-[var(--muted-ink)] dark:text-slate-400 uppercase tracking-wider select-none">
              Hali ya Ndoa
            </label>
            <select
              disabled={isUpdating}
              value={maritalStatus}
              onChange={(e) => setMaritalStatus(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-[#0d1124] border border-slate-200 dark:border-[#1c2245] rounded-xl text-[#0d1124] dark:text-white text-xs focus:outline-none focus:ring-1 focus:ring-[#d9a020]/40 transition"
            >
              <option value="">-- Chagua Hali --</option>
              {MARITAL_STATUSES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        ) : (
          <SetField label="Hali ya Ndoa" value={maritalLabel(maritalStatus)} />
        )}

        {isGenderEmpty ? (
          <div>
            <label className="block text-[12px] font-bold mb-1.5 text-[var(--muted-ink)] dark:text-slate-400 uppercase tracking-wider select-none">
              Jinsia
            </label>
            {/* These values must be the ones the Pastor app counts. They were
                'Mume'/'Mke' here and 'Mwanaume'/'Mwanamke' there, so filling
                this in saved fine and then counted as nobody. */}
            <select
              disabled={isUpdating}
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-[#0d1124] border border-slate-200 dark:border-[#1c2245] rounded-xl text-[#0d1124] dark:text-white text-xs focus:outline-none focus:ring-1 focus:ring-[#d9a020]/40 transition animate-in fade-in"
            >
              <option value="">-- Chagua Jinsia --</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
        ) : (
          <SetField label="Jinsia" value={gender} />
        )}
      </div>

      <button
        type="submit"
        disabled={isUpdating}
        className="w-full py-3 min-h-[44px] mt-2 text-white text-xs font-semibold rounded-xl bg-amber-700 hover:bg-amber-800 disabled:opacity-40 select-none active:scale-[0.99] transition cursor-pointer flex items-center justify-center gap-1.5"
      >
        {isUpdating ? (
          <>
            <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span>Inahifadhi...</span>
          </>
        ) : (
          <>
            <UserCheck className="w-3.5 h-3.5" />
            <span>Kamilisha Usajili</span>
          </>
        )}
      </button>
    </form>
  );
};


export default function App() {
  // --- Global Application States ---
  // Taarifa leads, and is where the app opens. Biblia and Nyimbo stay open to
  // everyone: the sign-in card lives inside the Taarifa tab rather than in
  // front of the app, so someone with no account can still read scripture and
  // sing — they are only asked to sign in for their own giving records.
  const [activeTab, setActiveTab] = useState<"taarifa" | "biblia" | "nyimbo">("taarifa");
  const [dbProgressState, setDbProgressState] = useState<DBProgress>({
    status: "idle",
    percent: 0,
    message: "Inaanzisha...",
  });
  const [testaments, setTestaments] = useState<Testament[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [currentTestamentId, setCurrentTestamentId] = useState<number>(1); // Default: Agano la Kale
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [currentChapter, setCurrentChapter] = useState<number>(1);
  const [verses, setVerses] = useState<Verse[]>([]);
  
  // Custom Settings (cached locally)
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem("bible-theme") === "dark";
  });
  const [fontSize, setFontSize] = useState<"sm" | "md" | "lg" | "xl">(() => {
    return (localStorage.getItem("bible-font-size") as any) || "lg";
  });
  const [layoutStyle, setLayoutStyle] = useState<"paragraph" | "list">(() => {
    return (localStorage.getItem("bible-layout") as any) || "paragraph";
  });

  // Bookmark / Favorite System (cached locally)
  const [favorites, setFavorites] = useState<Verse[]>(() => {
    const saved = localStorage.getItem("bible-favorites");
    return saved ? JSON.parse(saved) : [];
  });
  const [favoriteSongs, setFavoriteSongs] = useState<Song[]>(() => {
    const saved = localStorage.getItem("bible-favorite-songs");
    return saved ? JSON.parse(saved) : [];
  });
  const [favoritesTab, setFavoritesTab] = useState<"bible" | "songs">("bible");

  // Search Scripture Overlay
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<Verse[]>([]);
  const [searchMeta, setSearchMeta] = useState<{ total: number; books: number; truncated: boolean }>({ total: 0, books: 0, truncated: false });
  const [searchJump, setSearchJump] = useState<Verse | null>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showSearchModal, setShowSearchModal] = useState<boolean>(false);


  // New visual state controls
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isSingerMode, setIsSingerMode] = useState<boolean>(false);

  // Nyimbo za Kristo (Hymnal) States
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [currentSongDetail, setCurrentSongDetail] = useState<Song | null>(null);
  const [songSearchQuery, setSongSearchQuery] = useState<string>("");
  const [songSearchResults, setSongSearchResults] = useState<Song[]>([]);
  const [isSearchingSongs, setIsSearchingSongs] = useState<boolean>(false);

  // --- Supabase Member Auth & Contributions System States ---
  const [user, setUser] = useState<any>(null);
  const [authPhone, setAuthPhone] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [showMockReport, setShowMockReport] = useState<boolean>(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(false);
  const [isLoadingContributions, setIsLoadingContributions] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>("");
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean>(false);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [isOfflineData, setIsOfflineData] = useState<boolean>(false);
  const [customServerUrl, setCustomServerUrl] = useState<string>(() => {
    return localStorage.getItem("mshiriki-custom-backend-url") || "";
  });
  const [showServerConfig, setShowServerConfig] = useState<boolean>(false);
  const [userContributions, setUserContributions] = useState<any[]>([]);
  const [churchData, setChurchData] = useState<any>(null);
  // Letterhead for giving receipts, maintained by the pastor/treasurer. Null
  // until they fill it in; the receipt still prints, just without a header.
  const [receiptSettings, setReceiptSettings] = useState<any>(null);
  const [openReceipt, setOpenReceipt] = useState<Receipt | null>(null);
  const [financialStats, setFinancialStats] = useState<any>({
    totalZaka: 0,
    totalSadaka: 0,
    totalContributions: 0,
    typeBreakdown: { Zaka: 0, Sadaka: 0, Majengo: 0, Makambi: 0 }
  });
  const [reportSubTab, setReportSubTab] = useState<"muhtasari" | "historia">("muhtasari");
  const [graphPeriod, setGraphPeriod] = useState<"mwezi" | "mwaka">("mwezi");
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const [selectedHistoryYear, setSelectedHistoryYear] = useState<number>(() => new Date().getFullYear());
  const [selectedHistoryMonth, setSelectedHistoryMonth] = useState<number | null>(null);
  const [splashMsgIndex, setSplashMsgIndex] = useState<number>(0);
  const splashMessages = [
    "Neno lako ni taa ya miguu yangu, na mwanga wa njia yangu.",
    "Bwana ndiye mchungaji wangu, sitapungukiwa na kitu.",
    "Leteni zaka kamili ghalani ili kiwemo chakula nyumbani mwangu...",
    "Njia zako, Ee Bwana, unijulishe, unipitishe katika mapito yako.",
    "Ombeni, nanyi mtapewa; tafuteni, nanyi mtaona; bisani, nanyi mtafunguliwa.",
    "Kuwa mshiriki mwaminifu ni ngazi ya amani na utulivu."
  ];

  useEffect(() => {
    if (dbProgressState.status === "ready") return;
    const interval = setInterval(() => {
      setSplashMsgIndex((prev) => (prev + 1) % splashMessages.length);
    }, 2800);
    return () => clearInterval(interval);
  }, [dbProgressState.status]);
  
  // This state controls looking at a single hymn directly
  const [songDetailView, setSongDetailView] = useState<Song | null>(null);
  const [bibleDirection, setBibleDirection] = useState<number>(0); // -1 = prev, 1 = next
  const [songDirection, setSongDirection] = useState<number>(0);   // -1 = prev, 1 = next
  const songScrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (songScrollContainerRef.current) {
      songScrollContainerRef.current.scrollTop = 0;
    }
  }, [songDetailView?.id]);

  // Where the reader had scrolled to in the hymn catalogue. The list unmounts
  // whenever a hymn is opened or the tab changes, so without this you are
  // dropped back at hymn 1 after glancing at the wrong hymn — a long scroll
  // back when you were down at 200-odd.
  const songListScrollRef = useRef<HTMLDivElement>(null);
  const songListScrollTop = useRef<number>(0);

  const rememberSongListScroll = () => {
    if (songListScrollRef.current) {
      songListScrollTop.current = songListScrollRef.current.scrollTop;
    }
  };

  // Restore before paint, so the list never flashes at the top first.
  useLayoutEffect(() => {
    if (activeTab !== "nyimbo" || songDetailView) return;
    const el = songListScrollRef.current;
    if (el) el.scrollTop = songListScrollTop.current;
  }, [activeTab, songDetailView]);

  // Custom numeric keypad states for jump-to-song
  const [isDialpadOpen, setIsDialpadOpen] = useState<boolean>(false);
  const [dialpadInput, setDialpadInput] = useState<string>("");

  // Native Mobile Book-and-Chapter Selector Overlay
  const [isBookSelectorOpen, setIsBookSelectorOpen] = useState<boolean>(false);
  // Book -> Aya (chapter) -> Fungu (verse), so the selector lands the reader on
  // an exact place rather than the top of a chapter.
  const [selectorStep, setSelectorStep] = useState<"book" | "chapter" | "verse">("book");
  const [selectedSelectorBook, setSelectedSelectorBook] = useState<Book | null>(null);
  const [selectorChapter, setSelectorChapter] = useState<number | null>(null);
  const [selectorVerseCount, setSelectorVerseCount] = useState<number>(0);
  // Set when a verse is chosen; the reader scrolls to it once that chapter's
  // verses have actually rendered.
  const [pendingVerseNumber, setPendingVerseNumber] = useState<number | null>(null);
  const [selectorBookSearch, setSelectorBookSearch] = useState<string>("");
  const [selectorScriptureResults, setSelectorScriptureResults] = useState<Verse[]>([]);
  const [selectorMeta, setSelectorMeta] = useState<{ total: number; books: number; truncated: boolean }>({ total: 0, books: 0, truncated: false });
  const [selectorJump, setSelectorJump] = useState<Verse | null>(null);
  const [isSearchingSelectorScriptures, setIsSearchingSelectorScriptures] = useState<boolean>(false);

  // UI Interactive Feedback
  const [copiedVerseId, setCopiedVerseId] = useState<number | null>(null);
  const [copiedSongId, setCopiedSongId] = useState<number | null>(null);
  const [highlightedVerseId, setHighlightedVerseId] = useState<number | null>(null);
  // A short-lived "here is the line you asked for" marker, kept separate from
  // highlightedVerseId on purpose: that one is the tap-to-select state and opens
  // the Hifadhi/Nakili popup. Arriving at a reference should just show you the
  // verse, not offer to copy it. Clears itself after LANDING_HIGHLIGHT_MS.
  const [landedVerseId, setLandedVerseId] = useState<number | null>(null);

  // Scroll Container Ref
  const readingContainerRef = useRef<HTMLDivElement>(null);

  // Where the reader had got to when they last left the Biblia tab. The tab
  // unmounts on every switch, so without this you come back to the top of the
  // chapter instead of the verse you were reading.
  const pendingBibleRestore = useRef<{ key: string; top: number } | null>(null);

  const chapterKey = selectedBook ? `${selectedBook.id}:${currentChapter}` : "";

  /** Notes the reading position while the Biblia tab is still mounted. */
  const rememberBibleScroll = () => {
    const el = readingContainerRef.current;
    if (activeTab !== "biblia" || !el || !chapterKey) return;
    pendingBibleRestore.current = { key: chapterKey, top: el.scrollTop };
  };

  useLayoutEffect(() => {
    if (activeTab !== "biblia" || verses.length === 0) return;

    const pending = pendingBibleRestore.current;
    // Only restore into the very chapter the reader left, and never fight the
    // verse-selector, which is scrolling somewhere specific of its own.
    if (!pending || pending.key !== chapterKey || pending.top <= 0 || pendingVerseNumber !== null) {
      pendingBibleRestore.current = null;
      return;
    }

    const el = readingContainerRef.current;
    if (!el) return;

    // The container is `scroll-smooth`; this should be instant, not a visible
    // glide back down the chapter.
    const applyScroll = () => {
      const previous = el.style.scrollBehavior;
      el.style.scrollBehavior = "auto";
      el.scrollTop = pending.top;
      el.style.scrollBehavior = previous;
      return Math.abs(el.scrollTop - pending.top) < 2;
    };

    if (applyScroll()) {
      pendingBibleRestore.current = null;
      return;
    }

    // Landing short means the chapter is still sliding in and the container is
    // not yet tall enough to hold the old offset, so the browser clamped it.
    // Re-apply as the content grows. A ResizeObserver is used rather than
    // requestAnimationFrame because rAF does not run while the page is hidden,
    // which is exactly when a tab switch can leave this pending.
    const observer = new ResizeObserver(() => {
      if (applyScroll()) {
        pendingBibleRestore.current = null;
        observer.disconnect();
      }
    });
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);

    const giveUp = setTimeout(() => observer.disconnect(), 1500);
    return () => {
      observer.disconnect();
      clearTimeout(giveUp);
    };
  }, [activeTab, chapterKey, verses, pendingVerseNumber]);
  const songsScrollRef = useRef<HTMLDivElement>(null);

  // --- Theme Mode Toggle ---
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("bible-theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("bible-theme", "light");
    }
  }, [darkMode]);

  // Caching settings
  useEffect(() => {
    localStorage.setItem("bible-font-size", fontSize);
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem("bible-layout", layoutStyle);
  }, [layoutStyle]);

  // Cache bookmarks
  useEffect(() => {
    localStorage.setItem("bible-favorites", JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem("bible-favorite-songs", JSON.stringify(favoriteSongs));
  }, [favoriteSongs]);

  // --- Member Contributions Data Logger & Auth Handlers ---
  // `cacheKey` identifies the ACCOUNT for offline storage only — it is never a
  // lookup key. Who the member is comes from the token, resolved by the
  // database (my_congregant_id), so nothing here has to know whether they
  // signed up with a number or an address.
  const fetchContributions = async (cacheKey: string) => {
    setIsLoadingContributions(true);
    setAuthError("");

    try {
      const client = getSupabaseClient();
      if (client) {
        console.log("Using direct client-side Supabase for fetchContributions");

        // 1. Which record is mine? Asked of the database rather than matched
        // here: "mine" means a normalised phone number (or, for members
        // enrolled before phone auth, an e-mail address), and no client-side
        // filter can express that — '0754 112 233' and '255754112233' are the
        // same member and `.ilike` says they are not. See my_congregant_id()
        // in database/rls_policies.sql.
        const { data: congregantId, error: idError } = await client.rpc("my_congregant_id");

        if (idError) {
          throw new Error("Imeshindwa kutambua rekodi yako: " + idError.message);
        }
        if (!congregantId) {
          throw new Error("Rekodi yako haijapatikana kwenye mfumo wa kanisa. Wasiliana na mhazini wa kanisa lako.");
        }

        const { data: congregant, error: cgError } = await client
          .from("congregants")
          .select("*")
          .eq("id", congregantId)
          .maybeSingle();

        if (cgError || !congregant) {
          throw new Error("Rekodi yako haijapatikana kwenye mfumo wa kanisa. Wasiliana na mhazini wa kanisa lako.");
        }

        // 2. Chora kanisa, mipangilio ya stakabadhi na michango kwa pamoja
        const [churchRes, receiptRes, contribRes] = await Promise.all([
          client.from("churches").select("*").eq("id", congregant.church_id).maybeSingle(),
          client.from("church_receipt_settings").select("*").eq("church_id", congregant.church_id).maybeSingle(),
          client.from("contributions").select("*").eq("congregant_id", congregant.id).order("created_at", { ascending: false })
        ]);

        const church = churchRes.data;
        const contributions = contribRes.data;

        if (contribRes.error) {
          throw new Error("Imeshindwa kusoma michango yako: " + contribRes.error.message);
        }

        // Un-map the categories the Pastor app hides in `payment_method`
        // before totalling, otherwise Majengo/Makambi are reported as Sadaka.
        const normalized = normalizeContributions(contributions);

        const data = {
          congregant,
          church,
          contributions: normalized,
          stats: summarizeContributions(normalized)
        };

        if (congregant) {
          setUser((prevUser: any) => {
            const nextUser = {
              ...(prevUser || {}),
              fullName: congregant.full_name,
              congregantId: congregant.id,
              churchId: congregant.church_id,
              phone: congregant.phone || null,
              parental_church: congregant.parental_church || null,
              marital_status: congregant.marital_status || null,
              gender: congregant.gender || null,
              residence: congregant.residence || null,
              age: congregant.age ?? null
            };
            localStorage.setItem("mshiriki-user", JSON.stringify(nextUser));
            return nextUser;
          });
        }

        setChurchData(data.church || null);
        setReceiptSettings(receiptRes.data || null);
        setUserContributions(data.contributions);
        setFinancialStats(data.stats);
        setIsOfflineData(false);

        // Cache the raw rows only. Totals are always recomputed from them, so a
        // stale stats blob can never outlive a change to the aggregation rules.
        localStorage.setItem("mshiriki-church-data-" + cacheKey, JSON.stringify(data.church || null));
        localStorage.setItem("mshiriki-receipt-settings-" + cacheKey, JSON.stringify(receiptRes.data || null));
        localStorage.setItem("mshiriki-contributions-" + cacheKey, JSON.stringify(data.contributions));
      } else {
        // The member is identified server-side from the bearer token; the
        // cache key is only used to keep each account's offline records
        // separate on a shared device.
        const res = await fetchWithCache(
          `/api/member/contributions`,
          undefined,
          { cacheKey: `member-contributions-${cacheKey}` }
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Imeshindwa kusoma michango yako.");
        }
        const data = await res.json();
        const cg = data.congregant;

        if (cg) {
          setUser((prevUser: any) => {
            const nextUser = {
              ...(prevUser || {}),
              fullName: cg.full_name,
              congregantId: cg.id,
              churchId: cg.church_id,
              phone: cg.phone || null,
              parental_church: cg.parental_church || null,
              marital_status: cg.marital_status || null,
              gender: cg.gender || null,
              residence: cg.residence || null,
              age: cg.age ?? null
            };
            localStorage.setItem("mshiriki-user", JSON.stringify(nextUser));
            return nextUser;
          });
        }
        
        // Recompute totals locally from normalized rows rather than trusting
        // `data.stats`: a cached response from an older server build would carry
        // pre-fix figures that mis-file Majengo/Makambi as Sadaka.
        const normalized = normalizeContributions(data.contributions);

        // Update state
        setChurchData(data.church || null);
        setReceiptSettings(data.receiptSettings || null);
        setUserContributions(normalized);
        setFinancialStats(summarizeContributions(normalized));
        setIsOfflineData(false);

        // Save to cache
        localStorage.setItem("mshiriki-church-data-" + cacheKey, JSON.stringify(data.church || null));
        localStorage.setItem("mshiriki-receipt-settings-" + cacheKey, JSON.stringify(data.receiptSettings || null));
        localStorage.setItem("mshiriki-contributions-" + cacheKey, JSON.stringify(normalized));
      }
    } catch (err: any) {
      // Attempt to load from offline cache
      const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
      const reason = err?.message || "Hitilafu isiyojulikana imetokea.";
      const cachedChurch = localStorage.getItem("mshiriki-church-data-" + cacheKey);
      const cachedReceiptSettings = localStorage.getItem("mshiriki-receipt-settings-" + cacheKey);
      const cachedContributions = localStorage.getItem("mshiriki-contributions-" + cacheKey);

      if (cachedContributions) {
        try {
          const normalized = normalizeContributions(JSON.parse(cachedContributions));
          setChurchData(cachedChurch ? JSON.parse(cachedChurch) : null);
          // Receipts must work offline too — that is much of the point of
          // having them on the phone at all.
          setReceiptSettings(cachedReceiptSettings ? JSON.parse(cachedReceiptSettings) : null);
          setUserContributions(normalized);
          setFinancialStats(summarizeContributions(normalized));
          setIsOfflineData(true);
          // Offline is expected and already signalled by the banner. If we are
          // online the request failed for a real reason — say so instead of
          // silently presenting stale figures as current.
          setAuthError(isOffline ? "" : reason);
          console.log("Loaded contributions from offline cache.");
        } catch (parseErr) {
          setAuthError("Imeshindwa kupata kumbukumbu mtandaoni na faili la akiba limeharibika.");
        }
      } else {
        setAuthError(
          isOffline
            ? "Nje ya mtandao: Imeshindwa kupata kumbukumbu zako mtandaoni na hakuna data ya akiba."
            : reason
        );
      }
    } finally {
      setIsLoadingContributions(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authPhone || !authPassword) {
      setAuthError("Tafadhali jaza namba ya simu na nenosiri.");
      return;
    }
    if (!isValidPhone(authPhone)) {
      setAuthError(PHONE_INVALID_MESSAGE);
      return;
    }

    setIsLoadingAuth(true);
    setAuthError("");

    try {
      const client = getSupabaseClient();
      if (client) {
        console.log("Using direct client-side Supabase for Login");
        const { data: authData, error: authError } = await client.auth.signInWithPassword({
          phone: toE164(authPhone),
          password: authPassword
        });

        if (authError) {
          throw new Error("Kuingia imefeli: " + translateAuthError(authError.message));
        }

        const authUser = authData.user;
        if (!authUser) {
          throw new Error("Mtumiaji hajapatikana.");
        }

        const { data: profile } = await client
          .from("profiles")
          .select("*")
          .eq("id", authUser.id)
          .maybeSingle();

        // Resolved by the database from the token — see my_congregant_id().
        const { data: congregantId } = await client.rpc("my_congregant_id");
        const { data: congregant } = congregantId
          ? await client.from("congregants").select("*").eq("id", congregantId).maybeSingle()
          : { data: null };

        const userObj = {
          id: authUser.id,
          email: authUser.email || null,
          phoneLogin: authUser.phone || null,
          role: profile?.role || "mshiriki",
          fullName: profile?.full_name || congregant?.full_name || formatPhoneDisplay(authPhone),
          congregantId: congregant?.id || null,
          churchId: congregant?.church_id || null,
          phone: congregant?.phone || null,
          parental_church: congregant?.parental_church || null
        };

        setAuthToken(authData.session?.access_token);
        setUser(userObj);
        localStorage.setItem("mshiriki-user", JSON.stringify(userObj));
        fetchContributions(authUser.id);
      } else {
        // Live Supabase Authenticate via Backend API
        const backendUrl = getBackendUrl();
        const apiUrl = `${backendUrl}/api/auth/login`;
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: toE164(authPhone), password: authPassword })
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Kuingia kumefeli. Hakikisha namba ya simu na nenosiri viko sahihi.");
        }

        const data = await res.json();
        if (data.success && data.user) {
          setAuthToken(data.token);
          setUser(data.user);
          localStorage.setItem("mshiriki-user", JSON.stringify(data.user));
          fetchContributions(data.user.id);
        }
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authPhone || !authPassword || !authConfirmPassword) {
      setAuthError("Tafadhali jaza namba ya simu, nenosiri, na thibitisho la nenosiri.");
      return;
    }

    if (!isValidPhone(authPhone)) {
      setAuthError(PHONE_INVALID_MESSAGE);
      return;
    }

    if (authPassword !== authConfirmPassword) {
      setAuthError("Nenosiri na thibitisho la nenosiri hazifanani.");
      return;
    }
    
    if (authPassword.length < 6) {
      setAuthError("Nenosiri lazima liwe na herufi kuanzia 6 au zaidi.");
      return;
    }
    
    setIsLoadingAuth(true);
    setAuthError("");
    
    try {
      const client = getSupabaseClient();
      if (client) {
        console.log("Using direct client-side Supabase for Register");
        
        // 1. Je, namba hii ya simu ipo kwenye orodha ya washirika?
        //
        // Swali hili linaulizwa KABLA ya kuingia, hivyo linatumia jukumu la
        // `anon`. Jukumu hilo halina ruhusa ya kusoma jedwali lolote — ufunguo
        // wake upo ndani ya APK, hivyo `select * from congregants` hapa
        // ingemruhusu yeyote mwenye app kupata majina na namba za simu za
        // washirika wote. Ndiyo maana ilikataliwa kwa "permission denied for
        // table congregants".
        //
        // Badala yake tunauliza swali moja kupitia RPC inayorudisha ndiyo/hapana
        // pekee — congregant_phone_registered() katika database/schema.sql.
        const phoneInput = toE164(authPhone);
        const { data: isMember, error: cgError } = await client
          .rpc("congregant_phone_registered", { p_phone: phoneInput });

        if (cgError) {
          throw new Error("Imefeli kuangalia orodha ya washirika: " + cgError.message);
        }

        if (!isMember) {
          throw new Error("Namba yako ya simu haijasajiliwa kama mshiriki katika mfumo wa kanisa. Tafadhali wasiliana na viongozi au mhazini wa kanisa lako kukusajili kwanza!");
        }

        // 2. Usajili wa akaunti mpya ya Auth
        const { data: authData, error: authError } = await client.auth.signUp({
          phone: phoneInput,
          password: authPassword,
        });

        if (authError) {
          throw new Error(translateAuthError(authError.message));
        }

        const authUser = authData.user;
        if (!authUser) {
          throw new Error("Haikuweza kupata taarifa za mtumiaji aliyesajiliwa.");
        }

        // 3. Profile HAIWEKWI hapa.
        //
        // handle_new_user() (database/schema.sql) huitengeneza ndani ya muamala
        // ule ule wa usajili, na ndiyo inayoamua jukumu: namba iliyopo kwenye
        // congregants hupata 'mshiriki'. Andiko la hapa lilikuwa linarudia kazi
        // hiyo — na pale uthibitisho unapohitajika hakuna kipindi bado, hivyo
        // lilikuwa linakataliwa kimyakimya kwa sababu matokeo yake
        // hayakuangaliwa kabisa.

        // 4. Hakuna kipindi => project inahitaji uthibitisho wa namba (OTP).
        // Kwa sasa "Confirm phone" imezimwa kwa sababu hakuna mtoa huduma wa
        // SMS, hivyo hii haitokei — lakini ikiwashwa siku moja, hii ndiyo njia
        // sahihi: bila kipindi hakuna namna ya kusoma rekodi yake, na
        // kujifanya tumeingia kungetupeleka kwenye "permission denied".
        if (!authData.session) {
          setAuthMode("login");
          setAuthError("Akaunti imetengenezwa. Thibitisha namba yako ya simu, kisha ingia hapa.");
          return;
        }

        // 5. Sasa tumeingia kweli: soma rekodi yake mwenyewe. Ni database
        // inayotuambia rekodi ipi ni yake (my_congregant_id), kwa sababu
        // ulinganishaji wa namba unahitaji normalize_phone pande zote mbili.
        const { data: congregantId } = await client.rpc("my_congregant_id");
        const { data: congregant } = congregantId
          ? await client.from("congregants").select("*").eq("id", congregantId).maybeSingle()
          : { data: null };

        const userObj = {
          id: authUser.id,
          email: authUser.email || null,
          phoneLogin: authUser.phone || null,
          role: "mshiriki",
          fullName: congregant?.full_name || formatPhoneDisplay(authPhone),
          congregantId: congregant?.id || null,
          churchId: congregant?.church_id || null,
          phone: congregant?.phone || null,
          parental_church: congregant?.parental_church || null
        };

        setAuthToken(authData.session.access_token);
        setUser(userObj);
        localStorage.setItem("mshiriki-user", JSON.stringify(userObj));
        fetchContributions(authUser.id);
      } else {
        // Live Supabase User Register via Backend API
        const backendUrl = getBackendUrl();
        const apiUrl = `${backendUrl}/api/auth/register`;
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: toE164(authPhone), password: authPassword })
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Usajili umeshindwa.");
        }

        const data = await res.json();
        if (data.success && data.user) {
          setAuthToken(data.token);
          setUser(data.user);
          localStorage.setItem("mshiriki-user", JSON.stringify(data.user));
          fetchContributions(data.user.id);
        }
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const handleLogout = async () => {
    // Both key schemes. The cache is keyed by account id now, but a device that
    // was signed in before this change still holds e-mail-keyed entries — and
    // leaving one member's giving history readable to the next person on a
    // shared phone is exactly what this purge exists to prevent.
    const cacheKeys = [user?.id, user?.email].filter(Boolean) as string[];

    // Terminate the Supabase session itself. Clearing local state alone left a
    // valid, auto-refreshing session behind on the device.
    try {
      const client = getSupabaseClient();
      if (client) await client.auth.signOut();
    } catch (err) {
      console.warn("Supabase sign-out failed; clearing local session anyway.", err);
    }

    clearAuthToken();
    setUser(null);
    localStorage.removeItem("mshiriki-user");

    // Purge this member's cached financial records — on a shared phone the next
    // person to sign in must not be able to read them.
    for (const key of cacheKeys) {
      localStorage.removeItem("mshiriki-church-data-" + key);
      localStorage.removeItem("mshiriki-receipt-settings-" + key);
      localStorage.removeItem("mshiriki-contributions-" + key);
      localStorage.removeItem("mshiriki-financial-stats-" + key); // legacy key
      void clearMemberCache(key);
    }

    setAuthPhone("");
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthError("");
    setChurchData(null);
    setReceiptSettings(null);
    setUserContributions([]);
    setFinancialStats({
      totalZaka: 0,
      totalSadaka: 0,
      totalContributions: 0,
      typeBreakdown: { Zaka: 0, Sadaka: 0, Majengo: 0, Makambi: 0 }
    });
  };

  // --- Account deletion -----------------------------------------------------
  // Google Play requires an in-app way to delete an account for any app that
  // lets people create one, plus a public web page describing the same. This is
  // the in-app half; the URL goes in the Play listing.
  //
  // Two confirmations on purpose: this cannot be undone, and it sits a few
  // pixels from "Toka" on a screen people use one-handed in church.
  const [isDeletingAccount, setIsDeletingAccount] = useState<boolean>(false);

  const handleDeleteAccount = async () => {
    if (!window.confirm(
      "Je, una uhakika unataka kufuta akaunti yako?" +
      "\n\n" +
      "Hutaweza kuingia tena kwa namba hii. Kumbukumbu za michango yako zitabaki " +
      "kwenye vitabu vya kanisa lako (ni rekodi za kanisa, siyo zako pekee), na " +
      "ukijisajili tena kwa namba hii utaziona tena."
    )) return;

    if (!window.confirm("Thibitisha mara ya mwisho: futa akaunti yangu sasa.")) return;

    setIsDeletingAccount(true);
    try {
      const client = getSupabaseClient();
      if (client) {
        const { error } = await client.rpc("delete_my_account");
        if (error) throw new Error(error.message);
      } else {
        const res = await fetchWithCache("/api/member/delete-account", { method: "POST" });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Imeshindwa kufuta akaunti.");
        }
      }
      // The login no longer exists, so clear the device exactly as a sign-out
      // would — leaving cached giving records behind would be the whole point
      // of the deletion missed.
      await handleLogout();
      window.alert("Akaunti yako imefutwa.");
    } catch (err: any) {
      window.alert("Imeshindwa kufuta akaunti: " + (err?.message || "Hitilafu isiyojulikana."));
    } finally {
      setIsDeletingAccount(false);
    }
  };

  // Profile completion states
  const [isUpdatingProfile, setIsUpdatingProfile] = useState<boolean>(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState<string>("");
  const [profileErrorMsg, setProfileErrorMsg] = useState<string>("");

  const updateProfileFields = async (fields: { marital_status?: string; gender?: string; residence?: string; age?: number }) => {
    if (!user?.id) return;
    setIsUpdatingProfile(true);
    setProfileSuccessMsg("");
    setProfileErrorMsg("");

    try {
      const client = getSupabaseClient();
      if (client) {
        // Direct client-side update, on the record the database says is mine.
        const { data: congregantId } = await client.rpc("my_congregant_id");
        const { data: congregant, error: cgError } = congregantId
          ? await client.from("congregants").select("*").eq("id", congregantId).maybeSingle()
          : { data: null, error: null };

        if (cgError || !congregant) {
          throw new Error("Rekodi yako haijapatikana kwenye mfumo wa kanisa.");
        }

        // Only ever fills blanks. The database enforces the same rule in
        // guard_congregant_self_update(), so this is the courteous version of a
        // refusal that would otherwise happen silently.
        const updatePayload: Record<string, any> = {};
        if (congregant.age === null || congregant.age === undefined) {
          if (typeof fields.age === "number") {
            updatePayload.age = fields.age;
          }
        }
        if (!congregant.marital_status || congregant.marital_status.trim() === "") {
          if (fields.marital_status && fields.marital_status.trim() !== "") {
            updatePayload.marital_status = fields.marital_status.trim();
          }
        }
        if (!congregant.gender || congregant.gender.trim() === "") {
          if (fields.gender && fields.gender.trim() !== "") {
            updatePayload.gender = fields.gender.trim();
          }
        }
        if (!congregant.residence || congregant.residence.trim() === "") {
          if (fields.residence && fields.residence.trim() !== "") {
            updatePayload.residence = fields.residence.trim();
          }
        }

        if (Object.keys(updatePayload).length > 0) {
          const { error: updateError } = await client
            .from("congregants")
            .update(updatePayload)
            .eq("id", congregant.id);

          if (updateError) {
            throw new Error(updateError.message);
          }

          // Force refetch to sync user state & local storage
          await fetchContributions(user.id);
          setProfileSuccessMsg("Taarifa zako zimesasishwa kikamilifu tayari!");
        } else {
          setProfileSuccessMsg("Taarifa zako tayari ziko up-to-date.");
        }
      } else {
        // Handle via API proxy. fetchWithCache attaches the bearer token; the
        // server resolves the member from it, so no email is sent.
        const res = await fetchWithCache("/api/member/update-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            marital_status: fields.marital_status,
            gender: fields.gender,
            residence: fields.residence,
            age: fields.age
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Imeshindwa kusasisha taarifa.");
        }

        // Force refetch to sync user state & local storage
        await fetchContributions(user.id);
        setProfileSuccessMsg("Taarifa zako zimesasishwa kikamilifu tayari!");
      }
    } catch (err: any) {
      console.error(err);
      setProfileErrorMsg(err.message || "Hitilafu imetokea wakati wa kusasisha.");
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const checkSupabaseConfig = async () => {
    try {
      // First check if direct client-side Supabase client is configured
      const directClient = getSupabaseClient();
      if (directClient) {
        console.log("Direct client-side Supabase is fully configured!");
        setSupabaseConfigured(true);
        setIsDemoMode(false);
        return;
      }

      // Otherwise fall back to check intermediate server config
      const backendUrl = getBackendUrl();
      if (!backendUrl) {
        setSupabaseConfigured(false);
        return;
      }
      const apiUrl = `${backendUrl}/api/supabase-config-check`;
      const res = await fetch(apiUrl);
      if (res.ok) {
        const check = await res.json();
        setSupabaseConfigured(check.isConfigured);
        if (check.isConfigured) {
          setIsDemoMode(false);
        }
      } else {
        setSupabaseConfigured(false);
      }
    } catch (err) {
      console.warn("Could not check Supabase, defaulting to demo:", err);
      setSupabaseConfigured(false);
    }
  };

  // Check Supabase connection on load
  useEffect(() => {
    checkSupabaseConfig().then(async () => {
      // Re-issue the API token from the live Supabase session. Without this a
      // restored login would carry an expired token into /api/member/* calls.
      try {
        const client = getSupabaseClient();
        if (client) {
          const { data } = await client.auth.getSession();
          if (data?.session?.access_token) setAuthToken(data.session.access_token);
        }
      } catch (err) {
        console.warn("Could not refresh session token on boot", err);
      }

      const savedUser = localStorage.getItem("mshiriki-user");
      if (savedUser) {
        try {
          const parsed = JSON.parse(savedUser);
          setUser(parsed);
          // Keyed by account id. A session saved before this change has no
          // `id` on some builds; skipping the refetch is better than caching
          // under "undefined" and showing one member another's records.
          if (parsed?.id) fetchContributions(parsed.id);
        } catch (_) {
          localStorage.removeItem("mshiriki-user");
        }
      }
    });
  }, []);

  // --- Boot Client-Side SQLite WASM Database ---
  useEffect(() => {
    const unsubscribe = subscribeToDBProgress((prog) => {
      setDbProgressState(prog);
    });

    initializeDatabases().catch((err) => {
      console.error("Critical error loading SQLite WASM database", err);
    });

    return () => unsubscribe();
  }, []);

  // --- Initial Offline Databases Boot ---
  useEffect(() => {
    if (dbProgressState.status !== "ready") return;

    try {
      const dbTestaments = dbService.getTestaments();
      setTestaments(dbTestaments);

      const dbBooks = dbService.getBooks();
      setBooks(dbBooks);
      
      const savedBookId = localStorage.getItem("bible-last-book-id");
      const savedChapter = localStorage.getItem("bible-last-chapter");
      const hasChosenFirstTime = localStorage.getItem("bible-has-selected-first-time") === "true";

      if (dbBooks.length > 0 && !selectedBook) {
        let initialBook = dbBooks[0];
        let initialChapter = 1;

        if (savedBookId) {
          const matched = dbBooks.find(b => b.id.toString() === savedBookId);
          if (matched) {
            initialBook = matched;
          }
        }
        if (savedChapter) {
          initialChapter = Number(savedChapter);
        }

        setSelectedBook(initialBook);
        setCurrentChapter(initialChapter);
        setCurrentTestamentId(initialBook.testament_id);

        // The book selector used to spring open here, on the very first
        // startup, back when the app opened on the Biblia tab. It now opens on
        // Taarifa, so doing that covers the sign-in card with a list of Bible
        // books the moment a new user arrives. The same orientation now
        // happens on the first visit to Biblia instead — see goToBiblia().
        void hasChosenFirstTime;
      }

      const dbSongs = dbService.getSongs();
      setSongs(dbSongs);
      if (dbSongs.length > 0 && !selectedSong) {
        setSelectedSong(dbSongs[0]);
      }
    } catch (err: any) {
      console.error("Error loading initial data from SQLite WASM:", err);
      setDbProgressState({
        status: "error",
        percent: 0,
        message: `Kushindwa kupata vitabu vya Biblia: ${err?.message || err}`
      });
    }
  }, [dbProgressState.status]);

  // --- Fetch Scripture Verses on Navigation ---
  useEffect(() => {
    if (dbProgressState.status !== "ready" || !selectedBook) return;
    
    try {
      const dbVerses = dbService.getVerses(selectedBook.id, currentChapter);
      setVerses(dbVerses);
      // A new chapter always starts at the top — unless the reader picked a
      // specific verse, in which case the effect below scrolls to it. Returning
      // to a chapter you were already reading is handled separately, by
      // pendingBibleRestore.
      //
      // The jump has to be instant. The container is `scroll-smooth`, so a
      // plain assignment animates: leaving Zaburi 119 from 8,000px down meant
      // watching the whole chapter scroll past before the new one appeared.
      if (readingContainerRef.current && pendingVerseNumber === null) {
        const el = readingContainerRef.current;
        const previous = el.style.scrollBehavior;
        el.style.scrollBehavior = "auto";
        el.scrollTop = 0;
        el.style.scrollBehavior = previous;
      }
    } catch (err: any) {
      console.error("Error loading verses from SQLite WASM:", err);
      // Don't crash entirely but show error info
      setDbProgressState({
        status: "error",
        percent: 0,
        message: `Kushindwa kufungua mlango: ${err?.message || err}`
      });
    }
  }, [selectedBook, currentChapter, dbProgressState.status]);

  // --- Land on the verse chosen in the selector ---
  // A layout effect, so the placement happens in the same frame the chapter is
  // painted: asking for Zaburi 119:176 puts you at 176, rather than showing
  // verse 1 and then travelling 8,000px past the whole chapter to get there.
  useLayoutEffect(() => {
    if (pendingVerseNumber === null) return;
    if (!selectedBook || verses.length === 0) return;

    // `verses` still holds the PREVIOUS chapter for one render after navigating.
    // Acting on it would match a same-numbered verse from the wrong chapter and
    // burn the pending jump, so wait until the array is the one we asked for.
    if (verses[0].book_id !== selectedBook.id || verses[0].chapter !== currentChapter) return;

    const target = verses.find(v => v.verse === pendingVerseNumber);
    if (!target) {
      setPendingVerseNumber(null);
      return;
    }

    // A plain tint that fades on its own, not the tap-to-select state — landing
    // on a verse should not pop the copy toolbar open over it.
    setLandedVerseId(target.id);

    // Positioned from rect deltas rather than scrollIntoView: the reader slides
    // in horizontally, and scrollIntoView is thrown off by a transformed
    // ancestor. A vertical gap between two rects is unaffected by that
    // translate, so this stays correct mid-flight.
    let placedAt: number | null = null;
    const place = () => {
      const container = readingContainerRef.current;
      const el = document.getElementById(`verse-${target.id}`);
      if (!container || !el) return;
      // Never yank a reader who has started scrolling for themselves.
      if (placedAt !== null && Math.abs(container.scrollTop - placedAt) > 2) return;

      const delta = (el.getBoundingClientRect().top - container.getBoundingClientRect().top)
        - container.clientHeight / 3;   // sit a third down, not jammed to the top
      const top = Math.max(0, container.scrollTop + delta);

      // The container is `scroll-smooth`, and `behavior: "auto"` defers to that
      // CSS — which is the animated travel we are getting rid of. Suspend the
      // property for the assignment instead.
      const previous = container.style.scrollBehavior;
      container.style.scrollBehavior = "auto";
      container.scrollTop = top;
      container.style.scrollBehavior = previous;

      // Record what the container actually settled on, not what we asked for.
      // The outgoing chapter is still absolutely positioned in the scroller on
      // this first pass, so a request past the current scroll range gets
      // clamped; storing the requested value would make the re-measure below
      // mistake that clamp for the reader scrolling, and skip the correction.
      placedAt = container.scrollTop;
    };

    place();

    // One silent re-measure once the 220ms slide has settled. If the first pass
    // was right this is a no-op; it only earns its keep when the verse had not
    // been laid out yet at commit time.
    const timer = setTimeout(() => {
      place();
      setPendingVerseNumber(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [verses, pendingVerseNumber, selectedBook, currentChapter]);

  // --- Retire the landing tint ---
  useEffect(() => {
    if (landedVerseId === null) return;
    const timer = setTimeout(() => setLandedVerseId(null), LANDING_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [landedVerseId]);

  // --- Fetch Detailed Hymn Lyrics when Selected ---
  useEffect(() => {
    if (dbProgressState.status !== "ready") return;
    const songToFetch = songDetailView || selectedSong;
    if (!songToFetch) return;

    try {
      const details = dbService.getSongDetail(songToFetch.id);
      if (details) {
        setCurrentSongDetail(details);
      }
    } catch (err: any) {
      console.error("Error loading hymn lyrics from SQLite WASM:", err);
      setDbProgressState({
        status: "error",
        percent: 0,
        message: `Kushindwa kupata maudhui ya wimbo: ${err?.message || err}`
      });
    }
  }, [selectedSong, songDetailView, dbProgressState.status]);

  // --- Live Search Global Scriptures ---
  useEffect(() => {
    if (dbProgressState.status !== "ready") return;
    const delayDebounceSelector = setTimeout(() => {
      if (searchQuery.trim().length < 2) {
        setSearchResults([]);
        setSearchMeta({ total: 0, books: 0, truncated: false });
        setSearchJump(null);
        return;
      }
      setIsSearching(true);
      try {
        // "Yakobo 4:7" is a reference, not a phrase to find inside verses.
        setSearchJump(dbService.lookupReference(searchQuery));
        const found = dbService.searchScriptures(searchQuery);
        setSearchResults(found.results);
        setSearchMeta({ total: found.total, books: found.books, truncated: found.truncated });
      } catch (err) {
        console.error("Error searching scripture text:", err);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(delayDebounceSelector);
  }, [searchQuery, dbProgressState.status]);

  // --- Live Search Scriptures in Book Selector ---
  useEffect(() => {
    if (dbProgressState.status !== "ready") return;
    const delayDebounce = setTimeout(() => {
      const query = selectorBookSearch.trim();
      if (query.length < 2) {
        setSelectorScriptureResults([]);
        setSelectorMeta({ total: 0, books: 0, truncated: false });
        setSelectorJump(null);
        return;
      }
      setIsSearchingSelectorScriptures(true);
      try {
        setSelectorJump(dbService.lookupReference(query));
        const found = dbService.searchScriptures(query);
        setSelectorScriptureResults(found.results);
        setSelectorMeta({ total: found.total, books: found.books, truncated: found.truncated });
      } catch (err) {
        console.error("Error searching scripture in selector:", err);
      } finally {
        setIsSearchingSelectorScriptures(false);
      }
    }, 250);

    return () => clearTimeout(delayDebounce);
  }, [selectorBookSearch, dbProgressState.status]);

  // --- Live Search Nyimbo catalog ---
  useEffect(() => {
    if (dbProgressState.status !== "ready") return;
    const delayDebounceSelector = setTimeout(() => {
      if (songSearchQuery.trim().length === 0) {
        setSongSearchResults([]);
        return;
      }
      setIsSearchingSongs(true);
      try {
        const results = dbService.searchSongs(songSearchQuery);
        setSongSearchResults(results);
      } catch (err) {
        console.error("Error searching hymns database:", err);
      } finally {
        setIsSearchingSongs(false);
      }
    }, 200);

    return () => clearTimeout(delayDebounceSelector);
  }, [songSearchQuery, dbProgressState.status]);

  // --- Scripture Navigation ---
  const handleBookChange = (book: Book, chapter: number = 1) => {
    let dir = 1;
    if (selectedBook) {
      if (book.id < selectedBook.id) {
        dir = -1;
      } else if (book.id === selectedBook.id && chapter < currentChapter) {
        dir = -1;
      }
    }
    setBibleDirection(dir);
    setSelectedBook(book);
    setCurrentChapter(chapter);
  };

  const handleNextChapter = () => {
    if (!selectedBook) return;
    setBibleDirection(1);
    if (currentChapter < selectedBook.chapter_count) {
      setCurrentChapter(currentChapter + 1);
    } else {
      // Shift to next book
      const currentIdx = books.findIndex(b => b.id === selectedBook.id);
      if (currentIdx !== -1 && currentIdx < books.length - 1) {
        const nextBook = books[currentIdx + 1];
        setSelectedBook(nextBook);
         setCurrentChapter(1);
      }
    }
  };

  const handlePrevChapter = () => {
    if (!selectedBook) return;
    setBibleDirection(-1);
    if (currentChapter > 1) {
      setCurrentChapter(currentChapter - 1);
    } else {
      // Shift to previous book's last chapter
      const currentIdx = books.findIndex(b => b.id === selectedBook.id);
      if (currentIdx !== -1 && currentIdx > 0) {
        const prevBook = books[currentIdx - 1];
        setSelectedBook(prevBook);
        setCurrentChapter(prevBook.chapter_count);
      }
    }
  };

  // Navigating directly from elements like Daily Verse or Bookmarks
  const handleNavigateToVerse = (v: Verse) => {
    const targetBook = books.find(b => b.id === v.book_id);
    if (targetBook) {
      let dir = 1;
      if (selectedBook) {
        if (targetBook.id < selectedBook.id) {
          dir = -1;
        } else if (targetBook.id === selectedBook.id && v.chapter < currentChapter) {
          dir = -1;
        }
      }
      setBibleDirection(dir);
      setSelectedBook(targetBook);
      setCurrentChapter(v.chapter);
      // Hand the verse to the landing effect rather than only tinting it. It
      // used to be marked but never scrolled to, so following a search result
      // for Zaburi 119:176 dropped you at the top of the chapter with the
      // highlight sitting 8,000px below the fold.
      setPendingVerseNumber(v.verse);
      setActiveTab("biblia");
      setShowSearchModal(false);
      setIsBookSelectorOpen(false);
    }
  };

  /**
   * Opens the Biblia tab, offering the book selector on a first-ever visit so a
   * new reader is not dropped into Genesis 1 with no sense of where they are.
   * Once they have picked a book the app remembers it and goes straight there.
   */
  const goToBiblia = () => {
    setActiveTab("biblia");
    setShowSearchModal(false);
    if (localStorage.getItem("bible-has-selected-first-time") !== "true") {
      setSelectorStep("book");
      setIsBookSelectorOpen(true);
      // Mark it here, not only when a book is finally picked. Otherwise anyone
      // who dismisses the selector without choosing gets it thrown at them
      // again on every single visit to Biblia — the flag is meant to record
      // "we have oriented this user once", not "this user obeyed".
      localStorage.setItem("bible-has-selected-first-time", "true");
    } else {
      setIsBookSelectorOpen(false);
    }
  };

  const handleNavigateToSong = (song: Song) => {
    let dir = 1;
    if (songDetailView) {
      if (song.id < songDetailView.id) {
        dir = -1;
      }
    }
    setSongDirection(dir);
    setSongDetailView(song);
    setSelectedSong(song);
    setActiveTab("nyimbo");
  };

  const handlePrevSong = () => {
    if (!songDetailView) return;
    setSongDirection(-1);
    const currentIdx = songs.findIndex(s => s.id === songDetailView.id);
    if (currentIdx > 0) {
      setSongDetailView(songs[currentIdx - 1]);
    }
  };

  const handleNextSong = () => {
    if (!songDetailView) return;
    setSongDirection(1);
    const currentIdx = songs.findIndex(s => s.id === songDetailView.id);
    if (currentIdx < songs.length - 1) {
      setSongDetailView(songs[currentIdx + 1]);
    }
  };

  const lastBibleSwipeTime = useRef<number>(0);
  const lastSongSwipeTime = useRef<number>(0);

  // Bible gesture navigation (swipe & sideways wheel scroll)
  useEffect(() => {
    const element = readingContainerRef.current;
    if (!element) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length === 1) {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const duration = Date.now() - touchStartTime;

        if (duration < 500) {
          const diffX = touchEndX - touchStartX;
          const diffY = touchEndY - touchStartY;

          // Must be primarily horizontal and exceed threshold
          if (Math.abs(diffX) > Math.abs(diffY) * 1.5 && Math.abs(diffX) > 60) {
            const now = Date.now();
            if (now - lastBibleSwipeTime.current > 600) {
              lastBibleSwipeTime.current = now;
              if (diffX > 0) {
                handlePrevChapter();
              } else {
                handleNextChapter();
              }
            }
          }
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 15) {
        const now = Date.now();
        if (now - lastBibleSwipeTime.current > 700) {
          lastBibleSwipeTime.current = now;
          if (e.deltaX > 0) {
            handleNextChapter();
          } else {
            handlePrevChapter();
          }
        }
      }
    };

    element.addEventListener("touchstart", handleTouchStart, { passive: true });
    element.addEventListener("touchend", handleTouchEnd, { passive: true });
    element.addEventListener("wheel", handleWheel, { passive: true });

    return () => {
      element.removeEventListener("touchstart", handleTouchStart);
      element.removeEventListener("touchend", handleTouchEnd);
      element.removeEventListener("wheel", handleWheel);
    };
  }, [selectedBook, currentChapter, books]);

  // Song gesture navigation (swipe & sideways wheel scroll)
  useEffect(() => {
    const element = songScrollContainerRef.current;
    if (!element) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length === 1) {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const duration = Date.now() - touchStartTime;

        if (duration < 500) {
          const diffX = touchEndX - touchStartX;
          const diffY = touchEndY - touchStartY;

          // Must be primarily horizontal and exceed threshold
          if (Math.abs(diffX) > Math.abs(diffY) * 1.5 && Math.abs(diffX) > 60) {
            const now = Date.now();
            if (now - lastSongSwipeTime.current > 600) {
              lastSongSwipeTime.current = now;
              if (diffX > 0) {
                handlePrevSong();
              } else {
                handleNextSong();
              }
            }
          }
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 15) {
        const now = Date.now();
        if (now - lastSongSwipeTime.current > 700) {
          lastSongSwipeTime.current = now;
          if (e.deltaX > 0) {
            handleNextSong();
          } else {
            handlePrevSong();
          }
        }
      }
    };

    element.addEventListener("touchstart", handleTouchStart, { passive: true });
    element.addEventListener("touchend", handleTouchEnd, { passive: true });
    element.addEventListener("wheel", handleWheel, { passive: true });

    return () => {
      element.removeEventListener("touchstart", handleTouchStart);
      element.removeEventListener("touchend", handleTouchEnd);
      element.removeEventListener("wheel", handleWheel);
    };
  }, [songDetailView, songs]);

  // --- Favorite Toggle Handlers ---
  const toggleFavoriteVerse = (v: Verse) => {
    const defaultBookName = selectedBook?.name || "Biblia";
    const item: Verse = {
      ...v,
      book_name: v.book_name || defaultBookName
    };

    setFavorites(prev => {
      const exists = prev.some(f => f.id === v.id);
      if (exists) {
        return prev.filter(f => f.id !== v.id);
      } else {
        return [...prev, item];
      }
    });
  };

  const isVerseFavorite = (verseId: number) => {
    return favorites.some(f => f.id === verseId);
  };

  const toggleFavoriteSong = (s: Song) => {
    setFavoriteSongs(prev => {
      const exists = prev.some(f => f.id === s.id);
      if (exists) {
        return prev.filter(f => f.id !== s.id);
      } else {
        return [...prev, s];
      }
    });
  };

  const isSongFavorite = (songId: number) => {
    return favoriteSongs.some(f => f.id === songId);
  };

  // --- Copy Clipboard Helpers ---
  const copyTextToClipboard = (text: string, id: number, type: "verse" | "song") => {
    navigator.clipboard.writeText(text);
    if (type === "verse") {
      setCopiedVerseId(id);
      setTimeout(() => setCopiedVerseId(null), 2000);
    } else {
      setCopiedSongId(id);
      setTimeout(() => setCopiedSongId(null), 2000);
    }
  };

  // Filter selector books (displays selected testament or searches globally)
  const filteredSelectorBooks = books.filter(b => {
    const matchesSearch = b.name.toLowerCase().includes(selectorBookSearch.toLowerCase());
    if (selectorBookSearch) {
      return matchesSearch;
    }
    return matchesSearch && b.testament_id === currentTestamentId;
  });

  // --- Beautiful Congregant Report Renderer ---
  const renderCongregantReport = (
    member: any,
    contributionsList: any[],
    stats: any,
    church: any
  ) => {
    // Standard Swahili short months for loyalty checklist
    const miezi = [
      { id: 1, kirefu: "Januari", kifupi: "Jan" },
      { id: 2, kirefu: "Februari", kifupi: "Feb" },
      { id: 3, kirefu: "Machi", kifupi: "Mar" },
      { id: 4, kirefu: "Aprili", kifupi: "Apr" },
      { id: 5, kirefu: "Mei", kifupi: "Mei" },
      { id: 6, kirefu: "Juni", kifupi: "Jun" },
      { id: 7, kirefu: "Julai", kifupi: "Jul" },
      { id: 8, kirefu: "Agosti", kifupi: "Ago" },
      { id: 9, kirefu: "Septemba", kifupi: "Sep" },
      { id: 10, kirefu: "Oktoba", kifupi: "Okt" },
      { id: 11, kirefu: "Novemba", kifupi: "Nov" },
      { id: 12, kirefu: "Desemba", kifupi: "Des" }
    ];

    // Determine tithing checkmarks for each month (e.g. if there's tithing in that month)
    const tithingMonths = contributionsList
      .filter(c => c.type === "Zaka" && c.created_at)
      .map(c => new Date(c.created_at).getMonth() + 1);

    // --- DYNAMIC DATED GROUPS GENERATORS ---
    const getMonthlyReports = () => {
      const groups: Record<string, {
        id: string;
        year: number;
        month: number;
        monthName: string;
        contributions: any[];
        totalZaka: number;
        totalSadaka: number;
        totalOther: number;
        total: number;
      }> = {};

      contributionsList.forEach(c => {
        if (!c.created_at) return;
        const d = new Date(c.created_at);
        const y = d.getFullYear();
        const m = d.getMonth() + 1; // 1-12
        const key = `${y}-${m}`;

        const monthName = miezi.find(item => item.id === m)?.kirefu || `Mwezi ${m}`;

        if (!groups[key]) {
          groups[key] = {
            id: key,
            year: y,
            month: m,
            monthName,
            contributions: [],
            totalZaka: 0,
            totalSadaka: 0,
            totalOther: 0,
            total: 0
          };
        }

        const amt = parseFloat(c.amount) || 0;
        groups[key].contributions.push(c);
        groups[key].total += amt;
        if (c.type === "Zaka") {
          groups[key].totalZaka += amt;
        } else if (c.type === "Sadaka") {
          groups[key].totalSadaka += amt;
        } else {
          groups[key].totalOther += amt;
        }
      });

      return Object.values(groups).sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      });
    };

    const getYearlyReports = () => {
      const groups: Record<number, {
        year: number;
        contributions: any[];
        totalZaka: number;
        totalSadaka: number;
        totalOther: number;
        total: number;
        activeMonths: Set<number>;
      }> = {};

      contributionsList.forEach(c => {
        if (!c.created_at) return;
        const d = new Date(c.created_at);
        const y = d.getFullYear();

        if (!groups[y]) {
          groups[y] = {
            year: y,
            contributions: [],
            totalZaka: 0,
            totalSadaka: 0,
            totalOther: 0,
            total: 0,
            activeMonths: new Set<number>()
          };
        }

        const amt = parseFloat(c.amount) || 0;
        groups[y].contributions.push(c);
        groups[y].total += amt;
        if (c.type === "Zaka") {
          groups[y].totalZaka += amt;
          groups[y].activeMonths.add(d.getMonth() + 1);
        } else if (c.type === "Sadaka") {
          groups[y].totalSadaka += amt;
        } else {
          groups[y].totalOther += amt;
        }
      });

      return Object.values(groups).sort((a, b) => b.year - a.year);
    };

    const monthlyReports = getMonthlyReports();
    const yearlyReports = getYearlyReports();

    return (
      <div className="space-y-4">
        {/* SUB-TAB NAV
            Was four tabs. "Mwezi" listed every month's total and "Mwaka" every
            year's total — both are already inside "Historia", which shows a year
            summary followed by that year's twelve months. Three of the four tabs
            were the same figures grouped differently, so the two duplicates are
            gone. Nothing is lost: pick a year in Historia to get either view. */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-[#0d1124] border border-slate-200 dark:border-[#1c2245] rounded-2xl select-none text-[12px] font-bold uppercase tracking-wider font-sans">
          <button
            onClick={() => setReportSubTab("muhtasari")}
            aria-pressed={reportSubTab === "muhtasari"}
            className={`py-3 min-h-[44px] rounded-xl transition cursor-pointer text-center ${
              reportSubTab === "muhtasari"
                ? "bg-amber-700 text-white shadow-xs font-black"
                : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
            }`}
          >
            Muhtasari
          </button>
          <button
            onClick={() => {
              setReportSubTab("historia");
              // Land on the most recent year that actually has giving in it.
              const yrs = Array.from(new Set(contributionsList.filter(c => c.created_at).map(c => new Date(c.created_at).getFullYear())));
              setSelectedHistoryYear(yrs.length > 0 ? Math.max(...yrs) : new Date().getFullYear());
              setSelectedHistoryMonth(null);
            }}
            aria-pressed={reportSubTab === "historia"}
            className={`py-3 min-h-[44px] rounded-xl transition cursor-pointer text-center ${
              reportSubTab === "historia"
                ? "bg-amber-700 text-white shadow-xs font-black"
                : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
            }`}
          >
            Historia
          </button>
        </div>

        {/* 1. MUHTASARI (SUMMARY VIEW) */}
        {reportSubTab === "muhtasari" && (
          <div className="space-y-5 animate-in fade-in duration-200">
            {/* MEMBER CARD
                Follows the theme: a light gold-washed card on the cream page,
                the navy card in dark mode. It used to be dark navy in both,
                which read as a foreign slab in light mode.

                Removed at the owner's request: the "KADI YA MSHIRIKI DIGITAL"
                banner, the rotated church-name disc, the CG-year pill, and the
                "Kanisa Wazazi" field. */}
            <div className="w-full p-6 text-left rounded-3xl relative overflow-hidden shadow-lg
                            bg-gradient-to-br from-white via-[#FEFBF4] to-[#F7EFDD] border border-[#d9a020]/35
                            dark:from-[#1c2245] dark:via-[#151b38] dark:to-[#0d1124] dark:border-amber-500/25">
              {/* Soft gold wash, stronger in light mode so the card still reads
                  as a card against the cream page. */}
              <div className="absolute right-0 bottom-0 w-36 h-36 rounded-full pointer-events-none -mr-10 -mb-10 blur-xl bg-amber-500/[0.10] dark:bg-amber-500/[0.04]" />
              <div className="absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl pointer-events-none bg-gradient-to-bl from-amber-500/20 dark:from-amber-500/10 to-transparent" />

              <h4 className="relative font-serif font-black text-neutral-900 dark:text-white text-lg tracking-tight uppercase font-display">
                {member.fullName}
              </h4>

              <div className="relative grid grid-cols-2 gap-y-4 gap-x-3 pt-4 mt-4 border-t border-black/10 dark:border-white/10 text-left">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-widest text-slate-600 dark:text-[var(--muted-ink)] font-extrabold select-none">
                    Kanisa
                  </p>
                  <p className="text-sm font-serif font-bold text-neutral-800 dark:text-amber-100/90 truncate mt-0.5">
                    {church ? church.name : "-"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-widest text-slate-600 dark:text-[var(--muted-ink)] font-extrabold select-none">
                    Mtaa / Makazi
                  </p>
                  <p className="text-sm font-serif font-bold text-neutral-800 dark:text-amber-100/90 truncate mt-0.5 font-display">
                    {member.residence || "-"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-widest text-slate-600 dark:text-[var(--muted-ink)] font-extrabold select-none">
                    Namba ya Simu
                  </p>
                  <p className="text-sm font-mono font-bold text-neutral-800 dark:text-amber-100/90 truncate mt-0.5">
                    {formatPhoneDisplay(member.phone) || member.phone || "-"}
                  </p>
                </div>
              </div>
            </div>

            {/* GRAND TOTAL
                The page showed Zaka, Sadaka and Nyinginezo separately but never
                their sum — the one figure a member opens this tab to find. The
                three cards below now read as a breakdown of this number, and
                the period each figure covers is stated instead of implied. */}
            <div className="p-4 rounded-3xl bg-white dark:bg-[#131730] border border-slate-100 dark:border-[#1c2245] text-left">
              <div className="flex items-baseline justify-between gap-2 select-none">
                <span className="text-[12px] font-black uppercase tracking-widest text-[var(--muted-ink)] font-mono">
                  Jumla ya Michango Yako
                </span>
                <span className="text-[11px] font-bold text-[var(--muted-ink)] font-mono uppercase">Muda wote</span>
              </div>
              <p className="mt-1.5 text-3xl font-black font-mono text-neutral-900 dark:text-white leading-none">
                {Math.round(stats.totalContributions).toLocaleString()}
                <span className="ml-1.5 text-sm font-bold text-[var(--gold-ink)] align-baseline">TZS</span>
              </p>
              <p className="mt-2 text-[12px] text-[var(--muted-ink)] font-sans">
                Kutoka michango {contributionsList.length} tangu ulipojiunga.
              </p>
            </div>

            {/* STATS GRID — breakdown of the total above */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-3 bg-emerald-500/[0.04] dark:bg-emerald-950/15 border border-emerald-100/60 dark:border-emerald-900/20 rounded-2xl text-left shadow-3xs">
                <div className="flex items-center justify-between text-emerald-800 dark:text-emerald-400 mb-1 select-none">
                  <span className="text-[11px] font-black uppercase tracking-wider">Zaka</span>
                  <Coins className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="text-sm font-black font-mono text-neutral-900 dark:text-emerald-300">
                  {stats.totalZaka.toLocaleString()}
                </p>
                <span className="text-[11px] font-bold text-[var(--muted-ink)] font-mono">TZS</span>
              </div>

              <div className="p-3 bg-amber-500/[0.04] dark:bg-amber-950/15 border border-amber-100/60 dark:border-amber-900/20 rounded-2xl text-left shadow-3xs">
                <div className="flex items-center justify-between text-[#8f6113] dark:text-[#d9a020] mb-1 select-none">
                  <span className="text-[11px] font-black uppercase tracking-wider">Sadaka</span>
                  <PiggyBank className="w-3 h-3 text-[var(--gold-ink)] dark:text-[#d9a020]" />
                </div>
                <p className="text-sm font-black font-mono text-neutral-900 dark:text-amber-300">
                  {stats.totalSadaka.toLocaleString()}
                </p>
                <span className="text-[11px] font-bold text-[var(--muted-ink)] font-mono">TZS</span>
              </div>

              <div className="p-3 bg-indigo-500/[0.04] dark:bg-indigo-950/15 border border-indigo-100/60 dark:border-indigo-900/20 rounded-2xl text-left shadow-3xs">
                <div className="flex items-center justify-between text-indigo-800 dark:text-indigo-400 mb-1 select-none">
                  <span className="text-[11px] font-black uppercase tracking-wider">Nyinginezo</span>
                  <TrendingUp className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                </div>
                <p className="text-sm font-black font-mono text-neutral-900 dark:text-indigo-300">
                  {Math.max(0, (stats.totalContributions - stats.totalZaka - stats.totalSadaka)).toLocaleString()}
                </p>
                <span className="text-[11px] font-bold text-[var(--muted-ink)] font-mono">TZS</span>
              </div>
             </div>
 
            {/* INK-PERFECT PROGRESS AND TREND CHART */}
            <div className="p-4 rounded-3xl bg-white dark:bg-[#131730] border border-slate-100 dark:border-[#1c2245] text-left">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4 select-none">
                <div>
                  <h4 className="text-[12px] font-black text-neutral-500 dark:text-neutral-400 uppercase tracking-widest font-mono">
                    {(() => {
                      const now = new Date();
                      const graphYear = now.getFullYear();
                      const graphMonthIndex = now.getMonth();
                      const graphMonthInfo = miezi[graphMonthIndex] || { kirefu: "Mwezi wa Sasa" };

                      return graphPeriod === "mwezi" 
                        ? `${graphMonthInfo.kirefu.toUpperCase()} ${graphYear}` 
                        : `MWAKA ${graphYear}`;
                    })()}
                  </h4>
                  <p className="text-[13px] font-black text-neutral-900 dark:text-white mt-0.5">
                    Zaka na Sadaka kwa kipindi hiki (TZS)
                  </p>
                </div>
                
                {/* Micro Toggles with high-contrast text */}
                <div className="flex items-center bg-white dark:bg-[#0d1124] border border-neutral-200 dark:border-[#1c2245] p-0.5 rounded-xl shrink-0">
                  <button
                    onClick={() => setGraphPeriod("mwezi")}
                    className={`px-2.5 py-1 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                      graphPeriod === "mwezi"
                        ? "bg-amber-700 text-white shadow-xs"
                        : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white"
                    }`}
                  >
                    Kila Siku
                  </button>
                  <button
                    onClick={() => setGraphPeriod("mwaka")}
                    className={`px-2.5 py-1 text-[11px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                      graphPeriod === "mwaka"
                        ? "bg-amber-700 text-white shadow-xs"
                        : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white"
                    }`}
                  >
                    Kila Mwezi
                  </button>
                </div>
              </div>

              {/* Compute chart parameters */}
              {(() => {
                // Always the month/year the member is actually in — see note above.
                const nowForGraph = new Date();
                const graphYear = nowForGraph.getFullYear();
                const graphMonthIndex = nowForGraph.getMonth();
                const graphMonthInfo = miezi[graphMonthIndex] || { kirefu: "Mwezi wa Sasa", kifupi: "Sasa" };
                
                let graphData: { label: string; fullLabel: string; zaka: number; sadaka: number; key: string }[] = [];
                
                if (graphPeriod === "mwezi") {
                  // Monthly view: display the days of the active month, grouped by 2 days to fit the space nicely
                  const daysCount = new Date(graphYear, graphMonthIndex + 1, 0).getDate();
                  const groupsCount = Math.ceil(daysCount / 2);
                  
                  graphData = Array.from({ length: groupsCount }, (_, i) => {
                    const startDay = i * 2 + 1;
                    const endDay = Math.min(startDay + 1, daysCount);
                    
                    const zaka = contributionsList
                      .filter(c => {
                        if (c.type !== "Zaka" || !c.created_at) return false;
                        const d = new Date(c.created_at);
                        const day = d.getDate();
                        return day >= startDay && day <= endDay && d.getMonth() === graphMonthIndex && d.getFullYear() === graphYear;
                      })
                      .reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
                      
                    const sadaka = contributionsList
                      .filter(c => {
                        if (c.type !== "Sadaka" || !c.created_at) return false;
                        const d = new Date(c.created_at);
                        const day = d.getDate();
                        return day >= startDay && day <= endDay && d.getMonth() === graphMonthIndex && d.getFullYear() === graphYear;
                      })
                      .reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
                      
                    const label = startDay === endDay ? `${startDay}` : `${endDay}`;
                    return {
                      label,
                      fullLabel: startDay === endDay ? `Tarehe ${startDay} ${graphMonthInfo.kirefu}` : `Tarehe ${startDay} hadi ${endDay} ${graphMonthInfo.kirefu}`,
                      zaka,
                      sadaka,
                      key: `d-${startDay}`
                    };
                  });
                } else {
                  // Yearly view: display the 12 months of the year
                  graphData = miezi.map((m, index) => {
                    const zaka = contributionsList
                      .filter(c => c.type === "Zaka" && c.created_at && new Date(c.created_at).getMonth() === index && new Date(c.created_at).getFullYear() === graphYear)
                      .reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
                      
                    const sadaka = contributionsList
                      .filter(c => c.type === "Sadaka" && c.created_at && new Date(c.created_at).getMonth() === index && new Date(c.created_at).getFullYear() === graphYear)
                      .reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
                      
                    return {
                      label: m.kifupi,
                      fullLabel: m.kirefu,
                      zaka,
                      sadaka,
                      key: `m-${index}`
                    };
                  });
                }

                const maxGraphVal = Math.max(...graphData.map(d => Math.max(d.zaka, d.sadaka)), 1000);

                return (
                  <>
                    {/* The Graph Layout */}
                    <div className="relative pt-4 pb-2 border-b border-neutral-200/50 dark:border-neutral-800/50">
                      {/* Horizontal Background Grid Guide Lines */}
                      <div className="absolute inset-x-0 bottom-6 top-4 flex flex-col justify-between pointer-events-none select-none">
                        <div className="w-full border-t border-dashed border-neutral-200/50 dark:border-neutral-800/40" />
                        <div className="w-full border-t border-dashed border-neutral-200/50 dark:border-neutral-800/40" />
                        <div className="w-full border-t border-dashed border-neutral-200/50 dark:border-neutral-800/40" />
                      </div>

                      {/* Columns Container */}
                      <div className="relative h-28 flex items-end justify-between gap-[1px] sm:gap-1 px-0.5 select-none w-full">
                        {graphData.map((d) => {
                          const zakaPercent = (d.zaka / maxGraphVal) * 100;
                          const sadakaPercent = (d.sadaka / maxGraphVal) * 100;

                          return (
                            <div key={d.key} className="flex flex-col items-center flex-1 min-w-0 group h-full">
                              {/* Bars stack side by side */}
                              <div className="relative flex-1 w-full mt-1">
                                <div className="absolute inset-0 flex items-end justify-center gap-[1px]">
                                  {/* Zaka Bar (Emerald) */}
                                  <div 
                                    style={{ height: `${zakaPercent}%`, minHeight: '4px' }}
                                    className={`flex-1 max-w-[8px] rounded-t-sm transition-all duration-300 relative ${
                                      d.zaka > 0 
                                        ? "bg-emerald-500 dark:bg-emerald-400 shadow-[0_-2px_6px_rgba(16,185,129,0.15)] group-hover:brightness-110" 
                                        : "bg-neutral-300/80 dark:bg-neutral-700/50"
                                    }`}
                                  >
                                    {/* Hover tooltip with absolute high-contrast styling */}
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:flex flex-col items-center z-40">
                                      <div className="bg-[#1a2142] dark:bg-[#1c2245] border border-[#242c58] dark:border-[#2a3260] text-white text-[11px] font-mono p-1 px-1.5 rounded-md shadow-lg whitespace-nowrap text-center">
                                        <span className="text-neutral-400 font-bold block border-b border-neutral-800 pb-0.5 mb-1">{d.fullLabel}</span>
                                        <span className="text-emerald-400 font-bold block">Zaka</span>
                                        {Math.round(d.zaka).toLocaleString()} TZS
                                      </div>
                                      <div className="w-1.5 h-1.5 bg-[#1a2142] dark:bg-[#1c2245] rotate-45 -mt-0.5" />
                                    </div>
                                  </div>

                                  {/* Sadaka Bar (Amber) */}
                                  <div 
                                    style={{ height: `${sadakaPercent}%`, minHeight: '4px' }}
                                    className={`flex-1 max-w-[8px] rounded-t-sm transition-all duration-300 relative ${
                                      d.sadaka > 0 
                                        ? "bg-amber-500 dark:bg-amber-400 shadow-[0_-2px_6px_rgba(245,158,11,0.15)] group-hover:brightness-110" 
                                        : "bg-neutral-300/80 dark:bg-neutral-700/50"
                                    }`}
                                  >
                                    {/* Hover tooltip with absolute high-contrast styling */}
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:flex flex-col items-center z-40">
                                      <div className="bg-[#1a2142] dark:bg-[#1c2245] border border-[#242c58] dark:border-[#2a3260] text-white text-[11px] font-mono p-1 px-1.5 rounded-md shadow-lg whitespace-nowrap text-center">
                                        <span className="text-neutral-400 font-bold block border-b border-neutral-800 pb-0.5 mb-1">{d.fullLabel}</span>
                                        <span className="text-[var(--gold-ink)] font-bold block">Sadaka</span>
                                        {Math.round(d.sadaka).toLocaleString()} TZS
                                      </div>
                                      <div className="w-1.5 h-1.5 bg-[#1a2142] dark:bg-[#1c2245] rotate-45 -mt-0.5" />
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Axis label.
                                  In "Kila Mwezi" there are 12 columns of ~22px,
                                  but a 3-letter label in Sora Black measured
                                  22.1px — wider than its own column, so the
                                  months ran into each other. Lighter weight and
                                  tighter tracking bring it under the column
                                  width; nowrap stops it breaking mid-word. */}
                              <span className="text-[11px] font-mono font-semibold tracking-tighter whitespace-nowrap text-[var(--muted-ink)] mt-1 select-none">
                                {d.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sub-Legend with Dynamic aggregation of totals shown */}
                    <div className="grid grid-cols-2 gap-2 mt-3 text-xs select-none">
                      <div className="p-2 bg-white dark:bg-[#131730] border border-slate-100 dark:border-[#1c2245] rounded-2xl flex items-center justify-between">
                        <div>
                          <span className="text-[11px] font-black uppercase text-neutral-500 dark:text-neutral-400 block font-mono">
                            Zaka {graphPeriod === "mwezi" ? "mwezi huu" : "mwaka huu"}
                          </span>
                          <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-xs">
                            {graphData.reduce((acc, current) => acc + current.zaka, 0).toLocaleString()} <span className="text-[11px] text-[var(--muted-ink)] font-bold">TZS</span>
                          </span>
                        </div>
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 shrink-0 shadow-[0_0_4px_rgba(16,185,129,0.5)]" />
                      </div>
                      
                      <div className="p-2 bg-white dark:bg-[#131730] border border-slate-100 dark:border-[#1c2245] rounded-2xl flex items-center justify-between">
                        <div>
                          <span className="text-[11px] font-black uppercase text-neutral-500 dark:text-neutral-400 block font-mono">
                            Sadaka {graphPeriod === "mwezi" ? "mwezi huu" : "mwaka huu"}
                          </span>
                          <span className="font-mono font-black text-[var(--gold-ink)] dark:text-[#d9a020] text-xs">
                            {graphData.reduce((acc, current) => acc + current.sadaka, 0).toLocaleString()} <span className="text-[11px] text-[var(--muted-ink)] font-bold">TZS</span>
                          </span>
                        </div>
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 shrink-0 shadow-[0_0_4px_rgba(245,158,11,0.5)]" />
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* KAMILISHA USAJILI SECTION */}
            {(() => {
              // Phone is excluded: it is the login, so it is never empty here.
              // Leaving it in this test kept the whole card on screen for a
              // member who had genuinely finished everything they can fill.
              const isMaritalEmpty = !member.marital_status || member.marital_status.trim() === "";
              const isGenderEmpty = !member.gender || member.gender.trim() === "";
              const isResidenceEmpty = !member.residence || member.residence.trim() === "";
              const isAgeEmpty = member.age === null || member.age === undefined || member.age === "";

              const allFilled = !isMaritalEmpty && !isGenderEmpty && !isResidenceEmpty && !isAgeEmpty;

              if (allFilled) {
                return null;
              }

              return (
                <div className="w-full text-left bg-white dark:bg-[#131730] rounded-3xl border border-slate-100 dark:border-[#1c2245] p-5 shadow-xs">
                  <div className="flex items-center gap-2.5 mb-3.5 pb-3 border-b border-dashed border-slate-100 dark:border-[#1c2245] select-none">
                    <div className="p-3 rounded-xl bg-amber-500/10 text-[var(--gold-ink)] dark:text-[#d9a020]">
                      <UserCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-neutral-900 dark:text-white font-sans">Kamilisha Usajili</h4>
                      <p className="text-[12px] text-neutral-400 dark:text-neutral-500">Jaza maelezo ya ziada katika kadi yako ya uanachama</p>
                    </div>
                  </div>

                  <ProfileCompleterForm
                    member={member}
                    isMaritalEmpty={isMaritalEmpty}
                    isGenderEmpty={isGenderEmpty}
                    isResidenceEmpty={isResidenceEmpty}
                    isAgeEmpty={isAgeEmpty}
                    onUpdate={updateProfileFields}
                    isUpdating={isUpdatingProfile}
                    successMsg={profileSuccessMsg}
                    errorMsg={profileErrorMsg}
                    setSuccessMsg={setProfileSuccessMsg}
                    setErrorMsg={setProfileErrorMsg}
                  />
                </div>
              );
            })()}

            {/* RECENT LEDGER ENTRIES */}
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              <p className="text-[11px] font-black text-neutral-500 dark:text-neutral-400 uppercase tracking-widest text-left select-none pb-1 font-mono">
                Michango ya Hivi Karibuni
              </p>
              {contributionsList.slice(0, 10).map((c: any) => {
                const formattedDate = c.created_at 
                  ? new Date(c.created_at).toLocaleDateString("sw-TZ", { day: 'numeric', month: 'short' })
                  : "Leo";

                return (
                  <div 
                    key={c.id} 
                    className="p-2.5 bg-white dark:bg-[#131730] border border-slate-100 dark:border-[#1c2245] rounded-2xl flex items-center justify-between font-sans hover:bg-slate-50 dark:hover:bg-[#1c2245] transition"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 font-extrabold select-none text-[12px] ${
                        c.type === "Zaka" ? "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-[#d9a020]" :
                        c.type === "Sadaka" ? "bg-emerald-100 text-emerald-950 dark:bg-emerald-950/30 text-emerald-990 dark:text-emerald-400" :
                        "bg-indigo-100 text-indigo-900 dark:bg-[#1e1b4b]/30 dark:text-indigo-400"
                      }`}>
                        {c.type[0]}
                      </div>
                      <div className="text-left truncate">
                        <p className="text-xs font-bold text-neutral-800 dark:text-neutral-200 leading-tight">
                          {c.type}
                        </p>
                        <p className="text-[11px] text-neutral-500 dark:text-neutral-400 tracking-wide font-semibold mt-0.5">
                          {c.payment_method ? `${c.payment_method} • ${formattedDate}` : formattedDate}
                        </p>
                      </div>
                    </div>
                    <div className="text-right pl-2 font-mono shrink-0">
                      <p className="text-xs font-black text-neutral-900 dark:text-neutral-100">
                        {Math.round(c.amount).toLocaleString()}
                      </p>
                      <span className="text-[11px] text-[var(--muted-ink)] font-bold uppercase">TZS</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* STAKABADHI — one receipt per day of giving, newest first.
                Everything recorded on the same day belongs on the same
                receipt, exactly as it does on the paper form. */}
            {(() => {
              const receipts = buildReceipts(contributionsList, member?.congregantId || "", receiptSettings);
              if (receipts.length === 0) return null;

              return (
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1 pt-1">
                  <p className="text-[11px] font-black text-neutral-500 dark:text-neutral-400 uppercase tracking-widest text-left select-none pb-1 font-mono">
                    Stakabadhi Zako
                  </p>
                  {receipts.slice(0, 24).map((r) => (
                    <button
                      key={r.receiptNo}
                      onClick={() => setOpenReceipt(r)}
                      aria-label={`Fungua stakabadhi ya tarehe ${r.dateLabel}`}
                      className="w-full p-2.5 bg-white dark:bg-[#131730] border border-slate-100 dark:border-[#1c2245] rounded-2xl flex items-center justify-between font-sans hover:bg-slate-50 dark:hover:bg-[#1c2245] transition text-left"
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-[#d9a020]">
                          <FileText size={15} />
                        </div>
                        <div className="text-left truncate">
                          <p className="text-xs font-bold text-neutral-800 dark:text-neutral-200 leading-tight tabular-nums">
                            {r.receiptNo}
                          </p>
                          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 tracking-wide font-semibold mt-0.5 tabular-nums">
                            {r.dateLabel} • michango {r.contributionCount}
                          </p>
                        </div>
                      </div>
                      <div className="text-right pl-2 font-mono shrink-0">
                        <p className="text-xs font-black text-neutral-900 dark:text-neutral-100">
                          {formatMoney(r.grandTotal)}
                        </p>
                        <span className="text-[11px] text-[var(--muted-ink)] font-bold uppercase">TZS</span>
                      </div>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* 4. MASTER COMPREHENSIVE HISTORIA TAB */}
        {reportSubTab === "historia" && (
          <div className="space-y-4 animate-in fade-in duration-200 text-left">
            <div className="px-1 py-1 text-center select-none">
              <span className="text-[11px] font-black uppercase tracking-wider text-[var(--gold-ink)] dark:text-[#d9a020] bg-amber-500/10 dark:bg-amber-400/10 px-2 py-0.5 rounded-md border border-amber-500/10">
                HISTORIA KAMILI YA MICHANGO
              </span>
              <p className="text-[12px] text-neutral-500 dark:text-neutral-400 font-medium mt-1">
                Chagua mwaka kuona jumla yake na mchanganuo wa kila mwezi.
              </p>
            </div>

            {/* Horizontal Years pills selector */}
            {(() => {
              const yearsList = Array.from(new Set(contributionsList.filter(c => c.created_at).map(c => new Date(c.created_at).getFullYear())));
              if (yearsList.length === 0) {
                yearsList.push(new Date().getFullYear());
              }
              yearsList.sort((a, b) => b - a);

              const yearContributions = contributionsList.filter(c => c.created_at && new Date(c.created_at).getFullYear() === selectedHistoryYear);
              const yearZaka = yearContributions.filter(c => c.type === "Zaka").reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
              const yearSadaka = yearContributions.filter(c => c.type === "Sadaka").reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
              const yearOther = yearContributions.filter(c => c.type !== "Zaka" && c.type !== "Sadaka").reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
              const yearTotal = yearZaka + yearSadaka + yearOther;

              return (
                <div className="space-y-3">
                  {/* Horizontal Scroll bar of Years */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 select-none scrollbar-thin scrollbar-thumb-slate-200">
                    {yearsList.map(yr => (
                      <button
                        key={yr}
                        onClick={() => {
                          setSelectedHistoryYear(yr);
                          setSelectedHistoryMonth(null);
                        }}
                        className={`px-3 py-1.5 rounded-2xl text-[11px] font-semibold transition shrink-0 active:scale-95 cursor-pointer ${
                          selectedHistoryYear === yr
                            ? "bg-[#d9a020] text-[var(--on-gold)] shadow-xs font-bold"
                            : "bg-slate-100 dark:bg-[#131730] border border-slate-200/40 dark:border-[#1c2245]/60 text-slate-650 dark:text-slate-350 hover:bg-slate-200 dark:hover:bg-[#1c2245]"
                        }`}
                      >
                        📅 Mwaka {yr}
                      </button>
                    ))}
                  </div>

                  {/* YEAR SUMMARY
                      Was one panel with a 3-column tile grid: on a 375px screen
                      each tile was ~105px, so a figure like "1,125,084 TZS" had
                      to wrap or shrink. Each figure now gets its own full-width
                      card with the label left and the amount right, so the
                      number has the whole row. Theme-responsive, matching the
                      member card. */}
                  <div className="rounded-2xl border shadow-sm p-4 flex flex-col gap-3
                                  bg-gradient-to-br from-white via-[#FEFBF4] to-[#F7EFDD] border-[#d9a020]/35
                                  dark:from-[#1c2245] dark:via-[#151b38] dark:to-[#0d1124] dark:border-[#d9a020]/20">
                    <div>
                      <span className="text-[11px] font-mono font-bold text-[var(--gold-ink)] uppercase tracking-widest block">
                        JUMLA YA MWAKA {selectedHistoryYear}
                      </span>
                      <span className="mt-1 block text-2xl font-sans font-black tabular-nums whitespace-nowrap text-neutral-900 dark:text-white">
                        {yearTotal.toLocaleString()}
                        <span className="ml-1.5 text-sm font-bold text-[var(--gold-ink)]">TZS</span>
                      </span>
                    </div>

                    <div className="flex flex-col gap-2">
                      {[
                        { label: "Zaka", value: yearZaka, tone: "text-emerald-800 dark:text-emerald-300" },
                        { label: "Sadaka", value: yearSadaka, tone: "text-[var(--gold-ink)]" },
                        { label: "Nyinginezo", value: yearOther, tone: "text-indigo-800 dark:text-indigo-300" },
                      ].map(row => (
                        <div
                          key={row.label}
                          className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 border
                                     bg-black/[0.03] border-black/10
                                     dark:bg-[#0d1124]/45 dark:border-white/10"
                        >
                          <span className="text-[11px] font-sans uppercase tracking-wider text-slate-600 dark:text-[var(--muted-ink)] shrink-0">
                            {row.label}
                          </span>
                          <span className={`text-sm font-sans font-bold tabular-nums whitespace-nowrap ${row.tone}`}>
                            {row.value.toLocaleString()} TZS
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Months grid.
                      Only months that have already happened are listed. Showing
                      the rest of the current year as "Bila mchango — 0 TZS"
                      filled the page with empty rows and read like a rebuke for
                      months the member has not reached yet. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                    {miezi
                      .filter(m => {
                        const now = new Date();
                        if (selectedHistoryYear < now.getFullYear()) return true;
                        if (selectedHistoryYear > now.getFullYear()) return false;
                        return m.id <= now.getMonth() + 1;
                      })
                      .map(m => {
                      const monthContributions = yearContributions.filter(c => {
                        if (!c.created_at) return false;
                        return (new Date(c.created_at).getMonth() + 1) === m.id;
                      });
                      const monthTotal = monthContributions.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
                      const isSelected = selectedHistoryMonth === m.id;

                      const hasZaka = monthContributions.some(c => c.type === "Zaka");
                      const hasSadaka = monthContributions.some(c => c.type === "Sadaka");
                      const hasOther = monthContributions.some(c => c.type !== "Zaka" && c.type !== "Sadaka");

                      return (
                        <div
                          key={m.id}
                          className={`rounded-2xl border transition overflow-hidden bg-white dark:bg-[#131730] ${
                            isSelected
                              ? "border-[#d9a020] shadow-sm select-none"
                              : "border-slate-100 dark:border-[#1c2245]/60 hover:border-[#d9a020]/20"
                          }`}
                        >
                          {/* Entry card header */}
                          <div
                            onClick={() => setSelectedHistoryMonth(isSelected ? null : m.id)}
                            className="p-3 flex items-center justify-between cursor-pointer select-none active:bg-slate-50 dark:active:bg-[#141834]"
                          >
                            <div>
                              <h4 className="font-serif font-black text-xs text-neutral-900 dark:text-white uppercase tracking-wider font-display">
                                {m.kirefu}
                              </h4>
                              {/* Swahili badges indicators */}
                              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                                {hasZaka && (
                                  <span className="text-[11px] font-sans font-bold bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 px-1 py-0.5 rounded leading-none">
                                    🌱 Zaka
                                  </span>
                                )}
                                {hasSadaka && (
                                  <span className="text-[11px] font-sans font-bold bg-amber-500/10 text-amber-800 dark:text-amber-400 px-1 py-0.5 rounded leading-none">
                                    🪙 Sadaka
                                  </span>
                                )}
                                {hasOther && (
                                  <span className="text-[11px] font-sans font-bold bg-indigo-500/10 text-indigo-800 dark:text-indigo-400 px-1 py-0.5 rounded leading-none">
                                    🏗️ Miradi
                                  </span>
                                )}
                                {!hasZaka && !hasSadaka && !hasOther && (
                                  <span className="text-[11px] font-sans font-medium text-[var(--muted-ink)] italic">
                                    Bila mchango
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="text-right flex items-center gap-2">
                              <div className="text-right select-none">
                                <p className="text-xs font-sans font-black text-neutral-900 dark:text-neutral-200">
                                  {monthTotal.toLocaleString()} TZS
                                </p>
                                <span className="text-[11px] text-[var(--muted-ink)] font-mono tracking-wider uppercase block">JUMLA YA MWEZI</span>
                              </div>
                              <div>
                                {isSelected ? (
                                  <ChevronUp className="w-3.5 h-3.5 text-neutral-450" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5 text-neutral-450" />
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Expanded detailed table of this month */}
                          {isSelected && (
                            <div className="border-t border-slate-100 dark:border-[#1c2245] bg-[#F5F3EE]/40 dark:bg-[#0d1124]/60 p-2.5 space-y-1.5 animate-in slide-in-from-top-1 duration-150">
                              {monthContributions.length === 0 ? (
                                <div className="text-center py-4 text-[11px] font-sans text-[var(--muted-ink)] select-none">
                                  Haukurefusha michango yoyote katika mwezi huu wa {m.kirefu}.
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  <p className="text-[11px] font-bold text-[var(--muted-ink)] dark:text-slate-500 tracking-wider uppercase px-1 select-none">Miamala yote ya {m.kirefu}</p>
                                  {monthContributions.map((c: any) => {
                                    const contributionDate = c.created_at
                                      ? new Date(c.created_at).toLocaleDateString("sw-TZ", { day: 'numeric', month: 'short' })
                                      : "Mwezi Huu";
                                    return (
                                      <div key={c.id} className="p-2 bg-white dark:bg-[#131730] border border-slate-100 dark:border-[#1c2245]/50 rounded-xl flex items-center justify-between shadow-3xs">
                                        <div className="text-left font-sans">
                                          <p className="text-[11px] font-bold text-neutral-800 dark:text-neutral-200">{c.type}</p>
                                          <p className="text-[11px] text-[var(--muted-ink)] mt-0.5">{c.payment_method} • {contributionDate}</p>
                                        </div>
                                        <div className="text-right font-sans">
                                          <p className="text-[11px] font-black text-[var(--gold-ink)]">{Math.round(c.amount).toLocaleString()} TZS</p>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ACCOUNT ACTIONS — the last thing on the page.
            These close the report rather than crowding the heading. They sit
            outside the Muhtasari/Historia switch on purpose: tucked inside
            Historia alone, signing out would be unreachable from Muhtasari. */}
        <div className="mt-8 pt-5 border-t border-dashed border-slate-200 dark:border-[#1c2245] select-none">
          <div className="grid grid-cols-2 gap-2.5">
            {/* Deliberately quieter than "Toka": this is the destructive one,
                and it should not be the button a thumb finds first. */}
            <button
              onClick={handleDeleteAccount}
              disabled={isDeletingAccount}
              className="flex items-center justify-center gap-1.5 min-h-[48px] px-3 py-3 rounded-2xl text-[13px] font-semibold text-[var(--muted-ink)] dark:text-slate-400 border border-slate-200 dark:border-[#1c2245] cursor-pointer hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-900/40 transition disabled:opacity-50 active:scale-[0.98]"
            >
              <Trash2 className="w-4 h-4" />
              {isDeletingAccount ? "Inafuta..." : "Futa akaunti"}
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center justify-center gap-1.5 min-h-[48px] px-3 py-3 rounded-2xl text-[13px] font-bold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/30 transition active:scale-[0.98]"
            >
              <LogOut className="w-4 h-4" />
              Toka
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // NEW CHURCHRECORDS UI — Modern Cathedral Design
  // ============================================================
  return (
    <div className={`min-h-screen w-full flex items-center justify-center transition-colors duration-300 p-0 sm:p-4 md:p-6 ${darkMode ? "bg-[var(--color-ink-dark)]" : "bg-[var(--color-ink-light)]"}`}>
      
      {/* Ambient glow blobs (desktop only) */}
      <div className="hidden md:block absolute top-[8%] left-[8%] w-96 h-96 bg-[#d9a020]/6 rounded-full blur-[120px] pointer-events-none" />
      <div className="hidden md:block absolute bottom-[10%] right-[8%] w-72 h-72 bg-indigo-600/5 rounded-full blur-[100px] pointer-events-none" />

      {/* =================== PHONE FRAME =================== */}
      <div className={`
        w-full app-shell max-w-[390px]
        bg-[var(--color-ink-light)] dark:bg-[var(--color-ink-dark)]
        sm:shadow-2xl sm:rounded-[44px]
        overflow-hidden flex flex-col relative
        sm:border-[5px] sm:border-slate-200/90 dark:sm:border-navy-800
        transition-colors duration-300
      `}>

        {/* Phone notch (desktop mock) */}
        <div className="hidden sm:flex justify-center items-center w-full h-7 shrink-0 bg-[#EEE9E0] dark:bg-[#0d1124] relative z-40">
          <div className="w-28 h-5 bg-slate-900 dark:bg-slate-950 rounded-b-2xl flex items-center justify-center gap-2">
            <div className="w-14 h-1 bg-slate-800 rounded-full" />
            <div className="w-2 h-2 bg-slate-800 rounded-full" />
          </div>
        </div>

        {/* ============= CONTENT AREA ============= */}
        <div className="flex-1 overflow-hidden flex flex-col relative">

          {/* ====== LOADING / SPLASH SCREEN ====== */}
          {dbProgressState.status !== "ready" ? (
            <div className="flex-grow flex flex-col items-center justify-center p-8 text-center bg-[#F5F3EE] dark:bg-[#0d1124] select-none">
              {/* Church cross logo */}
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="relative mb-8"
              >
                <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-[#d9a020] to-[#b8821a] flex items-center justify-center shadow-lg shadow-[#d9a020]/25">
                  <BookOpen className="w-12 h-12 text-white" strokeWidth={1.5} />
                </div>
                <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-amber-600 flex items-center justify-center border-2 border-[#F5F3EE] dark:border-[#0d1124]">
                  <span className="text-white text-[12px] font-black">✦</span>
                </div>
              </motion.div>
              
              <motion.h1 
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.6 }}
                className="text-3xl font-display font-bold text-[#0d1124] dark:text-white mb-2 tracking-tight"
              >
                Mshiriki
              </motion.h1>

              {/* Rotating Inspirational Verses & Quotes */}
              <div className="h-20 flex items-center justify-center max-w-[280px] mb-8 overflow-hidden">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={splashMsgIndex}
                    initial={{ y: 15, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -15, opacity: 0 }}
                    transition={{ duration: 0.4 }}
                    className="text-xs text-[var(--muted-ink)] dark:text-slate-400 italic leading-relaxed text-center font-sans font-medium"
                  >
                    "{splashMessages[splashMsgIndex]}"
                  </motion.p>
                </AnimatePresence>
              </div>

              {dbProgressState.status === "error" ? (
                <div className="space-y-4">
                  <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200/60 dark:border-red-900/20 px-4 py-3 rounded-2xl font-medium max-w-xs">
                    {dbProgressState.message}
                  </div>
                  <button
                    onClick={() => window.location.reload()}
                    className="px-5 py-2.5 bg-[#d9a020] hover:bg-[#b8821a] text-[var(--on-gold)] rounded-xl text-sm font-semibold cursor-pointer active:scale-95 transition-all shadow-sm"
                  >
                    Jaribu Tena
                  </button>
                </div>
              ) : (
                <div className="w-full max-w-[220px]">
                  {/* Highly polished sleek loader track with no numbers */}
                  <div className="w-full bg-slate-200 dark:bg-slate-800/80 h-1.5 rounded-full overflow-hidden relative">
                    <motion.div
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#d9a020] to-[#eccb6a] rounded-full"
                      initial={{ width: "10%" }}
                      animate={{ 
                        width: dbProgressState.percent ? `${dbProgressState.percent}%` : "50%",
                      }}
                      transition={{ type: "spring", stiffness: 60, damping: 15 }}
                    />
                  </div>
                  <span className="text-[11px] text-[var(--muted-ink)] dark:text-slate-500 font-mono tracking-widest uppercase block mt-3 animate-pulse">
                    Inatayarisha...
                  </span>
                </div>
              )}
            </div>
          ) : (
            <>

              {/* ============================= */}
              {/* TAB 1: BIBLIA (BIBLE READER)  */}
              {/* ============================= */}
              {activeTab === "biblia" && (
                <div className="flex-grow flex flex-col overflow-hidden h-full">

                  {/* Top Header */}
                  <header className="px-4 py-3 shrink-0 bg-[#F5F3EE]/95 dark:bg-[#0d1124]/95 backdrop-blur-md border-b border-[#d9a020]/15 dark:border-[#d9a020]/10 flex items-center justify-between z-10">
                    
                    <button
                      id="biblia-tafuta-button"
                      onClick={() => {
                        setSelectorBookSearch("");
                        setSelectorStep("book");
                        if (selectedBook) setCurrentTestamentId(selectedBook.testament_id);
                        setIsBookSelectorOpen(true);
                      }}
                      className="flex items-center gap-2 px-3.5 py-3 rounded-2xl bg-[#d9a020]/10 dark:bg-[#d9a020]/15 border border-[#d9a020]/20 dark:border-[#d9a020]/20 hover:bg-[#d9a020]/15 transition cursor-pointer active:scale-95"
                    >
                      <BookOpen className="w-4 h-4 text-[var(--gold-ink)] dark:text-[#d9a020]" strokeWidth={2} />
                      <span className="font-display font-semibold text-sm text-[#4a300a] dark:text-[#eccb6a] tracking-tight">
                        Tafuta: {selectedBook ? `${selectedBook.name} ${currentChapter}` : "Inapakia..."}
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 text-[var(--gold-ink)] dark:text-[#d9a020]" />
                    </button>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setShowSearchModal(true)}
                        aria-label="Tafuta katika Maandiko"
                        className="p-3 rounded-xl text-[var(--muted-ink)] dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#1c2245] transition cursor-pointer active:scale-90"
                      >
                        <Search className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setLayoutStyle(layoutStyle === "paragraph" ? "list" : "paragraph")}
                        aria-label="Badilisha mpangilio wa mistari"
                        className="p-3 rounded-xl text-[var(--muted-ink)] dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#1c2245] transition cursor-pointer active:scale-90"
                      >
                        {layoutStyle === "paragraph" ? <AlignLeft className="w-5 h-5" /> : <Layers className="w-5 h-5" />}
                      </button>
                      <button
                        onClick={() => setIsSettingsOpen(true)}
                        aria-label="Mipangilio"
                        className="p-3 rounded-xl text-[var(--gold-ink)] dark:text-[#d9a020] hover:bg-[#d9a020]/10 transition cursor-pointer active:scale-90"
                      >
                        <Settings className="w-5 h-5" />
                      </button>
                    </div>
                  </header>

                  {/* Reading Content */}
                  <div
                    ref={readingContainerRef}
                    className="flex-grow overflow-y-auto overflow-x-hidden px-5 py-5 scroll-smooth relative"
                  >
                    <AnimatePresence custom={bibleDirection}>
                      <motion.div
                        key={`${selectedBook?.id}-${currentChapter}`}
                        custom={bibleDirection}
                        variants={cubeTransitionVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        style={{ position: "absolute", width: "100%", top: 0, left: 0 }}
                        className="p-5"
                      >
                    
                    {/* Book/Chapter Header */}
                    {selectedBook && (
                      <div className="mb-10 mt-6 flex flex-col items-center text-center select-none">
                        <span className="text-[12px] uppercase font-accent font-semibold text-[var(--gold-ink)] tracking-[0.25em] mb-2">
                          {selectedBook.testament_id === 1 ? "Agano la Kale" : "Agano Jipya"}
                        </span>
                        <h2 className="text-5xl font-display text-slate-900 dark:text-white tracking-tight">
                          {selectedBook.name} {currentChapter}
                        </h2>
                        <div className="flex items-center justify-center gap-3 mt-6">
                          <div className="h-[1px] w-24 bg-[#D4AF37]/50" />
                          <div className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]" />
                          <div className="h-[1px] w-24 bg-[#D4AF37]/50" />
                        </div>
                      </div>
                    )}

                    {/* Verses */}
                    {verses.length > 0 ? (
                      layoutStyle === "paragraph" ? (
                        <div className={`font-serif leading-[2.1] tracking-wide text-slate-800 dark:text-[#E2E8F0] transition-all space-y-4 ${
                          fontSize === "sm" ? "text-[15px]" :
                          fontSize === "md" ? "text-[17px]" :
                          fontSize === "lg" ? "text-[19px]" : "text-[21px]"
                        }`}>
                          {verses.map((v) => (
                            <p
                              key={v.id}
                              id={`verse-${v.id}`}
                              onClick={() => setHighlightedVerseId(highlightedVerseId === v.id ? null : v.id)}
                              className={`block transition-colors duration-500 rounded-xl relative cursor-pointer px-2.5 py-1 -mx-2.5 ${
                                highlightedVerseId === v.id
                                  ? "bg-[#D4AF37]/10 dark:bg-[#D4AF37]/12 ring-1 ring-[#D4AF37]/25 text-slate-900 dark:text-white"
                                  : landedVerseId === v.id
                                    ? "bg-[#D4AF37]/25 dark:bg-[#D4AF37]/22 text-slate-900 dark:text-white"
                                    : isVerseFavorite(v.id)
                                      ? "border-b-2 border-dashed border-rose-400/60 dark:border-rose-500/40"
                                      : ""
                              }`}
                            >
                              <sup className="font-sans font-semibold text-[var(--gold-ink)] mr-2 select-none" style={{ fontSize: '0.65em', top: '-0.4em' }}>
                                {v.verse}
                              </sup>
                              {v.text}

                              {/* Quick action popup */}
                              {highlightedVerseId === v.id && (
                                <span
                                  className="absolute -top-11 left-1/2 -translate-x-1/2 bg-[#0d1124] dark:bg-[#1c2245] border border-[#d9a020]/20 text-white rounded-2xl shadow-xl px-3.5 py-2 flex items-center gap-4 z-40 text-xs font-sans font-medium whitespace-nowrap"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    onClick={() => toggleFavoriteVerse(v)}
                                    className="flex items-center gap-1.5 hover:text-rose-400 text-slate-300 active:scale-95 transition"
                                  >
                                    <Heart className={`w-3.5 h-3.5 ${isVerseFavorite(v.id) ? "fill-rose-500 text-rose-500" : ""}`} />
                                    <span className="text-[12px]">{isVerseFavorite(v.id) ? "Futa" : "Hifadhi"}</span>
                                  </button>
                                  <div className="w-px h-3 bg-slate-700" />
                                  <button
                                    onClick={() => copyTextToClipboard(`[${selectedBook?.name} ${v.chapter}:${v.verse}] ${v.text}`, v.id, "verse")}
                                    className="flex items-center gap-1.5 hover:text-[var(--gold-ink)] text-slate-300 active:scale-95 transition"
                                  >
                                    {copiedVerseId === v.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                    <span className="text-[12px]">{copiedVerseId === v.id ? "Copied!" : "Nakili"}</span>
                                  </button>
                                </span>
                              )}
                            </p>
                          ))}
                        </div>
                      ) : (
                        /* List view */
                        <div className="space-y-4">
                          {verses.map((v) => (
                            <div
                              key={v.id}
                              id={`verse-${v.id}`}
                              className={`p-5 rounded-2xl border transition-colors duration-500 flex items-start gap-4 ${
                                highlightedVerseId === v.id
                                  ? "bg-[#D4AF37]/10 border-[#D4AF37]/25"
                                  : landedVerseId === v.id
                                    ? "bg-[#D4AF37]/25 border-[#D4AF37]/40"
                                    : "bg-white dark:bg-transparent border-slate-100 dark:border-[#D4AF37]/10"
                              }`}
                            >
                              <div className="flex flex-col items-center select-none shrink-0 min-w-[28px] mt-1">
                                <span className="text-[var(--gold-ink)] text-lg font-sans font-semibold">{v.verse}</span>
                              </div>
                              <div className="flex-1">
                                <p className={`font-serif leading-relaxed tracking-wide text-slate-800 dark:text-[#E2E8F0] ${
                                  fontSize === "sm" ? "text-[15px]" :
                                  fontSize === "md" ? "text-[17px]" :
                                  fontSize === "lg" ? "text-[19px]" : "text-[21px]"
                                }`}>{v.text}</p>
                                <div className="mt-3 flex items-center justify-end gap-4 pt-3 border-t border-slate-100 dark:border-[#D4AF37]/10 select-none">
                                  <button onClick={() => toggleFavoriteVerse(v)} className={`flex items-center gap-1.5 text-[11px] font-sans tracking-wide transition uppercase ${isVerseFavorite(v.id) ? "text-rose-500 font-bold" : "text-[var(--muted-ink)] hover:text-rose-500"}`}>
                                    <Heart className={`w-3.5 h-3.5 ${isVerseFavorite(v.id) ? "fill-rose-500" : ""}`} />
                                    {isVerseFavorite(v.id) ? "Imependwa" : "Penda"}
                                  </button>
                                  <button onClick={() => copyTextToClipboard(`[${selectedBook?.name} ${v.chapter}:${v.verse}] ${v.text}`, v.id, "verse")} className="text-[var(--muted-ink)] hover:text-[var(--gold-ink)] font-sans uppercase tracking-wide flex items-center gap-1.5 text-[11px] transition cursor-pointer">
                                    {copiedVerseId === v.id ? <><Check className="w-3.5 h-3.5 text-emerald-500" /><span className="text-emerald-500">Copied!</span></> : <><Copy className="w-3.5 h-3.5" /><span>Nakili</span></>}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    ) : (
                      <div className="flex flex-col items-center justify-center py-24 text-[var(--muted-ink)]">
                        <div className="w-8 h-8 rounded-full border-2 border-[#D4AF37]/30 border-t-[#D4AF37] animate-spin mb-3" />
                        <p className="text-xs font-sans tracking-widest uppercase">Inafungua Mstari...</p>
                      </div>
                    )}

                    {/* Bible Anchor Icon at end of chapter */}
                    {verses.length > 0 && (
                      <div className="flex flex-col items-center justify-center mt-12 mb-8 opacity-80 select-none">
                        <div className="flex items-center justify-center gap-4 text-[var(--gold-ink)]">
                          <div className="h-[1px] w-16 bg-gradient-to-r from-transparent to-[#D4AF37]/50" />
                          <div className="relative">
                            <BookOpen className="w-6 h-6" />
                            <div className="absolute inset-0 flex items-center justify-center -top-2">
                              {/* Simple Cross graphic */}
                              <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
                                <path d="M3.5 0h1v3.5H8v1H4.5V12h-1V4.5H0v-1h3.5V0z" />
                              </svg>
                            </div>
                          </div>
                          <div className="h-[1px] w-16 bg-gradient-to-l from-transparent to-[#D4AF37]/50" />
                        </div>
                      </div>
                    )}

                    {/* Chapter Navigation */}
                    {selectedBook && (
                      <div className="mt-10 pt-5 pb-2 border-t border-slate-200/60 dark:border-[#1c2245] flex items-center justify-between">
                        <button
                          onClick={handlePrevChapter}
                          className="px-4 py-2.5 text-sm font-semibold font-sans flex items-center gap-1.5 bg-white dark:bg-[#131730] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#1c2245] hover:bg-slate-50 dark:hover:bg-[#1c2245] rounded-2xl transition cursor-pointer shadow-sm active:scale-95"
                        >
                          <ChevronLeft className="w-4 h-4" />
                          Nyuma
                        </button>
                        <span className="text-[12px] font-mono font-bold text-[var(--muted-ink)] uppercase tracking-widest">
                          {currentChapter} / {selectedBook.chapter_count}
                        </span>
                        <button
                          onClick={handleNextChapter}
                          className="px-4 py-2.5 text-sm font-semibold font-sans flex items-center gap-1.5 bg-white dark:bg-[#131730] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#1c2245] hover:bg-slate-50 dark:hover:bg-[#1c2245] rounded-2xl transition cursor-pointer shadow-sm active:scale-95"
                        >
                          Mbele
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* ========================== */}
              {/* TAB 2: NYIMBO (HYMNS)      */}
              {/* ========================== */}
              {activeTab === "nyimbo" && (
                <div className="flex-grow flex flex-col overflow-hidden h-full bg-[#F5F3EE] dark:bg-[#0d1124] relative">
                  {!songDetailView ? (
                    /* Hymn catalog */
                    <div className="flex-grow flex flex-col overflow-hidden">
                      <header className="px-4 pt-5 pb-3 shrink-0 bg-[#F5F3EE]/95 dark:bg-[#0d1124]/95 backdrop-blur-md border-b border-[#d9a020]/12 dark:border-[#d9a020]/10">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h2 className="text-2xl font-display font-bold text-[#0d1124] dark:text-white tracking-tight">Nyimbo za Kristo</h2>
                            <p className="text-[12px] font-mono text-[var(--gold-ink)] dark:text-[#d9a020] uppercase tracking-widest mt-0.5">{songs.length} wimbo</p>
                          </div>
                        </div>
                        <div className="relative">
                          <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-[var(--muted-ink)] pointer-events-none" />
                          <input
                            type="search"
                            placeholder="Namba ya wimbo au maneno..."
                            value={songSearchQuery}
                            onChange={(e) => { songListScrollTop.current = 0; setSongSearchQuery(e.target.value); }}
                            className="w-full bg-white dark:bg-[#131730] border border-slate-200 dark:border-[#1c2245] text-sm text-[#0d1124] dark:text-white pl-10 pr-4 py-3 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#d9a020]/30 focus:border-[#d9a020]/40 transition"
                          />
                        </div>
                      </header>

                      <div ref={songListScrollRef} className="flex-grow overflow-y-auto p-4 space-y-2">
                        {isSearchingSongs ? (
                          <div className="flex flex-col items-center justify-center py-24 text-[var(--muted-ink)]">
                            <div className="w-7 h-7 rounded-full border-2 border-[#d9a020]/30 border-t-[#d9a020] animate-spin mb-2" />
                            <span className="text-[11px] font-sans">Inatafuta...</span>
                          </div>
                        ) : (
                          (songSearchQuery.trim() !== "" ? songSearchResults : songs).map((s) => (
                            <button
                              key={s.id}
                              onClick={() => { rememberSongListScroll(); setSongDetailView(s); }}
                              className="w-full text-left px-4 py-3.5 rounded-2xl bg-white dark:bg-[#131730] border border-slate-100 dark:border-[#1c2245]/60 hover:border-[#d9a020]/25 hover:bg-[#d9a020]/4 dark:hover:bg-[#1c2245] transition duration-150 flex items-center justify-between cursor-pointer group active:scale-[0.98] shadow-sm"
                            >
                              <div className="flex items-center gap-3.5 overflow-hidden">
                                <div className="w-10 h-10 rounded-xl bg-[#d9a020]/10 dark:bg-[#d9a020]/15 border border-[#d9a020]/15 text-[#8f6113] dark:text-[#d9a020] flex items-center justify-center font-mono text-[12px] font-bold shrink-0 group-hover:bg-[#d9a020]/18 transition">
                                  {s.number}
                                </div>
                                <div className="truncate">
                                  <p className="text-sm font-semibold text-[#0d1124] dark:text-white truncate pr-2 font-sans">{s.title}</p>
                                  {s.english_title && (
                                    <p className="text-[11px] text-[var(--muted-ink)] truncate italic mt-0.5">{s.english_title}</p>
                                  )}
                                </div>
                              </div>
                              <ChevronRight className="w-4 h-4 text-[var(--muted-ink)] dark:text-[var(--muted-ink)] group-hover:text-[var(--gold-ink)] transition shrink-0" />
                            </button>
                          ))
                        )}

                        {songSearchQuery.trim() !== "" && songSearchResults.length === 0 && (
                          <div className="text-center py-20 text-[var(--muted-ink)] select-none">
                            <Compass className="w-10 h-10 text-slate-200 dark:text-slate-700 mx-auto mb-2 animate-pulse" />
                            <p className="text-xs font-semibold">Hakuna wimbo uliopatikana</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Hymn detail view */
                    <div className="flex-grow flex flex-col overflow-hidden h-full">
                      <header className="px-4 py-3.5 border-b border-slate-100 dark:border-[#1c2245] bg-[#F5F3EE]/95 dark:bg-[#0d1124]/95 backdrop-blur-md flex items-center justify-between shrink-0 select-none">
                        <button
                          onClick={() => setSongDetailView(null)}
                          className="flex items-center gap-1.5 p-1.5 -ml-1 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#1c2245] rounded-xl active:scale-95 transition cursor-pointer text-xs font-semibold font-sans"
                        >
                          <ArrowLeft className="w-5 h-5" />
                          Orodha
                        </button>

                        <div className="flex items-center gap-1">

                          <button
                            onClick={() => toggleFavoriteSong(songDetailView)}
                            className="p-2 text-[var(--muted-ink)] hover:bg-slate-100 dark:hover:bg-[#1c2245] rounded-xl active:scale-95 transition cursor-pointer"
                          >
                            <Heart className={`w-4 h-4 ${isSongFavorite(songDetailView.id) ? "fill-rose-500 text-rose-500" : ""}`} />
                          </button>
                          <button
                            onClick={() => {
                              if (!currentSongDetail) return;
                              const formattedText = `Nyimbo za Kristo Na. ${currentSongDetail.number}\n${currentSongDetail.title}\n\n` +
                                currentSongDetail.stanzas?.map(st => {
                                  const title = st.is_chorus ? "[Korasi]\n" : `${st.stanza_number}.\n`;
                                  return title + st.content;
                                }).join("\n\n");
                              copyTextToClipboard(formattedText, currentSongDetail.id, "song");
                            }}
                            className="p-2 text-[var(--muted-ink)] hover:bg-slate-100 dark:hover:bg-[#1c2245] rounded-xl active:scale-95 transition cursor-pointer"
                          >
                            {copiedSongId === currentSongDetail?.id ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </div>
                      </header>

                      <div ref={songScrollContainerRef} className="flex-grow overflow-y-auto overflow-x-hidden px-5 py-5 transition-colors duration-300 relative bg-[#F5F3EE] dark:bg-[#0d1124]">
                        <AnimatePresence custom={songDirection}>
                          {currentSongDetail ? (
                            <motion.div
                              key={currentSongDetail.id}
                              custom={songDirection}
                              variants={cubeTransitionVariants}
                              initial="initial"
                              animate="animate"
                              exit="exit"
                              style={{ position: "absolute", width: "100%", top: 0, left: 0 }}
                              className="p-5"
                            >
                            <div className="mb-10 text-center flex flex-col items-center">
                              <span className="inline-flex items-center gap-2 border border-[#D4AF37]/30 text-[var(--gold-ink)] text-[12px] uppercase font-accent font-semibold px-4 py-1.5 rounded-full tracking-[0.2em] mb-4">
                                <Music className="w-3.5 h-3.5" /> NYIMBO NO. {currentSongDetail.number}
                              </span>
                              
                              <h2 className="text-4xl sm:text-5xl font-display text-slate-900 dark:text-white mt-2 leading-[1.1] tracking-tight">
                                {currentSongDetail.title}
                              </h2>

                              <div className="flex items-center justify-center gap-4 mt-6 mb-8 w-full max-w-[200px] text-[var(--gold-ink)]">
                                <div className="h-[1px] flex-grow bg-gradient-to-r from-transparent to-[#D4AF37]/50" />
                                <div className="w-2 h-2 rotate-45 border border-[#D4AF37]" />
                                <Sparkles className="w-4 h-4 mx-1" />
                                <div className="w-2 h-2 rotate-45 border border-[#D4AF37]" />
                                <div className="h-[1px] flex-grow bg-gradient-to-l from-transparent to-[#D4AF37]/50" />
                              </div>

                              {currentSongDetail.english_title && (
                                <p className="text-[11px] text-[var(--muted-ink)] font-accent tracking-widest uppercase mb-3">{currentSongDetail.english_title}</p>
                              )}
                              
                              <div className="flex flex-wrap items-center justify-center gap-2">
                                {currentSongDetail.doh && (
                                  <span className="inline-block border border-slate-200 dark:border-slate-800 rounded-full px-4 py-1.5 text-[12px] font-accent font-semibold text-[var(--muted-ink)] tracking-widest uppercase">
                                    Doh: {currentSongDetail.doh}
                                  </span>
                                )}
                                {/* SDAH./C.S. hymnal cross-reference — not a musical key. */}
                                {currentSongDetail.english_ref && (
                                  <span className="inline-block border border-slate-200 dark:border-slate-800 rounded-full px-4 py-1.5 text-[12px] font-accent font-semibold text-[var(--muted-ink)] tracking-widest uppercase">
                                    {currentSongDetail.english_ref}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Stanzas */}
                            <div className="space-y-10">
                              {currentSongDetail.stanzas?.map((stanza, idx) => (
                                <div key={stanza.id || idx} className="text-center w-full">
                                  
                                  {/* Diamond Divider */}
                                  <div className="flex items-center justify-center gap-4 mb-6 relative">
                                    <div className="h-[1px] w-24 bg-gradient-to-r from-transparent to-[#D4AF37]/40" />
                                    <div className="w-7 h-7 rotate-45 border border-[#D4AF37] flex items-center justify-center bg-white dark:bg-[#0A0F19] z-10 shrink-0 shadow-sm relative">
                                      <span className="-rotate-45 text-[11px] font-accent font-semibold text-[var(--gold-ink)] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 mt-[0.5px]">
                                        {stanza.is_chorus ? "C" : stanza.stanza_number}
                                      </span>
                                    </div>
                                    <div className="h-[1px] w-24 bg-gradient-to-l from-transparent to-[#D4AF37]/40" />
                                  </div>

                                  <div className="px-4">
                                    <p className={`whitespace-pre-line font-serif leading-[2.1] ${fontSize === "sm" ? "text-sm" : fontSize === "md" ? "text-base" : fontSize === "lg" ? "text-[19px]" : "text-xl"} ${stanza.is_chorus ? "italic font-semibold text-[var(--gold-ink)] dark:text-[var(--gold-ink)]" : "text-slate-800 dark:text-[#E2E8F0]"}`}>
                                      {stanza.content}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Treble Clef Anchor */}
                            <div className="flex flex-col items-center justify-center mt-16 text-[var(--gold-ink)] opacity-80 select-none">
                              <div className="flex items-center justify-center gap-5 relative">
                                <div className="flex flex-col gap-1.5 w-16 items-end">
                                  <div className="h-[1px] w-full bg-gradient-to-r from-transparent to-[#D4AF37]/40" />
                                  <div className="h-[1px] w-12 bg-gradient-to-r from-transparent to-[#D4AF37]/40" />
                                </div>
                                <div className="text-4xl leading-none font-serif font-light mb-1 relative z-10">
                                  {/* Using a stylized S or text symbol to mimic the treble clef visually */}
                                  <span style={{ fontSize: '1.2em' }}>𝄞</span>
                                </div>
                                <div className="flex flex-col gap-1.5 w-16 items-start">
                                  <div className="h-[1px] w-full bg-gradient-to-l from-transparent to-[#D4AF37]/40" />
                                  <div className="h-[1px] w-12 bg-gradient-to-l from-transparent to-[#D4AF37]/40" />
                                </div>
                              </div>
                            </div>

                            {/* Prev/Next Hymn */}
                            <div className="mt-10 pt-5 border-t border-slate-200/60 dark:border-[#1c2245] flex items-center justify-between">
                              <button
                                onClick={() => {
                                  const currentIdx = songs.findIndex(s => s.id === songDetailView.id);
                                  if (currentIdx > 0) {
                                    setSongDirection(-1);
                                    setSongDetailView(songs[currentIdx - 1]);
                                  }
                                }}
                                className="px-4 py-2 text-xs font-semibold flex items-center gap-1.5 bg-white dark:bg-[#131730] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#1c2245] rounded-2xl transition cursor-pointer shadow-sm active:scale-95"
                              >
                                <ChevronLeft className="w-4 h-4" />
                                Iliyotangulia
                              </button>
                              <button
                                onClick={() => {
                                  const currentIdx = songs.findIndex(s => s.id === songDetailView.id);
                                  if (currentIdx < songs.length - 1) {
                                    setSongDirection(1);
                                    setSongDetailView(songs[currentIdx + 1]);
                                  }
                                }}
                                className="px-4 py-2 text-xs font-semibold flex items-center gap-1.5 bg-white dark:bg-[#131730] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#1c2245] rounded-2xl transition cursor-pointer shadow-sm active:scale-95"
                              >
                                Inayofuata
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            </div>
                            </motion.div>
                          ) : (
                            <motion.div
                              key="loading-song"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="flex flex-col items-center justify-center py-24"
                            >
                              <div className="w-7 h-7 rounded-full border-2 border-[#d9a020]/30 border-t-[#d9a020] animate-spin mb-2" />
                              <p className="text-xs text-[var(--muted-ink)] font-sans">Inapakia maneno...</p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  )}

                  {/* Floating Action Button for Dialpad */}
                  <button
                    onClick={() => setIsDialpadOpen(true)}
                    aria-label="Fungua kibodi ya kutafuta wimbo kwa namba"
                    className="absolute bottom-6 right-6 w-12 h-12 rounded-full bg-[#D4AF37] text-[var(--on-gold)] shadow-lg shadow-[#D4AF37]/30 flex items-center justify-center transition cursor-pointer active:scale-90 hover:bg-[#C5A059] z-40"
                  >
                    <span className="text-3xl leading-none font-serif font-light mb-[2px]">𝄞</span>
                  </button>
                </div>
              )}

              {/* ============================= */}
              {/* TAB 3: TAARIFA / RECORDS      */}
              {/* ============================= */}
              {activeTab === "taarifa" && (
                <div className="flex-grow flex flex-col overflow-hidden h-full bg-[#F5F3EE] dark:bg-[#0d1124]">
                  <header className="px-5 py-4 shrink-0 border-b border-[#d9a020]/12 dark:border-[#d9a020]/10 bg-[#F5F3EE]/95 dark:bg-[#0d1124]/95 backdrop-blur-md z-10 select-none">
                    <h2 className="text-2xl font-display font-bold text-[#0d1124] dark:text-white tracking-tight">Zaka &amp; Sadaka</h2>
                    <p className="text-[12px] font-mono text-[var(--gold-ink)] dark:text-[#d9a020] uppercase tracking-widest mt-0.5">Kumbukumbu za Michango</p>
                  </header>

                  <div className="flex-grow overflow-y-auto p-4 flex flex-col items-center w-full gap-4">

                    {isOfflineData && (
                      <div className="w-full bg-[#d9a020]/10 border border-[#d9a020]/25 rounded-2xl p-3 flex items-center gap-2.5 text-xs text-[#8f6113] dark:text-[#eccb6a] select-none shadow-xs animate-pulse">
                        <WifiOff className="w-4 h-4 shrink-0" />
                        <span className="font-sans font-medium">Umeunganishwa Nje ya Mtandao! Unaona kumbukumbu za mwisho zilizohifadhiwa.</span>
                      </div>
                    )}

                    {/* Scripture card */}
                    <div className="w-full relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#d9a020]/12 to-[#eccb6a]/6 dark:from-[#d9a020]/10 dark:to-transparent border border-[#d9a020]/20 dark:border-[#d9a020]/15 p-5 select-none">
                      <p className="font-display italic text-[#4a300a] dark:text-[#fdf9ef] text-sm leading-relaxed text-center">
                        "Leteni zaka kamili ghalani... asema Bwana wa majeshi"
                      </p>
                      <p className="mt-2 text-center text-[12px] font-mono font-bold text-[var(--gold-ink)] dark:text-[#d9a020] tracking-widest uppercase">— Malaki 3:10</p>
                    </div>

                    {!user ? (
                      /* Auth card */
                      <div className="w-full bg-white dark:bg-[#131730] rounded-3xl border border-slate-100 dark:border-[#1c2245] p-5 shadow-sm">
                        
                        {/* Tab switcher */}
                        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-[#0d1124] rounded-2xl mb-5 select-none">
                          <button
                            type="button"
                            onClick={() => { setAuthMode("login"); setAuthError(""); }}
                            className={`py-2.5 text-[11px] font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 uppercase tracking-wide ${authMode === "login" ? "bg-[#d9a020] text-[var(--on-gold)] shadow-md" : "text-[var(--muted-ink)] dark:text-slate-400 hover:text-[#0d1124] dark:hover:text-white"}`}
                          >
                            <Lock className="w-3 h-3" />
                            Kuingia
                          </button>
                          <button
                            type="button"
                            onClick={() => { setAuthMode("register"); setAuthError(""); }}
                            className={`py-2.5 text-[11px] font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 uppercase tracking-wide ${authMode === "register" ? "bg-indigo-600 text-white shadow-md" : "text-[var(--muted-ink)] dark:text-slate-400 hover:text-[#0d1124] dark:hover:text-white"}`}
                          >
                            <UserPlus className="w-3 h-3" />
                            Jisajili
                          </button>
                        </div>

                        <div className={`p-3 rounded-xl text-[11px] leading-relaxed mb-4 border ${authMode === "login" ? "bg-[#d9a020]/6 border-[#d9a020]/15 text-[#4a300a] dark:text-[#eccb6a]" : "bg-indigo-50/60 dark:bg-indigo-950/20 border-indigo-200/40 dark:border-indigo-800/30 text-indigo-800 dark:text-indigo-300"}`}>
                          {authMode === "login" ? (
                            <p>🔑 Ingiza namba yako ya simu na nenosiri kufungua taarifa yako ya michango.</p>
                          ) : (
                            <p>✨ Sajili akaunti mpya kuunda kadi yako ya uanachama wa digital.</p>
                          )}
                        </div>

                        {authError && (
                          <div className="mb-4 p-3 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 text-xs font-semibold text-center">
                            {authError}
                          </div>
                        )}

                        <form onSubmit={authMode === "login" ? handleLoginSubmit : handleRegisterSubmit} className="space-y-4">
                          <div>
                            <label className="block text-[12px] font-bold mb-1.5 text-[var(--muted-ink)] dark:text-slate-400 uppercase tracking-wider">Namba ya Simu</label>
                            <div className="relative">
                              <Phone className="w-4 h-4 absolute left-3.5 top-3.5 text-[var(--muted-ink)]" />
                              <input type="tel" inputMode="tel" autoComplete="tel" required placeholder="0754 112 233" value={authPhone} onChange={(e) => setAuthPhone(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-[#0d1124] border border-slate-200 dark:border-[#1c2245] rounded-xl text-[#0d1124] dark:text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#d9a020]/30 focus:border-[#d9a020]/40 transition"
                              />
                            </div>
                            {authMode === "register" && (
                              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted-ink)] dark:text-slate-400">
                                Tumia namba ile ile uliyompa mhazini wa kanisa lako.
                              </p>
                            )}
                          </div>
                          <div>
                            <label className="block text-[12px] font-bold mb-1.5 text-[var(--muted-ink)] dark:text-slate-400 uppercase tracking-wider">Nenosiri (Password)</label>
                            <div className="relative">
                              <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-[var(--muted-ink)]" />
                              <input type={showPassword ? "text" : "password"} required minLength={6} placeholder="••••••••" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)}
                                className="w-full pl-10 pr-11 py-3 bg-slate-50 dark:bg-[#0d1124] border border-slate-200 dark:border-[#1c2245] rounded-xl text-[#0d1124] dark:text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#d9a020]/30 focus:border-[#d9a020]/40 transition"
                              />
                              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-2.5 p-1 text-[var(--muted-ink)] hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer rounded">
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                          {authMode === "register" && (
                            <div>
                              <label className="block text-[12px] font-bold mb-1.5 text-[var(--muted-ink)] dark:text-slate-400 uppercase tracking-wider">Thibitisha Nenosiri</label>
                              <div className="relative">
                                <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-[var(--muted-ink)]" />
                                <input type={showConfirmPassword ? "text" : "password"} required minLength={6} placeholder="••••••••" value={authConfirmPassword} onChange={(e) => setAuthConfirmPassword(e.target.value)}
                                  className="w-full pl-10 pr-11 py-3 bg-slate-50 dark:bg-[#0d1124] border border-slate-200 dark:border-[#1c2245] rounded-xl text-[#0d1124] dark:text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300/40 focus:border-indigo-400/40 transition"
                                />
                                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3.5 top-2.5 p-1 text-[var(--muted-ink)] hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer rounded">
                                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                              </div>
                            </div>
                          )}

                          <button type="submit" disabled={isLoadingAuth}
                            className={`w-full py-3.5 text-white font-semibold rounded-2xl transition-all active:scale-[0.98] text-sm cursor-pointer shadow-sm flex items-center justify-center gap-2 font-sans mt-2 ${authMode === "login" ? "bg-[#d9a020] hover:bg-[#b8821a]" : "bg-indigo-600 hover:bg-indigo-700"} disabled:opacity-40`}
                          >
                            {isLoadingAuth ? (
                              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Inashughulikia...</span></>
                            ) : (
                              <><Check className="w-4 h-4" /><span>{authMode === "login" ? "Ingia Kwenye Akaunti" : "Jisajili Kama Mshiriki"}</span></>
                            )}
                          </button>

                          <div className="text-center pt-3 border-t border-slate-100 dark:border-[#1c2245] pb-1">
                            <button type="button" onClick={(e) => { e.preventDefault(); setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); }}
                              className="text-xs font-semibold cursor-pointer hover:underline text-[var(--muted-ink)] dark:text-slate-400 inline-flex items-center min-h-[44px] px-2"
                            >
                              {authMode === "login" ? "Nahitaji kujisajili upya →" : "Nimeshasajiliwa, kuingia →"}
                            </button>
                          </div>
                        </form>
                      </div>
                    ) : null}

                    {/* The app opens on Taarifa, so this card is the first thing
                        a visitor without an account sees. Without this they
                        could reasonably conclude the whole app is locked —
                        say plainly that it is not, and offer the way through. */}
                    {!user && (
                      <div className="w-full bg-white dark:bg-[#131730] rounded-3xl border border-slate-100 dark:border-[#1c2245] p-4 select-none">
                        <p className="text-[12px] leading-relaxed text-[var(--muted-ink)] dark:text-slate-400 text-center font-sans">
                          Huhitaji akaunti kusoma <span className="font-bold text-[#0d1124] dark:text-white">Biblia</span> au kuimba{" "}
                          <span className="font-bold text-[#0d1124] dark:text-white">Nyimbo</span>. Akaunti inahitajika tu kwa kumbukumbu zako za michango.
                        </p>
                        <div className="grid grid-cols-2 gap-2 mt-3.5">
                          <button
                            type="button"
                            onClick={goToBiblia}
                            className="flex items-center justify-center gap-2 py-3 rounded-2xl border border-[#d9a020]/25 bg-[#d9a020]/8 text-[var(--gold-ink)] dark:text-[#eccb6a] text-[12px] font-bold cursor-pointer transition active:scale-[0.98]"
                          >
                            <BookOpen className="w-4 h-4" />
                            Fungua Biblia
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveTab("nyimbo")}
                            className="flex items-center justify-center gap-2 py-3 rounded-2xl border border-slate-200 dark:border-[#1c2245] bg-slate-50 dark:bg-[#0d1124] text-[#0d1124] dark:text-slate-200 text-[12px] font-bold cursor-pointer transition active:scale-[0.98]"
                          >
                            <Music className="w-4 h-4" />
                            Fungua Nyimbo
                          </button>
                        </div>
                      </div>
                    )}

                    {user && (
                      /* Logged in — contributions report */
                      <div className="w-full">
                        {/* Toka and Futa akaunti used to sit here, beside the
                            heading. They now close the page instead — see the
                            end of renderCongregantReport. */}
                        <div className="flex items-center justify-between mb-4 px-1 select-none">
                          <h3 className="text-sm font-semibold text-[#0d1124] dark:text-white font-sans">Ripoti Yako</h3>
                        </div>
                        {isLoadingContributions ? (
                          <div className="flex flex-col items-center justify-center py-16">
                            <div className="w-8 h-8 rounded-full border-2 border-[#d9a020]/30 border-t-[#d9a020] animate-spin mb-3" />
                            <p className="text-xs text-[var(--muted-ink)] font-sans">Inapakia taarifa yako...</p>
                          </div>
                        ) : (
                          <div className="bg-white dark:bg-[#131730] rounded-3xl border border-slate-100 dark:border-[#1c2245] p-4 shadow-sm">
                            {renderCongregantReport(user, userContributions, financialStats, churchData || { name: "Kanisa Lako" })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Attribution logo section */}
                    <div className="mt-6 mb-4 text-center select-none opacity-80 pt-4 w-full border-t border-slate-200/40 dark:border-[#1c2245]">
                      <p className="text-[11px] text-[var(--muted-ink)] dark:text-slate-500 font-sans tracking-wide">
                        Made by <span className="font-semibold text-[var(--gold-ink)] dark:text-[#d9a020]">Venics Software Company</span>
                      </p>
                    </div>
                  </div>
                </div>
              )}

            </>
          )}

        </div>

        {/* ===================== BOTTOM NAVIGATION ===================== */}
        {dbProgressState.status === "ready" && (
          <nav className="h-[68px] shrink-0 border-t border-slate-200/60 dark:border-[#1c2245] bg-white/95 dark:bg-[#0d1124]/95 backdrop-blur-md flex items-center justify-around px-2 select-none z-30">
            
            {[
              { id: "taarifa" as const, label: "Taarifa", icon: Database },
              { id: "biblia" as const, label: "Biblia", icon: BookOpen },
              { id: "nyimbo" as const, label: "Nyimbo", icon: Music },
            ].map(({ id, label, icon: Icon }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => {
                    if (id === "biblia") {
                      goToBiblia();
                      return;
                    }
                    // Leaving Biblia: note the reading position first, while the
                    // reader is still mounted.
                    rememberBibleScroll();

                    // Only drop back to the catalogue when Nyimbo is ALREADY
                    // the open tab. Coming back from Biblia should return you
                    // to the hymn you were singing, not to hymn 1.
                    if (id === "nyimbo" && activeTab === "nyimbo") {
                      rememberSongListScroll();
                      setSongDetailView(null);
                    }
                    setActiveTab(id);
                    setIsBookSelectorOpen(false);
                    setShowSearchModal(false);
                  }}
                  className={`flex-1 flex flex-col items-center justify-center h-full gap-1 cursor-pointer transition-all active:scale-90 relative ${isActive ? "text-[var(--gold-ink)] dark:text-[#d9a020]" : "text-[var(--muted-ink)] dark:text-[var(--muted-ink)] hover:text-slate-600 dark:hover:text-[var(--muted-ink)]"}`}
                >
                  {isActive && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gradient-to-r from-[#d9a020] to-[#eccb6a] rounded-full" />
                  )}
                  <Icon className={`${isActive ? "w-[22px] h-[22px]" : "w-5 h-5"} transition-all`} strokeWidth={isActive ? 2.2 : 1.7} />
                  <span className={`text-[11px] font-sans uppercase tracking-wider transition-all ${isActive ? "font-bold" : "font-medium"}`}>{label}</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* ===================== BIBLE BOOK SELECTOR SHEET ===================== */}
        <AnimatePresence>
          {isBookSelectorOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 top-0 bottom-[68px] z-50 bg-[#F5F3EE] dark:bg-[#0d1124] flex flex-col select-none overflow-hidden"
            >
              {/* Header */}
              <div className="shrink-0 bg-white dark:bg-[#131730] border-b border-slate-100 dark:border-[#1c2245] px-4 py-3 flex items-center gap-3">
                <button
                  aria-label="Rudi nyuma"
                  onClick={() => {
                    if (selectorStep === "verse") {
                      setSelectorStep("chapter");
                    } else if (selectorStep === "chapter") {
                      setSelectorStep("book");
                    } else {
                      setIsBookSelectorOpen(false);
                    }
                  }}
                  className="p-3 rounded-xl text-[var(--muted-ink)] dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#1c2245] transition active:scale-90 cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                {selectorStep === "book" ? (
                  // A label, not a div: the field no longer autofocuses (opening
                  // Tafuta threw the keyboard up over the book grid), so the
                  // whole bar including the icon has to be a tap target.
                  <label className="flex-1 flex items-center gap-2 bg-transparent cursor-text">
                    <Search className="w-4 h-4 text-[var(--muted-ink)] shrink-0" />
                    <input
                      type="text"
                      placeholder="Tafuta kitabu..."
                      value={selectorBookSearch}
                      onChange={(e) => setSelectorBookSearch(e.target.value)}
                      className="w-full bg-transparent border-0 p-0.5 text-sm text-[#0d1124] dark:text-white placeholder-slate-400 focus:ring-0 focus:outline-none font-sans"
                    />
                  </label>
                ) : (
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] font-mono font-bold text-[var(--gold-ink)] dark:text-[#d9a020] uppercase tracking-widest">
                      {selectorStep === "chapter" ? "CHAGUA AYA" : "CHAGUA FUNGU"}
                    </span>
                    <h4 className="text-sm font-semibold text-[#0d1124] dark:text-white font-display truncate">
                      {selectedSelectorBook?.name}
                      {selectorStep === "verse" && selectorChapter !== null ? ` ${selectorChapter}` : ""}
                    </h4>
                  </div>
                )}

                {selectorBookSearch && selectorStep === "book" && (
                  <button onClick={() => setSelectorBookSearch("")} className="p-1 rounded text-[var(--muted-ink)] hover:text-slate-600 dark:hover:text-white transition cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Testament tabs (book step only) */}
              {selectorStep === "book" && !selectorBookSearch && (
                <div className="shrink-0 flex border-b border-slate-100 dark:border-[#1c2245] bg-white dark:bg-[#131730]">
                  {testaments.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setCurrentTestamentId(t.id)}
                      className={`flex-1 py-2.5 text-xs font-bold font-sans uppercase tracking-wider transition cursor-pointer ${currentTestamentId === t.id ? "text-[var(--gold-ink)] dark:text-[#d9a020] border-b-2 border-[#d9a020]" : "text-[var(--muted-ink)] hover:text-slate-600 dark:hover:text-slate-300"}`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Content */}
              <div className="flex-grow overflow-y-auto">
                {selectorStep === "book" ? (
                  <div className="p-3">
                    {selectorBookSearch.trim() ? (
                      <div className="space-y-4">
                        {/* Books Section */}
                        {filteredSelectorBooks.length > 0 && (
                          <div className="space-y-2">
                            <h5 className="text-[12px] font-mono font-bold text-[var(--muted-ink)] uppercase tracking-widest px-1">
                              Vitabu ({filteredSelectorBooks.length})
                            </h5>
                            <div className="grid grid-cols-3 gap-2">
                              {filteredSelectorBooks.map(b => (
                                <button
                                  key={b.id}
                                  onClick={() => {
                                    setSelectedSelectorBook(b);
                                    setSelectorChapter(null);
                                    setSelectorStep("chapter");
                                  }}
                                  className={`py-4 px-2.5 min-h-[72px] flex items-center justify-center rounded-2xl text-sm leading-tight font-semibold font-sans text-center cursor-pointer transition active:scale-95 border ${
                                    selectedBook?.id === b.id
                                      ? "bg-[#d9a020]/12 border-[#d9a020]/30 text-[#4a300a] dark:text-[#eccb6a] font-bold"
                                      : "bg-white dark:bg-[#131730] border-slate-100 dark:border-[#1c2245]/60 text-slate-700 dark:text-slate-300 hover:border-[#d9a020]/20 hover:bg-[#d9a020]/5"
                                  }`}
                                >
                                  {b.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Scriptures (Verses) Section */}
                        <div className="space-y-2">
                          <h5 className="text-[12px] font-mono font-bold text-[var(--muted-ink)] uppercase tracking-widest px-1 flex items-center justify-between">
                            <span>
                              Mistari Kwenye Biblia
                              {selectorMeta.total > 0 && (
                                <span className="ml-1.5 font-normal normal-case tracking-normal">
                                  ({selectorMeta.total.toLocaleString()}
                                  {selectorMeta.truncated ? ` katika vitabu ${selectorMeta.books}` : ""})
                                </span>
                              )}
                            </span>
                            {isSearchingSelectorScriptures && (
                              <span className="text-[11px] lowercase font-normal italic text-[var(--gold-ink)] animate-pulse">Inatafuta...</span>
                            )}
                          </h5>

                          {isSearchingSelectorScriptures && selectorScriptureResults.length === 0 ? (
                            <div className="flex items-center justify-center py-6 text-[var(--muted-ink)]">
                              <div className="w-5 h-5 rounded-full border-2 border-[#d9a020]/30 border-t-[#d9a020] animate-spin" />
                            </div>
                          ) : selectorScriptureResults.length > 0 || selectorJump ? (
                            // No max-height and no scroller of its own: the sheet's
                            // own `flex-grow overflow-y-auto` scrolls. A nested
                            // 350px window meant dismissing the keyboard freed
                            // space the results refused to use, leaving a dead band
                            // that looked like the list had been cut off.
                            <div className="space-y-2 pr-1">
                              {selectorJump && (
                                <div
                                  onClick={() => handleNavigateToVerse(selectorJump)}
                                  className="p-3 bg-[#d9a020]/8 dark:bg-[#d9a020]/12 border border-[#d9a020]/30 cursor-pointer rounded-xl transition flex flex-col active:scale-[0.99]"
                                >
                                  <span className="text-[10px] font-mono font-bold text-[var(--gold-ink)] dark:text-[#d9a020] uppercase tracking-widest mb-1">
                                    Nenda moja kwa moja
                                  </span>
                                  <p className="text-xs font-sans text-slate-700 dark:text-slate-300 leading-relaxed italic">
                                    "{selectorJump.text}"
                                  </p>
                                  <span className="mt-1.5 self-start text-[12px] bg-[#d9a020]/15 text-[#8f6113] dark:text-[#d9a020] px-2 py-0.5 rounded font-bold font-sans">
                                    {selectorJump.book_name} {selectorJump.chapter}:{selectorJump.verse}
                                  </span>
                                </div>
                              )}
                              {selectorScriptureResults.map((v) => (
                                <div
                                  key={v.id}
                                  onClick={() => handleNavigateToVerse(v)}
                                  className="p-3 bg-white dark:bg-[#131730] border border-slate-100 dark:border-[#1c2245]/60 hover:border-[#d9a020]/20 hover:bg-[#d9a040]/5 cursor-pointer rounded-xl transition flex flex-col active:scale-[0.99] shadow-sm"
                                >
                                  <p className="text-xs font-sans text-slate-700 dark:text-slate-300 leading-relaxed italic">
                                    "<HighlightedText text={v.text} terms={searchTerms(selectorBookSearch)} />"
                                  </p>
                                  <div className="mt-1.5 flex items-center justify-between">
                                    <span className="text-[12px] bg-[#d9a020]/10 dark:bg-[#d9a020]/15 text-[#8f6113] dark:text-[#d9a020] px-2 py-0.5 rounded font-bold font-sans">
                                      {v.book_name} {v.chapter}:{v.verse}
                                    </span>
                                    <span className="text-[11px] font-mono text-[var(--muted-ink)]">{v.testament_name}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            selectorBookSearch.trim().length >= 2 && !isSearchingSelectorScriptures && (
                              <div className="text-center py-6 text-[var(--muted-ink)] text-xs font-sans">
                                Hakuna mistari inayolingana kwenye maandiko
                              </div>
                            )
                          )}
                        </div>

                        {/* Combined No Results */}
                        {filteredSelectorBooks.length === 0 && selectorScriptureResults.length === 0 && !selectorJump && !isSearchingSelectorScriptures && (
                          <div className="flex flex-col items-center justify-center py-12 text-[var(--muted-ink)] text-center select-none">
                            <Compass className="w-8 h-8 text-slate-200 dark:text-slate-800 mb-1.5 animate-pulse" />
                            <p className="text-xs font-bold font-sans">Hakuna matokeo yaliyopatikana</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Standard list of books */
                      <div className="grid grid-cols-3 gap-2">
                        {filteredSelectorBooks.map(b => (
                          <button
                            key={b.id}
                            onClick={() => {
                              setSelectedSelectorBook(b);
                              setSelectorChapter(null);
                              setSelectorStep("chapter");
                            }}
                            className={`py-4 px-2.5 min-h-[72px] flex items-center justify-center rounded-2xl text-sm leading-tight font-semibold font-sans text-center cursor-pointer transition active:scale-95 border ${
                              selectedBook?.id === b.id
                                ? "bg-[#d9a020]/12 border-[#d9a020]/30 text-[#4a300a] dark:text-[#eccb6a] font-bold"
                                : "bg-white dark:bg-[#131730] border-slate-100 dark:border-[#1c2245]/60 text-slate-700 dark:text-slate-300 hover:border-[#d9a020]/20 hover:bg-[#d9a020]/5"
                            }`}
                          >
                            {b.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : selectorStep === "chapter" ? (
                  <div className="p-3 grid grid-cols-4 gap-2.5">
                    {selectedSelectorBook && Array.from({ length: selectedSelectorBook.chapter_count }, (_, i) => i + 1).map(ch => (
                      <button
                        key={ch}
                        onClick={() => {
                          if (!selectedSelectorBook) return;
                          // Advance to the verse step rather than closing here,
                          // so the reader can land on an exact fungu.
                          setSelectorChapter(ch);
                          try {
                            setSelectorVerseCount(dbService.getVerses(selectedSelectorBook.id, ch).length);
                          } catch (err) {
                            console.error("Could not count verses for the selector", err);
                            setSelectorVerseCount(0);
                          }
                          setSelectorStep("verse");
                        }}
                        className={`py-4 min-h-[60px] rounded-2xl text-base font-mono font-bold text-center cursor-pointer transition active:scale-95 border ${
                          selectedBook?.id === selectedSelectorBook?.id && currentChapter === ch
                            ? "bg-[#d9a020] text-[var(--on-gold)] border-[#d9a020] shadow-sm shadow-[#d9a020]/20"
                            : "bg-white dark:bg-[#131730] border-slate-100 dark:border-[#1c2245]/60 text-slate-700 dark:text-slate-300 hover:border-[#d9a020]/25 hover:bg-[#d9a020]/6"
                        }`}
                      >
                        {ch}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-3">
                    {/* Whole-chapter escape hatch: not everyone wants a specific verse. */}
                    <button
                      onClick={() => {
                        if (!selectedSelectorBook || selectorChapter === null) return;
                        handleBookChange(selectedSelectorBook, selectorChapter);
                        setCurrentTestamentId(selectedSelectorBook.testament_id);
                        localStorage.setItem("bible-last-book-id", selectedSelectorBook.id.toString());
                        localStorage.setItem("bible-last-chapter", selectorChapter.toString());
                        localStorage.setItem("bible-has-selected-first-time", "true");
                        setPendingVerseNumber(null);
                        setIsBookSelectorOpen(false);
                      }}
                      className="w-full mb-3 py-3 min-h-[44px] rounded-2xl text-xs font-sans font-bold cursor-pointer transition active:scale-[0.99] border border-[#d9a020]/30 bg-[#d9a020]/10 text-[var(--gold-ink)] dark:text-[#d9a020]"
                    >
                      Anza mwanzo wa {selectedSelectorBook?.name} {selectorChapter}
                    </button>

                    <div className="grid grid-cols-4 gap-2.5">
                      {Array.from({ length: selectorVerseCount }, (_, i) => i + 1).map(vs => (
                        <button
                          key={vs}
                          onClick={() => {
                            if (!selectedSelectorBook || selectorChapter === null) return;
                            handleBookChange(selectedSelectorBook, selectorChapter);
                            setCurrentTestamentId(selectedSelectorBook.testament_id);
                            localStorage.setItem("bible-last-book-id", selectedSelectorBook.id.toString());
                            localStorage.setItem("bible-last-chapter", selectorChapter.toString());
                            localStorage.setItem("bible-has-selected-first-time", "true");
                            setPendingVerseNumber(vs);
                            setIsBookSelectorOpen(false);
                          }}
                          className={`py-4 min-h-[60px] rounded-2xl text-base font-mono font-bold text-center cursor-pointer transition active:scale-95 border ${
                            selectedBook?.id === selectedSelectorBook?.id && currentChapter === selectorChapter && verses.find(v => v.id === (highlightedVerseId ?? landedVerseId))?.verse === vs
                              ? "bg-[#d9a020] text-[var(--on-gold)] border-[#d9a020] shadow-sm shadow-[#d9a020]/20"
                              : "bg-white dark:bg-[#131730] border-slate-100 dark:border-[#1c2245]/60 text-slate-700 dark:text-slate-300 hover:border-[#d9a020]/25 hover:bg-[#d9a020]/6"
                          }`}
                        >
                          {vs}
                        </button>
                      ))}
                    </div>

                    {selectorVerseCount === 0 && (
                      <p className="text-center text-[12px] text-[var(--muted-ink)] py-8 font-sans">
                        Hakuna mafungu yaliyopatikana kwa aya hii.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ===================== SEARCH MODAL ===================== */}
        <AnimatePresence>
          {showSearchModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 top-0 bottom-[68px] z-50 bg-[#F5F3EE] dark:bg-[#0d1124] flex flex-col overflow-hidden"
            >
              <div className="shrink-0 bg-white dark:bg-[#131730] border-b border-slate-100 dark:border-[#1c2245] px-4 py-3 flex items-center gap-3">
                <button onClick={() => { setShowSearchModal(false); setSearchQuery(""); setSearchResults([]); }} className="p-3 rounded-xl text-[var(--muted-ink)] dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#1c2245] transition cursor-pointer active:scale-90">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex-1 flex items-center gap-2">
                  <Search className="w-4 h-4 text-[var(--muted-ink)] shrink-0" />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Tafuta mistari..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-transparent text-sm text-[#0d1124] dark:text-white placeholder-slate-400 focus:outline-none border-0 font-sans"
                  />
                </div>
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(""); setSearchResults([]); }} className="p-1 rounded text-[var(--muted-ink)] hover:text-slate-600 transition cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex-grow overflow-y-auto p-3.5 space-y-2">
                {isSearching ? (
                  <div className="flex flex-col items-center py-24 text-[var(--muted-ink)]">
                    <div className="w-7 h-7 rounded-full border-2 border-[#d9a020]/30 border-t-[#d9a020] animate-spin mb-2" />
                    <span className="text-xs font-sans">Inatafuta...</span>
                  </div>
                ) : searchResults.length > 0 || searchJump ? (
                  <>
                    {searchJump && (
                      <div
                        onClick={() => handleNavigateToVerse(searchJump)}
                        className="p-4 mb-1 bg-[#d9a020]/8 dark:bg-[#d9a020]/12 border border-[#d9a020]/30 cursor-pointer rounded-2xl transition flex flex-col active:scale-[0.99]"
                      >
                        <span className="text-[10px] font-mono font-bold text-[var(--gold-ink)] dark:text-[#d9a020] uppercase tracking-widest mb-1.5">
                          Nenda moja kwa moja
                        </span>
                        <p className="text-sm font-display leading-relaxed text-[#1a1510] dark:text-[#fdf9ef] italic">
                          "{searchJump.text}"
                        </p>
                        <span className="mt-2.5 self-start bg-[#d9a020]/15 text-[#8f6113] dark:text-[#d9a020] px-2.5 py-0.5 rounded-full text-[12px] font-mono font-bold">
                          {searchJump.book_name} {searchJump.chapter}:{searchJump.verse}
                        </span>
                      </div>
                    )}
                    <p className="text-[11px] font-mono font-bold text-[var(--muted-ink)] uppercase tracking-widest px-1">
                      {searchMeta.truncated
                        ? `MISTARI ${searchMeta.total.toLocaleString()} KATIKA VITABU ${searchMeta.books}`
                        : `MISTARI ${searchResults.length} IMEPATIKANA`}
                    </p>
                    {searchMeta.truncated && (
                      <p className="text-[11px] font-sans text-[var(--muted-ink)] px-1 -mt-1 leading-relaxed">
                        Inaonyesha michache kutoka kila kitabu. Andika maneno zaidi, au andika
                        rejea kama <span className="font-bold">Yakobo 4:7</span>, ili kupata haraka.
                      </p>
                    )}
                    {searchResults.map((result) => (
                      <div
                        key={result.id}
                        onClick={() => handleNavigateToVerse(result)}
                        className="p-4 bg-white dark:bg-[#131730] border border-slate-100 dark:border-[#1c2245]/60 hover:border-[#d9a020]/20 cursor-pointer rounded-2xl transition flex flex-col shadow-sm active:scale-[0.99]"
                      >
                        <p className="text-sm font-display leading-relaxed text-[#1a1510] dark:text-[#fdf9ef] italic">
                          "<HighlightedText text={result.text} terms={searchTerms(searchQuery)} />"
                        </p>
                        <div className="mt-2.5 flex items-center justify-between">
                          <span className="bg-[#d9a020]/10 dark:bg-[#d9a020]/15 text-[#8f6113] dark:text-[#d9a020] px-2.5 py-0.5 rounded-full text-[12px] font-mono font-bold">
                            {result.book_name} {result.chapter}:{result.verse}
                          </span>
                          <span className="text-[12px] font-mono text-[var(--muted-ink)]">{result.testament_name}</span>
                        </div>
                      </div>
                    ))}
                  </>
                ) : searchQuery.trim().length >= 2 ? (
                  <div className="flex flex-col items-center py-20 text-[var(--muted-ink)] text-center select-none">
                    <Compass className="w-10 h-10 text-slate-200 dark:text-slate-800 mb-2 animate-pulse" />
                    <p className="text-xs font-bold">Hakuna mistari iliyopatikana</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-16 text-center select-none">
                    <Sparkles className="w-10 h-10 text-[var(--gold-ink)]/15 mb-3 animate-bounce" />
                    <p className="text-xs font-bold text-[var(--muted-ink)] dark:text-slate-400 uppercase tracking-widest font-mono">Utafutaji wa Biblia</p>
                    <p className="text-[12px] text-[var(--muted-ink)] max-w-[220px] mt-1.5 leading-relaxed">
                      Andika neno lolote la Kiswahili kuona mistari yote katika vitabu 66 vya Biblia.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ===================== DIALPAD (JUMP TO HYMN) ===================== */}
        <AnimatePresence>
          {isDialpadOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 top-0 bottom-[68px] z-50 bg-black/50 backdrop-blur-sm flex flex-col justify-end"
            >
              <div className="absolute inset-0" onClick={() => { setIsDialpadOpen(false); setDialpadInput(""); }} />
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "tween", duration: 0.22 }}
                className="bg-white dark:bg-[#131730] rounded-t-[36px] overflow-hidden shadow-2xl relative z-10 border-t border-slate-100 dark:border-[#1c2245] flex flex-col p-6 pb-8 select-none"
              >
                <div className="w-10 h-1 bg-slate-200 dark:bg-slate-700 rounded-full mx-auto mb-5" />
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="text-sm font-bold text-[#0d1124] dark:text-white font-sans uppercase tracking-tight">Nenda kwa Wimbo</h3>
                    <p className="text-[12px] text-[var(--muted-ink)] font-mono mt-0.5">Chagua wimbo kwa namba yake</p>
                  </div>
                  <button onClick={() => { setIsDialpadOpen(false); setDialpadInput(""); }} className="text-xs font-bold text-[var(--muted-ink)] hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#1c2245] transition">
                    Funga
                  </button>
                </div>

                <div className="bg-slate-50 dark:bg-[#0d1124] rounded-2xl p-4 mb-5 text-center border border-slate-100 dark:border-[#1c2245] h-24 flex flex-col justify-center">
                  <div className="text-4xl font-mono font-bold tracking-widest text-[var(--gold-ink)] dark:text-[#d9a020]">
                    {dialpadInput || <span className="text-slate-300 dark:text-slate-700 font-sans font-light text-3xl">---</span>}
                  </div>
                  <div className="mt-1 text-xs font-sans font-semibold text-[var(--muted-ink)] h-5 overflow-hidden">
                    {(() => {
                      if (!dialpadInput) return "Chagua namba 1 - 300+";
                      const match = songs.find(s => s.number === dialpadInput || parseInt(s.number, 10) === parseInt(dialpadInput, 10));
                      if (match) return <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓ {match.title}</span>;
                      return <span className="text-red-400">Haimatch wimbo wowote</span>;
                    })()}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-y-3 gap-x-5 max-w-[280px] mx-auto w-full pb-2">
                  {[1,2,3,4,5,6,7,8,9].map((num) => (
                    <button key={num} onClick={() => { if (dialpadInput.length < 3) setDialpadInput(prev => prev + num); }}
                      className="w-14 h-14 rounded-full flex items-center justify-center font-mono text-xl font-bold bg-slate-100 dark:bg-[#1c2245] hover:bg-[#d9a020]/10 text-[#0d1124] dark:text-white active:scale-90 transition cursor-pointer"
                    >{num}</button>
                  ))}
                  <button onClick={() => setDialpadInput(prev => prev.slice(0, -1))} className="w-14 h-14 rounded-full flex items-center justify-center font-sans text-xl bg-slate-100 dark:bg-[#1c2245] hover:bg-red-50 dark:hover:bg-red-950/20 text-red-500 active:scale-90 transition cursor-pointer">⌫</button>
                  <button onClick={() => { if (dialpadInput.length > 0 && dialpadInput.length < 3) setDialpadInput(prev => prev + "0"); }}
                    className="w-14 h-14 rounded-full flex items-center justify-center font-mono text-xl font-bold bg-slate-100 dark:bg-[#1c2245] hover:bg-[#d9a020]/10 text-[#0d1124] dark:text-white active:scale-90 transition cursor-pointer"
                  >0</button>
                  <button
                    onClick={() => {
                      const match = songs.find(s => s.number === dialpadInput || parseInt(s.number, 10) === parseInt(dialpadInput, 10));
                      if (match) { setSongDetailView(match); setSelectedSong(match); setIsDialpadOpen(false); setDialpadInput(""); }
                    }}
                    disabled={!songs.some(s => s.number === dialpadInput || parseInt(s.number, 10) === parseInt(dialpadInput, 10))}
                    className={`w-14 h-14 rounded-full flex items-center justify-center font-sans text-xs font-bold uppercase active:scale-95 transition cursor-pointer ${songs.some(s => s.number === dialpadInput || parseInt(s.number, 10) === parseInt(dialpadInput, 10)) ? "bg-[#d9a020] text-[var(--on-gold)] shadow-md shadow-[#d9a020]/20" : "bg-slate-100 dark:bg-[#1c2245] text-[var(--muted-ink)] opacity-40 pointer-events-none"}`}
                  >
                    Nenda
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ===================== SETTINGS DRAWER ===================== */}
        <AnimatePresence>
          {isSettingsOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 top-0 bottom-[68px] z-50 bg-black/50 backdrop-blur-sm flex flex-col justify-end"
            >
              <div className="absolute inset-0" onClick={() => setIsSettingsOpen(false)} />
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "tween", duration: 0.22 }}
                className="bg-white dark:bg-[#131730] rounded-t-[36px] overflow-hidden shadow-2xl relative z-10 border-t border-slate-100 dark:border-[#1c2245] flex flex-col p-6 pb-8 select-none"
              >
                <div className="w-10 h-1 bg-slate-200 dark:bg-slate-700 rounded-full mx-auto mb-5" />
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="text-sm font-bold text-[#0d1124] dark:text-white font-sans uppercase tracking-tight">Mipangilio ya Usomaji</h3>
                    <p className="text-[12px] text-[var(--muted-ink)] font-mono mt-0.5">Binafsisha mwonekano wako</p>
                  </div>
                  <button onClick={() => setIsSettingsOpen(false)} className="text-xs font-bold text-[var(--gold-ink)] dark:text-[#d9a020] px-3 py-1.5 rounded-lg hover:bg-[#d9a020]/8 transition cursor-pointer">Funga</button>
                </div>

                <div className="space-y-5">
                  {/* Theme */}
                  <div>
                    <span className="text-[12px] font-bold text-[var(--muted-ink)] uppercase tracking-widest block mb-2">Mandhari</span>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: false, label: "Mwangaza", icon: Sun },
                        { id: true, label: "Giza", icon: Moon }
                      ].map(({ id, label, icon: Icon }) => (
                        <button key={String(id)} onClick={() => setDarkMode(id)}
                          className={`py-3 text-xs font-semibold rounded-2xl flex items-center justify-center gap-2 border transition-all cursor-pointer ${darkMode === id ? "bg-[#d9a020]/10 border-[#d9a020]/25 text-[#4a300a] dark:text-[#eccb6a] font-bold" : "bg-slate-50 dark:bg-[#0d1124] border-slate-200 dark:border-[#1c2245] text-[var(--muted-ink)] dark:text-slate-300"}`}
                        >
                          <Icon className="w-4 h-4" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font size */}
                  <div>
                    <span className="text-[12px] font-bold text-[var(--muted-ink)] uppercase tracking-widest block mb-2">Ukubwa wa Maandishi</span>
                    <div className="grid grid-cols-4 gap-1.5">
                      {(["sm","md","lg","xl"] as const).map((sz) => {
                        const labels = { sm: "Ndogo", md: "Wastani", lg: "Kubwa", xl: "Kuu" };
                        return (
                          <button key={sz} onClick={() => setFontSize(sz)}
                            className={`py-2.5 text-[11px] rounded-2xl border transition-all flex flex-col items-center cursor-pointer ${fontSize === sz ? "bg-[#d9a020] text-[var(--on-gold)] border-transparent font-bold" : "bg-slate-50 dark:bg-[#0d1124] border-slate-200 dark:border-[#1c2245] text-[var(--muted-ink)] dark:text-slate-300 hover:bg-slate-100"}`}
                          >
                            <span className="font-semibold">{labels[sz]}</span>
                            <span className={`mt-0.5 opacity-60 font-mono ${sz === "sm" ? "text-[11px]" : sz === "md" ? "text-[12px]" : sz === "lg" ? "text-xs" : "text-sm"}`}>A</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Layout style */}
                  <div>
                    <span className="text-[12px] font-bold text-[var(--muted-ink)] uppercase tracking-widest block mb-2">Muonekano wa Mistari</span>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: "paragraph" as const, label: "Aya Zinazoendelea", icon: AlignLeft },
                        { id: "list" as const, label: "Mstari kwa Mstari", icon: Layers }
                      ].map(({ id, label, icon: Icon }) => (
                        <button key={id} onClick={() => setLayoutStyle(id)}
                          className={`py-3 text-xs font-semibold rounded-2xl flex items-center justify-center gap-2 border transition-all cursor-pointer ${layoutStyle === id ? "bg-[#d9a020]/10 border-[#d9a020]/25 text-[#4a300a] dark:text-[#eccb6a] font-bold" : "bg-slate-50 dark:bg-[#0d1124] border-slate-200 dark:border-[#1c2245] text-[var(--muted-ink)] dark:text-slate-300"}`}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Attribution logo section */}
                  <div className="pt-4 border-t border-slate-100 dark:border-[#1c2245] text-center">
                    <p className="text-[11px] text-[var(--muted-ink)] dark:text-slate-500 font-sans tracking-wide">
                      Made with ❤️ by <span className="font-semibold text-[var(--gold-ink)] dark:text-[#d9a020]">Venics Software Company</span>
                    </p>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mounted at the root so the receipt overlays the whole app rather
            than being clipped by the scrolling report panel it opens from. */}
        {openReceipt && (
          <ReceiptModal
            receipt={openReceipt}
            memberName={user?.fullName || ""}
            churchName={churchData?.name || ""}
            settings={receiptSettings}
            onClose={() => setOpenReceipt(null)}
          />
        )}

      </div>
    </div>
  );
}
