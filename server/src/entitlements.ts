// Premium-feature gating for the data API. The accounts microservice is the
// authority for tiers (accounts/src/entitlements.ts) and writes each user's plan
// to the shared `subscriptions` table; here we only read it to decide whether a
// request is allowed through. Keep the Plan/Feature names in sync with accounts.

import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "./supabase";
import { AuthedRequest, HttpError } from "./middleware";

export type Plan = "free" | "pro";
export type Feature = "ai_coach" | "ai_nutrition" | "program_refresh" | "ai_exercise";

// Which plan unlocks which feature. Mirrors accounts/src/entitlements.ts.
const PLAN_FEATURES: Record<Plan, Feature[]> = {
  free: [],
  pro: ["ai_coach", "ai_nutrition", "program_refresh", "ai_exercise"],
};

// A subscription entitles its plan's features while in one of these states.
const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

// A plan lookup is a DB round trip, and gated routes hit it on every request.
// Cache briefly: the only thing that changes a plan is a Stripe webhook, and a
// sub-minute lag on an upgrade taking effect is not worth a query per request.
const PLAN_TTL_MS = 60_000;
const planCache = new Map<string, { plan: Plan; at: number }>();

/** Drops a user's cached plan. Called when billing state is known to change. */
export function invalidatePlan(userId: string) {
  planCache.delete(userId);
}

export async function resolvePlan(userId: string): Promise<Plan> {
  const hit = planCache.get(userId);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.plan;

  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", userId)
    .maybeSingle();

  let plan: Plan = "free";
  if (data && LIVE_STATUSES.has(data.status)) plan = (data.plan as Plan) ?? "free";

  planCache.set(userId, { plan, at: Date.now() });
  // Bound the map so a long-lived instance can't accumulate every user seen.
  if (planCache.size > 5000) {
    const cutoff = Date.now() - PLAN_TTL_MS;
    for (const [k, v] of planCache) if (v.at < cutoff) planCache.delete(k);
  }
  return plan;
}

/**
 * Express middleware that rejects the request with 402 Payment Required unless
 * the authenticated user's plan unlocks `feature`. Place after `requireAuth`.
 */
export function requireEntitlement(feature: Feature) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const userId = (req as AuthedRequest).userId;
      const plan = await resolvePlan(userId);
      if (PLAN_FEATURES[plan]?.includes(feature)) {
        next();
        return;
      }
      const err = new HttpError(
        402,
        "This feature requires a Pro subscription.",
        "upgrade_required"
      );
      (err as any).feature = feature;
      next(err);
    } catch (err) {
      next(err);
    }
  };
}
