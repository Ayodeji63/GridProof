import { Wallet } from "ethers";
import { afterEach, describe, expect, it } from "vitest";
import { clearAuditLogStore } from "../audit/service.js";
import { clearEvidenceStore } from "../ingestion/store.js";
import { clearJobQueueStore, listMemoryJobs } from "../jobs/queue.js";
import { clearPipelineStore } from "../pipeline/service.js";
import { clearDemoStore, createDemoWalletChallenge, getDemoSimulation, runDemoSimulation } from "./service.js";

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";

describe("judge demo simulation", () => {
  afterEach(() => {
    clearDemoStore();
    clearAuditLogStore();
    clearEvidenceStore();
    clearJobQueueStore();
    clearPipelineStore();
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    delete process.env.GRIDPROOF_DEMO_ALLOW_CHAIN_WRITE;
  });

  it("authorizes a wallet and previews an auto-approved proof without writing to chain", async () => {
    const wallet = Wallet.createRandom();
    const challenge = createDemoWalletChallenge(wallet.address);
    const signature = await wallet.signMessage(challenge.message);

    const simulation = await runDemoSimulation({
      walletAddress: wallet.address,
      nonce: challenge.nonce,
      signature,
      zoneId,
      scenario: "confirmed_outage"
    });

    expect(simulation.initiatedBy).toBe(wallet.address.toLowerCase());
    expect(simulation.telemetry).toMatchObject({ status: "grid_down", voltage: 0, currentAmps: 0 });
    expect(simulation.candidate).toMatchObject({ status: "outage", confidence: 0.95 });
    expect(simulation.policyDecision.decision).toBe("approve");
    expect(simulation.chain).toEqual({ mode: "preview", status: "preview", txHash: null, explorerUrl: null });
    expect((await getDemoSimulation(simulation.id)).id).toBe(simulation.id);
  });

  it("queues ambiguous telemetry for the AI worker", async () => {
    const wallet = Wallet.createRandom();
    const challenge = createDemoWalletChallenge(wallet.address);

    const simulation = await runDemoSimulation({
      walletAddress: wallet.address,
      nonce: challenge.nonce,
      signature: await wallet.signMessage(challenge.message),
      zoneId,
      scenario: "ambiguous_outage"
    });

    expect(simulation.policyDecision.decision).toBe("escalate");
    expect(simulation.agentState).toBe("queued");
    expect(simulation.stage).toBe("ai_queued");
    expect(listMemoryJobs("agent-review")[0]?.data.simulation).toMatchObject({
      runId: simulation.id,
      allowChainWrite: false
    });
  });

  it("rejects an authorization signature from a different wallet", async () => {
    const wallet = Wallet.createRandom();
    const attacker = Wallet.createRandom();
    const challenge = createDemoWalletChallenge(wallet.address);

    await expect(runDemoSimulation({
      walletAddress: wallet.address,
      nonce: challenge.nonce,
      signature: await attacker.signMessage(challenge.message),
      zoneId,
      scenario: "restoration"
    })).rejects.toMatchObject({ code: "DEMO_BAD_SIGNATURE" });
  });
});
