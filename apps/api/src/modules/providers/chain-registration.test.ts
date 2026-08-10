import { afterEach, describe, expect, it } from "vitest";
import { providerChainRegistrationFor } from "./chain-registration.js";

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const walletAddress = "0x1111111111111111111111111111111111111111";

describe("provider chain registration intent", () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.BOTCHAIN_NODE_REGISTRY_ADDRESS;
    delete process.env.BOTCHAIN_CHAIN_ID;
    delete process.env.BOTCHAIN_TESTNET_CHAIN_ID;
    delete process.env.BOTCHAIN_EXPLORER_BASE_URL;
    delete process.env.BOTCHAIN_RPC_URL;
    delete process.env.RELAYER_PRIVATE_KEY;
    delete process.env.BOTCHAIN_UPTIME_ATTESTATION_ADDRESS;
    delete process.env.BOTCHAIN_REPUTATION_ESCROW_ADDRESS;
  });

  it("returns an unconfigured wallet self-service intent when deployment env is missing", async () => {
    const intent = await providerChainRegistrationFor({
      walletAddress,
      providerType: "reporter",
      zoneId
    });

    expect(intent).toMatchObject({
      configured: false,
      mode: "wallet_self_service",
      chainId: null,
      contractAddress: null,
      explorerUrl: null,
      providerWallet: walletAddress,
      providerType: "reporter",
      providerTypeId: 1,
      zoneId,
      zoneKey: `0x${"a".repeat(64)}`,
      onChain: null
    });
    expect(intent.registerCall).toEqual({
      to: null,
      functionName: "register",
      args: [`0x${"a".repeat(64)}`, 1],
      data: null
    });
    expect(intent.reason).toContain("Set BOTCHAIN_NODE_REGISTRY_ADDRESS");
  });

  it("encodes NodeRegistry.register calldata and explorer links from env", async () => {
    process.env.BOTCHAIN_NODE_REGISTRY_ADDRESS = "0x2222222222222222222222222222222222222222";
    process.env.BOTCHAIN_CHAIN_ID = "3636";
    process.env.BOTCHAIN_EXPLORER_BASE_URL = "https://explorer.botchain.test/";

    const intent = await providerChainRegistrationFor({
      walletAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      providerType: "sensor",
      zoneId
    });

    expect(intent.configured).toBe(true);
    expect(intent.chainId).toBe("3636");
    expect(intent.contractAddress).toBe("0x2222222222222222222222222222222222222222");
    expect(intent.explorerUrl).toBe("https://explorer.botchain.test/address/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(intent.providerWallet).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(intent.providerTypeId).toBe(0);
    expect(intent.registerCall).toMatchObject({
      to: "0x2222222222222222222222222222222222222222",
      functionName: "register",
      args: [`0x${"a".repeat(64)}`, 0]
    });
    expect(intent.registerCall.data).toBe(`0x610b0a4a${"a".repeat(64)}${"0".repeat(64)}`);
    expect(intent.onChain).toBeNull();
  });
});
