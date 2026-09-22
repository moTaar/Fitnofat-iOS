import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Only vite-plugin-pwa provides this module, and the plugin isn't in the
      // test graph — point it at a controllable stub so lib/pwa.ts is testable.
      "virtual:pwa-register": path.resolve(__dirname, "./src/test/pwa-register-stub.ts"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify("test"),
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
