import { Send, Smartphone } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import type { ReporterIngestRequest } from "@gridproof/shared-types";
import { apiClient } from "../../lib/api-client.js";
import { PageHeader, PanelHeader } from "../../components/PageHeader.js";

type ReporterForm = Pick<ReporterIngestRequest, "reporterWallet" | "zoneId" | "status"> & {
  note: string;
};

const initialForm: ReporterForm = {
  reporterWallet: "",
  zoneId: "",
  status: "grid_down",
  note: ""
};

export function ReporterSubmission() {
  const [form, setForm] = useState<ReporterForm>(initialForm);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const submitReport = useMutation({
    mutationFn: (input: ReporterIngestRequest) => apiClient.submitReport(input),
    onSuccess: (result) => {
      const candidateMessage = result.candidateEvent
        ? `Candidate ${result.candidateEvent.status} event opened at ${Math.round(result.candidateEvent.confidence * 100)}% confidence.`
        : "Evidence accepted; no new candidate event was needed.";
      setLastResult(result.duplicate ? `Duplicate report ignored. ${candidateMessage}` : candidateMessage);
      setForm((current) => ({ ...current, note: "" }));
    }
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLastResult(null);
    submitReport.mutate({
      reporterWallet: form.reporterWallet.trim(),
      zoneId: form.zoneId.trim(),
      idempotencyKey: buildIdempotencyKey(form.reporterWallet),
      observedAt: new Date().toISOString(),
      status: form.status,
      note: form.note.trim().length > 0 ? form.note.trim() : undefined
    });
  }

  return (
    <main className="shell narrow">
      <PageHeader
        title="Submit Grid Report"
        description="Record field-observed outages or restorations when automated feeder telemetry is unavailable."
        status={<div className="health-pill">
          <Smartphone size={18} aria-hidden="true" />
          <span>Reporter mode</span>
        </div>}
      />

      <form className="proof-panel provider-form report-form" onSubmit={submit}>
        <PanelHeader
          title="Report an outage or restoration"
          description="This report enters the same evidence, detection, review, and proof pipeline as sensor data."
        />

        <label className="field">
          Reporter wallet
          <input
            onChange={(event) => setForm((current) => ({ ...current, reporterWallet: event.target.value }))}
            placeholder="0x…"
            required
            value={form.reporterWallet}
          />
        </label>

        <label className="field">
          Zone UUID
          <input
            onChange={(event) => setForm((current) => ({ ...current, zoneId: event.target.value }))}
            placeholder="8a27f3e2-2608-4a88-b8db-efce68be2a59"
            required
            value={form.zoneId}
          />
        </label>

        <label className="field">
          Grid status
          <select
            onChange={(event) =>
              setForm((current) => ({ ...current, status: event.target.value as ReporterIngestRequest["status"] }))
            }
            value={form.status}
          >
            <option value="grid_down">Power is out</option>
            <option value="grid_up">Power is restored</option>
            <option value="unknown">Not sure / noisy evidence</option>
          </select>
        </label>

        <label className="field">
          Note
          <textarea
            maxLength={1000}
            onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            placeholder="e.g. Transformer area has been off for 20 minutes."
            rows={5}
            value={form.note ?? ""}
          />
        </label>

        <div className="action-row">
          <button
            disabled={submitReport.isPending || form.reporterWallet.length === 0 || form.zoneId.length === 0}
            type="submit"
          >
            <Send size={18} aria-hidden="true" />
            {submitReport.isPending ? "Submitting…" : "Submit report"}
          </button>
        </div>

        {lastResult ? <p className="status-message">{lastResult}</p> : null}
        {submitReport.isError ? (
          <p className="status-message error">Report failed. Check the wallet, zone, and event freshness.</p>
        ) : null}
      </form>
    </main>
  );
}

function buildIdempotencyKey(walletAddress: string): string {
  const wallet = walletAddress.trim().toLowerCase() || "anonymous";
  return `web-report:${wallet}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
