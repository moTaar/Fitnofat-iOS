// Abuse controls for the accounts service.
//
// `/auth/*` is the credential surface — signup, login, password reset — and is
// the single most attacked endpoint set in any app. It gets a much tighter,
// longer-window limit than ordinary account/billing reads.

import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { config } from "./config";
import type { AuthedRequest } from "./middleware";

function userOrIp(req: Request): string {
  const userId = (req as AuthedRequest).userId;
  // Normalises IPv6 into a /64 subnet so a client can't rotate within its own range.
  return userId ? `u:${userId}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

/** Coarse ceiling for the service as a whole. */
export const serviceLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userOrIp,
  message: { error: "Too many requests. Slow down and try again shortly." },
});

/**
 * Credential-endpoint limiter. Keyed on IP only — keying on the submitted email
 * would let an attacker sidestep it by varying the address, which is exactly
 * the shape of a credential-stuffing run.
 */
export const authLimiter = rateLimit({
  windowMs: config.authRateLimitWindowMs,
  limit: config.authRateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
  // Successful logins shouldn't spend budget meant for catching guessing runs.
  skipSuccessfulRequests: true,
  message: {
    error: "Too many attempts. Please wait a few minutes and try again.",
    code: "rate_limited",
  },
});
