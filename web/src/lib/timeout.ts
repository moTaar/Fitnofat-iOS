/**
 * An AbortSignal that fires after `ms`. AbortSignal.timeout() only exists from
 * iOS 16 / Safari 16, and the iOS app supports iOS 15 — where calling it would
 * throw and take every request down with it.
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")), ms);
  return controller.signal;
}
