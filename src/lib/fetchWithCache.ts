import localforage from 'localforage';

// Ensure Capacitor uses the correct production backend URL instead of localhost
// Configure VITE_BACKEND_URL in your mobile environment settings if using native Capacitor
export const getBackendUrl = () => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem("mshiriki-custom-backend-url");
    if (saved && saved.trim()) {
      return saved.trim().replace(/\/$/, "");
    }
  }

  if (import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL.trim().replace(/\/$/, "");
  }

  if (typeof process !== 'undefined' && process.env && process.env.VITE_BACKEND_URL) {
    return process.env.VITE_BACKEND_URL.trim().replace(/\/$/, "");
  }

  return typeof window !== 'undefined' ? window.location.origin : "";
};

/* -------------------------------------------------------------------------- */
/* Session token                                                              */
/* -------------------------------------------------------------------------- */
/**
 * Access token issued by /api/auth/login|register, used to authenticate the
 * /api/member/* endpoints. Those endpoints identify the caller from this token
 * alone — they never trust an email supplied by the client.
 */
const TOKEN_KEY = "mshiriki-access-token";

export const getAuthToken = (): string => {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(TOKEN_KEY) || "";
};

export const setAuthToken = (token: string | null | undefined) => {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
};

export const clearAuthToken = () => setAuthToken(null);

const withAuthHeaders = (options?: RequestInit): RequestInit | undefined => {
  const token = getAuthToken();
  if (!token) return options;
  return {
    ...(options || {}),
    headers: {
      ...((options?.headers as Record<string, string>) || {}),
      Authorization: `Bearer ${token}`,
    },
  };
};

/* -------------------------------------------------------------------------- */
/* Cached fetch                                                               */
/* -------------------------------------------------------------------------- */
interface FetchWithCacheOptions {
  /**
   * Overrides the offline-cache key. Required for per-member endpoints: the URL
   * alone is identical for every user, so without this two people signing in on
   * the same device would see each other's cached records.
   */
  cacheKey?: string;
}

export const fetchWithCache = async (
  url: string,
  options?: RequestInit,
  { cacheKey }: FetchWithCacheOptions = {}
) => {
  const apiBaseUrl = getBackendUrl();
  const finalUrl = url.startsWith('/') ? `${apiBaseUrl}${url}` : url;
  const storageKey = `cache_${cacheKey || finalUrl}`;
  const requestInit = withAuthHeaders(options);
  let freshData: any;
  let fetchError: any;

  // For POST/PUT requests, just passthrough to fetch directly
  if (options && options.method && options.method !== 'GET') {
    return fetch(finalUrl, requestInit);
  }

  // Optimize: Attempt offline first if we're not online
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  if (!isOffline) {
    try {
      const res = await fetch(finalUrl, requestInit);
      if (res.ok) {
        freshData = await res.clone().json();
        await localforage.setItem(storageKey, { data: freshData, timestamp: Date.now() });
        return res; // Returning the fetch response as standard fetch
      } else {
        // 401/403 are authentication problems, not connectivity problems —
        // serving a stale cache would hide an expired session. Surface them.
        if (res.status === 401 || res.status === 403) {
          return res;
        }
        fetchError = new Error(`Server returned status: ${res.status}`);
      }
    } catch (err) {
      console.warn(`Network fetch failed for ${url}`, err);
      fetchError = err;
    }
  }

  // Fallback to cache
  try {
    const cachedItem: any = await localforage.getItem(storageKey);
    if (cachedItem && cachedItem.data) {
      console.log(`Serving ${url} from offline cache`);
      // Reconstruct a Response-like object
      return new Response(JSON.stringify(cachedItem.data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (err) {
    console.error("Cache read failed", err);
  }

  if (fetchError) {
    throw fetchError;
  }

  throw new Error("No network connection and no offline data available.");
};

/** Drops every cached API response for a member. Called on sign-out. */
export const clearMemberCache = async (email: string) => {
  if (!email) return;
  try {
    await Promise.all([
      localforage.removeItem(`cache_member-contributions-${email}`),
    ]);
  } catch (err) {
    console.warn("Failed clearing member cache", err);
  }
};
