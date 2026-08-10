import { Activity, AlertTriangle, CircleDot, RadioTower, ShieldCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../lib/api-client.js";
import { useRealtime } from "../../lib/realtime.js";
import { useDashboardStore } from "../../stores/dashboard-store.js";
import { sampleZones } from "./sample-data.js";

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
            <div className="map-canvas">
              {zones.map((zone, index) => {
                const status = statusByZoneId[zone.id] ?? zone.latestStatus;
                const position = markerPosition(zone.centroid, zones, index);
                return (
                  <button
                    className={`zone-marker ${status}`}
                    key={zone.id}
                    onClick={() => selectZone(zone.id)}
                    style={{
                      left: `${position.left}%`,
                      top: `${position.top}%`
                    }}
                    title={`${zone.name}: ${status.replace("_", " ")}`}
                    type="button"
                  >
                    <CircleDot size={18} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
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

function markerPosition(
  centroid: { lat: number; lng: number },
  zones: Array<{ centroid: { lat: number; lng: number } }>,
  fallbackIndex: number
): { left: number; top: number } {
  const lats = zones.map((zone) => zone.centroid.lat);
  const lngs = zones.map((zone) => zone.centroid.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const left =
    maxLng === minLng ? 24 + fallbackIndex * 18 : 14 + ((centroid.lng - minLng) / (maxLng - minLng)) * 72;
  const top = maxLat === minLat ? 36 + (fallbackIndex % 2) * 20 : 14 + ((maxLat - centroid.lat) / (maxLat - minLat)) * 72;

  return {
    left: clamp(left, 10, 86),
    top: clamp(top, 10, 86)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
