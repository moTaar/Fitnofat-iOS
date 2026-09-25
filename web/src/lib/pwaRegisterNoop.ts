// Stand-in for `virtual:pwa-register` in the iOS build (`vite build --mode
// ios`), which leaves vite-plugin-pwa out: the app bundle updates through new
// App Store/TestFlight/Xcode builds, not a service worker. main.tsx never calls
// setupPWA() in the app, so this only has to satisfy the import.
export function registerSW(_options?: unknown) {
  return async (_reload?: boolean) => {};
}
