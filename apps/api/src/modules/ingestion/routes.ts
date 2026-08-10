import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import {
  ingestResponseSchema,
  reporterIngestRequestSchema,
  telemetryIngestRequestSchema,
  whatsappWebhookRequestSchema,
  type ReporterIngestRequest,
  type WhatsAppWebhookRequest
} from "@gridproof/shared-types";
import { domainEvents } from "../../lib/events.js";
import { counters } from "../../lib/metrics.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth } from "../auth/middleware.js";
import { processCandidatePipeline } from "../pipeline/service.js";
import { upsertReporterEvidence, upsertTelemetryEvidence } from "./store.js";

export const ingestionRouter = Router();

const DEFAULT_MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const EVIDENCE_MODES = ["sensor", "reporter", "hybrid"] as const;
type EvidenceMode = (typeof EVIDENCE_MODES)[number];
type EvidenceSource = "sensor" | "reporter";

ingestionRouter.post(
  "/telemetry",
  requireEvidenceSource("sensor"),
  rateLimit({ name: "telemetry", key: (req) => bodyString(req.body, "deviceId") }),
  validateBody(telemetryIngestRequestSchema),
  validateObservedAt,
  async (req, res, next) => {
    const hmacSecret = process.env.TELEMETRY_HMAC_SECRET;
    if (!hmacSecret && process.env.NODE_ENV === "production") {
      return next({
        statusCode: 500,
        code: "TELEMETRY_HMAC_SECRET_REQUIRED",
        message: "TELEMETRY_HMAC_SECRET must be configured in production before telemetry ingestion is accepted"
      });
    }

    if (hmacSecret && !isValidTelemetrySignature(req.body, hmacSecret)) {
      return next({
        statusCode: 401,
        code: "BAD_SIGNATURE",
        message: "Telemetry signature is invalid"
      });
    }

    try {
      const result = await upsertTelemetryEvidence(req.body);
      await publishIngestResult(result);
      res.status(result.duplicate ? 200 : 202).json(ingestResponseSchema.parse({ accepted: true, ...result }));
    } catch (error) {
      next(error);
    }
  }
);

ingestionRouter.post(
  "/report",
  requireEvidenceSource("reporter"),
  rateLimit({ name: "report", key: (req) => bodyString(req.body, "reporterWallet") }),
  requireAuth("reporter"),
  validateBody(reporterIngestRequestSchema),
  validateObservedAt,
  async (req, res, next) => {
    try {
      const result = await upsertReporterEvidence(req.body);
      await publishIngestResult(result);
      res.status(result.duplicate ? 200 : 202).json(ingestResponseSchema.parse({ accepted: true, ...result }));
    } catch (error) {
      next(error);
    }
  }
);

ingestionRouter.post(
  "/whatsapp-webhook",
  requireEvidenceSource("reporter"),
  rateLimit({ name: "whatsapp-webhook", key: (req) => bodyString(req.body, "reporterWallet") ?? bodyString(req.body, "fromPhone") }),
  validateWebhookSignature,
  validateBody(whatsappWebhookRequestSchema),
  validateObservedAt,
  async (req, res, next) => {
    try {
      const result = await upsertReporterEvidence(reporterInputFromWhatsapp(req.body));
      await publishIngestResult(result);
      res.status(result.duplicate ? 200 : 202).json(ingestResponseSchema.parse({ accepted: true, ...result }));
    } catch (error) {
      next(error);
    }
  }
);

function requireEvidenceSource(source: EvidenceSource) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    const mode = evidenceModeFromEnv();
    if (!mode) {
      return next({
        statusCode: 500,
        code: "EVIDENCE_MODE_INVALID",
        message: "GRIDPROOF_EVIDENCE_MODE must be one of sensor, reporter, or hybrid"
      });
    }

    if (!sourceAllowed(mode, source)) {
      return next({
        statusCode: 403,
        code: "EVIDENCE_SOURCE_DISABLED",
        message: `${source} ingestion is disabled while GRIDPROOF_EVIDENCE_MODE=${mode}`
      });
    }

    return next();
  };
}

function evidenceModeFromEnv(): EvidenceMode | null {
  const raw = process.env.GRIDPROOF_EVIDENCE_MODE?.trim().toLowerCase();
  if (!raw) return "hybrid";
  return (EVIDENCE_MODES as readonly string[]).includes(raw) ? (raw as EvidenceMode) : null;
}

