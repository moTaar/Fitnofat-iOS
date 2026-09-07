import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { config } from "./config";
import { errorHandler } from "./middleware";
import { authLimiter, serviceLimiter } from "./ratelimit";
import { authRouter } from "./routes/auth";
import { accountRouter } from "./routes/account";
import { billingRouter } from "./routes/billing";
import { adminRouter } from "./routes/admin";
import { stripeWebhook } from "./routes/webhook";

const app = express();

// Render terminates TLS upstream, so req.ip is the proxy unless Express reads
// X-Forwarded-For. Rate limiting keys off req.ip, so without this every request
// looks like one client. `1` = trust exactly one hop; `true` would let a client
// spoof its own address.
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

// ⚠️ The Stripe webhook must read the RAW body to verify its signature, so it is
// registered with express.raw BEFORE the global express.json() below. Order matters.
app.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "accounts",
    stripe: config.stripeSecretKey ? "configured" : "missing-key",
  });
});

app.use("/auth", authLimiter, authRouter);
app.use("/account", serviceLimiter, accountRouter);
app.use("/billing", serviceLimiter, billingRouter);
app.use("/admin", serviceLimiter, adminRouter);

app.use(errorHandler);

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Fitnofat Accounts service listening on :${config.port}`);
    console.log(`  CORS origins: ${config.corsOrigins.join(", ")}`);
    console.log(`  Stripe: ${config.stripeSecretKey ? "configured" : "MISSING key"}`);
  });
}

export { app };
