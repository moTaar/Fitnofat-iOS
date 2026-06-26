import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

// Service-role client: full DB + auth-admin access. This service is the identity
// authority — it creates/updates/deletes users and scopes every DB query by user_id.
export const supabaseAdmin = createClient(
  config.supabaseUrl,
  config.supabaseServiceKey,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Anon client: used only for auth (sign in / refresh / token verify).
export const supabaseAuth = createClient(
  config.supabaseUrl,
  config.supabaseAnonKey,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
