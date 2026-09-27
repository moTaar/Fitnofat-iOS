// Where the app is running. The same React bundle ships as the web PWA and,
// wrapped by Capacitor, as the iOS app; the few places that behave differently
// (storage, notifications, opening external pages, the service worker) branch
// on this rather than on user-agent sniffing.
import { Capacitor } from "@capacitor/core";

/** True inside the Capacitor iOS/Android shell, false in a browser. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** "ios" | "android" | "web". */
export function platform(): string {
  return Capacitor.getPlatform();
}

/**
 * The custom URL scheme the iOS app registers (Info.plist CFBundleURLTypes).
 * Supabase auth emails (password reset) redirect here so the link opens the
 * app instead of a hosted web page — one less thing to keep deployed.
 */
export const APP_URL_SCHEME = (import.meta.env.VITE_APP_URL_SCHEME ?? "fitnofat").replace(/:\/*$/, "");
