import dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.warn(`[config] Missing env var ${name} — some features will fail.`);
  }
  return v ?? "";
}

export const config = {
  port: parseInt(process.env.PORT ?? "8080", 10),
  // Comma-separated list of allowed origins for CORS (the web app URL).
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseAnonKey: required("SUPABASE_ANON_KEY"),
  supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  // Stronger model with thinking + search grounding for routine-adjustment coaching.
  coachModel: process.env.GEMINI_COACH_MODEL ?? "gemini-2.5-pro",
};
