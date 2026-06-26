import Stripe from "stripe";
import { config } from "./config";
import { supabaseAdmin } from "./supabase";

// Construct lazily so a missing STRIPE_SECRET_KEY doesn't crash the whole service
// at import time (the SDK throws on an empty key). /health stays up and reports
// the misconfiguration; only routes that actually touch Stripe will error.
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    if (!config.stripeSecretKey) {
      const err = new Error("Stripe is not configured (missing STRIPE_SECRET_KEY)") as Error & { status?: number };
      err.status = 503;
      throw err;
    }
    _stripe = new Stripe(config.stripeSecretKey, {
      // Pin to the SDK's bundled API version for stable typings.
      apiVersion: "2025-01-27.acacia" as Stripe.LatestApiVersion,
    });
  }
  return _stripe;
}

// Proxy that defers construction to first property access, so existing
// `stripe.customers.create(...)` call sites work unchanged.
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_t, prop) {
    const client = getStripe();
    const value = (client as any)[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

// A Stripe subscription is "live" (entitling the Pro features) for these statuses.
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export function isLiveStatus(status: string | null | undefined): boolean {
  return !!status && ACTIVE_STATUSES.has(status);
}

/**
 * Returns the Stripe customer id for a user, creating one (and saving it on the
 * `subscriptions` row) if it doesn't exist yet.
 */
export async function ensureStripeCustomer(
  userId: string,
  email: string
): Promise<string> {
  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (sub?.stripe_customer_id) return sub.stripe_customer_id;

  const customer = await stripe.customers.create({
    email,
    metadata: { user_id: userId },
  });

  await supabaseAdmin
    .from("subscriptions")
    .upsert(
      { user_id: userId, stripe_customer_id: customer.id },
      { onConflict: "user_id" }
    );

  return customer.id;
}
