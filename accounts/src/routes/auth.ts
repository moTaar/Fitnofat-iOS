import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin, supabaseAuth } from "../supabase";
import { asyncHandler } from "../middleware";
import { ensureStripeCustomer } from "../stripe";
import { config } from "../config";

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

// POST /auth/forgot-password — sends a Supabase recovery email pointing back
// at the web app's /reset-password page. Always responds { ok: true }
// regardless of whether the email is registered, so this endpoint can't be
// used to enumerate accounts.
const forgotPasswordSchema = z.object({ email: z.string().email() });

authRouter.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    try {
      await supabaseAuth.auth.resetPasswordForEmail(email, {
        redirectTo: `${config.appUrl}/reset-password`,
      });
    } catch (err) {
      // Best-effort — never let a Supabase/SMTP hiccup leak into the response
      // (that would also leak whether the address is registered).
      console.warn("[auth] forgot-password error:", err);
    }
    res.json({ ok: true });
  })
);

// POST /auth/reset-password — completes the recovery flow. `accessToken` is
// the one-time token Supabase put in the reset-email link (the client reads
// it out of the URL fragment); we verify it identifies a real user, then set
// the new password with the service-role client. No existing session/login
// is required — the recovery token itself is the proof of email ownership.
const resetPasswordSchema = z.object({
  accessToken: z.string().min(1),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

authRouter.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const { accessToken, password } = resetPasswordSchema.parse(req.body);

    const { data, error } = await supabaseAuth.auth.getUser(accessToken);
    if (error || !data.user) {
      res.status(401).json({ error: "This reset link is invalid or has expired" });
      return;
    }

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
      data.user.id,
      { password }
    );
    if (updateErr) throw new Error(updateErr.message);

    res.json({ ok: true });
  })
);
