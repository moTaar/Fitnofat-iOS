import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import { asyncHandler, requireAdmin } from "../middleware";
import { stripe, isLiveStatus } from "../stripe";
import type { Plan } from "../entitlements";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// ── GET /admin/users ──────────────────────────────────────────────────────────
// Returns every user with their email, name, plan, status, and period end.
// Supports optional ?plan=free|pro and ?email= query filters.
adminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const planFilter = req.query.plan as string | undefined;
    const emailFilter = (req.query.email as string | undefined)?.toLowerCase();

    // Load all auth users (paged — Supabase caps at 1 000 per call).
    const { data: usersPage, error: usersErr } =
      await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (usersErr) throw new Error(usersErr.message);
    const users = usersPage.users;

    // Load subscriptions + profiles in parallel.
    const [{ data: subs }, { data: profiles }] = await Promise.all([
      supabaseAdmin.from("subscriptions").select("user_id, plan, status, current_period_end, stripe_customer_id, stripe_subscription_id"),
      supabaseAdmin.from("profiles").select("user_id, name"),
    ]);

    const subMap = new Map((subs ?? []).map((s) => [s.user_id, s]));
    const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));

    let result = users.map((u) => {
      const sub = subMap.get(u.id);
      const profile = profileMap.get(u.id);
      return {
        id: u.id,
        email: u.email ?? "",
        name: profile?.name ?? "",
        createdAt: u.created_at,
        plan: (sub?.plan as Plan) ?? "free",
        status: sub?.status ?? "inactive",
        currentPeriodEnd: sub?.current_period_end ?? null,
        stripeCustomerId: sub?.stripe_customer_id ?? null,
        stripeSubscriptionId: sub?.stripe_subscription_id ?? null,
      };
    });

    if (planFilter) result = result.filter((u) => u.plan === planFilter);
    if (emailFilter) result = result.filter((u) => u.email.toLowerCase().includes(emailFilter));

    res.json({ total: result.length, users: result });
  })
);

// ── GET /admin/users/:id ──────────────────────────────────────────────────────
adminRouter.get(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const [{ data: user, error: userErr }, { data: sub }, { data: profile }] = await Promise.all([
      supabaseAdmin.auth.admin.getUserById(id),
      supabaseAdmin.from("subscriptions").select("*").eq("user_id", id).maybeSingle(),
      supabaseAdmin.from("profiles").select("*").eq("user_id", id).maybeSingle(),
    ]);
    if (userErr || !user.user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({
      id: user.user.id,
      email: user.user.email ?? "",
      name: profile?.name ?? "",
      createdAt: user.user.created_at,
      plan: (sub?.plan as Plan) ?? "free",
      status: sub?.status ?? "inactive",
      currentPeriodEnd: sub?.current_period_end ?? null,
      stripeCustomerId: sub?.stripe_customer_id ?? null,
      stripeSubscriptionId: sub?.stripe_subscription_id ?? null,
      profile,
    });
  })
);

// ── PATCH /admin/users/:id/plan ───────────────────────────────────────────────
// Manually set a user's plan/status without going through Stripe.
// Useful for: free trials, comps, manual grants, fixing webhook mismatches.
const planPatchSchema = z.object({
  plan: z.enum(["free", "pro"]),
  status: z.enum(["active", "trialing", "past_due", "canceled", "inactive"]).optional(),
});

adminRouter.patch(
  "/users/:id/plan",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { plan, status } = planPatchSchema.parse(req.body);

    // Default status: active when granting pro, inactive when revoking.
    const resolvedStatus = status ?? (plan === "pro" ? "active" : "inactive");

    const { error } = await supabaseAdmin
      .from("subscriptions")
      .upsert(
        {
          user_id: id,
          plan,
          status: resolvedStatus,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    if (error) throw new Error(error.message);

    res.json({ ok: true, userId: id, plan, status: resolvedStatus });
  })
);

// ── DELETE /admin/users/:id ───────────────────────────────────────────────────
// Hard-deletes a user: cancels their Stripe sub (if any) then removes the auth
// user (cascade wipes all their data via DB FKs).
adminRouter.delete(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_subscription_id")
      .eq("user_id", id)
      .maybeSingle();

    if (sub?.stripe_subscription_id) {
      try {
        const existing = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
        if (isLiveStatus(existing.status)) {
          await stripe.subscriptions.cancel(sub.stripe_subscription_id);
        }
      } catch (err) {
        console.warn("[admin] Stripe cancel failed:", err);
      }
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error) throw new Error(error.message);

    res.status(204).end();
  })
);

// ── GET /admin/stats ──────────────────────────────────────────────────────────
// Quick summary: total users, free vs pro count, past_due count.
adminRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const { data: subs, error } = await supabaseAdmin
      .from("subscriptions")
      .select("plan, status");
    if (error) throw new Error(error.message);

    const { data: usersPage } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1 });
    const total = (usersPage as any)?.total ?? (subs ?? []).length;

    const rows = subs ?? [];
    const pro = rows.filter((s) => s.plan === "pro" && isLiveStatus(s.status)).length;
    const pastDue = rows.filter((s) => s.status === "past_due").length;

    res.json({
      totalUsers: total,
      freeUsers: total - pro,
      proUsers: pro,
      pastDueUsers: pastDue,
    });
  })
);
