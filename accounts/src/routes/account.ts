import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import { asyncHandler, requireAuth, AuthedRequest } from "../middleware";
import { stripe } from "../stripe";
import type { Plan } from "../entitlements";

export const accountRouter = Router();
accountRouter.use(requireAuth);

const uid = (req: AuthedRequest) => req.userId;

interface SubRow {
  plan: Plan;
  status: string;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

async function loadSub(userId: string): Promise<SubRow | null> {
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select("plan, status, current_period_end, stripe_customer_id, stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as SubRow) ?? null;
}

// ── GET /account : identity + plan summary ───────────────────────────────────
accountRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const r = req as AuthedRequest;
    const userId = uid(r);
    const [{ data: profile }, sub] = await Promise.all([
      supabaseAdmin.from("profiles").select("name").eq("user_id", userId).maybeSingle(),
      loadSub(userId),
    ]);
    res.json({
      id: userId,
      email: r.userEmail,
      name: profile?.name ?? "",
      plan: sub?.plan ?? "free",
      status: sub?.status ?? "inactive",
      currentPeriodEnd: sub?.current_period_end ?? null,
    });
  })
);

// ── PATCH /account : update name and/or email ────────────────────────────────
const patchSchema = z.object({
  name: z.string().max(120).optional(),
  email: z.string().email().optional(),
});

accountRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const { name, email } = patchSchema.parse(req.body);

    if (name !== undefined) {
      const { error } = await supabaseAdmin
        .from("profiles")
        .upsert({ user_id: userId, name }, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    }

    if (email !== undefined) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { email });
      if (error) throw new Error(error.message);
      // Keep the Stripe customer's email in sync (best-effort).
      const sub = await loadSub(userId);
      if (sub?.stripe_customer_id) {
        try {
          await stripe.customers.update(sub.stripe_customer_id, { email });
        } catch (err) {
          console.warn("[account] Stripe email sync failed:", err);
        }
      }
    }

    res.json({ ok: true });
  })
);

// ── POST /account/password : change password ─────────────────────────────────
accountRouter.post(
  "/password",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const { password } = z
      .object({ password: z.string().min(6, "Password must be at least 6 characters") })
      .parse(req.body);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  })
);

// ── DELETE /account : cancel billing + remove the user (cascades all data) ────
accountRouter.delete(
  "/",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const sub = await loadSub(userId);

    // Cancel any live Stripe subscription so we stop billing a deleted account.
    if (sub?.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(sub.stripe_subscription_id);
      } catch (err) {
        console.warn("[account] Stripe subscription cancel failed:", err);
      }
    }

    // Deleting the auth user cascades to profiles/programs/routines/workouts/
    // nutrition_plans/subscriptions via `on delete cascade` FKs.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    res.status(204).end();
  })
);
