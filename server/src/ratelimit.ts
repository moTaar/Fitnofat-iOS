// Abuse and cost controls for the data API.
//
// Two layers, because they defend against different things:
//   1. `apiLimiter` / `aiLimiter` — short-window burst limits (express-rate-limit,
//      in-process). Cheap, immediate, and enough to stop a hot loop.
//   2. `aiQuota` — a persisted per-user daily allowance for the AI features that
//      a *free* account can reach. In-process counters reset on every deploy and
//      aren't shared between instances, so these live in Postgres.
//
// Gemini calls are the only thing in this app that costs real money per request,
// so every route that can reach one is covered by at least one of these.

import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config";
import { supabaseAdmin } from "./supabase";
import { AuthedRequest, HttpError } from "./middleware";
import { resolvePlan } from "./entitlements";

/** Rate-limit key: the authenticated user when known, else the client IP. */
function userOrIp(req: Request): string {
  const userId = (req as AuthedRequest).userId;
  // ipKeyGenerator normalises IPv6 into a /64 subnet so a single client can't
  // trivially rotate through addresses it already controls.
  return userId ? `u:${userId}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

/** Coarse ceiling applied to the whole API surface. */
export const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userOrIp,
  message: { error: "Too many requests. Slow down and try again shortly." },
});

/** Tight ceiling for the routes that call Gemini. Mounted per-route. */
export const aiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.aiRateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userOrIp,
  message: {
    error: "You're sending AI requests too quickly. Give it a moment.",
    code: "rate_limited",
  },
});

// ── Persisted daily quotas ───────────────────────────────────────────────────

export type QuotaFeature = keyof typeof config.aiDailyQuota;

/** UTC calendar day, so the reset point is stable regardless of instance TZ. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Atomically bump today's counter and return the value *after* the increment.
 * Uses the `increment_ai_usage` RPC so concurrent requests can't both read the
 * same pre-increment value and slip past the limit.
 */
async function bumpUsage(userId: string, feature: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin.rpc("increment_ai_usage", {
    p_user_id: userId,
    p_feature: feature,
    p_day: today(),
  });
  if (error) {
    // Never fail a request because the meter is broken — log and let it through.
    console.error("[quota] increment failed", error.message);
    return null;
  }
  return typeof data === "number" ? data : null;
}

/** Read today's count without incrementing (for the usage endpoint). */
export async function readUsage(userId: string): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin
    .from("ai_usage")
    .select("feature, count")
    .eq("user_id", userId)
    .eq("day", today());
  const out: Record<string, number> = {};
  for (const row of data ?? []) out[row.feature as string] = Number(row.count);
  return out;
}

/**
 * Express middleware enforcing a daily allowance for `feature`. Place after
 * `requireAuth`. Unlike `requireEntitlement` this does not hard-block free
 * users — it lets them use the feature up to the free allowance, which is what
 * makes "your first AI program" work without handing out an unmetered Gemini key.
 */
export function aiQuota(feature: QuotaFeature) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const userId = (req as AuthedRequest).userId;
      const plan = await resolvePlan(userId);
      const limit = config.aiDailyQuota[feature][plan] ?? config.aiDailyQuota[feature].free;
      if (limit <= 0) {
        next(new HttpError(402, "This feature requires a Pro subscription.", "upgrade_required"));
        return;
      }
      const used = await bumpUsage(userId, feature);
      if (used !== null && used > limit) {
        next(
          new HttpError(
            429,
            plan === "pro"
              ? "Daily AI limit reached. It resets at midnight UTC."
              : "You've used today's free AI allowance. Upgrade to Pro for more, or try again tomorrow.",
            plan === "pro" ? "quota_exceeded" : "upgrade_required"
          )
        );
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
