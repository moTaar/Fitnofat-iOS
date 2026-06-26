// Premium-feature gating for the data API. The accounts microservice is the
// authority for tiers (accounts/src/entitlements.ts) and writes each user's plan
// to the shared `subscriptions` table; here we only read it to decide whether a
// request is allowed through. Keep the Plan/Feature names in sync with accounts.

import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "./supabase";
import { AuthedRequest } from "./middleware";

export type Plan = "free" | "pro";
export type Feature = "ai_coach" | "ai_nutrition" | "program_refresh" | "ai_exercise";

// Which plan unlocks which feature. Mirrors accounts/src/entitlements.ts.
const PLAN_FEATURES: Record<Plan, Feature[]> = {
  free: [],
  pro: ["ai_coach", "ai_nutrition", "program_refresh", "ai_exercise"],
};

// A subscription entitles its plan's features while in one of these states.
const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

async function resolvePlan(userId: string): Promise<Plan> {
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return "free";
  const live = LIVE_STATUSES.has(data.status);
  return live ? ((data.plan as Plan) ?? "free") : "free";
}

/**
 * Express middleware that rejects the request with 402 Payment Required unless
 * the authenticated user's plan unlocks `feature`. Place after `requireAuth`.
 */
export function requireEntitlement(feature: Feature) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as AuthedRequest).userId;
    const plan = await resolvePlan(userId);
    if (PLAN_FEATURES[plan]?.includes(feature)) {
      next();
      return;
    }
    res.status(402).json({
      error: "This feature requires a Pro subscription.",
      code: "upgrade_required",
      feature,
    });
  };
}
