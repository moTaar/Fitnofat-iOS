import { registerSW } from "virtual:pwa-register";
import { toast } from "./toast";

// Registers the service worker that makes Fitnofat installable and fully usable
// offline. With `registerType: "autoUpdate"` a new build is fetched and applied
// automatically; we surface a one-time confirmation once everything the app
// needs has been cached, so the user knows it's safe to go offline (e.g. at the
// gym with no signal). No-ops in dev (the SW is disabled there).
export function setupPWA(): void {
  try {
    registerSW({
      immediate: true,
      onOfflineReady() {
        toast.success("Ready to use offline — open Fitnofat anytime, no signal needed.");
      },
    });
  } catch {
    // virtual:pwa-register is a no-op stub when the SW is disabled (dev mode).
  }
}
