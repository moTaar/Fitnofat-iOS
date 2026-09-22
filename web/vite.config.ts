import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { execSync } from "node:child_process";

function buildVersion(): string {
  try {
    const hash = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    return `0.1.0+${hash}`;
  } catch {
    return "0.1.0";
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion()),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing dependencies into their own chunks.
        // Recharts in particular is only needed by History and the Dashboard
        // graphs, and dragging it into the entry bundle delayed first paint on
        // the gym-floor screens that never render a chart.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-charts": ["recharts"],
        },
      },
    },
    // The entry chunk should stay small now that routes are split; warn early
    // if something drags a heavy dependency back into it.
    chunkSizeWarningLimit: 400,
  },
  plugins: [
    react(),
    VitePWA({
      // "prompt", not "autoUpdate": a new worker installs and then waits,
      // instead of claiming the open tab and deleting the hashed chunks that
      // tab still references (which breaks the next lazy-route navigation).
      // The swap happens on a full reload, when the user accepts the
      // "new version is ready" banner. See web/src/lib/pwa.ts.
      registerType: "prompt",
      includeAssets: ["favicon.svg", "robots.txt", "apple-touch-icon.png"],
      manifest: {
        name: "Fitnofat — Workout Tracker",
        short_name: "Fitnofat",
        description:
          "AI-personalized workout and exercise tracker with progression analytics. Works offline on the gym floor.",
        theme_color: "#0a0a0b",
        background_color: "#0a0a0b",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        categories: ["health", "fitness", "lifestyle"],
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-maskable-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2,webmanifest}"],
        // Serve the SPA shell for any in-app navigation when offline (deep links
        // like /history work after a hard refresh with no network)…
        navigateFallback: "index.html",
        // …but never hijack API calls or the SW assets with the shell.
        navigateFallbackDenylist: [/^\/api\//, /\/sw\.js$/, /\/manifest\.webmanifest$/],
        // Take control of open tabs immediately so the app is offline-ready on the
        // very next navigation after the first load (no second visit required).
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // The app bundle grows over time — make sure it always gets precached.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // Gemini/API responses are never cached (always fresh + auth-bound);
            // the Google Fonts stylesheet + font files are cached for offline use.
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-fonts-stylesheets",
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Keep the service worker out of `vite dev` (it interferes with HMR and
        // tooling). The full PWA is active in the production build.
        enabled: false,
        type: "module",
      },
    }),
  ],
});
