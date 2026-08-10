import { logger } from "../../lib/logger.js";
import { domainEvents } from "../../lib/events.js";
import { counters } from "../../lib/metrics.js";
import { HEARTBEAT_GAP_MS, detectHeartbeatGapCandidates } from "../detection/heartbeat.js";
import { recordGapCandidate, listSweepEvidenceByZone } from "../ingestion/store.js";
import { processCandidatePipeline } from "./service.js";
import {
  isChainRelayerConfigured,
  submitPendingCommitments,
  indexPendingConfirmations
} from "../blockchain/service.js";

/**
 * How far back the heartbeat sweep looks for sensor evidence.
 *
 * Three gap-lengths is enough to detect both an open outage and one that closed
 * just before the sweep fired, without pulling unbounded history. A node that
 * went silent more than this ago is left to the next manual review cycle.
 */
const SWEEP_LOOKBACK_MS = 3 * HEARTBEAT_GAP_MS;

/**
 * How often the heartbeat sweep runs.
 *
 * One gap-length keeps the detection lag under a minute past the threshold.
 * Running it more often would not find earlier gaps — the threshold is the
 * binding constraint — and would just burn CPU re-deriving the same candidates.
 */
export const HEARTBEAT_SWEEP_INTERVAL_MS = HEARTBEAT_GAP_MS;

/**
 * How often the chain submission sweep runs.
 *
 * Pending commitments queue up as candidates are approved; submitting every
 * two minutes keeps the chain lag short without hammering a slow RPC endpoint.
 */
export const CHAIN_SUBMIT_INTERVAL_MS = 2 * 60 * 1000;

/**
 * How often the confirmation indexing sweep runs.
 *
 * BOT Chain blocks land in seconds; 30 s is generous. This runs more often
 * than submission so confirmations stay current for the demo dashboard.
 */
export const CHAIN_INDEX_INTERVAL_MS = 30 * 1000;

type TimerHandle = ReturnType<typeof setInterval>;

export type SchedulerHandles = {
  /** Whether the two chain sweeps were started. False when their env is absent. */
  chainSweepsEnabled: boolean;
  stopHeartbeatSweep: () => void;
  stopChainSubmit: () => void;
  stopChainIndex: () => void;
  stopAll: () => void;
};

/**
 * Whether a chain sweep could accomplish anything if it fired.
 *
 * Both sweeps read the `chain_commitments` table and need the relayer to sign, so
 * without a database *and* a configured relayer they can only report that they were
 * skipped. Checking up front keeps a demo or CI run from appending a skip entry to
 * the audit log every two minutes for the life of the process. The admin endpoints
 * in the dashboard module stay available either way, so no capability is lost.
 *
 * `env.DATABASE_URL` is the same signal as `isDatabaseConfigured()`, read through the
 * injected env so tests can exercise both branches without mutating the process.
 */
export function isChainSweepConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL) && isChainRelayerConfigured(env);
}

/**
 * Start the background sweeps that drive the core loop.
 *
 * The heartbeat sweep always runs: it works against the in-memory store as well as
 * Postgres, and it is what turns sensor silence into a candidate without waiting for
 * an inbound request. The chain sweeps start only when they have a database and a
 * relayer to work with.
 *
 * Nothing here throws to the timer — each sweep catches and logs — and nothing here
 * signs a transaction: submission stays inside the Blockchain Service relayer.
 *
 * Safe to call more than once in tests as long as each caller keeps and calls its own
 * `stopAll()` handle; there is no global singleton.
 */
export function startScheduler(env: NodeJS.ProcessEnv = process.env): SchedulerHandles {
  const heartbeatTimer = setInterval(runHeartbeatSweep, HEARTBEAT_SWEEP_INTERVAL_MS);

  const chainSweepsEnabled = isChainSweepConfigured(env);
  const submitTimer = chainSweepsEnabled ? setInterval(runChainSubmit, CHAIN_SUBMIT_INTERVAL_MS) : null;
  const indexTimer = chainSweepsEnabled ? setInterval(runChainIndex, CHAIN_INDEX_INTERVAL_MS) : null;

  // Unref so the scheduler timers do not prevent the Node process from exiting
  // cleanly in tests that import server.ts but do not call stopAll().
  heartbeatTimer.unref();
  submitTimer?.unref();
  indexTimer?.unref();

  if (!chainSweepsEnabled) {
    logger.info(
      {
        databaseConfigured: Boolean(env.DATABASE_URL),
        relayerConfigured: isChainRelayerConfigured(env)
      },
      "scheduler: chain sweeps disabled, admin endpoints still available"
    );
  }

  const stop = (timer: TimerHandle | null) => () => {
    if (timer) clearInterval(timer);
  };

  const stopHeartbeatSweep = stop(heartbeatTimer);
  const stopChainSubmit = stop(submitTimer);
  const stopChainIndex = stop(indexTimer);

  return {
    chainSweepsEnabled,
    stopHeartbeatSweep,
    stopChainSubmit,
    stopChainIndex,
    stopAll() {
      stopHeartbeatSweep();
      stopChainSubmit();
      stopChainIndex();
    }
  };
}

export type HeartbeatSweepResult = {
  zones: number;
  candidates: number;
  newCandidates: number;
};

/**
 * One pass of heartbeat-gap detection across every zone with recent sensor evidence.
 *
 * Exported so tests and the admin tooling can drive a single pass deterministically
 * instead of waiting on a timer. `recordGapCandidate` is what makes a repeated pass
 * harmless: it returns the candidate only when the gap was newly recorded, so the
 * pipeline runs exactly once per silence even across restarts and concurrent
 * instances.
 */
export async function runHeartbeatSweep(now: Date = new Date()): Promise<HeartbeatSweepResult> {
  const result: HeartbeatSweepResult = { zones: 0, candidates: 0, newCandidates: 0 };

  try {
    const byZone = await listSweepEvidenceByZone(SWEEP_LOOKBACK_MS, now);
    result.zones = byZone.size;
    if (byZone.size === 0) return result;

    for (const [zoneId, evidence] of byZone) {
      const candidates = detectHeartbeatGapCandidates(zoneId, evidence, { now });
      result.candidates += candidates.length;

      for (const candidate of candidates) {
        const recorded = await recordGapCandidate(candidate);
        if (!recorded) continue;

        result.newCandidates += 1;
        counters.candidatesDetected += 1;
        domainEvents.emit("candidate.detected", recorded);

        // A pipeline failure for one gap must not abandon the remaining zones.
        await processCandidatePipeline(recorded).catch((error: unknown) => {
          logger.error({ err: error, candidateId: recorded.id, zoneId }, "heartbeat sweep: pipeline error");
        });
      }
    }

    if (result.newCandidates > 0) {
      logger.info(result, "heartbeat sweep: new gap candidates detected");
    }
  } catch (error) {
    logger.error({ err: error }, "heartbeat sweep: unexpected error");
  }

  return result;
}

async function runChainSubmit(): Promise<void> {
  try {
    const result = await submitPendingCommitments();
    if (result.submitted > 0 || result.skipped > 0) {
      logger.info(result, "chain submit sweep");
    }
  } catch (error) {
    logger.error({ err: error }, "chain submit sweep: unexpected error");
  }
}

async function runChainIndex(): Promise<void> {
  try {
    const result = await indexPendingConfirmations();
    if (result.confirmed > 0 || result.failed > 0) {
      logger.info(result, "chain index sweep");
    }
  } catch (error) {
    logger.error({ err: error }, "chain index sweep: unexpected error");
  }
}
