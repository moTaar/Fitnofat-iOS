// The Supabase client the app uses for everything that is just reading or
// writing the user's own rows: auth, the training record, the health record.
// Access control is Postgres row-level security (every table is owner-only,
// see supabase/schema.sql and supabase/migrations/native_client_access.sql),
// so the anon key here is safe to ship in the bundle — it can do nothing a
// signed-in user couldn't already do to their own data.
//
// What still goes through the services is anything that needs a secret the
// phone must not hold: Gemini, YouTube and Stripe keys, the service role for
// the shared AI caches and the per-user AI quota. See api.ts.

import { createClient, type SupabaseClient, type SupportedStorage } from "@supabase/supabase-js";
import { Preferences } from "@capacitor/preferences";
import { isNative } from "./platform";
import { timeoutSignal } from "./timeout";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

/** Where the auth session is kept. */
export const AUTH_STORAGE_KEY = "fitnofat-auth-v1";

// A request that's in flight when the app is backgrounded can be suspended by
// the OS and never settle once the app resumes (common on iOS), leaving callers
// awaiting it forever. Bound every request so it always rejects instead.
const DB_REQUEST_TIMEOUT_MS = 15_000;

/**
 * On iOS the session lives in the app's Preferences (UserDefaults, inside the
 * app sandbox) rather than WKWebView localStorage, which iOS is allowed to
 * evict under storage pressure — that would silently sign the user out.
 */
const nativeAuthStorage: SupportedStorage = {
  getItem: async (key) => (await Preferences.get({ key })).value,
  setItem: async (key, value) => {
    await Preferences.set({ key, value });
  },
  removeItem: async (key) => {
    await Preferences.remove({ key });
  },
};

const webAuthStorage: SupportedStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode — the session lives for this page only */
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to remove */
    }
  },
};

export const authStorage: SupportedStorage = isNative() ? nativeAuthStorage : webAuthStorage;

function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: init?.signal ?? timeoutSignal(DB_REQUEST_TIMEOUT_MS),
  });
}

let client: SupabaseClient | null = null;

/** True when the build was given a Supabase project to talk to. */
export function supabaseConfigured(): boolean {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

/**
 * The shared client, created on first use so that importing this module (e.g.
 * from a unit test) doesn't require a configured project.
 */
export function supabase(): SupabaseClient {
  if (client) return client;
  if (!supabaseConfigured()) {
    throw new Error(
      "Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in web/.env"
    );
  }
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: authStorage,
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      // The password-reset link is handled explicitly by the ResetPassword
      // page (and, on iOS, by the deep-link handler), not by the client
      // swallowing whatever fragment the app happens to open with.
      detectSessionInUrl: false,
    },
    global: { fetch: timedFetch },
  });
  return client;
}
