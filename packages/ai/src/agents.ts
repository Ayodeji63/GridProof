import { z } from "zod";
import type { CandidateEvent, EvidenceEvent, Provider } from "@gridproof/shared-types";
import { completeJson, type LlmClientOptions } from "./llm-client.js";
import type { AgentToolContext } from "./tools.js";

export const anomalyAnalysisOutputSchema = z.object({
  hypothesis: z.string().min(1),
  confidence: z.number().min(0).max(1),
  supportingEvidenceIds: z.array(z.string().uuid())
});
export type AnomalyAnalysisOutput = z.infer<typeof anomalyAnalysisOutputSchema>;

export const verificationOutputSchema = z.object({
  decision: z.enum(["approve", "escalate", "reject"]),
  finalConfidence: z.number().min(0).max(1),
  notificationDraft: z.string().min(1)
});
export type VerificationOutput = z.infer<typeof verificationOutputSchema>;

export type AgentContext = {
  candidate: CandidateEvent;
  evidence: EvidenceEvent[];
  providers: Provider[];
  toolContext?: AgentToolContext;
};

export async function runAnomalyAnalysisAgent(options: LlmClientOptions, context: AgentContext) {
  return completeJson(options, [
    {
      role: "system",
      content:
        "You are GridProof's read-only Anomaly Analysis Agent. Explain ambiguous grid-uptime evidence. Never recommend blockchain writes."
    },
    {
      role: "user",
      content: JSON.stringify(context)
    }
  ], anomalyAnalysisOutputSchema);
}

export async function runVerificationAgent(
  options: LlmClientOptions,
  context: AgentContext,
  analysis: AnomalyAnalysisOutput
) {
  return completeJson(options, [
    {
      role: "system",
      content:
        "You are GridProof's Evidence Verification Agent. Return approve only when confidence is at least 0.85; escalate 0.5-0.85; reject below 0.5."
    },
    {
      role: "user",
      content: JSON.stringify({ context, analysis, policy: { approveAt: 0.85, escalateAt: 0.5 } })
    }
  ], verificationOutputSchema);
}
