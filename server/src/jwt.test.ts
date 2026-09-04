import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAccessToken, __resetJwksCache } from "./jwt";
import { config } from "./config";

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function signHs256(payload: Record<string, unknown>, secret = config.supabaseJwtSecret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest();
  return `${header}.${body}.${b64url(sig)}`;
}

const now = () => Math.floor(Date.now() / 1000);
const validPayload = (over: Record<string, unknown> = {}) => ({
  sub: "11111111-2222-3333-4444-555555555555",
  email: "lifter@example.com",
  aud: "authenticated",
  iss: `${config.supabaseUrl}/auth/v1`,
  iat: now() - 10,
  exp: now() + 3600,
  ...over,
});

beforeEach(() => __resetJwksCache());

describe("verifyAccessToken — HS256", () => {
  it("accepts a well-formed token and returns the user", async () => {
    const r = await verifyAccessToken(signHs256(validPayload()));
    expect(r).toEqual({
      userId: "11111111-2222-3333-4444-555555555555",
      email: "lifter@example.com",
    });
  });

  it("rejects a token signed with the wrong secret", async () => {
    expect(await verifyAccessToken(signHs256(validPayload(), "not-the-secret"))).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = signHs256(validPayload());
    const [h, , s] = token.split(".");
    const forged = b64url(JSON.stringify(validPayload({ sub: "attacker" })));
    expect(await verifyAccessToken(`${h}.${forged}.${s}`)).toBeNull();
  });

  it("rejects an expired token", async () => {
    expect(await verifyAccessToken(signHs256(validPayload({ exp: now() - 1 })))).toBeNull();
  });

  it("rejects a token with no exp at all", async () => {
    const p = validPayload();
    delete (p as Record<string, unknown>).exp;
    expect(await verifyAccessToken(signHs256(p))).toBeNull();
  });

  it("rejects a token issued in the future beyond the skew allowance", async () => {
    expect(await verifyAccessToken(signHs256(validPayload({ iat: now() + 600 })))).toBeNull();
  });

  it("tolerates small clock skew on iat", async () => {
    expect(await verifyAccessToken(signHs256(validPayload({ iat: now() + 30 })))).not.toBeNull();
  });

  it("rejects a token minted for a different Supabase project", async () => {
    expect(
      await verifyAccessToken(signHs256(validPayload({ iss: "https://evil.supabase.co/auth/v1" })))
    ).toBeNull();
  });

  it("rejects a token whose audience isn't an authenticated user", async () => {
    expect(await verifyAccessToken(signHs256(validPayload({ aud: "anon" })))).toBeNull();
  });

  it("rejects a token with no subject", async () => {
    const p = validPayload();
    delete (p as Record<string, unknown>).sub;
    expect(await verifyAccessToken(signHs256(p))).toBeNull();
  });
});

describe("verifyAccessToken — malformed and hostile input", () => {
  it("rejects the alg=none downgrade", async () => {
    // The classic JWT attack: strip the signature and claim it wasn't needed.
    const header = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
    const body = b64url(JSON.stringify(validPayload()));
    expect(await verifyAccessToken(`${header}.${body}.`)).toBeNull();
  });

  it("rejects tokens that aren't three segments", async () => {
    expect(await verifyAccessToken("")).toBeNull();
    expect(await verifyAccessToken("abc")).toBeNull();
    expect(await verifyAccessToken("a.b")).toBeNull();
    expect(await verifyAccessToken("a.b.c.d")).toBeNull();
  });

  it("rejects segments that aren't valid JSON", async () => {
    expect(await verifyAccessToken(`${b64url("{{{")}.${b64url("}}}")}.sig`)).toBeNull();
  });

  it("never throws, whatever it is handed", async () => {
    for (const bad of ["....", "😀.😀.😀", "null.null.null", ".".repeat(50)]) {
      await expect(verifyAccessToken(bad)).resolves.toBeNull();
    }
  });
});

describe("verifyAccessToken — asymmetric keys", () => {
  it("verifies an ES256 token against the project's JWKS", async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "ES256" };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }));

    const header = b64url(JSON.stringify({ alg: "ES256", kid: "test-kid", typ: "JWT" }));
    const body = b64url(JSON.stringify(validPayload()));
    const sig = crypto.sign(
      "sha256",
      Buffer.from(`${header}.${body}`),
      { key: privateKey, dsaEncoding: "ieee-p1363" }
    );
    const token = `${header}.${body}.${b64url(sig)}`;

    expect(await verifyAccessToken(token)).toMatchObject({ email: "lifter@example.com" });
    fetchMock.mockRestore();
  });

  it("returns null (deferring to the network path) when the JWKS is unreachable", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const header = b64url(JSON.stringify({ alg: "ES256", kid: "unknown-kid", typ: "JWT" }));
    const body = b64url(JSON.stringify(validPayload()));
    expect(await verifyAccessToken(`${header}.${body}.${b64url("sig")}`)).toBeNull();
    fetchMock.mockRestore();
  });
});
