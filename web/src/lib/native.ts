// Native-shell helpers: the handful of things the iOS app has to do
// differently from a browser tab. Everything here degrades to the browser
// behaviour on the web, so callers don't branch themselves.

import { APP_URL_SCHEME, isNative } from "./platform";

/**
 * Opens a page outside the app — Stripe Checkout, the billing portal, a
 * YouTube video. In the iOS app that must be an in-app Safari sheet: assigning
 * window.location would navigate the app's own web view away from the app,
 * with no way back. `onClose` fires when the user dismisses the sheet.
 */
export async function openExternal(url: string, onClose?: () => void): Promise<void> {
  if (!isNative()) {
    window.location.href = url;
    return;
  }
  const { Browser } = await import("@capacitor/browser");
  if (onClose) {
    const handle = await Browser.addListener("browserFinished", () => {
      void handle.remove();
      onClose();
    });
  }
  await Browser.open({ url, presentationStyle: "popover" });
}

/**
 * Maps a URL the OS opened the app with (`fitnofat://reset-password#…`,
 * `fitnofat://settings?billing=success`) to an in-app route, or null if it
 * isn't ours. Supabase's password-reset link lands here: the recovery token
 * travels in the fragment, which the ResetPassword page reads.
 */
export function deepLinkToRoute(url: string, scheme = APP_URL_SCHEME): string | null {
  const prefix = `${scheme}://`;
  if (!url.toLowerCase().startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  // Everything up to the first ? or # is the path (the "host" of a custom URL
  // is just its first path segment).
  const cut = rest.search(/[?#]/);
  const rawPath = cut === -1 ? rest : rest.slice(0, cut);
  const tail = cut === -1 ? "" : rest.slice(cut);
  const path = "/" + rawPath.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!/^\/[\w\-/]*$/.test(path)) return null;
  return path + tail;
}
