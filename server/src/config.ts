import dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.warn(`[config] Missing env var ${name} — some features will fail.`);
  }
  return v ?? "";
}

function num(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: process.env.NODE_ENV === "production",
  port: parseInt(process.env.PORT ?? "8080", 10),
  // Comma-separated list of allowed origins for CORS (the web app URL).
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseAnonKey: required("SUPABASE_ANON_KEY"),
  supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  // Optional. Supabase → Project Settings → API → JWT Secret. When set, access
  // tokens signed with the legacy HS256 secret are verified in-process instead
  // of via a network call per request. Projects on the newer asymmetric keys
  // don't need this — those verify against the published JWKS automatically.
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? "",

  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
  // Stronger model with thinking + search grounding for routine-adjustment coaching.
  coachModel: process.env.GEMINI_COACH_MODEL ?? "gemini-2.5-pro",
  // Upstream call budget. Gemini occasionally hangs; without a bound, a stuck
  // request pins a worker until the platform kills it.
  geminiTimeoutMs: num("GEMINI_TIMEOUT_MS", 45_000),
  // The coach model thinks + grounds with search, so it legitimately runs longer.
  geminiCoachTimeoutMs: num("GEMINI_COACH_TIMEOUT_MS", 90_000),

  // Shared secret gating /internal diagnostics. Same value as the accounts
  // service's ADMIN_API_KEY. Unset ⇒ the routes report 503 rather than running.
  adminApiKey: process.env.ADMIN_API_KEY ?? "",

  // ── Abuse limits ───────────────────────────────────────────────────────────
  // Coarse per-IP ceiling across the whole API (protects against unauthenticated
  // floods and credential-stuffing style bursts).
  rateLimitWindowMs: num("RATE_LIMIT_WINDOW_MS", 60_000),
  rateLimitMax: num("RATE_LIMIT_MAX", 300),
  // Per-user ceiling on AI routes within the same window — these are the calls
  // that cost money, so they get a much tighter bound than ordinary CRUD.
  aiRateLimitMax: num("AI_RATE_LIMIT_MAX", 20),
  // Daily per-user quotas for AI features that are reachable without a Pro
  // subscription. Pro users get the (much higher) `*_PRO` allowance instead.
  aiDailyQuota: {
    program_generate: { free: num("QUOTA_PROGRAM_FREE", 3), pro: num("QUOTA_PROGRAM_PRO", 30) },
    onboarding_chat: { free: num("QUOTA_ONBOARD_FREE", 60), pro: num("QUOTA_ONBOARD_PRO", 300) },
    nutrition_lookup: { free: num("QUOTA_LOOKUP_FREE", 25), pro: num("QUOTA_LOOKUP_PRO", 250) },
  },
  // How many days of workout history /bootstrap returns. Older sessions are
  // fetched on demand by the History page instead of on every cold start.
  bootstrapHistoryDays: num("BOOTSTRAP_HISTORY_DAYS", 120),
};
