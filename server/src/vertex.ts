// Google Cloud credentials minted from a service-account key.
//
// The Gemini calls elsewhere in this service authenticate with a plain API key
// (`?key=…`), but two things the medical desk can talk to do not accept one:
// Vertex AI wants an OAuth **access token**, and a private Cloud Run service
// wants a Google-signed **ID token** whose `aud` is the service URL. Rather than
// pull in `google-auth-library` (this service has no Google SDK at all), both
// come from the same documented JWT-bearer exchange, done by hand: sign a
// short-lived assertion with the service account's private key and swap it at
// Google's token endpoint. Tokens are cached until just before they expire, so a
// busy instance mints roughly one per hour, not one per request.

import crypto from "node:crypto";
import fs from "node:fs";
import { config } from "./config";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
  project_id?: string;
}

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
// Refresh this far before the real expiry so an in-flight call never races it.
const EXPIRY_SKEW_MS = 60_000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedAccount: ServiceAccount | null | undefined;
let cachedAccessToken: CachedToken | null = null;
// ID tokens are audience-scoped, so they cache per audience rather than globally.
const cachedIdTokens = new Map<string, CachedToken>();

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * The service-account key, from `VERTEX_SERVICE_ACCOUNT_JSON` (raw JSON or
 * base64-encoded, because most secret managers mangle multi-line values) or
 * from the file at `GOOGLE_APPLICATION_CREDENTIALS`. Returns null when neither
 * is configured — callers treat that as "Vertex isn't set up".
 */
export function loadServiceAccount(): ServiceAccount | null {
  if (cachedAccount !== undefined) return cachedAccount;
  cachedAccount = null;

  const raw = config.vertexServiceAccountJson.trim();
  let text = "";
  if (raw) {
    text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  } else if (config.googleCredentialsPath) {
    try {
      text = fs.readFileSync(config.googleCredentialsPath, "utf8");
    } catch (err) {
      console.error("[vertex] could not read GOOGLE_APPLICATION_CREDENTIALS:", (err as Error).message);
      return cachedAccount;
    }
  } else {
    return cachedAccount;
  }

  try {
    const parsed = JSON.parse(text) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key) {
      console.error("[vertex] service account JSON is missing client_email/private_key");
      return cachedAccount;
    }
    // Secrets pasted through a UI often arrive with literal \n sequences.
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    cachedAccount = parsed;
  } catch {
    console.error("[vertex] service account JSON could not be parsed");
  }
  return cachedAccount;
}

/** Project id for the Vertex endpoint — explicit env wins over the key's own. */
export function vertexProjectId(): string {
  return config.vertexProjectId || loadServiceAccount()?.project_id || "";
}

/** True when a Vertex call has everything it needs to authenticate. */
export function vertexConfigured(): boolean {
  return !!loadServiceAccount() && !!vertexProjectId();
}

/** Test seam: drops the cached key + tokens so env changes take effect. */
export function resetVertexAuth() {
  cachedAccount = undefined;
  cachedAccessToken = null;
  cachedIdTokens.clear();
}

/**
 * Signs the self-signed assertion and swaps it at Google's token endpoint.
 * `scope` asks for an access token; `targetAudience` asks for an ID token whose
 * `aud` is that value (the OpenID Connect variant of the same grant).
 */
async function exchangeAssertion(
  account: ServiceAccount,
  claim: { scope: string } | { target_audience: string }
): Promise<{ access_token?: string; id_token?: string; expires_in?: number }> {
  const tokenUri = account.token_uri || DEFAULT_TOKEN_URI;
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: account.client_email,
    aud: tokenUri,
    iat,
    exp: iat + 3600,
    ...claim,
  };
  const signingInput = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify(claims)
  )}`;

  let assertion: string;
  try {
    const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(account.private_key);
    assertion = `${signingInput}.${base64url(signature)}`;
  } catch {
    // A malformed private key is a config error, not a transient one.
    throw new Error("VERTEX_AUTH_FAILED");
  }

  let res: Response;
  try {
    res = await fetch(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("VERTEX_AUTH_FAILED");
  }

  if (!res.ok) {
    // The body echoes the assertion's claims — log it, never surface it.
    console.error("[vertex] token exchange failed", res.status, (await res.text()).slice(0, 200));
    throw new Error("VERTEX_AUTH_FAILED");
  }
  return (await res.json()) as { access_token?: string; id_token?: string; expires_in?: number };
}

function cacheFor(token: string, expiresIn: number | undefined): CachedToken {
  return {
    token,
    expiresAt: Date.now() + Math.max(0, (expiresIn ?? 3600) * 1000 - EXPIRY_SKEW_MS),
  };
}

/**
 * A cached OAuth access token for Vertex AI. Throws `VERTEX_NOT_CONFIGURED`
 * when no service account is available and `VERTEX_AUTH_FAILED` when Google
 * rejects the assertion — both recoverable, so the caller can fall back to
 * another provider rather than failing the request.
 */
export async function vertexAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt) return cachedAccessToken.token;

  const account = loadServiceAccount();
  if (!account) throw new Error("VERTEX_NOT_CONFIGURED");

  const body = await exchangeAssertion(account, { scope: SCOPE });
  if (!body.access_token) throw new Error("VERTEX_AUTH_FAILED");

  cachedAccessToken = cacheFor(body.access_token, body.expires_in);
  return cachedAccessToken.token;
}

/**
 * A cached Google-signed ID token for `audience` — what a private Cloud Run
 * service checks before it will answer. The audience must be the service's base
 * URL with no path, exactly as Cloud Run issued it; a mismatch is rejected as an
 * invalid token rather than as a 403, which is a confusing way to learn you had
 * a trailing path on it.
 */
export async function googleIdToken(audience: string): Promise<string> {
  const key = audience.replace(/\/+$/, "");
  const hit = cachedIdTokens.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.token;

  const account = loadServiceAccount();
  if (!account) throw new Error("VERTEX_NOT_CONFIGURED");

  const body = await exchangeAssertion(account, { target_audience: key });
  if (!body.id_token) throw new Error("VERTEX_AUTH_FAILED");

  // An ID token's lifetime isn't in the response body; Google issues them for
  // an hour, so cache on that with the same safety margin as an access token.
  const token = cacheFor(body.id_token, body.expires_in ?? 3600);
  cachedIdTokens.set(key, token);
  return token.token;
}