function sourceAllowed(mode: EvidenceMode, source: EvidenceSource): boolean {
  return mode === "hybrid" || mode === source;
}

function bodyString(body: unknown, key: string): string | null {
  if (!body || typeof body !== "object" || !(key in body)) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function validateObservedAt(req: Request, _res: Response, next: NextFunction): void {
  const observedAt = bodyString(req.body, "observedAt");
  if (!observedAt) return next();

  const observedAtMs = Date.parse(observedAt);
  const now = Date.now();
  const maxEventAgeMs = positiveEnvInt("INGEST_MAX_EVENT_AGE_MS", DEFAULT_MAX_EVENT_AGE_MS);
  const maxClockSkewMs = positiveEnvInt("INGEST_MAX_CLOCK_SKEW_MS", DEFAULT_MAX_CLOCK_SKEW_MS);

  if (observedAtMs > now + maxClockSkewMs) {
    return next({
      statusCode: 400,
      code: "OBSERVED_AT_OUT_OF_RANGE",
      message: "observedAt is too far in the future"
    });
  }

  if (observedAtMs < now - maxEventAgeMs) {
    return next({
      statusCode: 400,
      code: "OBSERVED_AT_OUT_OF_RANGE",
      message: "observedAt is older than the accepted ingestion window"
    });
  }

  return next();
}

function validateWebhookSignature(req: Request, _res: Response, next: NextFunction): void {
  const webhookSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!webhookSecret && process.env.NODE_ENV === "production") {
    return next({
      statusCode: 500,
      code: "WHATSAPP_WEBHOOK_SECRET_REQUIRED",
      message: "WHATSAPP_WEBHOOK_SECRET must be configured in production before webhook reporter ingestion is accepted"
    });
  }

  if (webhookSecret && !isValidWebhookSignature(req, webhookSecret)) {
    return next({
      statusCode: 401,
      code: "BAD_WEBHOOK_SIGNATURE",
      message: "Webhook signature is invalid"
    });
  }

  return next();
}

function positiveEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function reporterInputFromWhatsapp(input: WhatsAppWebhookRequest): ReporterIngestRequest {
  return {
    reporterWallet: input.reporterWallet,
    zoneId: input.zoneId,
    idempotencyKey: `whatsapp:${input.source}:${input.messageId}`,
    observedAt: input.observedAt ?? new Date().toISOString(),
    status: input.status ?? inferStatusFromMessage(input.text),
    note: `[${input.source} ${input.fromPhone}] ${input.text}`
  };
}

function inferStatusFromMessage(text: string): "grid_up" | "grid_down" | "unknown" {
  const normalized = text.toLowerCase();
  if (/\b(down|outage|blackout|off|no power|no light|no electricity)\b/.test(normalized)) return "grid_down";
  if (/\b(up|back|restored|light|lights|power is on|electricity is on)\b/.test(normalized)) return "grid_up";
  return "unknown";
}

async function publishIngestResult(result: Awaited<ReturnType<typeof upsertTelemetryEvidence>>): Promise<void> {
  if (result.duplicate) return;

  counters.evidenceIngested += 1;
  domainEvents.emit("evidence.received", result.evidenceEvent);

  if (result.candidateEvent) {
    counters.candidatesDetected += 1;
    domainEvents.emit("candidate.detected", result.candidateEvent);
    await processCandidatePipeline(result.candidateEvent, result.evidenceEvent);
  }
}

function isValidTelemetrySignature(
  input: {
    deviceId: string;
    providerWallet: string;
    zoneId: string;
    idempotencyKey: string;
    observedAt: string;
    status: string;
    voltage?: number;
    signature: string;
  },
  secret: string
): boolean {
  const signedPayload = [
    input.deviceId,
    input.providerWallet.toLowerCase(),
    input.zoneId,
    input.idempotencyKey,
    input.observedAt,
    input.status,
    input.voltage ?? ""
  ].join(".");

  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
  const provided = input.signature.toLowerCase();

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
}

function isValidWebhookSignature(req: Request, secret: string): boolean {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const header = req.header("x-hub-signature-256");
  if (!rawBody || !header?.startsWith("sha256=")) return false;

  const provided = header.slice("sha256=".length).toLowerCase();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!/^[a-f0-9]{64}$/.test(provided) || provided.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
}
