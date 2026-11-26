import { createClient } from '@supabase/supabase-js';
import { authStorage } from './authStorage';
import { createAuthFetch } from './authRequest';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  || import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
export const publicSupabaseConfig = supabaseUrl && supabaseKey ? { url: supabaseUrl.replace(/\/$/, ''), key: supabaseKey } : null;

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      global: { fetch: createAuthFetch(supabaseUrl, (input, init) => fetch(input, init)) },
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
        storage: authStorage,
      },
    })
  : null;
