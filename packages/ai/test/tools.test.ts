import { describe, expect, it, vi } from "vitest";
import {
  collectAgentToolContext,
  getConflictingReports,
  getHistoricalBaseline,
  getProviderMetadata,
  getTelemetryWindow,
  type AgentToolQuery
} from "../src/tools.js";

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const providerId = "2084fca3-725c-4a2d-b521-bc82de112c64";
const reporterProviderId = "2cbebf96-685b-49aa-ab25-67468c151e88";
const observedAt = "2026-08-09T12:00:00.000Z";
const windowEnd = "2026-08-09T12:05:00.000Z";

const sensorEvidenceRow = {
  id: "6a670093-7823-44e1-80e4-ac608f9e75bd",
  provider_id: providerId,
  zone_id: zoneId,
  idempotency_key: "esp32-ogb-a-2026-08-09T12:00:00Z",
  source: "sensor" as const,
  status: "grid_down" as const,
  voltage: "0",
  confidence_hint: null,
  raw_payload: { deviceId: "esp32-ogb-a" },
  observed_at: observedAt,
  received_at: "2026-08-09T12:00:01.000Z"
};

const reporterDownRow = {
  ...sensorEvidenceRow,
  id: "182c73b4-041f-48bb-abaa-7c60826bb0c4",
  provider_id: reporterProviderId,
  idempotency_key: "reporter-down-2026-08-09T12:01:00Z",
  source: "reporter" as const,
  raw_payload: { note: "Power is out" },
  observed_at: "2026-08-09T12:01:00.000Z"
};

const reporterUpRow = {
  ...reporterDownRow,
  id: "b9500689-0e34-4701-9ba4-126fc67d8f95",
  idempotency_key: "reporter-up-2026-08-09T12:02:00Z",
  status: "grid_up" as const,
  raw_payload: { note: "Power is restored" },
  observed_at: "2026-08-09T12:02:00.000Z"
};

describe("agent read-only tools", () => {
  it("reads and validates telemetry windows", async () => {
    const query = vi.fn(async () => ({ rows: [sensorEvidenceRow] }));

    const window = await getTelemetryWindow(query, {
      zoneId,
      range: { start: observedAt, end: windowEnd }
    });

    expect(window.events).toHaveLength(1);
    expect(window.events[0]?.voltage).toBe(0);
    expect(query.mock.calls[0]?.[0]).toContain("from evidence_events");
    expect(query.mock.calls[0]?.[1]).toEqual([zoneId, observedAt, windowEnd, 200]);
  });

  it("summarizes historical baselines", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          sample_size: "12",
          grid_up_count: "9",
          grid_down_count: "2",
          unknown_count: "1",
          average_voltage: "219.5",
          first_observed_at: "2026-08-02T12:00:00.000Z",
          last_observed_at: "2026-08-09T11:59:00.000Z"
        }
      ]
    }));

    const baseline = await getHistoricalBaseline(query, {
      zoneId,
      asOf: windowEnd
    });

    expect(baseline.sampleSize).toBe(12);
    expect(baseline.statusCounts.gridUp).toBe(9);
    expect(baseline.averageVoltage).toBe(219.5);
  });

  it("returns provider metadata with recent evidence stats", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          id: providerId,
          user_id: null,
          wallet_address: "0x1111111111111111111111111111111111111111",
          provider_type: "sensor" as const,
          zone_id: zoneId,
          reputation_cache: "14",
          active: true,
          recent_evidence_count: "4",
          last_evidence_at: observedAt,
          latest_status: "grid_down" as const
        }
      ]
    }));

    const metadata = await getProviderMetadata(query, {
      providerId,
      asOf: windowEnd
    });

    expect(metadata.provider.reputationCache).toBe(14);
    expect(metadata.recentEvidenceCount).toBe(4);
    expect(metadata.latestStatus).toBe("grid_down");
  });

  it("detects conflicting reporter statuses in a zone window", async () => {
    const query = vi.fn(async () => ({ rows: [reporterDownRow, reporterUpRow] }));

    const conflicts = await getConflictingReports(query, {
      zoneId,
      range: { start: observedAt, end: windowEnd }
    });

    expect(conflicts.hasConflict).toBe(true);
    expect(conflicts.statusGroups.map((group) => group.status).sort()).toEqual(["grid_down", "grid_up"]);
  });

  it("collects the complete context snapshot for an ambiguous candidate", async () => {
    const query: AgentToolQuery = vi.fn(async (sql, values = []) => {
      if (sql.includes("left join lateral")) {
        const rows = [
          {
            id: providerId,
            user_id: null,
            wallet_address: "0x1111111111111111111111111111111111111111",
            provider_type: "sensor",
            zone_id: zoneId,
            reputation_cache: 14,
            active: true,
            recent_evidence_count: 4,
            last_evidence_at: observedAt,
            latest_status: "grid_down"
          },
          {
            id: reporterProviderId,
            user_id: null,
            wallet_address: "0x2222222222222222222222222222222222222222",
            provider_type: "reporter",
            zone_id: zoneId,
            reputation_cache: 3,
            active: true,
            recent_evidence_count: 2,
            last_evidence_at: "2026-08-09T12:02:00.000Z",
            latest_status: "grid_up"
          }
        ];
        return {
          rows: rows.filter((row) => row.id === values[0])
        };
      }

      if (sql.includes("count(*)::int")) {
        return {
          rows: [
            {
              sample_size: 2,
              grid_up_count: 1,
              grid_down_count: 1,
              unknown_count: 0,
              average_voltage: null,
              first_observed_at: observedAt,
              last_observed_at: windowEnd
            }
          ]
        };
      }

      if (sql.includes("source = 'reporter'")) {
        return { rows: [reporterDownRow, reporterUpRow] };
      }

      return { rows: [sensorEvidenceRow, reporterDownRow, reporterUpRow] };
    });

    const context = await collectAgentToolContext(query, {
      id: "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
      zoneId,
      status: "outage",
      confidence: 0.62,
      windowStart: observedAt,
      windowEnd,
      evidenceEventIds: [sensorEvidenceRow.id],
      createdAt: "2026-08-09T12:05:01.000Z"
    });

    expect(context.telemetryWindow.events).toHaveLength(3);
    expect(context.conflictingReports.hasConflict).toBe(true);
    expect(context.providerMetadata.map((metadata) => metadata.provider.id).sort()).toEqual([providerId, reporterProviderId].sort());
  });
});
