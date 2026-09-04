import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The modules under test import ./config, which reads env at load time.
    // Provide the minimum so nothing warns or reaches out to a real project.
    env: {
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
      SUPABASE_JWT_SECRET: "test-jwt-secret-for-unit-tests-only",
    },
  },
});
