import { EventEmitter } from "node:events";
import type { CandidateEvent, EvidenceEvent } from "@gridproof/shared-types";

export type DomainEvents = {
  "evidence.received": EvidenceEvent;
  "candidate.detected": CandidateEvent;
  "chain.committed": { zoneId: string; txHash: string; status: "pending" | "confirmed" | "failed" };
  "review.required": { candidateEventId: string; reason: string };
};

class TypedEventBus {
  private readonly emitter = new EventEmitter();

  emit<K extends keyof DomainEvents>(eventName: K, payload: DomainEvents[K]): void {
    this.emitter.emit(eventName, payload);
  }

  on<K extends keyof DomainEvents>(eventName: K, listener: (payload: DomainEvents[K]) => void): () => void {
    this.emitter.on(eventName, listener);
    return () => {
      this.emitter.off(eventName, listener);
    };
  }
}

export const domainEvents = new TypedEventBus();
