// Subscription tiers and what each unlocks. Tiers live in code (versioned with
// the app), not the database — the `subscriptions` table only stores which tier
// a user is on and the Stripe linkage. The data API mirrors the FEATURES list so
// it can gate premium routes.

import { config } from "./config";

export type Plan = "free" | "pro";

// Gated premium capabilities. Both this service and the data API key off these.
export type Feature =
  | "ai_coach"
  | "ai_nutrition"
  | "program_refresh"
  | "ai_exercise"
  // AI nutritionist + medical helper and the Medical dashboard's health review.
  | "ai_medical";

export interface Tier {
  id: Plan;
  name: string;
  /** Display price, in the smallest currency unit's human form (USD). */
  priceUsd: number;
  /** Stripe recurring Price ID, empty for the free tier. */
  stripePriceId: string;
  features: Feature[];
  blurb: string;
}

export const TIERS: Record<Plan, Tier> = {
  free: {
    id: "free",
    name: "Free",
    priceUsd: 0,
    stripePriceId: "",
    features: [],
    blurb: "Workout logging, manual routines, library, history, and your first AI program.",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsd: 9,
    stripePriceId: config.stripePricePro,
    features: ["ai_coach", "ai_nutrition", "program_refresh", "ai_exercise", "ai_medical"],
    blurb:
      "Everything in Free plus the AI Coach, evolving nutrition plans, program refresh, AI exercise assist, and the AI nutritionist + medical helper.",
  },
};

export const PLAN_LIST: Tier[] = [TIERS.free, TIERS.pro];

/** Does the given plan unlock a feature? */
export function planAllows(plan: Plan, feature: Feature): boolean {
  return TIERS[plan]?.features.includes(feature) ?? false;
}

/** Map a Stripe Price ID back to our plan. Unknown prices fall back to free. */
export function planForPriceId(priceId: string | null | undefined): Plan {
  if (priceId && priceId === config.stripePricePro) return "pro";
  return "free";
}
