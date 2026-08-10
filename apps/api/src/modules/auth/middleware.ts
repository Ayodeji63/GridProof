import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { User, UserRole } from "@gridproof/shared-types";
import { userRoleSchema, userSchema } from "@gridproof/shared-types";

const LOCAL_DEV_JWT_SECRET = "gridproof-local-dev-jwt-secret";
const ROLE_RANK: Record<UserRole, number> = {
  public: 0,
  reporter: 1,
  reviewer: 2,
  admin: 3
};

export type AuthContext = {
  user: User;
  tokenPayload: JwtPayload;
};

type RequestWithAuth = Request & {
  auth?: AuthContext;
};

type JwtPayload = {
  sub?: unknown;
  email?: unknown;
  phone?: unknown;
  role?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
  app_metadata?: unknown;
  user_metadata?: unknown;
};

type JwtHeader = {
  alg?: unknown;
  typ?: unknown;
};

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = bearerToken(req);
  if (!token) return next();

  try {
    setAuth(req, verifyBearerToken(token));
    return next();
  } catch (error) {
    return next(authError("UNAUTHENTICATED", error instanceof Error ? error.message : "Invalid bearer token", 401));
  }
}

export function requireAuth(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    const token = bearerToken(req);
    if (!token) {
      return next(authError("UNAUTHENTICATED", "A valid bearer token is required", 401));
    }

    try {
      const auth = verifyBearerToken(token);
      setAuth(req, auth);

      if (roles.length > 0 && !roles.some((role) => hasRole(auth.user.role, role))) {
        return next(authError("FORBIDDEN", "User role is not allowed to access this route", 403));
      }

      return next();
    } catch (error) {
      return next(authError("UNAUTHENTICATED", error instanceof Error ? error.message : "Invalid bearer token", 401));
    }
  };
}

export function currentAuth(req: Request): AuthContext | null {
  return (req as RequestWithAuth).auth ?? null;
}

export function verifyBearerToken(token: string): AuthContext {
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error("Bearer token must be a signed JWT");
  }

  const header = parseJwtPart<JwtHeader>(encodedHeader);
  if (header.alg !== "HS256") {
    throw new Error("Only HS256 Supabase-compatible JWTs are supported");
  }

  const signedPayload = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = base64Url(createHmac("sha256", jwtSecret()).update(signedPayload).digest());
  if (!safeEqual(signature, expectedSignature)) {
    throw new Error("Bearer token signature is invalid");
  }

  const payload = parseJwtPart<JwtPayload>(encodedPayload);
  assertTemporalClaims(payload);

  return {
    user: userFromPayload(payload),
    tokenPayload: payload
  };
}

export function createSessionToken(user: User, expiresInSeconds = 60 * 60): { token: string; expiresAt: string } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresInSeconds;
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlJson({
    sub: user.id,
    email: user.phoneOrEmail.includes("@") ? user.phoneOrEmail : undefined,
    phone: user.phoneOrEmail.includes("@") ? undefined : user.phoneOrEmail,
    iat: now,
    exp,
    app_metadata: {
      role: user.role
    }
  });
  const signature = base64Url(createHmac("sha256", jwtSecret()).update(`${header}.${payload}`).digest());

  return {
    token: `${header}.${payload}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

function setAuth(req: Request, auth: AuthContext): void {
  (req as RequestWithAuth).auth = auth;
}

function bearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function jwtSecret(): string {
  const configuredSecret = process.env.SUPABASE_JWT_SECRET ?? process.env.GRIDPROOF_DEV_JWT_SECRET;
  if (configuredSecret) return configuredSecret;
  if (process.env.NODE_ENV !== "production") return LOCAL_DEV_JWT_SECRET;
  throw new Error("SUPABASE_JWT_SECRET is not configured");
}

function parseJwtPart<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function assertTemporalClaims(payload: JwtPayload): void {
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp <= now) {
    throw new Error("Bearer token is expired");
  }
  if (typeof payload.nbf === "number" && payload.nbf > now) {
    throw new Error("Bearer token is not active yet");
  }
}

function userFromPayload(payload: JwtPayload): User {
  if (typeof payload.sub !== "string") {
    throw new Error("Bearer token is missing a subject");
  }

  return userSchema.parse({
    id: payload.sub,
    role: roleFromPayload(payload),
    phoneOrEmail: stringClaim(payload.email) ?? stringClaim(payload.phone) ?? payload.sub,
    createdAt: new Date((typeof payload.iat === "number" ? payload.iat : Math.floor(Date.now() / 1000)) * 1000).toISOString()
  });
}

function roleFromPayload(payload: JwtPayload): UserRole {
  const role =
    roleFromMetadata(payload.app_metadata) ??
    roleFromMetadata(payload.user_metadata) ??
    stringClaim(payload.role) ??
    "public";
  return userRoleSchema.catch("public").parse(role);
}

function roleFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || !("role" in metadata)) return null;
  return stringClaim((metadata as { role?: unknown }).role);
}

function stringClaim(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hasRole(actual: UserRole, required: UserRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function authError(code: "UNAUTHENTICATED" | "FORBIDDEN", message: string, statusCode: 401 | 403) {
  return Object.assign(new Error(message), { code, statusCode });
}
