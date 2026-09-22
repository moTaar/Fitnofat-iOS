// Abuse and cost controls for the data API.
//
// Two layers, because they defend against different things:
//   1. `apiLimiter` / `aiLimiter` — short-window burst limits (express-rate-limit,
//      in-process). Cheap, immediate, and enough to stop a hot loop.
//   2. `aiQuota` — a persisted per-user daily allowance for the AI features that
//      a *free* account can reach. In-process counters reset on every deploy and
//      aren't shared between instances, so these live in Postgres.
//   3. `claimYoutubeSearch` — a persisted *global* daily budget. Layers 1 and 2
//      both bound one user; YouTube's quota is a single allocation shared by the
//      whole user base, so it needs a meter nobody's politeness can evade.
//
// Gemini calls cost real money per request and YouTube searches spend a fixed
// daily allowance that can't be topped up, so every route that can reach either
// is covered by at least one of these.

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

/**
 * Ceiling for the demo-video route. Not a Gemini route, but it reaches an
 * upstream with a metered budget, so the same rule applies: never make it
 * reachable without a meter.
 */
export const videoLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.youtubeRateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userOrIp,
  message: {
    error: "You're browsing demo videos too quickly. Give it a moment.",
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

// ── Global YouTube search budget ─────────────────────────────────────────────
// `videoLimiter` bounds what one client can do; this bounds what everyone can
// do together, which is the constraint that actually matters. The YouTube quota
// is a single allocation shared by the whole user base: 50 users each politely
// making 3 searches exhausts the day just as thoroughly as one abusive client.
//
// Unlike aiQuota this is not middleware — it guards the single expensive call
// inside the route, so a request served entirely from cache (the overwhelming
// majority) never touches the meter.

/**
 * Claim one unit of today's global search budget.
 * Returns false when the budget is spent and the caller must not search.
 */
export async function claimYoutubeSearch(): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("increment_youtube_budget", {
    p_day: today(),
  });
  if (error) {
    // Fail CLOSED, unlike aiQuota. A broken AI meter costs money we chose to
    // spend; a broken budget here silently burns a fixed daily allowance that
    // cannot be topped up, taking the feature down for every other user until
    // midnight Pacific. Declining to search degrades one sheet to text-only.
    console.error("[youtube] budget check failed", error.message);
    return false;
  }
  return typeof data === "number" ? data <= config.youtubeDailyBudget : false;
}

/** Today's global search spend, for the /internal diagnostics endpoint. */
export async function readYoutubeBudget(): Promise<{ used: number; limit: number }> {
  const { data } = await supabaseAdmin
    .from("youtube_budget")
    .select("count")
    .eq("day", today())
    .maybeSingle();
  return { used: Number(data?.count ?? 0), limit: config.youtubeDailyBudget };
}
