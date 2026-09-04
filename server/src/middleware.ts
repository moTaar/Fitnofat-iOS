import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { ZodError } from "zod";
import { supabaseAuth } from "./supabase";
import { config } from "./config";
import { verifyAccessToken } from "./jwt";

export interface AuthedRequest extends Request {
  userId: string;
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

export function bearerToken(req: Request): string {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/**
 * Validates the Supabase access token and attaches userId to the request.
 *
 * Fast path: verify the JWT signature in-process (see `./jwt`). Slow path: ask
 * Supabase, for tokens we can't verify locally (unknown algorithm, JWKS
 * unreachable, no JWT secret configured). Because the fast path is offline, a
 * token stays valid until it expires even if the session was revoked
 * server-side — Supabase access tokens are short-lived (1h by default), and the
 * refresh call that mints the next one still goes through Supabase.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }

  const local = await verifyAccessToken(token);
  if (local) {
    (req as AuthedRequest).userId = local.userId;
    (req as AuthedRequest).accessToken = token;
    next();
    return;
  }

  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }
  (req as AuthedRequest).userId = data.user.id;
  (req as AuthedRequest).accessToken = token;
  next();
}

/** Gates internal/diagnostic routes on the shared ADMIN_API_KEY. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const key = config.adminApiKey;
  if (!key) {
    res.status(503).json({ error: "Not configured" });
    return;
  }
  const header = req.headers["x-admin-key"] ?? req.headers.authorization ?? "";
  const raw = Array.isArray(header) ? header[0] : header;
  const provided = raw.startsWith("Bearer ") ? raw.slice(7) : raw;
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
  // Schema validation failures are the client's fault, not ours — surface them
  // as 400 with the offending fields instead of a generic 500.
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
    // Upstream messages (Supabase/Gemini) can carry connection strings, key
    // fragments and row contents — log them, never ship them to the client.
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
  // Pass through the discriminators the client branches on (see api.ts).
  const code = (err as any)?.code;
  const feature = (err as any)?.feature;
  if (code) body.code = code;
  if (feature) body.feature = feature;
  res.status(status).json(body);
}
