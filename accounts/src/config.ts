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
  port: parseInt(process.env.PORT ?? "8090", 10),
  // Comma-separated list of allowed origins for CORS (the web app URL).
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Public URL of the web app — Stripe Checkout/Portal redirect back here.
  appUrl: (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, ""),

  supabaseUrl: required("SUPABASE_URL"),
  supabaseAnonKey: required("SUPABASE_ANON_KEY"),
  supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  // Optional. Supabase → Project Settings → API → JWT Secret. When set, access
  // tokens signed with the legacy HS256 secret are verified in-process instead
  // of via a network call per request. Projects on the newer asymmetric keys
  // verify against the published JWKS and need no configuration.
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? "",

  stripeSecretKey: required("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: required("STRIPE_WEBHOOK_SECRET"),
  // Recurring price for the Pro tier. Mapped back to the `pro` plan on webhooks.
  stripePricePro: process.env.STRIPE_PRICE_PRO ?? "",
  // Secret key that gates all /admin/* routes. Set to a long random string.
  // Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  adminApiKey: process.env.ADMIN_API_KEY ?? "",

  // ── Abuse limits ───────────────────────────────────────────────────────────
  rateLimitWindowMs: num("RATE_LIMIT_WINDOW_MS", 60_000),
  rateLimitMax: num("RATE_LIMIT_MAX", 200),
  // Signup/login/reset are the credential-stuffing surface — bound them hard,
  // per IP, over a long window.
  authRateLimitWindowMs: num("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60_000),
  authRateLimitMax: num("AUTH_RATE_LIMIT_MAX", 30),
};
