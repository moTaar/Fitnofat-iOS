import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { config } from "./config";
import { errorHandler, requireAdmin } from "./middleware";
import { apiLimiter, readYoutubeBudget } from "./ratelimit";
import { dataRouter } from "./routes/data";
import { healthRouter } from "./routes/health";
import { chatOnboarding } from "./gemini";
import { activeProvider, modelLabel } from "./health/reasoning";

const app = express();

// Render (and any other proxy) terminates TLS upstream, so req.ip is the proxy
// unless Express is told to read X-Forwarded-For. Rate limiting keys off req.ip,
// so without this every request looks like it came from the same client.
// `1` = trust exactly one hop; a bare `true` would let a client spoof its own IP.
app.set("trust proxy", 1);

app.use(helmet());
app.use(compression());

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
  })
);

// Body limits are per-route, not global. Only the coach chat carries images
// (up to 4 per message, client-side downscaled to ≤1280px JPEG); every other
// endpoint takes small JSON and has no business accepting megabytes.
const largeJson = express.json({ limit: "25mb" });
app.use("/api/ai/coach", largeJson);
// The health chat takes the same attachments (a lab printout, a medication
// label, a photo of a symptom), so it needs the same allowance.
app.use("/api/health/chat", largeJson);
app.use(express.json({ limit: "512kb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    ai: config.geminiApiKey ? "gemini" : "local-fallback",
    videos: config.youtubeApiKey ? "youtube" : "disabled",
  });
});

// How much of today's shared YouTube search allowance is gone. The budget is
// global and can't be topped up before midnight Pacific, so "are we about to
// run out" is an operational question worth being able to answer directly.
app.get(
  "/internal/youtube-budget",
  requireAdmin,
  async (_req, res) => {
    res.json(await readYoutubeBudget());
  }
);

// Gemini connectivity check. Gated on ADMIN_API_KEY: it makes a real (billable)
// model call, so leaving it open is a free way for anyone to burn the quota.
app.get(
  "/internal/ai-test",
  requireAdmin,
  async (_req, res) => {
    try {
      const reply = await chatOnboarding([]);
      res.json({ ok: true, reply });
    } catch (err) {
      res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
);

// NOTE: Auth (signup/login/refresh) now lives in the separate accounts service.
// Tokens remain Supabase JWTs, so requireAuth keeps verifying them locally here.
// Health/medical tracker + AI nutritionist. Separate router because its AI
// routes carry an extra gate the rest of the API doesn't have: explicit consent
// before any health data is sent to a model (see routes/health.ts). Mounted
// BEFORE the data router so a health request doesn't pass through that router's
// auth and rate limiter on its way here — it would spend two tokens per call.
app.use("/api/health", apiLimiter, healthRouter);
app.use("/api", apiLimiter, dataRouter);

app.use(errorHandler);

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Fitnofat API listening on :${config.port}`);
    console.log(`  CORS origins: ${config.corsOrigins.join(", ")}`);
    console.log(`  AI engine: ${config.geminiApiKey ? "Gemini" : "local fallback"}`);
    // The medical desk falls back silently by design, so the only way to know
    // what it will actually use is to say so at boot — including the deadline,
    // which is the setting most likely to be quietly wrong.
    console.log(
      `  Medical desk: ${modelLabel(activeProvider())} · timeout ${config.medicalTimeoutMs}ms`
    );
    console.log(`  JWT verification: ${config.supabaseJwtSecret ? "local (HS256) + JWKS" : "JWKS + network fallback"}`);
  });
}

export { app };
