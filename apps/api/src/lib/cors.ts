import type { CorsOptions } from "cors";

const LOCAL_DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export type GridProofCorsConfig = {
  origins: string[];
  source: "configured" | "local-default";
};

export function getCorsConfig(env: NodeJS.ProcessEnv = process.env): GridProofCorsConfig {
  const raw = env.CORS_ORIGINS ?? env.CORS_ORIGIN;
  const configuredOrigins = raw ? parseCorsOrigins(raw) : [];

  if (configuredOrigins.length > 0) {
    return { origins: configuredOrigins, source: "configured" };
  }

  if (env.NODE_ENV === "production") {
    throw Object.assign(new Error("CORS_ORIGINS must be configured in production"), {
      code: "CORS_ORIGINS_REQUIRED"
    });
  }

  return { origins: LOCAL_DEV_ORIGINS, source: "local-default" };
}

export function corsOptionsFromConfig(config: GridProofCorsConfig): CorsOptions {
  return {
    origin(origin, callback) {
      if (isCorsOriginAllowed(config, origin)) {
        callback(null, origin ?? false);
        return;
      }

      callback(null, false);
    }
  };
}

export function isCorsOriginAllowed(config: GridProofCorsConfig, origin: string | undefined): boolean {
  if (!origin) return true;
  return config.origins.includes(origin);
}

function parseCorsOrigins(raw: string): string[] {
  const origins = raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);

  if (origins.includes("*")) {
    throw Object.assign(new Error("Wildcard CORS origins are not allowed; list deployed frontend origins explicitly"), {
      code: "CORS_WILDCARD_FORBIDDEN"
    });
  }

  const invalidOrigin = origins.find((origin) => !/^https?:\/\/[^/]+(?::\d+)?$/.test(origin));
  if (invalidOrigin) {
    throw Object.assign(new Error(`Invalid CORS origin: ${invalidOrigin}`), {
      code: "CORS_ORIGIN_INVALID"
    });
  }

  return Array.from(new Set(origins));
}
