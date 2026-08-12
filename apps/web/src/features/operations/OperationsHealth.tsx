import { Activity, AlertTriangle, DatabaseZap, Gauge, ShieldCheck, Timer } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { apiClient } from "../../lib/api-client.js";
import { formatGridProofDateTime } from "../../lib/date-time.js";

export function OperationsHealth() {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: apiClient.health,
    retry: 1,
    refetchInterval: 30_000
  });
  const metricsQuery = useQuery({
    queryKey: ["metrics"],
    queryFn: apiClient.metrics,
    retry: 1,
    refetchInterval: 30_000
  });
  const readinessQuery = useQuery({
    queryKey: ["readiness"],
    queryFn: apiClient.readiness,
    retry: 1,
    refetchInterval: 30_000
  });

  const health = healthQuery.data;
  const metrics = metricsQuery.data;
  const readiness = readinessQuery.data;
  const counters = metrics?.counters;

  return (
    <main className="shell">
      <section className="topbar" aria-label="Operations health heading">
        <div>
          <p className="eyebrow">Observability</p>
          <h1>Operations Health</h1>
        </div>
        <div className="health-pill">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>{health?.ok ? "API healthy" : healthQuery.isError ? "API unavailable" : "Checking API"}</span>
        </div>
      </section>

      {healthQuery.isLoading || metricsQuery.isLoading ? <p className="status-message">Loading system health…</p> : null}
      {healthQuery.isError ? <p className="status-message error">Could not load API health.</p> : null}
      {metricsQuery.isError ? <p className="status-message error">Could not load API metrics.</p> : null}
      {readinessQuery.isError ? <p className="status-message error">Could not load deployment readiness.</p> : null}

      <section className="metrics-grid" aria-label="API health metrics">
        <Metric label="Service" value={health?.service ?? "Unknown"} icon={<DatabaseZap size={18} />} />
        <Metric label="Version" value={health?.version ?? "Pending"} icon={<Gauge size={18} />} />
        <Metric label="Uptime" value={metrics ? formatUptime(metrics.uptimeSeconds) : "Pending"} icon={<Timer size={18} />} />
        <Metric label="Readiness" value={readiness?.status ?? "Pending"} icon={<ShieldCheck size={18} />} />
      </section>

      <section className="dashboard-grid">
        <section className="zone-panel" aria-label="Pipeline counters">
          <p className="eyebrow">Pipeline counters</p>
          <h2>Current process totals</h2>
          <dl>
            <Counter label="Evidence ingested" value={counters?.evidenceIngested} />
            <Counter label="Candidates detected" value={counters?.candidatesDetected} />
            <Counter label="Agent decisions" value={counters?.agentDecisions} />
            <Counter label="Chain submissions" value={counters?.chainSubmissions} />
            <Counter label="Failures" value={counters?.failures} />
          </dl>
        </section>

        <section className="zone-panel" aria-label="Health snapshot">
          <p className="eyebrow">Health snapshot</p>
          <h2>Runtime status</h2>
          <dl>
            <div>
              <dt>Last health check</dt>
              <dd>{health?.timestamp ? <time dateTime={health.timestamp}>{formatGridProofDateTime(health.timestamp)}</time> : "Pending"}</dd>
            </div>
            <div>
              <dt>Health endpoint</dt>
              <dd>{healthQuery.isError ? "failed" : health?.ok ? "ok" : "pending"}</dd>
            </div>
            <div>
              <dt>Metrics endpoint</dt>
              <dd>{metricsQuery.isError ? "failed" : metrics ? "ok" : "pending"}</dd>
            </div>
          </dl>
          {counters && counters.failures > 0 ? (
            <p className="status-message error">
              <AlertTriangle size={18} aria-hidden="true" /> Failures have been recorded in this process.
            </p>
          ) : (
            <p className="status-message">
              <Activity size={18} aria-hidden="true" /> No failures reported by the current API process.
            </p>
          )}
        </section>

        <section className="zone-panel" aria-label="Deployment readiness">
          <p className="eyebrow">Deployment readiness</p>
          <h2>Demo-critical configuration</h2>
          {readiness ? (
            <dl>
              {readiness.checks.map((check) => (
                <div key={check.name}>
                  <dt>{humanizeCheckName(check.name)}</dt>
                  <dd>
                    {check.status}
                    {check.missingEnv.length > 0 ? ` — missing ${check.missingEnv.join(", ")}` : ""}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="status-message">Readiness checks pending.</p>
          )}
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="metric">
      <span className="metric-icon">{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value == null ? "Pending" : value.toString()}</dd>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function humanizeCheckName(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
