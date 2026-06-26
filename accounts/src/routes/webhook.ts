import type { Request, Response } from "express";
import type Stripe from "stripe";
import { config } from "../config";
import { supabaseAdmin } from "../supabase";
import { stripe } from "../stripe";
import { planForPriceId } from "../entitlements";

// Push a Stripe Subscription's state onto our `subscriptions` row, keyed by the
// Stripe customer id (set when the customer was created at signup/checkout).
async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const priceId = sub.items.data[0]?.price?.id ?? null;
  // A canceled/expired subscription drops the user back to the free plan.
  const live = sub.status !== "canceled" && sub.status !== "incomplete_expired";
  const plan = live ? planForPriceId(priceId) : "free";

  await supabaseAdmin
    .from("subscriptions")
    .update({
      stripe_subscription_id: sub.id,
      plan,
      status: sub.status,
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_customer_id", customerId);
}

/**
 * POST /webhooks/stripe — must receive the RAW request body so the signature can
 * be verified (mounted with express.raw in index.ts, before express.json()).
 */
export async function stripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    res.status(400).send("Missing stripe-signature header");
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripeWebhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid signature";
    console.warn("[webhook] signature verification failed:", msg);
    res.status(400).send(`Webhook Error: ${msg}`);
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await syncSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        if (customerId) {
          await supabaseAdmin
            .from("subscriptions")
            .update({ status: "past_due", updated_at: new Date().toISOString() })
            .eq("stripe_customer_id", customerId);
        }
        break;
      }
      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }
  } catch (err) {
    console.error("[webhook] handler error:", err);
    res.status(500).send("Webhook handler failed");
    return;
  }

  res.json({ received: true });
}
