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

  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
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
  //   "vertex" — Google Cloud Vertex AI (the service behind what Google now
  //              brands "Gemini Enterprise Agent Platform" — the product was
  //              renamed in April 2026 but `aiplatform.googleapis.com`, its
  //              model ids and its auth are unchanged). Needs a service
  //              account, not an API key.
  //   "gemini" — the same generativelanguage endpoint the rest of the app uses.
  //   "auto"   — Vertex when it's fully configured, Gemini otherwise (default).
  // Vertex is never a hard requirement: a medical request degrades to Gemini
  // rather than failing, because a health question going unanswered is worse
  // than one answered by the general model (the reply says which model ran).
  medicalProvider: (process.env.MEDICAL_AI_PROVIDER ?? "auto") as "auto" | "vertex" | "gemini",
  // Vertex publisher model id. The caller picks the request shape from the id
  // (see server/src/medical.ts), so both families work:
  //   `gemini-*`  → the modern `:generateContent` contract. This is the default
  //                 because Google retired MedLM (the productized Med-PaLM 2,
  //                 `medlm-medium`/`medlm-large`) on 2025-09-29 — those ids no
  //                 longer resolve for anyone.
  //   `medlm-*`   → the PaLM-era `:predict` contract, kept for any project that
  //                 still has a medical-tuned model served under it.
  // Point this at a medical-tuned publisher model if your project has one.
  medicalModel: process.env.MEDICAL_AI_MODEL ?? COACH_MODEL,
  // Model used when the request runs on the Gemini provider.
  medicalGeminiModel: process.env.MEDICAL_AI_GEMINI_MODEL ?? COACH_MODEL,
  // Medical answers are longer and reasoned; give them the coach's budget.
  medicalTimeoutMs: num("MEDICAL_AI_TIMEOUT_MS", 90_000),

  // Vertex AI credentials. `VERTEX_SERVICE_ACCOUNT_JSON` takes the key JSON
  // inline (raw or base64); `GOOGLE_APPLICATION_CREDENTIALS` points at a file.
  vertexProjectId: process.env.VERTEX_PROJECT_ID ?? "",
  vertexLocation: process.env.VERTEX_LOCATION ?? "us-central1",
  vertexServiceAccountJson: process.env.VERTEX_SERVICE_ACCOUNT_JSON ?? "",
  googleCredentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "",

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
    // Medical AI is Pro-gated (see entitlements), so the free allowance is 0 —
    // the quota exists to bound a Pro account's spend on the priciest model.
    medical_ai: { free: num("QUOTA_MEDICAL_FREE", 0), pro: num("QUOTA_MEDICAL_PRO", 60) },
  },
  // How many days of workout history /bootstrap returns. Older sessions are
  // fetched on demand by the History page instead of on every cold start.
  bootstrapHistoryDays: num("BOOTSTRAP_HISTORY_DAYS", 120),
};
