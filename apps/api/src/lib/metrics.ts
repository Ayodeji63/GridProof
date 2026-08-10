const startedAt = Date.now();

export const counters = {
  evidenceIngested: 0,
  candidatesDetected: 0,
  agentDecisions: 0,
  chainSubmissions: 0,
  failures: 0
};

export function metricsSnapshot() {
  return {
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    counters: { ...counters }
  };
}

export function resetMetrics(): void {
  counters.evidenceIngested = 0;
  counters.candidatesDetected = 0;
  counters.agentDecisions = 0;
  counters.chainSubmissions = 0;
  counters.failures = 0;
}
