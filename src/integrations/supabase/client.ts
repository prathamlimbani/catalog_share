import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { supabaseStorageAdapter } from '@/native/prefs';
import { isNative } from '@/native/platform';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

/**
 * On Android the session is kept in SharedPreferences rather than localStorage.
 * Android can evict a WebView's localStorage under storage pressure, which
 * would sign the user out at random; SharedPreferences survives that.
 * The browser build keeps using localStorage.
 */
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: isNative ? supabaseStorageAdapter : localStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: !isNative,
    flowType: 'pkce',
  },
});
