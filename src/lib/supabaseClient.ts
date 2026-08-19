import { createClient } from "@supabase/supabase-js";

/**
 * CLIENT-SIDE DIRECT SUPABASE CONNECTION (Security Exception for Client-Side APK execution)
 * This connects directly to Supabase client-side using the Anon Key to bypass the intermediate API server.
 */

export const getSupabaseConfig = () => {
  let url = "";
  let key = "";

  if (typeof window !== "undefined") {
    url = localStorage.getItem("mshiriki-custom-supabase-url") || "";
    key = localStorage.getItem("mshiriki-custom-supabase-key") || "";
  }

  if (!url) {
    url = (process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || "").trim().replace(/\/$/, "");
  }
  if (!key) {
    key = (process.env.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();
  }

  return { url, key };
};

export const getSupabaseClient = () => {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });
};
