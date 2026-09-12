// Google Cloud access tokens for Vertex AI, minted from a service-account key.
//
// The Gemini calls elsewhere in this service authenticate with a plain API key
// (`?key=…`), but Vertex AI — where the medical models live — only accepts OAuth
// bearer tokens. Rather than pull in `google-auth-library` (this service has no
// Google SDK at all), we do the documented JWT-bearer exchange by hand: sign a
// short-lived assertion with the service account's private key and swap it for
// an access token. Tokens are cached until just before they expire, so a busy
// instance mints roughly one per hour, not one per request.

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

let cachedAccount: ServiceAccount | null | undefined;
let cachedToken: { token: string; expiresAt: number } | null = null;

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

/** Test seam: drops the cached key + token so env changes take effect. */
export function resetVertexAuth() {
  cachedAccount = undefined;
  cachedToken = null;
}

/**
 * A cached OAuth access token for Vertex AI. Throws `VERTEX_NOT_CONFIGURED`
 * when no service account is available and `VERTEX_AUTH_FAILED` when Google
 * rejects the assertion — both recoverable, so the caller can fall back to
 * Gemini rather than failing the request.
 */
export async function vertexAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const account = loadServiceAccount();
  if (!account) throw new Error("VERTEX_NOT_CONFIGURED");

  const tokenUri = account.token_uri || DEFAULT_TOKEN_URI;
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: account.client_email,
    scope: SCOPE,
    aud: tokenUri,
    iat,
    exp: iat + 3600,
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

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("VERTEX_AUTH_FAILED");

  cachedToken = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 3600) * 1000 - EXPIRY_SKEW_MS),
  };
  return cachedToken.token;
}
