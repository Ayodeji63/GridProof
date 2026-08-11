import { Activity, AlertTriangle, RadioTower, ShieldCheck } from "lucide-react";
import { DISCOS, discoCodeFromFeederCode } from "@gridproof/shared-types";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
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
  const averageUptimeBps = average(zones.map((zone) => zone.latestUptimeBps).filter((value) => value != null));
  const zonesDown = zones.filter((zone) => statusByZoneId[zone.id] === "grid_down").length;
  const healthLabel = zonesQuery.isLoading ? "Loading API" : usingDemoFallback ? "Demo data active" : "API connected";
  const discoRollups = rollupByDisco(zones, statusByZoneId);
  const discosReporting = discoRollups.filter((rollup) => rollup.zoneCount > 0).length;

  return (
    <main className="shell">
      <section className="topbar" aria-label="GridProof status summary">
        <div>
          <p className="eyebrow">BOT Chain uptime proofs</p>
          <h1>GridProof Operations</h1>
        </div>
        <div className="health-pill">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>{healthLabel}</span>
        </div>
      </section>

      <section className="metrics-grid" aria-label="Network metrics">
        <Metric label="Tracked zones" value={zones.length.toString()} icon={<RadioTower size={18} />} />
        <Metric label="DisCos reporting" value={`${discosReporting} / 11`} icon={<RadioTower size={18} />} />
        <Metric label="Average uptime" value={averageUptimeBps == null ? "Pending" : formatBps(averageUptimeBps)} icon={<Activity size={18} />} />
        <Metric label="Zones down" value={zonesDown.toString()} icon={<AlertTriangle size={18} />} />
      </section>

      {zonesQuery.isLoading ? <p className="status-message">Loading live zone data…</p> : null}
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
        <section className="dashboard-grid">
          <div className="map-panel" aria-label="Live zone map">
            <ZoneMap
              onSelectZone={selectZone}
              selectedZoneId={selectedZone?.id}
              statusByZoneId={statusByZoneId}
              zones={zones}
            />
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

          <aside className="zone-panel">
            <p className="eyebrow">Selected feeder</p>
            <h2>{selectedZone?.name}</h2>
            <dl>
              <div>
                <dt>Status</dt>
                <dd>{selectedZone ? (statusByZoneId[selectedZone.id] ?? selectedZone.latestStatus).replace("_", " ") : "unknown"}</dd>
              </div>
              <div>
                <dt>Uptime</dt>
                <dd>{selectedZone?.latestUptimeBps == null ? "Pending" : formatBps(selectedZone.latestUptimeBps)}</dd>
              </div>
              <div>
                <dt>Feeder code</dt>
                <dd>{selectedZone?.discosFeederCode}</dd>
              </div>
            </dl>
            {selectedZone ? (
              <div className="action-row">
                <Link className="primary-link" to={`/zones/${selectedZone.id}`}>
                  Open timeline
                </Link>
                <Link className="button-link" to={`/proof/${selectedZone.id}/latest`}>
                  Open proof explorer
                </Link>
              </div>
            ) : null}
          </aside>
        </section>
      ) : null}

      <section className="disco-panel" aria-label="DisCo coverage">
        <h2>DisCo coverage</h2>
        <p className="disco-caption">
          All 11 Nigerian distribution companies. Rows without tracked feeders have no telemetry yet.
        </p>
        <table className="disco-table">
          <thead>
            <tr>
              <th scope="col">DisCo</th>
              <th scope="col">States</th>
              <th scope="col">Zones</th>
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
                <td>{rollup.averageUptimeBps == null ? "—" : formatBps(rollup.averageUptimeBps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
