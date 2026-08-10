import { z } from "zod";

export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const uuidSchema = z.string().uuid();
export const walletAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Expected an EVM wallet address");
export const bytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Expected a bytes32 hex string");
export const txHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Expected a transaction hash");

export const userRoleSchema = z.enum(["public", "reporter", "reviewer", "admin"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const providerTypeSchema = z.enum(["sensor", "reporter"]);
export type ProviderType = z.infer<typeof providerTypeSchema>;

export const evidenceStatusSchema = z.enum(["grid_up", "grid_down", "unknown"]);
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;

export const candidateStatusSchema = z.enum(["outage", "restored"]);
export type CandidateStatus = z.infer<typeof candidateStatusSchema>;

export const agentDecisionStatusSchema = z.enum(["approve", "escalate", "reject"]);
export type AgentDecisionStatus = z.infer<typeof agentDecisionStatusSchema>;

export const chainCommitmentStatusSchema = z.enum(["pending", "confirmed", "failed"]);
export type ChainCommitmentStatus = z.infer<typeof chainCommitmentStatusSchema>;

export const userSchema = z.object({
  id: uuidSchema,
  role: userRoleSchema,
  phoneOrEmail: z.string().min(3),
  createdAt: isoDateTimeSchema
});
export type User = z.infer<typeof userSchema>;

export const zoneSchema = z.object({
  id: uuidSchema,
  zoneKey: bytes32Schema,
  name: z.string().min(1),
  discosFeederCode: z.string().min(1),
  region: z.string().min(1),
  centroid: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180)
  })
});
export type Zone = z.infer<typeof zoneSchema>;

export const providerSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema.nullable(),
  walletAddress: walletAddressSchema,
  providerType: providerTypeSchema,
  zoneId: uuidSchema,
  reputationCache: z.number().int(),
  active: z.boolean(),
  lastSeenAt: isoDateTimeSchema.nullable().optional()
});
export type Provider = z.infer<typeof providerSchema>;

export const evidenceEventSchema = z.object({
  id: uuidSchema,
  providerId: uuidSchema,
  zoneId: uuidSchema,
  idempotencyKey: z.string().min(12),
  source: providerTypeSchema,
  status: evidenceStatusSchema,
  voltage: z.number().nonnegative().nullable().optional(),
  confidenceHint: z.number().min(0).max(1).nullable().optional(),
  rawPayload: z.record(z.unknown()),
  observedAt: isoDateTimeSchema,
  receivedAt: isoDateTimeSchema
});
export type EvidenceEvent = z.infer<typeof evidenceEventSchema>;

export const candidateEventSchema = z.object({
  id: uuidSchema,
  zoneId: uuidSchema,
  status: candidateStatusSchema,
  confidence: z.number().min(0).max(1),
  windowStart: isoDateTimeSchema,
  windowEnd: isoDateTimeSchema,
  evidenceEventIds: z.array(uuidSchema).min(1),
  createdAt: isoDateTimeSchema
});
export type CandidateEvent = z.infer<typeof candidateEventSchema>;

export const agentDecisionSchema = z.object({
  id: uuidSchema,
  candidateEventId: uuidSchema,
  agentName: z.string().min(1),
  confidence: z.number().min(0).max(1),
  decision: agentDecisionStatusSchema,
  hypothesis: z.string().min(1),
  supportingEvidenceIds: z.array(uuidSchema),
  notificationDraft: z.string().optional(),
  reasoningTrace: z.record(z.unknown()),
  createdAt: isoDateTimeSchema
});
export type AgentDecision = z.infer<typeof agentDecisionSchema>;

export const epochScoreSchema = z.object({
  id: uuidSchema,
  zoneId: uuidSchema,
  epochStart: isoDateTimeSchema,
  uptimeBps: z.number().int().min(0).max(10_000),
  evidenceHash: bytes32Schema,
  createdAt: isoDateTimeSchema
});
export type EpochScore = z.infer<typeof epochScoreSchema>;

export const chainCommitmentSchema = z.object({
  id: uuidSchema,
  epochScoreId: uuidSchema,
  txHash: txHashSchema.nullable(),
  blockNumber: z.number().int().nonnegative().nullable(),
  status: chainCommitmentStatusSchema,
  explorerUrl: z.string().url().nullable(),
  createdAt: isoDateTimeSchema,
  confirmedAt: isoDateTimeSchema.nullable()
});
export type ChainCommitment = z.infer<typeof chainCommitmentSchema>;

export const auditLogSchema = z.object({
  id: uuidSchema,
  actorUserId: uuidSchema.nullable(),
  subjectProviderId: uuidSchema.nullable(),
  action: z.string().min(1),
  before: z.record(z.unknown()).nullable(),
  after: z.record(z.unknown()).nullable(),
  createdAt: isoDateTimeSchema
});
export type AuditLog = z.infer<typeof auditLogSchema>;
