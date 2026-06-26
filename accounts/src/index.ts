import express from "express";
import cors from "cors";
import { config } from "./config";
import { errorHandler } from "./middleware";
import { authRouter } from "./routes/auth";
import { accountRouter } from "./routes/account";
import { billingRouter } from "./routes/billing";
import { stripeWebhook } from "./routes/webhook";

const app = express();

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
    corsOrigins: config.corsOrigins,
  });
});

app.use("/auth", authRouter);
app.use("/account", accountRouter);
app.use("/billing", billingRouter);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`ForgeFit Accounts service listening on :${config.port}`);
  console.log(`  CORS origins: ${config.corsOrigins.join(", ")}`);
  console.log(`  Stripe: ${config.stripeSecretKey ? "configured" : "MISSING key"}`);
});
