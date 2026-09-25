import dotenv from "dotenv";
dotenv.config();

/**
 * Reads an env var, trimmed, with surrounding quotes removed.
 *
 * Hosting dashboards and `.env` files both routinely hand back a value the user
 * typed with quotes around it. For a string that produces a URL nothing can
 * fetch; for a number `parseInt` sees the quote, returns NaN, and the setting
 * silently does nothing while looking correct in the dashboard.
 */
function text(name: string, fallback = ""): string {
  const raw = (process.env[name] ?? "").trim();
  const unquoted = raw.replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
  return unquoted || fallback;
}

function required(name: string): string {
  const v = text(name);
  if (!v) {
    console.warn(`[config] Missing env var ${name} — some features will fail.`);
  }
  return v;
}

function num(name: string, fallback: number): number {
  const raw = text(name);
  const parsed = parseInt(raw, 10);
  if (raw && !(Number.isFinite(parsed) && parsed >= 0)) {
    // Say so rather than quietly using the default: a mistyped timeout looks
    // exactly like a correct one from the outside.
    console.warn(`[config] ${name}="${raw}" is not a non-negative number — using ${fallback}.`);
    return fallback;
  }
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Settings for medical providers that no longer exist: self-hosted MedGemma and
// Vertex AI were removed in Sept 2026. Nothing reads them, so a leftover value
// does nothing — except VERTEX_SERVICE_ACCOUNT_JSON, which is a private key
// sitting in the host's dashboard for no reason. Say so at boot.
const RETIRED_ENV = [
  "MEDICAL_AI_PROVIDER", "MEDICAL_AI_BASE_URL", "MEDICAL_AI_SELF_HOSTED_MODEL", "MEDICAL_AI_API_KEY",
  "MEDICAL_AI_WARM_PROBE_MS", "MEDICAL_AI_MODEL",
  "VERTEX_PROJECT_ID", "VERTEX_LOCATION", "VERTEX_SERVICE_ACCOUNT_JSON",
];
const leftover = RETIRED_ENV.filter((name) => text(name));
if (leftover.length) {
  console.warn(
    `[config] No longer used (the medical desk runs on Gemini only) — delete from the environment: ${leftover.join(", ")}`
  );
}

// The coach model doubles as the medical model, so it's resolved once here
// rather than duplicated in the object below.
const COACH_MODEL = process.env.GEMINI_COACH_MODEL ?? "gemini-2.5-pro";

/** Origins the Capacitor iOS shell sends (see web/capacitor.config.ts). */
export const NATIVE_APP_ORIGINS = ["capacitor://localhost"];

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: process.env.NODE_ENV === "production",
  port: parseInt(process.env.PORT ?? "8080", 10),
  // Comma-separated list of allowed origins for CORS (the web app URL), plus
  // the iOS app's own origin: Capacitor serves the app from capacitor://localhost,
  // and its requests carry that as Origin. CORS isn't access control here —
  // every route still needs a valid Supabase JWT.
  corsOrigins: [
    ...(process.env.CORS_ORIGIN ?? "http://localhost:5173").split(","),
    ...NATIVE_APP_ORIGINS,
  ]
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

  geminiApiKey: text("GEMINI_API_KEY"),
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
  // Stronger model with thinking + search grounding for routine-adjustment coaching.
  coachModel: COACH_MODEL,
  // Upstream call budget. Gemini occasionally hangs; without a bound, a stuck
  // request pins a worker until the platform kills it.
  geminiTimeoutMs: num("GEMINI_TIMEOUT_MS", 45_000),
  // The coach model thinks + grounds with search, so it legitimately runs longer.
  geminiCoachTimeoutMs: num("GEMINI_COACH_TIMEOUT_MS", 90_000),

  // ── Medical / health AI (nutritionist + medical helper) ────────────────────
  // Runs on the Gemini API with GEMINI_API_KEY. The model reasons over the
  // privacy layer's brief and never sees the full record — see
  // server/src/health/privacy.ts.
  medicalGeminiModel: text("MEDICAL_AI_GEMINI_MODEL", COACH_MODEL),
  // Medical answers are longer and reasoned — the same budget as the coach
  // model. The web client's MEDICAL_REQUEST_TIMEOUT_MS sits above this.
  medicalTimeoutMs: num("MEDICAL_AI_TIMEOUT_MS", 90_000),

  // Shared secret gating /internal diagnostics. Same value as the accounts
  // service's ADMIN_API_KEY. Unset ⇒ the routes report 503 rather than running.
  adminApiKey: process.env.ADMIN_API_KEY ?? "",

  // ── YouTube demo videos ────────────────────────────────────────────────────
  // Google Cloud console → YouTube Data API v3 → API key. Unset ⇒ the video
  // picker reports "not configured" and the text guide renders on its own.
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? "",
  youtubeRegion: process.env.YOUTUBE_REGION ?? "US",
  youtubeLanguage: process.env.YOUTUBE_RELEVANCE_LANGUAGE ?? "en",
  youtubeTimeoutMs: num("YOUTUBE_TIMEOUT_MS", 10_000),
  // Comma-separated YouTube channel IDs (UC…) whose videos are promoted to the
  // top of every result set. This is the cheapest quality lever in the feature —
  // it costs no extra quota and turns "whatever relevance returned" into "a
  // coach you trust, when they've covered the movement". Empty by default
  // because the right channels are an editorial choice, not a technical one.
  youtubeChannelAllowlist: (process.env.YOUTUBE_CHANNEL_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // GLOBAL searches per UTC day, shared by every user. `search.list` costs 100
  // units of a default 10,000/day project allocation, so 100 is the hard ceiling
  // and this sits below it to leave room for the 1-unit enrichment calls and any
  // other API use in the same Cloud project. Raising this past ~99 without an
  // approved quota increase just moves the failure from our meter to Google's.
  youtubeDailyBudget: num("YOUTUBE_DAILY_BUDGET", 90),
  // Per-user burst ceiling on the video route, within rateLimitWindowMs.
  youtubeRateLimitMax: num("YOUTUBE_RATE_LIMIT_MAX", 12),
  // How long a cached result set stays fresh. Long on purpose: form demos don't
  // go stale, and every re-search costs a scarce unit. `force` bypasses it when
  // a user explicitly asks for different videos.
  youtubeCacheDays: num("YOUTUBE_CACHE_DAYS", 180),

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
    // Medical AI is Pro-gated (see entitlements), so the free allowance is 0 —
    // the quota exists to bound a Pro account's spend on the priciest model.
    medical_ai: { free: num("QUOTA_MEDICAL_FREE", 0), pro: num("QUOTA_MEDICAL_PRO", 60) },
  },
  // How many days of workout history /bootstrap returns. Older sessions are
  // fetched on demand by the History page instead of on every cold start.
  bootstrapHistoryDays: num("BOOTSTRAP_HISTORY_DAYS", 120),
};
