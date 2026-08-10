import "dotenv/config";
import { createServer, type Server } from "node:http";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { Pool } from "pg";
import pino from "pino";
import type { AgentToolQuery } from "@gridproof/ai";
import { orchestrateCandidateReview } from "./orchestrator.js";
import { workerReadinessSnapshot } from "./readiness.js";
import { persistOrchestrationResult } from "./result-sink.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const redisUrl = process.env.REDIS_URL;
const healthPort = Number(process.env.HEALTH_PORT ?? process.env.PORT ?? 4101);
let healthServer: Server | undefined;
let worker: Worker | undefined;
let workerReady = false;

if (!redisUrl) {
  logger.error("REDIS_URL is required for the agent worker; the API can use memory fallback, but workers need Redis/BullMQ durability");
  process.exitCode = 1;
} else {
  healthServer = startHealthServer(healthPort);

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null
  });
  const toolQuery = readOnlyToolQueryFromEnv();

  const analysisOptions = {
    baseUrl: process.env.LLM_BASE_URL ?? "http://localhost:3040",
    apiKey: process.env.LLM_API_KEY ?? "",
    model: process.env.LLM_ANALYSIS_MODEL ?? "fast-free-model",
    timeoutMs: 8_000
  };

  const verificationOptions = {
    ...analysisOptions,
    model: process.env.LLM_VERIFICATION_MODEL ?? "strong-free-model"
  };

  worker = new Worker(
    "agent-review",
    async (job) => {
      const result = await orchestrateCandidateReview(job.data, analysisOptions, verificationOptions, toolQuery);
      const persistence = await persistOrchestrationResult(job.data, result);
      logger.info({ jobId: job.id, result, persistence }, "Processed candidate review");
      return { ...result, persistence };
    },
    { connection }
  );

  worker.on("error", (error) => {
    workerReady = false;
    logger.error({ error }, "Agent worker queue error");
  });

  workerReady = true;
  logger.info("GridProof agent worker listening for candidate reviews");
}

function startHealthServer(port: number): Server {
  const server = createServer((req, res) => {
    if (req.url === "/readiness") {
      const readiness = workerReadinessSnapshot(process.env, workerReady);
      res.writeHead(readiness.ok ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify(readiness));
      return;
    }

    if (req.url !== "/health") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }

    const status = workerReady ? 200 : 503;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: workerReady,
        service: "gridproof-agent-worker",
        timestamp: new Date().toISOString()
      })
    );
  });

  server.listen(port, () => {
    logger.info({ port }, "GridProof agent worker health server listening");
  });

  return server;
}

function readOnlyToolQueryFromEnv(): AgentToolQuery | undefined {
  if (!process.env.DATABASE_URL) return undefined;

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  return async <T = unknown>(text: string, values: readonly unknown[] = []) => {
    if (!text.trimStart().toLowerCase().startsWith("select")) {
      throw new Error("Agent tools are read-only and may only execute SELECT queries");
    }

    const result = await pool.query(text, [...values]);
    return { rows: result.rows as T[] };
  };
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, "Shutting down GridProof agent worker");
  workerReady = false;
  await worker?.close();
  healthServer?.close();
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM").finally(() => process.exit(0));
});

process.on("SIGINT", () => {
  void shutdown("SIGINT").finally(() => process.exit(0));
});
