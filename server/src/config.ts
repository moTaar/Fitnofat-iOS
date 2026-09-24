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

// The coach model doubles as the medical fallback when Vertex isn't configured,
// so it's resolved once here rather than duplicated in the object below.
const COACH_MODEL = process.env.GEMINI_COACH_MODEL ?? "gemini-2.5-pro";

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
  // Which backend answers medical questions:
  //   "cloudrun" — a model you host yourself behind an OpenAI-compatible API
  //                (vLLM, Ollama, TGI…), typically MedGemma on Cloud Run with a
  //                GPU. The weights and the request both stay on infrastructure
  //                you control. See wiki/MedGemma-Cloud-Run-Deployment.md.
  //   "vertex"   — Google Cloud Vertex AI (the service behind what Google now
  //                brands "Gemini Enterprise Agent Platform" — the product was
  //                renamed in April 2026 but `aiplatform.googleapis.com`, its
  //                model ids and its auth are unchanged). Needs a service
  //                account, not an API key.
  //   "gemini"   — the same generativelanguage endpoint the rest of the app uses.
  //   "auto"     — the first of those that is configured, in that order
  //                (default): a self-hosted medical model wins over Vertex,
  //                which wins over the shared Gemini endpoint.
  // Vertex is never a hard requirement: a medical request degrades to Gemini
  // rather than failing, because a health question going unanswered is worse
  // than one answered by the general model (the reply says which model ran).
  medicalProvider: (text("MEDICAL_AI_PROVIDER", "auto")) as
    | "auto"
    | "cloudrun"
    | "vertex"
    | "gemini",
  // Base URL of a self-hosted OpenAI-compatible server, INCLUDING the version
  // path — e.g. https://medgemma-xxxxx.europe-west1.run.app/v1. Setting this is
  // what turns the "cloudrun" provider on.
  medicalBaseUrl: text("MEDICAL_AI_BASE_URL").replace(/\/+$/, ""),
  // Model name the self-hosted server expects in the request body (vLLM echoes
  // whatever `--served-model-name` was set to). Defaults to `medicalModel`.
  medicalSelfHostedModel: text("MEDICAL_AI_SELF_HOSTED_MODEL"),
  // Optional static bearer token for a self-hosted endpoint that isn't on Cloud
  // Run. Leave unset for Cloud Run: the service account mints an ID token, which
  // is the better credential — short-lived and audience-scoped.
  medicalApiKey: text("MEDICAL_AI_API_KEY"),
  // Vertex publisher model id. The caller picks the request shape from the id
  // (see server/src/medical.ts), so both families work:
  //   `gemini-*`  → the modern `:generateContent` contract. This is the default
  //                 because Google retired MedLM (the productized Med-PaLM 2,
  //                 `medlm-medium`/`medlm-large`) on 2025-09-29 — those ids no
  //                 longer resolve for anyone.
  //   `medlm-*`   → the PaLM-era `:predict` contract, kept for any project that
  //                 still has a medical-tuned model served under it.
  // Point this at a medical-tuned publisher model if your project has one.
  medicalModel: text("MEDICAL_AI_MODEL", COACH_MODEL),
  // Model used when the request runs on the Gemini provider.
  medicalGeminiModel: text("MEDICAL_AI_GEMINI_MODEL", COACH_MODEL),
  // Medical answers are longer and reasoned, and a self-hosted model that has
  // scaled to zero needs 1-2 minutes to load before it answers at all. 90s was
  // shorter than a cold start, so the first question of the day fell back to
  // Gemini every time.
  medicalTimeoutMs: num("MEDICAL_AI_TIMEOUT_MS", 180_000),
  // How long the warm-up probe waits before reporting "still warming". It only
  // needs to TRIGGER the container start — Cloud Run keeps booting whether or
  // not we are still listening — so this stays short enough to answer the
  // client immediately.
  medicalWarmProbeMs: num("MEDICAL_AI_WARM_PROBE_MS", 8_000),

  // Vertex AI credentials. `VERTEX_SERVICE_ACCOUNT_JSON` takes the key JSON
  // inline (raw or base64); `GOOGLE_APPLICATION_CREDENTIALS` points at a file.
  vertexProjectId: text("VERTEX_PROJECT_ID"),
  vertexLocation: text("VERTEX_LOCATION", "us-central1"),
  vertexServiceAccountJson: process.env.VERTEX_SERVICE_ACCOUNT_JSON ?? "",
  googleCredentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "",

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
