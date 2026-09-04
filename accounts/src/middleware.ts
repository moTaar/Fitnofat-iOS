import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { ZodError } from "zod";
import { supabaseAuth } from "./supabase";
import { config } from "./config";
import { verifyAccessToken } from "./jwt";

export interface AuthedRequest extends Request {
  userId: string;
  userEmail: string;
  accessToken: string;
}

/** Wraps an async handler so thrown errors hit the Express error handler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Validates the Supabase access token and attaches the user to the request.
 *
 * Fast path: verify the JWT signature in-process (see `./jwt`). Slow path: ask
 * Supabase, for tokens we can't verify locally. The offline path means a token
 * stays valid until it expires even if the session was revoked server-side;
 * Supabase access tokens are short-lived and refresh still goes through them.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }

  const r = req as AuthedRequest;
  const local = await verifyAccessToken(token);
  if (local) {
    r.userId = local.userId;
    r.userEmail = local.email;
    r.accessToken = token;
    next();
    return;
  }

  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }
  r.userId = data.user.id;
  r.userEmail = data.user.email ?? "";
  r.accessToken = token;
  next();
}

/** Gates admin routes — caller must supply the ADMIN_API_KEY as a Bearer token
 *  or in the X-Admin-Key header. Returns 401 if the key is missing/wrong. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const key = config.adminApiKey;
  if (!key) {
    res.status(503).json({ error: "Admin API not configured (missing ADMIN_API_KEY)" });
    return;
  }
  const header = req.headers["x-admin-key"] ?? req.headers.authorization ?? "";
  const provided = Array.isArray(header)
    ? header[0]
    : header.startsWith("Bearer ")
    ? header.slice(7)
    : header;
  // Constant-time compare so the response latency can't be used to guess the key.
  const a = Buffer.from(provided);
  const b = Buffer.from(key);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: "Invalid or missing admin key" });
    return;
  }
  next();
}

/** Errors thrown with this carry an intentional, client-safe message. */
export class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Invalid request",
      code: "validation_failed",
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }

  const status = (err as any)?.status ?? 500;

  if (status >= 500) {
    // Stripe/Supabase messages can carry customer ids and key fragments — log
    // them, never ship them to the client.
    console.error("[error]", err);
    res.status(status).json({
      error: config.isProd
        ? "Something went wrong. Please try again."
        : err instanceof Error
        ? err.message
        : "Internal server error",
    });
    return;
  }

  const message = err instanceof Error ? err.message : "Request failed";
  const body: Record<string, unknown> = { error: message };
  const code = (err as any)?.code;
  if (code) body.code = code;
  res.status(status).json(body);
}
