import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blockchainConfigFromDeployment,
  loadDeploymentManifest,
  parseDeploymentManifest
} from "../src/deployment.js";

const manifest = {
  network: "botchainTestnet",
  chainId: "424242",
  deployedAt: "2026-08-09T12:00:00.000Z",
  admin: `0x${"1".repeat(40)}`,
  relayer: `0x${"2".repeat(40)}`,
  contracts: {
    NodeRegistry: `0x${"3".repeat(40)}`,
    UptimeAttestation: `0x${"4".repeat(40)}`,
    ReputationEscrow: `0x${"5".repeat(40)}`
  },
  params: {
    epochDurationSeconds: "3600",
    slashPolicyCap: "1000000000000000000",
    minimumStake: "100000000000000000",
    withdrawCooldownSeconds: "259200"
  }
} as const;

describe("deployment manifest helpers", () => {
  it("parses deployment manifests written by the Forge deploy script", () => {
    const parsed = parseDeploymentManifest(manifest);

    expect(parsed.network).toBe("botchainTestnet");
    expect(parsed.contracts.UptimeAttestation).toBe(manifest.contracts.UptimeAttestation);
  });

  it("rejects malformed deployment addresses before client construction", () => {
    expect(() =>
      parseDeploymentManifest({
        ...manifest,
        contracts: {
          ...manifest.contracts,
          NodeRegistry: "not-an-address"
        }
      })
    ).toThrow();
  });

  it("loads deployment manifests from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "gridproof-deployment-"));
    const filePath = join(dir, "botchainTestnet.json");

    try {
      writeFileSync(filePath, JSON.stringify(manifest), "utf8");

      expect(loadDeploymentManifest(filePath).contracts.ReputationEscrow).toBe(manifest.contracts.ReputationEscrow);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds relayer client config from a deployment manifest and runtime secrets", () => {
    const config = blockchainConfigFromDeployment({
      manifest: parseDeploymentManifest(manifest),
      rpcUrl: "https://rpc.example.test",
      relayerPrivateKey: `0x${"6".repeat(64)}`
    });

    expect(config.contracts.NodeRegistry).toBe(manifest.contracts.NodeRegistry);
    expect(config.relayerPrivateKey).toBe(`0x${"6".repeat(64)}`);
  });
});
