import express from "express";
import cors from "cors";
import { config } from "./config";
import { errorHandler } from "./middleware";
import { authRouter } from "./routes/auth";
import { dataRouter } from "./routes/data";
import { chatOnboarding } from "./gemini";

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
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ai: config.geminiApiKey ? "gemini" : "local-fallback", corsOrigins: config.corsOrigins });
});

// Public Gemini connectivity test — visit in browser to see the real error.
app.get("/ai-test", async (_req, res) => {
  try {
    const reply = await chatOnboarding([]);
    res.json({ ok: true, reply });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.use("/api/auth", authRouter);
app.use("/api", dataRouter);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`ForgeFit API listening on :${config.port}`);
  console.log(`  CORS origins: ${config.corsOrigins.join(", ")}`);
  console.log(`  AI engine: ${config.geminiApiKey ? "Gemini" : "local fallback"}`);
});
