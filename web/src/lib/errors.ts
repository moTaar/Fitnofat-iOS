// Error types shared by the two ways the client reaches the backend: the
// services over HTTP (api.ts) and Supabase directly (db.ts). Kept in their own
// module so db.ts can throw them without importing api.ts, which imports db.ts.

export class ApiError extends Error {
  status: number;
  /** The server's machine-readable discriminator, when it sent one. */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class AuthExpiredError extends ApiError {
  constructor() {
    super("Session expired", 401);
  }
}

// Thrown when the data API rejects a premium route for a non-Pro user (402).
export class UpgradeRequiredError extends ApiError {
  feature?: string;
  constructor(message: string, feature?: string) {
    super(message, 402);
    this.feature = feature;
  }
}

// Thrown on 429: either a short burst limit or the daily AI allowance. The
// server distinguishes the two via `code` — `upgrade_required` means a free
// user is out of allowance (offer Pro), `quota_exceeded`/`rate_limited` mean
// wait it out.
export class RateLimitedError extends ApiError {
  retryAfterSec?: number;
  constructor(message: string, code?: string, retryAfterSec?: number) {
    super(message, 429, code);
    this.retryAfterSec = retryAfterSec;
  }
  /** True when the fix is upgrading rather than waiting. */
  get isUpgradePath() {
    return this.code === "upgrade_required";
  }
}
