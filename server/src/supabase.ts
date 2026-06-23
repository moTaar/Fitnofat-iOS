import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

// Service-role client: full DB access. The API enforces per-user scoping by
// always filtering/inserting with the authenticated user's id.
export const supabaseAdmin = createClient(
  config.supabaseUrl,
  config.supabaseServiceKey,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Anon client: used only for auth (sign up / sign in / refresh / token verify).
export const supabaseAuth = createClient(
  config.supabaseUrl,
  config.supabaseAnonKey,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
