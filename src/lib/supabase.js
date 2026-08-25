import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// iPhone Safari (private browsing, or "Prevent Cross-Site Tracking") can throw
// when Supabase's default localStorage-based session storage is written to.
// When that happens, the anonymous sign-in session silently never gets saved,
// `user` stays null, and every "done" checkbox ends up permanently disabled
// with no error shown. This falls back to an in-memory store so auth still
// works even when localStorage is blocked or unavailable.
function createSafeStorage() {
  try {
    const testKey = '__studybot_storage_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch {
    const memory = new Map();
    return {
      getItem: k => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => memory.set(k, v),
      removeItem: k => memory.delete(k),
    };
  }
}

export const supabase = url && key
  ? createClient(url, key, {
      auth: {
        storage: createSafeStorage(),
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
