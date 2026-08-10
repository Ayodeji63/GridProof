import { describe, expect, it, vi } from "vitest";
import { encodeNodeRegistryRegisterCall, GridProofBlockchainClient, providerTypeIdFor } from "../src/client.js";

const config = {
  rpcUrl: "http://127.0.0.1:8545",
  relayerPrivateKey: `0x${"1".repeat(64)}`,
  contracts: {
    NodeRegistry: `0x${"2".repeat(40)}`,
    UptimeAttestation: `0x${"3".repeat(40)}`,
    ReputationEscrow: `0x${"4".repeat(40)}`
  }
};

describe("GridProofBlockchainClient", () => {
  it("rejects invalid constructor config before creating contract clients", () => {
    expect(
      () =>
        new GridProofBlockchainClient({
          ...config,
          relayerPrivateKey: "not-a-private-key"
        })
    ).toThrow();
  });

  it("validates commit input before forwarding to UptimeAttestation", async () => {
    const client = new GridProofBlockchainClient(config);
    const commitEpoch = vi.fn(async () => ({ hash: `0x${"9".repeat(64)}` }));
    (client as unknown as { uptimeAttestation: { commitEpoch: typeof commitEpoch } }).uptimeAttestation = { commitEpoch };

    await expect(
      client.commitEpoch({
        zoneId: `0x${"a".repeat(64)}`,
        epochStart: 1786276800n,
        uptimeBps: 10_001,
        evidenceHash: `0x${"e".repeat(64)}`
      })
    ).rejects.toThrow("uptimeBps");

    expect(commitEpoch).not.toHaveBeenCalled();
  });

  it("forwards valid epoch commitments to the configured contract", async () => {
    const client = new GridProofBlockchainClient(config);
    const commitEpoch = vi.fn(async () => ({ hash: `0x${"9".repeat(64)}` }));
    (client as unknown as { uptimeAttestation: { commitEpoch: typeof commitEpoch } }).uptimeAttestation = { commitEpoch };

    const tx = await client.commitEpoch({
      zoneId: `0x${"a".repeat(64)}`,
      epochStart: 1786276800n,
      uptimeBps: 5_000,
      evidenceHash: `0x${"e".repeat(64)}`
    });

    expect(tx.hash).toBe(`0x${"9".repeat(64)}`);
    expect(commitEpoch).toHaveBeenCalledWith(`0x${"a".repeat(64)}`, 1786276800n, 5_000, `0x${"e".repeat(64)}`);
  });

  it("maps provider transaction receipts into the API-safe receipt shape", async () => {
    const client = new GridProofBlockchainClient(config);
    const getTransactionReceipt = vi.fn(async () => ({
      hash: `0x${"9".repeat(64)}`,
      blockNumber: 1234,
      status: 1
    }));
    (client as unknown as { provider: { getTransactionReceipt: typeof getTransactionReceipt } }).provider = { getTransactionReceipt };

    const receipt = await client.getTransactionReceipt(`0x${"9".repeat(64)}`);

    expect(receipt).toEqual({
      hash: `0x${"9".repeat(64)}`,
      blockNumber: 1234,
      status: 1
    });
    expect(getTransactionReceipt).toHaveBeenCalledWith(`0x${"9".repeat(64)}`);
  });

  it("maps provider types to NodeRegistry enum values", () => {
    expect(providerTypeIdFor("sensor")).toBe(0);
    expect(providerTypeIdFor("reporter")).toBe(1);
  });

  it("encodes self-service NodeRegistry registration calldata", () => {
    expect(encodeNodeRegistryRegisterCall(`0x${"a".repeat(64)}`, "reporter")).toBe(
      `0x610b0a4a${"a".repeat(64)}${"0".repeat(63)}1`
    );
  });

  it("reads provider registration state from NodeRegistry", async () => {
    const client = new GridProofBlockchainClient(config);
    const getProvider = vi.fn(async () => ({
      zoneId: `0x${"a".repeat(64)}`,
      providerType: 1n,
      registeredAt: 1786276800n,
      active: true
    }));
    (client as unknown as { nodeRegistry: { getProvider: typeof getProvider } }).nodeRegistry = { getProvider };

    const registration = await client.getProviderRegistration("0x1111111111111111111111111111111111111111");

    expect(registration).toEqual({
      zoneId: `0x${"a".repeat(64)}`,
      providerTypeId: 1,
      registeredAt: 1786276800n,
      active: true
    });
    expect(getProvider).toHaveBeenCalledWith("0x1111111111111111111111111111111111111111");
  });
});
