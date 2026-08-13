import type { DemoScenario, DemoSimulation } from "@gridproof/shared-types";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Cpu,
  FlaskConical,
  Link2,
  RadioTower,
  ShieldCheck,
  WalletCards,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader.js";
import { apiClient } from "../../lib/api-client.js";
import { formatGridProofDateTime } from "../../lib/date-time.js";
import { connectInjectedWallet, signWalletMessage } from "../../lib/wallet.js";

const SCENARIOS: Array<{
  id: DemoScenario;
  name: string;
  description: string;
  reading: string;
  expectation: string;
}> = [
  {
    id: "ambiguous_outage",
    name: "Ambiguous outage",
    description: "Residual voltage creates uncertainty and sends the candidate to the AI worker.",
    reading: "72 V · 3.2 A",
    expectation: "AI review"
  },
  {
    id: "confirmed_outage",
    name: "Confirmed outage",
    description: "A zero-voltage, zero-current reading clears the deterministic approval threshold.",
    reading: "0 V · 0 A",
    expectation: "Auto-approve"
  },
  {
    id: "restoration",
    name: "Power restored",
    description: "Healthy feeder voltage and current produce a restoration candidate.",
    reading: "10.7 kV · 42 A",
    expectation: "Auto-approve"
  }
];

export function DemoLab() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState("");
  const [scenario, setScenario] = useState<DemoScenario>("ambiguous_outage");
  const [runId, setRunId] = useState<string | null>(null);
  const [initialSimulation, setInitialSimulation] = useState<DemoSimulation | null>(null);
  const [busy, setBusy] = useState<"wallet" | "simulation" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const zonesQuery = useQuery({ queryKey: ["zones"], queryFn: apiClient.zones, retry: 1 });
  const simulationQuery = useQuery({
    queryKey: ["demo-simulation", runId],
    queryFn: () => apiClient.demoSimulation(runId!),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const simulation = query.state.data?.simulation;
      return simulation?.agentState === "queued" || simulation?.chain.status === "pending" ? 2_000 : false;
    }
  });
  const zones = zonesQuery.data?.zones ?? [];
  const simulation = simulationQuery.data?.simulation ?? initialSimulation;
  const selectedScenario = useMemo(
    () => SCENARIOS.find((item) => item.id === scenario) ?? SCENARIOS[0]!,
    [scenario]
  );

  useEffect(() => {
    if (!zoneId && zones[0]) setZoneId(zones[0].id);
  }, [zoneId, zones]);

  async function connectWallet() {
    setBusy("wallet");
    setError(null);
    try {
      setWalletAddress(await connectInjectedWallet());
    } catch (connectError) {
      setError(errorMessage(connectError));
    } finally {
      setBusy(null);
    }
  }

  async function runSimulation() {
    if (!walletAddress || !zoneId) return;
    setBusy("simulation");
    setError(null);
    setRunId(null);
    setInitialSimulation(null);
    try {
      const challenge = await apiClient.demoWalletChallenge({ walletAddress });
      const signature = await signWalletMessage(walletAddress, challenge.message);
      const response = await apiClient.runDemoSimulation({
        walletAddress,
        nonce: challenge.nonce,
        signature,
        zoneId,
        scenario
      });
      setInitialSimulation(response.simulation);
      setRunId(response.simulation.id);
    } catch (simulationError) {
      setError(errorMessage(simulationError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="shell demo-lab-shell">
      <PageHeader
        title="Judge Demo Lab"
        description="Authorize a synthetic feeder reading, send it through GridProof, and inspect every decision from telemetry to proof."
        status={<div className="health-pill"><FlaskConical size={18} aria-hidden="true" /><span>Safe simulation</span></div>}
      />

      <section className="demo-safety-note" aria-label="Simulation safety">
        <ShieldCheck size={20} aria-hidden="true" />
        <div>
          <strong>No funds or wallet transaction required</strong>
          <p>Your signature authorizes one synthetic run. Demo evidence is marked and BOT Chain submission remains preview-only unless the server explicitly enables demo writes.</p>
        </div>
      </section>

      <div className="demo-relay">
        <section className="demo-controls" aria-labelledby="demo-controls-title">
          <div className="demo-section-heading">
            <span>Control rail</span>
            <h2 id="demo-controls-title">Set the grid condition</h2>
          </div>

          <div className="demo-control-step">
            <div className="demo-step-number">1</div>
            <div>
              <h3>Connect a judge wallet</h3>
              <p>The wallet proves who initiated the run without becoming a telemetry provider.</p>
              {walletAddress ? (
                <div className="demo-wallet-connected"><Check size={16} aria-hidden="true" /><span>{shortAddress(walletAddress)}</span></div>
              ) : (
                <button className="demo-primary-action" disabled={busy !== null} onClick={connectWallet} type="button">
                  <WalletCards size={18} aria-hidden="true" />
                  {busy === "wallet" ? "Connecting…" : "Connect wallet"}
                </button>
              )}
            </div>
          </div>

          <div className="demo-control-step">
            <div className="demo-step-number">2</div>
            <div className="demo-control-content">
              <h3>Choose a monitored feeder</h3>
              <label className="field">
                Feeder
                <select disabled={zonesQuery.isLoading} onChange={(event) => setZoneId(event.target.value)} value={zoneId}>
                  {zonesQuery.isLoading ? <option value="">Loading feeders…</option> : null}
                  {!zonesQuery.isLoading && zones.length === 0 ? <option value="">No feeders available</option> : null}
                  {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.discosFeederCode} · {zone.name}</option>)}
                </select>
              </label>
              {zonesQuery.isError ? (
                <div className="demo-inline-error" role="alert">
                  <span>Feeders could not be loaded from the API.</span>
                  <button onClick={() => void zonesQuery.refetch()} type="button">Try again</button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="demo-control-step">
            <div className="demo-step-number">3</div>
            <div className="demo-control-content">
              <h3>Inject synthetic telemetry</h3>
              <div className="demo-scenario-list" role="radiogroup" aria-label="Telemetry scenario">
                {SCENARIOS.map((item) => (
                  <button
                    aria-checked={scenario === item.id}
                    className={`demo-scenario ${scenario === item.id ? "selected" : ""}`}
                    key={item.id}
                    onClick={() => setScenario(item.id)}
                    role="radio"
                    type="button"
                  >
                    <span><strong>{item.name}</strong><small>{item.reading}</small></span>
                    <p>{item.description}</p>
                    <em>{item.expectation}</em>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            className="demo-run-action"
            disabled={!walletAddress || !zoneId || busy !== null}
            onClick={runSimulation}
            type="button"
          >
            <Zap size={19} aria-hidden="true" />
            {busy === "simulation" ? "Sign in your wallet…" : "Run this simulation"}
          </button>
          {!walletAddress ? <p className="demo-action-hint">Connect a wallet to enable the simulation.</p> : null}
          {error ? <p className="status-message error" role="alert">{error}</p> : null}
        </section>

        <section className="demo-observation" aria-labelledby="demo-observation-title">
          <div className="demo-observation-header">
            <div>
              <span>Live evidence dossier</span>
              <h2 id="demo-observation-title">{simulation ? selectedScenario.name : "Ready for a telemetry run"}</h2>
            </div>
            {simulation ? <span className={`demo-live-state ${simulation.agentState === "queued" ? "processing" : ""}`}><CircleDot size={14} />{stageLabel(simulation)}</span> : null}
          </div>

          {simulation ? (
            <div className="demo-results" aria-live="polite">
              <div className="demo-reading-strip">
                <div><span>Voltage</span><strong>{formatVoltage(simulation.telemetry.voltage)}</strong></div>
                <div><span>Current</span><strong>{simulation.telemetry.currentAmps} A</strong></div>
                <div><span>Device state</span><strong>{simulation.telemetry.status.replace("grid_", "Grid ")}</strong></div>
                <div><span>Observed</span><strong>{formatGridProofDateTime(simulation.telemetry.observedAt)}</strong></div>
              </div>
              <div className="demo-pipeline">
                <PipelineStep icon={<RadioTower />} title="Telemetry accepted" state="complete">
                  Synthetic device <code>{simulation.telemetry.deviceId}</code> produced evidence <code>{shortId(simulation.telemetry.evidenceId)}</code>.
                </PipelineStep>
                <PipelineStep icon={<Activity />} title="Candidate detected" state="complete">
                  GridProof detected a possible <strong>{simulation.candidate.status}</strong> with {Math.round(simulation.candidate.confidence * 100)}% confidence.
                </PipelineStep>
                <PipelineStep
                  icon={<Cpu />}
                  title="Deterministic policy"
                  state="complete"
                  badge={simulation.policyDecision.decision}
                >
                  {simulation.policyDecision.hypothesis}
                </PipelineStep>
                <PipelineStep
                  icon={<Bot />}
                  title="AI evidence review"
                  state={simulation.agentState === "not_required" ? "skipped" : simulation.agentState === "queued" ? "active" : "complete"}
                  badge={simulation.aiDecision?.decision}
                >
                  {simulation.agentState === "not_required"
                    ? "The deterministic signal cleared the approval threshold, so AI escalation was not required."
                    : simulation.aiDecision
                      ? simulation.aiDecision.hypothesis
                      : "The candidate is queued for the anomaly-analysis and evidence-verification agents. Keep the agent worker running to see their decision here."}
                </PipelineStep>
                <PipelineStep
                  icon={<Link2 />}
                  title="BOT Chain proof"
                  state={simulation.chain.status === "not_requested" ? "waiting" : simulation.chain.status === "pending" ? "active" : "complete"}
                  badge={simulation.chain.mode === "preview" ? "preview only" : simulation.chain.status}
                >
                  {chainMessage(simulation)}
                </PipelineStep>
              </div>
              <div className="demo-result-actions">
                <Link className="button-link" to={`/zones/${simulation.zoneId}`}>Open feeder timeline<ChevronRight size={17} /></Link>
                {simulation.chain.explorerUrl ? <a className="secondary-link" href={simulation.chain.explorerUrl} rel="noreferrer" target="_blank">View transaction</a> : null}
              </div>
            </div>
          ) : (
            <div className="demo-idle-state">
              <div className="demo-idle-signal"><span /><span /><span /><span /></div>
              <Bot size={34} aria-hidden="true" />
              <h3>Watch GridProof reason through the evidence</h3>
              <p>Choose the ambiguous outage to exercise the external AI worker, or use a clear outage/restoration to demonstrate deterministic auto-approval.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function PipelineStep({
  icon,
  title,
  state,
  badge,
  children
}: {
  icon: ReactNode;
  title: string;
  state: "complete" | "active" | "waiting" | "skipped";
  badge?: string;
  children: ReactNode;
}) {
  return (
    <article className={`demo-pipeline-step ${state}`}>
      <div className="demo-pipeline-icon">{icon}</div>
      <div><header><h3>{title}</h3>{badge ? <span>{badge}</span> : null}</header><p>{children}</p></div>
    </article>
  );
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The simulation could not be completed. Try again.";
}

function formatVoltage(voltage: number): string {
  return voltage >= 1000 ? `${(voltage / 1000).toFixed(1)} kV` : `${voltage} V`;
}

function stageLabel(simulation: DemoSimulation): string {
  if (simulation.agentState === "queued") return "AI processing";
  if (simulation.chain.status === "confirmed") return "Proof confirmed";
  if (simulation.chain.status === "preview") return "Proof previewed";
  return "Run complete";
}

function chainMessage(simulation: DemoSimulation): string {
  if (simulation.chain.mode === "preview" && simulation.chain.status === "preview") {
    return "The commitment payload was previewed. Synthetic demo evidence was not written to mainnet.";
  }
  if (simulation.chain.status === "pending") return "The relayer submitted the commitment and GridProof is waiting for confirmation.";
  if (simulation.chain.status === "confirmed") return "The availability commitment is confirmed on BOT Chain.";
  if (simulation.chain.status === "failed") return "The BOT Chain transaction failed; the evidence remains available for inspection.";
  return "A proof becomes available after the evidence is approved.";
}
