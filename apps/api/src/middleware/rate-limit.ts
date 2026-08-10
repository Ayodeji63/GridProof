import net from "node:net";
import tls from "node:tls";
import type { Request, RequestHandler } from "express";
import { logger } from "../lib/logger.js";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 60;
const redisFallbackKeys = new Set<string>();
const memoryCounters = new Map<string, { count: number; resetAt: number }>();

export type RateLimitOptions = {
  name: string;
  key: (req: Request) => string | null | undefined;
  max?: number;
  windowMs?: number;
};

export function rateLimit(options: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    const windowMs = options.windowMs ?? envInt("INGEST_RATE_LIMIT_WINDOW_MS", DEFAULT_WINDOW_MS);
    const max = options.max ?? envInt("INGEST_RATE_LIMIT_MAX", DEFAULT_MAX_REQUESTS);
    const identity = normalizeIdentity(options.key(req) ?? req.ip ?? req.socket.remoteAddress ?? "unknown");
    const bucket = Math.floor(Date.now() / windowMs);
    const key = `gridproof:rate-limit:${options.name}:${identity}:${bucket}`;

    try {
      const result = await incrementRateLimit(key, windowMs);
      const remaining = Math.max(0, max - result.count);
      res.setHeader("RateLimit-Limit", max.toString());
      res.setHeader("RateLimit-Remaining", remaining.toString());
      res.setHeader("RateLimit-Reset", Math.ceil(result.resetAt / 1000).toString());

      if (result.count > max) {
        res.setHeader("Retry-After", Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)).toString());
        return next(
          Object.assign(new Error("Rate limit exceeded"), {
            statusCode: 429,
            code: "RATE_LIMITED"
          })
        );
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function clearRateLimitStore(): void {
  memoryCounters.clear();
  redisFallbackKeys.clear();
}

async function incrementRateLimit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
  const redisEnabledInTest = process.env.NODE_ENV !== "test" || process.env.RATE_LIMIT_USE_REDIS_FOR_TESTS === "true";
  if (process.env.REDIS_URL && redisEnabledInTest && !redisFallbackKeys.has(key)) {
    try {
      const count = await incrementRedisCounter(process.env.REDIS_URL, key, windowMs);
      return { count, resetAt: bucketResetFor(windowMs) };
    } catch (error) {
      redisFallbackKeys.add(key);
      logger.warn({ err: error }, "Redis rate limiter unavailable; falling back to in-memory counter");
    }
  }

  return incrementMemoryCounter(key, windowMs);
}

function incrementMemoryCounter(key: string, windowMs: number): { count: number; resetAt: number } {
  const now = Date.now();
  const resetAt = bucketResetFor(windowMs);
  const current = memoryCounters.get(key);

  if (!current || current.resetAt <= now) {
    const next = { count: 1, resetAt };
    memoryCounters.set(key, next);
    return next;
  }

  current.count += 1;
  return current;
}

async function incrementRedisCounter(redisUrl: string, key: string, windowMs: number): Promise<number> {
  const url = new URL(redisUrl);
  const port = Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379));
  const host = url.hostname;
  const socket = url.protocol === "rediss:"
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });
  socket.setTimeout(envInt("REDIS_RATE_LIMIT_TIMEOUT_MS", 500));

  try {
    await socketReady(socket);

    if (url.password) {
      const authArgs = url.username ? ["AUTH", decodeURIComponent(url.username), decodeURIComponent(url.password)] : ["AUTH", decodeURIComponent(url.password)];
      await sendRedisCommand(socket, authArgs);
    }

    const count = Number(await sendRedisCommand(socket, ["INCR", key]));
    if (count === 1) {
      await sendRedisCommand(socket, ["PEXPIRE", key, windowMs.toString()]);
    }

    return count;
  } finally {
    socket.end();
  }
}

function socketReady(socket: net.Socket): Promise<void> {
  if (socket.readyState === "open") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("secureConnect", onConnect);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error("Redis rate-limit request timed out"));
    };

    socket.once("connect", onConnect);
    socket.once("secureConnect", onConnect);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
  });
}

function sendRedisCommand(socket: net.Socket, args: string[]): Promise<string | number> {
  socket.write(encodeRedisCommand(args));

  return new Promise((resolve, reject) => {
    const onData = (data: Buffer) => {
      cleanup();
      try {
        resolve(parseRedisReply(data.toString("utf8")));
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error("Redis rate-limit command timed out"));
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };

    socket.once("data", onData);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
  });
}

function encodeRedisCommand(args: string[]): string {
  return `*${args.length}\r\n${args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join("")}`;
}

function parseRedisReply(reply: string): string | number {
  const prefix = reply[0];
  const body = reply.slice(1, reply.indexOf("\r\n"));

  if (prefix === ":") return Number(body);
  if (prefix === "+") return body;
  if (prefix === "-") throw new Error(`Redis error: ${body}`);
  if (prefix === "$") {
    const [, value = ""] = reply.split("\r\n");
    return value;
  }

  throw new Error(`Unsupported Redis reply: ${reply}`);
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9:._-]/g, "_").slice(0, 160) || "unknown";
}

function bucketResetFor(windowMs: number): number {
  return (Math.floor(Date.now() / windowMs) + 1) * windowMs;
}

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
