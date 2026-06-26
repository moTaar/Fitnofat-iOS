import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { supabaseAdmin } from "../supabase";
import { asyncHandler, requireAuth, AuthedRequest } from "../middleware";
import { stripe, ensureStripeCustomer } from "../stripe";
import { PLAN_LIST, TIERS, type Plan } from "../entitlements";

export const billingRouter = Router();
billingRouter.use(requireAuth);

const uid = (req: AuthedRequest) => req.userId;

// ── GET /billing/plans : the public tier catalog ─────────────────────────────
billingRouter.get(
  "/plans",
  asyncHandler(async (_req, res) => {
    res.json({
      plans: PLAN_LIST.map((t) => ({
        id: t.id,
        name: t.name,
        priceUsd: t.priceUsd,
        features: t.features,
        blurb: t.blurb,
        purchasable: !!t.stripePriceId,
      })),
    });
  })
);

// ── GET /billing/subscription : the caller's current plan/status ─────────────
billingRouter.get(
  "/subscription",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const { data } = await supabaseAdmin
      .from("subscriptions")
      .select("plan, status, current_period_end")
      .eq("user_id", userId)
      .maybeSingle();
    res.json({
      plan: (data?.plan as Plan) ?? "free",
      status: data?.status ?? "inactive",
      currentPeriodEnd: data?.current_period_end ?? null,
    });
  })
);

// ── POST /billing/checkout : start a Stripe Checkout for a plan ──────────────
billingRouter.post(
  "/checkout",
  asyncHandler(async (req, res) => {
    const r = req as AuthedRequest;
    const userId = uid(r);
    const { plan } = z.object({ plan: z.enum(["pro"]) }).parse(req.body);

    const priceId = TIERS[plan].stripePriceId;
    if (!priceId) {
      res.status(400).json({ error: "This plan is not purchasable" });
      return;
    }

    const customerId = await ensureStripeCustomer(userId, r.userEmail);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Lets the webhook resolve the user even before the customer row propagates.
      client_reference_id: userId,
      subscription_data: { metadata: { user_id: userId, plan } },
      success_url: `${config.appUrl}/settings?billing=success`,
      cancel_url: `${config.appUrl}/settings?billing=cancel`,
    });

    res.json({ url: session.url });
  })
);

// ── POST /billing/portal : open the Stripe Billing Portal ────────────────────
billingRouter.post(
  "/portal",
  asyncHandler(async (req, res) => {
    const r = req as AuthedRequest;
    const userId = uid(r);
    const customerId = await ensureStripeCustomer(userId, r.userEmail);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${config.appUrl}/settings`,
    });
    res.json({ url: session.url });
  })
);
