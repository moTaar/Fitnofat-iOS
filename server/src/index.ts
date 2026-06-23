import express from "express";
import cors from "cors";
import { config } from "./config";
import { errorHandler } from "./middleware";
import { authRouter } from "./routes/auth";
import { dataRouter } from "./routes/data";

const app = express();

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow non-browser clients (no origin) and any configured origin.
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ai: config.geminiApiKey ? "gemini" : "local-fallback" });
});

app.use("/api/auth", authRouter);
app.use("/api", dataRouter);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`ForgeFit API listening on :${config.port}`);
  console.log(`  CORS origins: ${config.corsOrigins.join(", ")}`);
  console.log(`  AI engine: ${config.geminiApiKey ? "Gemini" : "local fallback"}`);
});
