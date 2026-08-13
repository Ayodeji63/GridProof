import { Activity, ArrowRight, Gauge, MapPinned, RadioTower, ShieldCheck, TrendingDown, Zap } from "lucide-react";
import { DISCOS, discoCodeFromFeederCode } from "@gridproof/shared-types";
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../lib/api-client.js";
import { useRealtime } from "../../lib/realtime.js";
import { useDashboardStore } from "../../stores/dashboard-store.js";
import { sampleZones } from "./sample-data.js";
import { ZoneMap } from "./ZoneMap.js";

export function Dashboard() {
  useRealtime();
  const selectedZoneId = useDashboardStore((state) => state.selectedZoneId);
  const selectZone = useDashboardStore((state) => state.selectZone);
  const realtimeStatuses = useDashboardStore((state) => state.realtimeStatuses);
  const zonesQuery = useQuery({
    queryKey: ["zones"],
    queryFn: apiClient.zones,
    retry: 1
  });

  const usingDemoFallback = zonesQuery.isError;
  const zones = usingDemoFallback ? sampleZones : (zonesQuery.data?.zones ?? []);
  const selectedZone = zones.find((zone) => zone.id === selectedZoneId) ?? zones[0];
  const statusByZoneId = Object.fromEntries(
    zones.map((zone) => [zone.id, realtimeStatuses[zone.id] ?? zone.latestStatus] as const)
  );
  const healthLabel = zonesQuery.isLoading ? "Loading API" : usingDemoFallback ? "Demo data active" : "API connected";
  const discoRollups = rollupByDisco(zones, statusByZoneId);
  const feederMetrics = calculateFeederMetrics(zones);
  const discosReporting = discoRollups.filter((rollup) => rollup.zoneCount > 0).length;
  const statusSummary = calculateStatusSummary(zones, statusByZoneId);
  const selectedStatus = selectedZone ? (statusByZoneId[selectedZone.id] ?? selectedZone.latestStatus) : "unknown";
  const lastUpdated = zonesQuery.dataUpdatedAt ? formatUpdatedAt(zonesQuery.dataUpdatedAt) : null;

  return (
    <main className="shell dashboard-shell">
      <section className="topbar dashboard-topbar" aria-label="GridProof status summary">
        <div className="dashboard-heading">
          <h1>Feeder operations</h1>
          <p className="dashboard-intro">Live availability, electrical telemetry and verifiable uptime proofs across Nigeria.</p>
        </div>
        <div className="dashboard-sync">
          <div className="health-pill">
            <span className="live-dot" aria-hidden="true" />
            <span>{healthLabel}</span>
          </div>
          <span className="last-updated">{lastUpdated ? `Updated ${lastUpdated}` : "Waiting for telemetry"}</span>
        </div>
      </section>

      <section className="dashboard-section-heading" aria-labelledby="performance-heading">
        <div>
          <h2 id="performance-heading">National performance</h2>
          <p>Percentages use all tracked feeders as the denominator.</p>
        </div>
        <div className="coverage-summary" aria-label={`${feederMetrics.total} feeders across ${discosReporting} distribution companies`}>
          <span><strong>{feederMetrics.total}</strong> feeders</span>
          <span aria-hidden="true" />
          <span><strong>{discosReporting}</strong> of 11 DisCos</span>
        </div>
      </section>

      <section className="metrics-grid feeder-metrics" aria-label="National feeder performance">
        <Metric
          caption={`${feederMetrics.darAtTarget.count} of ${feederMetrics.total} tracked feeders${missingSuffix(feederMetrics.darReported, feederMetrics.total, "DAR")}`}
          icon={<Gauge size={19} />}
          label="DAR at or above 90%"
          percentage={feederMetrics.darAtTarget.percentage}
          tone="green"
        />
        <Metric
          caption={`${feederMetrics.activeVoltage.count} of ${feederMetrics.total} tracked feeders${missingSuffix(feederMetrics.voltageReported, feederMetrics.total, "voltage")}`}
          icon={<Zap size={19} />}
          label="Active voltage"
          percentage={feederMetrics.activeVoltage.percentage}
          tone="red"
        />
        <Metric
          caption={`${feederMetrics.activeCurrent.count} of ${feederMetrics.total} tracked feeders${missingSuffix(feederMetrics.currentReported, feederMetrics.total, "current")}`}
          icon={<Activity size={19} />}
          label="Active current"
          percentage={feederMetrics.activeCurrent.percentage}
          tone="blue"
        />
        <Metric
          caption={`${feederMetrics.darBelowTarget.count} of ${feederMetrics.total} tracked feeders${missingSuffix(feederMetrics.darReported, feederMetrics.total, "DAR")}`}
          icon={<TrendingDown size={19} />}
          label="DAR below 90%"
          percentage={feederMetrics.darBelowTarget.percentage}
          tone="amber"
        />
      </section>

      {zonesQuery.isLoading ? <div className="dashboard-loading" role="status"><span />Loading live feeder telemetry…</div> : null}
      {usingDemoFallback ? (
        <p className="status-message error">Could not load live zones. Showing demo fallback data for rehearsal.</p>
      ) : null}
      {!zonesQuery.isLoading && !usingDemoFallback && zones.length === 0 ? (
        <section className="zone-panel">
          <h2>No zones yet</h2>
          <p>Register providers or ingest evidence to create a demo zone.</p>
        </section>
      ) : null}

      {zones.length > 0 ? (
        <>
        <section className="dashboard-section-heading network-heading" aria-labelledby="network-heading">
          <div>
            <h2 id="network-heading">Live network</h2>
            <p>Select a feeder on the map or from the list to inspect its latest reading.</p>
          </div>
          <div className="status-legend" aria-label="Feeder status legend">
            <span className="grid_up"><i />{statusSummary.up} up</span>
            <span className="grid_down"><i />{statusSummary.down} down</span>
            <span className="unknown"><i />{statusSummary.unknown} unknown</span>
          </div>
        </section>
        <section className="dashboard-grid">
          <div className="map-panel dashboard-card" aria-label="Live zone map">
            <header className="card-header">
              <div><MapPinned aria-hidden="true" size={20} /><span><strong>Nigeria feeder map</strong><small>Latest reported state</small></span></div>
              <span className="card-meta">{zones.length} monitored</span>
            </header>
            <ZoneMap
              onSelectZone={selectZone}
              selectedZoneId={selectedZone?.id}
              statusByZoneId={statusByZoneId}
              zones={zones}
            />
            <div className="feeder-list-heading"><span>Tracked feeders</span><small>{zones.length} total</small></div>
            <ul className="zone-list" aria-label="Tracked feeders">
              {zones.map((zone) => {
                const status = statusByZoneId[zone.id] ?? zone.latestStatus;
                return (
                  <li key={zone.id}>
                    <button
                      aria-pressed={zone.id === selectedZone?.id}
                      className={`zone-chip ${status}`}
                      onClick={() => selectZone(zone.id)}
                      title={`${zone.name}: ${status.replace("_", " ")}`}
                      type="button"
                    >
                      <span className="zone-chip-dot" aria-hidden="true" />
                      {zone.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <aside className="zone-panel feeder-inspector">
            <div className="inspector-header">
              <span className={`status-orb ${selectedStatus}`} aria-hidden="true"><RadioTower size={20} /></span>
              <div><span className="inspector-context">Selected feeder</span><h2>{selectedZone?.name}</h2></div>
            </div>
            <span className={`feeder-status ${selectedStatus}`}>{selectedStatus.replace("_", " ")}</span>
            <dl className="feeder-readings">
              <div>
                <dt>Status</dt>
                <dd>{selectedStatus.replace("_", " ")}</dd>
              </div>
              <div>
                <dt>Uptime</dt>
                <dd>{selectedZone?.latestUptimeBps == null ? "Pending" : formatBps(selectedZone.latestUptimeBps)}</dd>
              </div>
              <div>
                <dt>Voltage</dt>
                <dd>{selectedZone?.latestVoltage == null ? "Not reported" : `${selectedZone.latestVoltage.toFixed(1)} V`}</dd>
              </div>
              <div>
                <dt>Current</dt>
                <dd>{selectedZone?.latestCurrentAmps == null ? "Not reported" : `${selectedZone.latestCurrentAmps.toFixed(1)} A`}</dd>
              </div>
              <div>
                <dt>Feeder code</dt>
                <dd className="mono">{selectedZone?.discosFeederCode}</dd>
              </div>
            </dl>
            {selectedZone ? (
              <div className="action-row">
                <Link className="primary-link" to={`/zones/${selectedZone.id}`}>
                  Open timeline <ArrowRight aria-hidden="true" size={16} />
                </Link>
                <Link className="button-link" to={`/proof/${selectedZone.id}/latest`}>
                  View proof
                </Link>
              </div>
            ) : null}
          </aside>
        </section>
        </>
      ) : null}

      <section className="disco-panel dashboard-card" aria-label="DisCo coverage">
        <header className="card-header disco-header">
          <div><ShieldCheck aria-hidden="true" size={20} /><span><strong>Distribution company coverage</strong><small>All 11 Nigerian distribution companies</small></span></div>
          <span className="card-meta">{discosReporting} reporting</span>
        </header>
        <div className="table-scroll">
        <table className="disco-table">
          <thead>
            <tr>
              <th scope="col">DisCo</th>
              <th scope="col">States</th>
              <th scope="col">Feeders</th>
              <th scope="col">Down</th>
              <th scope="col">Avg uptime</th>
            </tr>
          </thead>
          <tbody>
            {discoRollups.map((rollup) => (
              <tr className={rollup.zoneCount === 0 ? "disco-row empty" : "disco-row"} key={rollup.code}>
                <th scope="row">
                  <span className="disco-code">{rollup.code}</span>
                  <span className="disco-name">{rollup.name}</span>
                </th>
                <td>{rollup.states.join(", ")}</td>
                <td>{rollup.zoneCount}</td>
                <td>{rollup.zoneCount === 0 ? "—" : rollup.zonesDown}</td>
                <td>{rollup.averageUptimeBps == null ? "—" : <span className="uptime-cell"><i style={{ "--uptime": `${rollup.averageUptimeBps / 100}%` } as CSSProperties} /><span>{formatBps(rollup.averageUptimeBps)}</span></span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </main>
  );
}

type MetricTone = "green" | "red" | "blue" | "amber";

function Metric({
  label,
  percentage,
  caption,
  icon,
  tone
}: {
  label: string;
  percentage: number;
  caption: string;
  icon: ReactNode;
  tone: MetricTone;
}) {
  const style = { "--metric-progress": `${percentage}%` } as CSSProperties;
  return (
    <article className={`metric metric-${tone}`} style={style}>
      <span className="metric-icon">{icon}</span>
      <span className="metric-label">{label}</span>
      <strong>{percentage.toFixed(1)}%</strong>
      <span className="metric-caption">{caption}</span>
      <span aria-hidden="true" className="metric-track"><span className="metric-progress" /></span>
    </article>
  );
}

type FeederMetric = { count: number; percentage: number };

export function calculateFeederMetrics(
  zones: Array<{
    latestUptimeBps: number | null;
    latestVoltage?: number | null;
    latestCurrentAmps?: number | null;
  }>
) {
  const total = zones.length;
  const metric = (predicate: (zone: (typeof zones)[number]) => boolean): FeederMetric => {
    const count = zones.filter(predicate).length;
    return { count, percentage: total === 0 ? 0 : (count / total) * 100 };
  };

  return {
    total,
    darReported: zones.filter((zone) => zone.latestUptimeBps != null).length,
    voltageReported: zones.filter((zone) => zone.latestVoltage != null).length,
    currentReported: zones.filter((zone) => zone.latestCurrentAmps != null).length,
    darAtTarget: metric((zone) => zone.latestUptimeBps != null && zone.latestUptimeBps >= 9_000),
    darBelowTarget: metric((zone) => zone.latestUptimeBps != null && zone.latestUptimeBps < 9_000),
    activeVoltage: metric((zone) => zone.latestVoltage != null && zone.latestVoltage >= 180),
    activeCurrent: metric((zone) => zone.latestCurrentAmps != null && zone.latestCurrentAmps > 0)
  };
}

function missingSuffix(reported: number, total: number, measurement: string): string {
  const missing = total - reported;
  return missing > 0 ? ` · ${missing} without ${measurement}` : "";
}

export function calculateStatusSummary(zones: Array<{ id: string; latestStatus: string }>, statusByZoneId: Record<string, string>) {
  return zones.reduce(
    (summary, zone) => {
      const status = statusByZoneId[zone.id] ?? zone.latestStatus;
      if (status === "grid_up") summary.up += 1;
      else if (status === "grid_down") summary.down += 1;
      else summary.unknown += 1;
      return summary;
    },
    { up: 0, down: 0, unknown: 0 }
  );
}

function formatUpdatedAt(value: number): string {
  return new Intl.DateTimeFormat("en-NG", { hour: "2-digit", minute: "2-digit" }).format(value);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatBps(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}

type DiscoRollup = {
  code: (typeof DISCOS)[number]["code"];
  name: string;
  states: string[];
  zoneCount: number;
  zonesDown: number;
  averageUptimeBps: number | null;
};

/**
 * Aggregates zones per DisCo, ordered to mirror the canonical DISCOS registry so
 * the dashboard always shows all 11 rows in the same stable order.
 */
export function rollupByDisco(
  zones: Array<{ id: string; discosFeederCode: string; latestUptimeBps: number | null }>,
  statusByZoneId: Record<string, string>
): DiscoRollup[] {
  return DISCOS.map((disco) => {
    const zonesInDisco = zones.filter((zone) => discoCodeFromFeederCode(zone.discosFeederCode) === disco.code);
    const uptimes = zonesInDisco
      .map((zone) => zone.latestUptimeBps)
      .filter((value): value is number => value != null);
    return {
      code: disco.code,
      name: disco.name,
      states: disco.states,
      zoneCount: zonesInDisco.length,
      zonesDown: zonesInDisco.filter((zone) => statusByZoneId[zone.id] === "grid_down").length,
      averageUptimeBps: average(uptimes)
    };
  });
}
