import { z } from "zod";
import {
  agentDecisionSchema,
  agentDecisionStatusSchema,
  bytes32Schema,
  candidateEventSchema,
  candidateStatusSchema,
  chainCommitmentSchema,
  epochScoreSchema,
  evidenceEventSchema,
  evidenceStatusSchema,
  isoDateTimeSchema,
  providerSchema,
  providerTypeSchema,
  txHashSchema,
  userSchema,
  userRoleSchema,
  uuidSchema,
  walletAddressSchema,
  zoneSchema
} from "./domain.js";

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("gridproof-api"),
  version: z.string(),
  timestamp: z.string().datetime({ offset: true })
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const metricsResponseSchema = z.object({
  uptimeSeconds: z.number().nonnegative(),
  counters: z.object({
    evidenceIngested: z.number().int().nonnegative(),
    candidatesDetected: z.number().int().nonnegative(),
    agentDecisions: z.number().int().nonnegative(),
    chainSubmissions: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative()
  })
});
export type MetricsResponse = z.infer<typeof metricsResponseSchema>;

export const readinessCheckStatusSchema = z.enum(["pass", "warn", "fail"]);
export type ReadinessCheckStatus = z.infer<typeof readinessCheckStatusSchema>;

export const readinessResponseSchema = z.object({
  ok: z.boolean(),
  service: z.literal("gridproof-api"),
  status: z.enum(["ready", "degraded", "not_ready"]),
  timestamp: z.string().datetime({ offset: true }),
  checks: z.array(
    z.object({
      name: z.string().min(1),
      status: readinessCheckStatusSchema,
      required: z.boolean(),
      message: z.string().min(1),
      missingEnv: z.array(z.string().min(1)).default([])
    })
  )
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

export const authMeResponseSchema = z.object({
  user: userSchema.nullable()
});
export type AuthMeResponse = z.infer<typeof authMeResponseSchema>;

export const authRegisterRequestSchema = z.object({
  phoneOrEmail: z.string().min(3),
  role: userRoleSchema.exclude(["public"]).default("reporter"),
  inviteCode: z.string().min(1).optional()
});
export type AuthRegisterRequest = z.infer<typeof authRegisterRequestSchema>;

export const authLoginRequestSchema = z.object({
  phoneOrEmail: z.string().min(3)
});
export type AuthLoginRequest = z.infer<typeof authLoginRequestSchema>;

export const authSessionResponseSchema = z.object({
  user: userSchema,
  token: z.string().min(20),
  expiresAt: isoDateTimeSchema
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export const telemetryIngestRequestSchema = z.object({
  deviceId: z.string().min(3),
  providerWallet: walletAddressSchema,
  zoneId: uuidSchema,
  idempotencyKey: z.string().min(12),
  observedAt: z.string().datetime({ offset: true }),
  status: evidenceStatusSchema,
  voltage: z.number().nonnegative().optional(),
  currentAmps: z.number().nonnegative().optional(),
  signature: z.string().min(32)
});
export type TelemetryIngestRequest = z.infer<typeof telemetryIngestRequestSchema>;

export const reporterIngestRequestSchema = z.object({
  reporterWallet: walletAddressSchema,
  zoneId: uuidSchema,
  idempotencyKey: z.string().min(12),
  observedAt: z.string().datetime({ offset: true }),
  status: evidenceStatusSchema,
  note: z.string().max(1000).optional()
});
export type ReporterIngestRequest = z.infer<typeof reporterIngestRequestSchema>;

export const whatsappWebhookRequestSchema = z.object({
  source: z.enum(["whatsapp_cloud", "twilio", "demo"]).default("demo"),
  messageId: z.string().min(6),
  fromPhone: z.string().min(6).max(32),
  reporterWallet: walletAddressSchema,
  zoneId: uuidSchema,
  observedAt: z.string().datetime({ offset: true }).optional(),
  text: z.string().min(1).max(1000),
  status: evidenceStatusSchema.optional()
});
export type WhatsAppWebhookRequest = z.infer<typeof whatsappWebhookRequestSchema>;

export const ingestResponseSchema = z.object({
  accepted: z.literal(true),
  duplicate: z.boolean(),
  evidenceEvent: evidenceEventSchema,
  candidateEvent: candidateEventSchema.nullable()
});
export type IngestResponse = z.infer<typeof ingestResponseSchema>;

export const zonesResponseSchema = z.object({
  zones: z.array(
    zoneSchema.extend({
      latestStatus: evidenceStatusSchema,
      latestUptimeBps: z.number().int().min(0).max(10_000).nullable(),
      latestVoltage: z.number().nonnegative().nullable().optional(),
      latestCurrentAmps: z.number().nonnegative().nullable().optional()
    })
  )
});
export type ZonesResponse = z.infer<typeof zonesResponseSchema>;

export const zoneHistoryResponseSchema = z.object({
  zone: zoneSchema,
  candidates: z.array(candidateEventSchema),
  epochScores: z.array(epochScoreSchema),
  trend: z.enum(["improving", "stable", "declining"])
});
export type ZoneHistoryResponse = z.infer<typeof zoneHistoryResponseSchema>;

export const proofParamsSchema = z.object({
  zoneId: uuidSchema.or(bytes32Schema),
  epoch: z.string().min(1)
});

export const proofResponseSchema = z.object({
  epochScore: epochScoreSchema.nullable(),
  commitment: chainCommitmentSchema.nullable()
});
export type ProofResponse = z.infer<typeof proofResponseSchema>;

export const reviewQueueResponseSchema = z.object({
  items: z.array(
    agentDecisionSchema.extend({
      candidate: candidateEventSchema
    })
  )
});
export type ReviewQueueResponse = z.infer<typeof reviewQueueResponseSchema>;

export const reviewDecisionRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().min(1).max(2000)
});
export type ReviewDecisionRequest = z.infer<typeof reviewDecisionRequestSchema>;

export const reviewDecisionResponseSchema = z.object({
  accepted: z.literal(true),
  reviewId: uuidSchema,
  decision: agentDecisionSchema,
  epochScore: epochScoreSchema.nullable(),
  commitment: chainCommitmentSchema.nullable()
});
export type ReviewDecisionResponse = z.infer<typeof reviewDecisionResponseSchema>;

export const providersResponseSchema = z.object({
  providers: z.array(providerSchema)
});
export type ProvidersResponse = z.infer<typeof providersResponseSchema>;

export const registerProviderRequestSchema = z.object({
  walletAddress: walletAddressSchema,
  providerType: providerTypeSchema,
  zoneId: uuidSchema
});
export type RegisterProviderRequest = z.infer<typeof registerProviderRequestSchema>;

export const providerTypeIdSchema = z.union([z.literal(0), z.literal(1)]);

export const providerChainRegistrationSchema = z.object({
  configured: z.boolean(),
  mode: z.literal("wallet_self_service"),
  chainId: z.string().min(1).nullable(),
  contractAddress: walletAddressSchema.nullable(),
  explorerUrl: z.string().url().nullable(),
  providerWallet: walletAddressSchema,
  providerType: providerTypeSchema,
  providerTypeId: providerTypeIdSchema,
  zoneId: uuidSchema,
  zoneKey: bytes32Schema,
  registerCall: z.object({
    to: walletAddressSchema.nullable(),
    functionName: z.literal("register"),
    args: z.tuple([bytes32Schema, providerTypeIdSchema]),
    data: z.string().regex(/^0x[a-fA-F0-9]*$/).nullable()
  }),
  onChain: z.object({
    active: z.boolean(),
    zoneKey: bytes32Schema,
    providerTypeId: providerTypeIdSchema,
    matchesRequest: z.boolean(),
    checkedAt: isoDateTimeSchema
  }).nullable(),
  reason: z.string().optional()
});
export type ProviderChainRegistration = z.infer<typeof providerChainRegistrationSchema>;

export const registerProviderResponseSchema = z.object({
  provider: providerSchema,
  duplicate: z.boolean(),
  chainRegistration: providerChainRegistrationSchema
});
export type RegisterProviderResponse = z.infer<typeof registerProviderResponseSchema>;

export const notificationRecordSchema = z.object({
  id: uuidSchema,
  kind: z.enum(["review_required", "chain_committed"]),
  audience: z.enum(["reviewer", "operator", "public"]),
  channel: z.enum(["outbox", "webhook"]),
  title: z.string().min(1),
  message: z.string().min(1),
  payload: z.record(z.unknown()),
  status: z.enum(["queued", "sent", "failed"]),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  sentAt: z.string().datetime({ offset: true }).nullable()
});
export type NotificationRecord = z.infer<typeof notificationRecordSchema>;

export const notificationsResponseSchema = z.object({
  notifications: z.array(notificationRecordSchema)
});
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;

export const demoScenarioSchema = z.enum(["ambiguous_outage", "confirmed_outage", "restoration"]);
export type DemoScenario = z.infer<typeof demoScenarioSchema>;

export const demoWalletChallengeRequestSchema = z.object({
  walletAddress: walletAddressSchema,
  zoneId: uuidSchema,
  scenario: demoScenarioSchema,
  publishToChain: z.boolean().default(false)
});
export type DemoWalletChallengeRequest = z.infer<typeof demoWalletChallengeRequestSchema>;

export const demoWalletChallengeResponseSchema = z.object({
  nonce: uuidSchema,
  message: z.string().min(1),
  expiresAt: isoDateTimeSchema,
  chainMode: z.enum(["preview", "live"])
});
export type DemoWalletChallengeResponse = z.infer<typeof demoWalletChallengeResponseSchema>;

export const demoSimulationRequestSchema = z.object({
  walletAddress: walletAddressSchema,
  nonce: uuidSchema,
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, "Expected a wallet signature"),
  zoneId: uuidSchema,
  scenario: demoScenarioSchema,
  publishToChain: z.boolean().default(false)
});
export type DemoSimulationRequest = z.infer<typeof demoSimulationRequestSchema>;

const demoDecisionSchema = z.object({
  agentName: z.string().min(1),
  decision: agentDecisionStatusSchema,
  confidence: z.number().min(0).max(1),
  hypothesis: z.string().min(1),
  createdAt: isoDateTimeSchema
});

export const demoSimulationSchema = z.object({
  id: uuidSchema,
  initiatedBy: walletAddressSchema,
  scenario: demoScenarioSchema,
  zoneId: uuidSchema,
  createdAt: isoDateTimeSchema,
  stage: z.enum(["telemetry_accepted", "ai_queued", "ai_complete", "proof_preview", "chain_pending", "chain_confirmed", "chain_failed"]),
  telemetry: z.object({
    evidenceId: uuidSchema,
    deviceId: z.string().min(1),
    status: evidenceStatusSchema,
    voltage: z.number().nonnegative(),
    currentAmps: z.number().nonnegative(),
    observedAt: isoDateTimeSchema
  }),
  candidate: z.object({
    id: uuidSchema,
    status: candidateStatusSchema,
    confidence: z.number().min(0).max(1)
  }),
  policyDecision: demoDecisionSchema,
  aiDecision: demoDecisionSchema.nullable(),
  agentState: z.enum(["not_required", "queued", "complete"]),
  chain: z.object({
    mode: z.enum(["preview", "live"]),
    status: z.enum(["not_requested", "preview", "pending", "confirmed", "failed"]),
    txHash: txHashSchema.nullable(),
    explorerUrl: z.string().url().nullable()
  })
});
export type DemoSimulation = z.infer<typeof demoSimulationSchema>;

export const demoSimulationResponseSchema = z.object({
  simulation: demoSimulationSchema
});
export type DemoSimulationResponse = z.infer<typeof demoSimulationResponseSchema>;

export const alertItemSchema = z.object({
  id: uuidSchema,
  candidateEventId: uuidSchema,
  zoneId: uuidSchema,
  status: candidateStatusSchema,
  confidence: z.number().min(0).max(1),
  decision: agentDecisionStatusSchema,
  hypothesis: z.string().min(1),
  supportingEvidenceIds: z.array(uuidSchema),
  review: z.object({
    initialDecision: agentDecisionStatusSchema,
    decision: z.enum(["approve", "reject"]),
    note: z.string().min(1),
    reviewedAt: z.string().datetime({ offset: true }).nullable()
  }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  candidateCreatedAt: z.string().datetime({ offset: true })
});
export type AlertItem = z.infer<typeof alertItemSchema>;

export const alertsResponseSchema = z.object({
  alerts: z.array(alertItemSchema)
});
export type AlertsResponse = z.infer<typeof alertsResponseSchema>;

export const chainSubmissionRequestSchema = z.object({
  zoneId: uuidSchema,
  epochStart: z.string().datetime({ offset: true }),
  uptimeBps: z.number().int().min(0).max(10_000),
  evidenceHash: bytes32Schema,
  idempotencyKey: z.string().min(12)
});
export type ChainSubmissionRequest = z.infer<typeof chainSubmissionRequestSchema>;

export const chainSubmissionResponseSchema = z.object({
  status: z.enum(["queued", "duplicate"]),
  txHash: txHashSchema.nullable()
});
export type ChainSubmissionResponse = z.infer<typeof chainSubmissionResponseSchema>;
