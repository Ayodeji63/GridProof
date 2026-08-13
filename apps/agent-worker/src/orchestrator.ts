import type { CandidateEvent, EvidenceEvent, Provider } from "@gridproof/shared-types";
import {
  collectAgentToolContext,
  runAnomalyAnalysisAgent,
  runVerificationAgent,
  type AgentToolQuery,
  type AnomalyAnalysisOutput,
  type LlmClientOptions,
  type VerificationOutput
} from "@gridproof/ai";

export type OrchestrationInput = {
  candidate: CandidateEvent;
  evidence: EvidenceEvent[];
  providers: Provider[];
  simulation?: {
    runId: string;
    initiatedBy: string;
    allowChainWrite: boolean;
  };
};

export type OrchestrationResult =
  | {
      outcome: "agent_decision";
      analysis: AnomalyAnalysisOutput;
      decision: VerificationOutput;
    }
  | {
      outcome: "escalate";
      reason: string;
    };

export async function orchestrateCandidateReview(
  input: OrchestrationInput,
  analysisOptions: LlmClientOptions,
  verificationOptions: LlmClientOptions,
  toolQuery?: AgentToolQuery
): Promise<OrchestrationResult> {
  try {
    const context = toolQuery
      ? {
          ...input,
          toolContext: await collectAgentToolContext(toolQuery, input.candidate, input.providers)
        }
      : input;
    const analysis = await runAnomalyAnalysisAgent(analysisOptions, context);
    const decision = await runVerificationAgent(verificationOptions, context, analysis);

    if (decision.decision === "approve" && decision.finalConfidence < 0.85) {
      return { outcome: "escalate", reason: "Agent attempted low-confidence approval" };
    }

    return { outcome: "agent_decision", analysis, decision };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown agent failure";
    return { outcome: "escalate", reason: message };
  }
}
