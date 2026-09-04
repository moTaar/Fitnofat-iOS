// Local verification of Supabase access tokens.
//
// `supabase.auth.getUser(token)` is a network round trip to the Supabase Auth
// service. Doing that on *every* API request adds 100-300ms to every call and
// makes our availability depend on theirs. Supabase access tokens are ordinary
// signed JWTs, so we can verify them here and keep the network call purely as a
// fallback for the cases this module can't handle.
//
// Two signing schemes are supported, matching the two Supabase key modes:
//   • HS256 — the legacy shared "JWT secret" (set SUPABASE_JWT_SECRET).
//   • RS256/ES256 — the newer asymmetric keys, verified against the project's
//     published JWKS (fetched and cached; no configuration needed).
//
// Anything unrecognised returns null so the caller can fall back to the network.

import crypto from "node:crypto";
import { config } from "./config";

export interface VerifiedToken {
  userId: string;
  email: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface JwtPayload {
  sub?: string;
  email?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
  session_id?: string;
}

function b64urlToBuffer(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function decodeJson<T>(part: string): T | null {
  try {
    return JSON.parse(b64urlToBuffer(part).toString("utf8")) as T;
  } catch {
    return null;
  }
}

// ── JWKS cache ───────────────────────────────────────────────────────────────
// Keys rotate rarely; refetch at most once a minute, and only when we actually
// see a `kid` we don't recognise (so rotation is picked up without polling).
const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_MIN_REFETCH_MS = 60 * 1000;

let jwksCache: Map<string, crypto.KeyObject> | null = null;
let jwksFetchedAt = 0;
let jwksInFlight: Promise<Map<string, crypto.KeyObject>> | null = null;

async function fetchJwks(): Promise<Map<string, crypto.KeyObject>> {
  const url = `${config.supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`;
  const res = await fetch(url, {
    headers: config.supabaseAnonKey ? { apikey: config.supabaseAnonKey } : {},
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys?: Array<Record<string, unknown>> };
  const map = new Map<string, crypto.KeyObject>();
  for (const jwk of body.keys ?? []) {
    const kid = typeof jwk.kid === "string" ? jwk.kid : null;
    if (!kid) continue;
    try {
      map.set(kid, crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: "jwk" }));
    } catch {
      // Unsupported key type — skip it; the network fallback still covers us.
    }
  }
  return map;
}

async function getKey(kid: string): Promise<crypto.KeyObject | null> {
  const fresh = jwksCache && Date.now() - jwksFetchedAt < JWKS_TTL_MS;
  if (fresh && jwksCache!.has(kid)) return jwksCache!.get(kid)!;
  // Unknown kid (or stale cache): refetch, but never hammer the endpoint.
  if (jwksCache && Date.now() - jwksFetchedAt < JWKS_MIN_REFETCH_MS) {
    return jwksCache.get(kid) ?? null;
  }
  if (!jwksInFlight) {
    jwksInFlight = fetchJwks()
      .then((map) => {
        jwksCache = map;
        jwksFetchedAt = Date.now();
        return map;
      })
      .finally(() => {
        jwksInFlight = null;
      });
  }
  try {
    return (await jwksInFlight).get(kid) ?? null;
  } catch {
    return null;
  }
}

// Node's signature verification wants the DSA/ECDSA signature in a specific
// encoding; JWS uses the raw r||s concatenation ("ieee-p1363").
const ALG_PARAMS: Record<string, { hash: string; dsaEncoding?: "ieee-p1363" }> = {
  RS256: { hash: "sha256" },
  RS384: { hash: "sha384" },
  RS512: { hash: "sha512" },
  ES256: { hash: "sha256", dsaEncoding: "ieee-p1363" },
  ES384: { hash: "sha384", dsaEncoding: "ieee-p1363" },
  ES512: { hash: "sha512", dsaEncoding: "ieee-p1363" },
};

const HS_ALGS: Record<string, string> = {
  HS256: "sha256",
  HS384: "sha384",
  HS512: "sha512",
};

function verifyHmac(alg: string, signingInput: string, signature: Buffer): boolean {
  const secret = config.supabaseJwtSecret;
  if (!secret) return false;
  const hash = HS_ALGS[alg];
  if (!hash) return false;
  const expected = crypto.createHmac(hash, secret).update(signingInput).digest();
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(expected, signature);
}

async function verifyAsymmetric(
  header: JwtHeader,
  signingInput: string,
  signature: Buffer
): Promise<boolean> {
  const params = ALG_PARAMS[header.alg ?? ""];
  if (!params || !header.kid) return false;
  const key = await getKey(header.kid);
  if (!key) return false;
  try {
    return crypto.verify(
      params.hash,
      Buffer.from(signingInput),
      { key, dsaEncoding: params.dsaEncoding },
      signature
    );
  } catch {
    return false;
  }
}

/**
 * Verifies a Supabase access token locally.
 *
 * Returns the user on success, or null when the token is malformed/expired *or*
 * when this module simply can't verify it (unknown algorithm, no JWT secret
 * configured, JWKS unreachable). Callers must treat null as "ask Supabase",
 * not as "reject" — see `requireAuth`.
 */
export async function verifyAccessToken(token: string): Promise<VerifiedToken | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const header = decodeJson<JwtHeader>(parts[0]);
  const payload = decodeJson<JwtPayload>(parts[1]);
  if (!header || !payload || !header.alg || header.alg === "none") return null;

  // Reject expiry before doing any crypto — cheapest check first.
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) return null;
  // Small tolerance for clock skew on tokens minted moments ago.
  if (typeof payload.iat === "number" && payload.iat > now + 60) return null;
  if (!payload.sub) return null;

  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = b64urlToBuffer(parts[2]);

  const ok = header.alg.startsWith("HS")
    ? verifyHmac(header.alg, signingInput, signature)
    : await verifyAsymmetric(header, signingInput, signature);
  if (!ok) return null;

  // Signature is good — now check it was actually minted for this project.
  const expectedIss = `${config.supabaseUrl.replace(/\/$/, "")}/auth/v1`;
  if (payload.iss && payload.iss !== expectedIss) return null;
  const aud = payload.aud;
  const audOk =
    aud === undefined ||
    (Array.isArray(aud) ? aud.includes("authenticated") : aud === "authenticated");
  if (!audOk) return null;

  return { userId: payload.sub, email: payload.email ?? "" };
}

/** Test seam: drops the cached JWKS so a test can control what gets fetched. */
export function __resetJwksCache() {
  jwksCache = null;
  jwksFetchedAt = 0;
  jwksInFlight = null;
}
