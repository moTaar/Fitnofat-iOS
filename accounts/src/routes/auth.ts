import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin, supabaseAuth } from "../supabase";
import { asyncHandler } from "../middleware";
import { ensureStripeCustomer } from "../stripe";

export const authRouter = Router();

const credsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().optional(),
});

function sessionPayload(session: any, user: any) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
    user: { id: user.id, email: user.email },
  };
}

// POST /auth/signup
authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const { email, password, name } = credsSchema.parse(req.body);

    // Create the user already confirmed so they can sign in immediately.
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !created.user) {
      res.status(400).json({ error: createErr?.message ?? "Could not create account" });
      return;
    }

    const userId = created.user.id;

    // Seed an empty profile row.
    await supabaseAdmin.from("profiles").upsert({
      user_id: userId,
      name: name ?? "",
      onboarded: false,
    });

    // Seed a free subscription row and create the Stripe customer up front, so
    // billing is one call away later. Best-effort: a Stripe hiccup must not block
    // signup — `ensureStripeCustomer` will retry lazily at checkout time.
    await supabaseAdmin
      .from("subscriptions")
      .upsert({ user_id: userId, plan: "free", status: "inactive" }, { onConflict: "user_id" });
    try {
      await ensureStripeCustomer(userId, email);
    } catch (err) {
      console.warn("[signup] Stripe customer creation deferred:", err);
    }

    const { data: signIn, error: signErr } = await supabaseAuth.auth.signInWithPassword({
      email,
      password,
    });
    if (signErr || !signIn.session) {
      res.status(400).json({ error: signErr?.message ?? "Account created — please log in" });
      return;
    }
    res.json(sessionPayload(signIn.session, signIn.user));
  })
);

// POST /auth/login
authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = credsSchema.parse(req.body);
    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    res.json(sessionPayload(data.session, data.user));
  })
);

// POST /auth/refresh
authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    const { data, error } = await supabaseAuth.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      res.status(401).json({ error: "Session expired, please log in again" });
      return;
    }
    res.json(sessionPayload(data.session, data.user));
  })
);

// POST /auth/logout — sessions are stateless JWTs; the client clears its copy.
// Provided for symmetry and future server-side revocation.
authRouter.post(
  "/logout",
  asyncHandler(async (_req, res) => {
    res.status(204).end();
  })
);
