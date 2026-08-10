import { Check, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiClient } from "../../lib/api-client.js";

export function ReviewQueue() {
  const queryClient = useQueryClient();
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const reviewQueue = useQuery({
    queryKey: ["review-queue"],
    queryFn: apiClient.reviewQueue,
    retry: 1
  });
  const resolveReview = useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: "approve" | "reject"; note: string }) =>
      apiClient.resolveReview(id, { decision, note }),
    onSuccess: async (_result, variables) => {
      setNotesById((current) => {
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    }
  });

  const items = reviewQueue.data?.items ?? [];

  return (
    <main className="shell narrow">
      <p className="eyebrow">Human-in-the-loop</p>
      <h1>Reviewer Console</h1>
      {reviewQueue.isLoading ? <p className="status-message">Loading escalated evidence…</p> : null}
      {reviewQueue.isError ? <p className="status-message error">Could not load the review queue.</p> : null}
      {!reviewQueue.isLoading && !reviewQueue.isError && items.length === 0 ? (
        <section className="review-item">
          <div>
            <h2>No escalations waiting</h2>
            <p>Ambiguous evidence will appear here when the deterministic or AI confidence gate asks for human confirmation.</p>
          </div>
        </section>
      ) : null}
      {items.map((item) => {
        const note = notesById[item.id] ?? "";
        const isResolving = resolveReview.isPending && resolveReview.variables?.id === item.id;

        return (
          <section className="review-item" key={item.id}>
            <div>
              <p className="eyebrow">{item.candidate.zoneId}</p>
              <h2>{item.candidate.status === "outage" ? "Possible outage" : "Possible restoration"}</h2>
              <p>{item.hypothesis}</p>
              <dl>
                <div>
                  <dt>Confidence</dt>
                  <dd>{Math.round(item.confidence * 100)}%</dd>
                </div>
                <div>
                  <dt>Evidence IDs</dt>
                  <dd className="mono">{item.supportingEvidenceIds.join(", ")}</dd>
                </div>
                <div>
                  <dt>Window</dt>
                  <dd>
                    {item.candidate.windowStart} → {item.candidate.windowEnd}
                  </dd>
                </div>
              </dl>
              <label className="field">
                Reviewer note
                <textarea
                  onChange={(event) => setNotesById((current) => ({ ...current, [item.id]: event.target.value }))}
                  placeholder="Add the reason for approving or rejecting this evidence."
                  rows={3}
                  value={note}
                />
              </label>
            </div>
            <div className="action-row">
              <button
                disabled={isResolving || note.trim().length === 0}
                onClick={() => resolveReview.mutate({ id: item.id, decision: "approve", note: note.trim() })}
                type="button"
                title="Approve evidence for submission"
              >
                <Check size={18} aria-hidden="true" />
                Approve
              </button>
              <button
                disabled={isResolving || note.trim().length === 0}
                onClick={() => resolveReview.mutate({ id: item.id, decision: "reject", note: note.trim() })}
                type="button"
                title="Reject evidence"
              >
                <X size={18} aria-hidden="true" />
                Reject
              </button>
            </div>
          </section>
        );
      })}
      {resolveReview.isError ? <p className="status-message error">Review decision failed. Please retry with a note.</p> : null}
    </main>
  );
}
