// Client mirror of the server tier→feature map, so the UI can show "Upgrade to
// Pro" states without waiting for a 402. The accounts service remains the source
// of truth; this only decides what to *show*.
import type { Feature, Plan, Subscription } from "./types";

const PLAN_FEATURES: Record<Plan, Feature[]> = {
  free: [],
  pro: ["ai_coach", "ai_nutrition", "program_refresh", "ai_exercise", "ai_medical"],
};

const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Effective plan for a subscription — non-live statuses fall back to free. */
export function effectivePlan(sub: Subscription | null): Plan {
  if (!sub) return "free";
  return LIVE_STATUSES.has(sub.status) ? sub.plan : "free";
}

/** Does the user's subscription unlock a feature? */
export function isEntitled(sub: Subscription | null, feature: Feature): boolean {
  return PLAN_FEATURES[effectivePlan(sub)].includes(feature);
}
