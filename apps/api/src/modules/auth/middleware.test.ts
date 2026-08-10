import { createHmac } from "node:crypto";
import type { User, UserRole } from "@gridproof/shared-types";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionToken, verifyBearerToken } from "./middleware.js";

const LOCAL_DEV_JWT_SECRET = "gridproof-local-dev-jwt-secret";

describe("auth middleware JWT helpers", () => {
  afterEach(() => {
    delete process.env.GRIDPROOF_DEV_JWT_SECRET;
    delete process.env.SUPABASE_JWT_SECRET;
  });

  it("creates Supabase-compatible local sessions that verify back into users", () => {
    const user = userFixture({ role: "reporter", phoneOrEmail: "reporter@gridproof.test" });
    const session = createSessionToken(user);

    const auth = verifyBearerToken(session.token);

    expect(session.expiresAt).toEqual(expect.any(String));
    expect(auth.user).toMatchObject({
      id: user.id,
      role: "reporter",
      phoneOrEmail: "reporter@gridproof.test"
    });
  });

  it("rejects expired and not-yet-active tokens", () => {
    const user = userFixture({ role: "reviewer" });
    const expired = createSessionToken(user, -1).token;
    const notBefore = signJwt({
      sub: user.id,
      email: user.phoneOrEmail,
      nbf: Math.floor(Date.now() / 1000) + 60,
      app_metadata: { role: "reviewer" }
    });

    expect(() => verifyBearerToken(expired)).toThrow("expired");
    expect(() => verifyBearerToken(notBefore)).toThrow("not active yet");
  });

  it("falls back to public role and rejects tampered signatures", () => {
    const publicToken = signJwt({
      sub: "9277c519-8549-4b29-b504-cac3f97e45ea",
      email: "public@gridproof.test"
    });
    const tampered = `${publicToken.slice(0, -1)}${publicToken.endsWith("a") ? "b" : "a"}`;

    expect(verifyBearerToken(publicToken).user.role).toBe("public");
    expect(() => verifyBearerToken(tampered)).toThrow("signature");
  });
});

function userFixture(overrides: Partial<User> = {}): User {
  return {
    id: "9cc8a4f6-4df7-45b4-8c1e-a4381c47083a",
    role: "reporter",
    phoneOrEmail: "user@gridproof.test",
    createdAt: "2026-08-09T10:00:00.000Z",
    ...overrides
  };
}

function signJwt(payload: {
  sub: string;
  email?: string;
  phone?: string;
  role?: UserRole;
  exp?: number;
  nbf?: number;
  app_metadata?: { role?: UserRole };
  user_metadata?: { role?: UserRole };
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iat: now, exp: now + 3600, ...payload })).toString("base64url");
  const signature = createHmac("sha256", LOCAL_DEV_JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}
