import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { CandidateEvent, EvidenceEvent, Provider } from "@gridproof/shared-types";
import { logger } from "../../lib/logger.js";

export const AGENT_REVIEW_QUEUE = "agent-review";

export type AgentReviewJob = {
  candidate: CandidateEvent;
  evidence: EvidenceEvent[];
  providers: Provider[];
};

export type QueuedJobRecord = {
  id: string;
  queueName: string;
  name: string;
  data: AgentReviewJob;
  backend: "bullmq" | "memory";
  createdAt: string;
};

const memoryJobs: QueuedJobRecord[] = [];
let agentReviewQueue: Queue<AgentReviewJob> | null = null;
let redisConnection: IORedis | null = null;
let redisUnavailable = false;

export async function enqueueAgentReviewJob(data: AgentReviewJob): Promise<QueuedJobRecord> {
  const queue = queueFromEnv();
  if (!queue) return enqueueMemoryJob(AGENT_REVIEW_QUEUE, "candidate-review", data);

  try {
    const job = await queue.add("candidate-review", data, {
      attempts: envInt("AGENT_REVIEW_QUEUE_ATTEMPTS", 2),
      backoff: {
        type: "exponential",
        delay: envInt("AGENT_REVIEW_QUEUE_BACKOFF_MS", 1000)
      },
      removeOnComplete: 100,
      removeOnFail: 500
    });

    return {
      id: String(job.id),
      queueName: AGENT_REVIEW_QUEUE,
      name: job.name,
      data,
      backend: "bullmq",
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    redisUnavailable = true;
    logger.warn({ err: error, queueName: AGENT_REVIEW_QUEUE }, "Falling back to in-memory job queue");
    return enqueueMemoryJob(AGENT_REVIEW_QUEUE, "candidate-review", data);
  }
}

export function listMemoryJobs(queueName?: string): QueuedJobRecord[] {
  return memoryJobs.filter((job) => !queueName || job.queueName === queueName);
}

export async function closeJobQueues(): Promise<void> {
  const queue = agentReviewQueue;
  const connection = redisConnection;
  agentReviewQueue = null;
  redisConnection = null;
  redisUnavailable = false;

  await queue?.close();
  await connection?.quit();
}

export function clearJobQueueStore(): void {
  memoryJobs.length = 0;
  redisUnavailable = false;
}

function queueFromEnv(): Queue<AgentReviewJob> | null {
  if (redisUnavailable) return null;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;
  if (process.env.NODE_ENV === "test" && process.env.JOB_QUEUE_USE_REDIS_FOR_TESTS !== "true") return null;

  if (!redisConnection) {
    redisConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      lazyConnect: true
    });
  }

  agentReviewQueue ??= new Queue<AgentReviewJob>(AGENT_REVIEW_QUEUE, {
    connection: redisConnection
  });

  return agentReviewQueue;
}

function enqueueMemoryJob(queueName: string, name: string, data: AgentReviewJob): QueuedJobRecord {
  const record: QueuedJobRecord = {
    id: `${queueName}:${memoryJobs.length + 1}`,
    queueName,
    name,
    data,
    backend: "memory",
    createdAt: new Date().toISOString()
  };
  memoryJobs.push(record);
  return record;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
