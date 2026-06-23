import type { NextFunction, Request, Response } from "express";
import { supabaseAuth } from "./supabase";

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

/** Validates the Supabase access token and attaches userId to the request. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Missing authorization token" });
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

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const message = err instanceof Error ? err.message : "Internal server error";
  // 400 for known validation-ish errors, 500 otherwise.
  const status = (err as any)?.status ?? 500;
  if (status >= 500) console.error("[error]", err);
  res.status(status).json({ error: message });
}
