import { describe, expect, it } from "vitest";

import {
  verifyContractDeploymentManifest,
  type ContractManifestCheckResult
} from "../../scripts/verify-contract-manifest.ts";

const manifestPath = "/tmp/gridproof-botchainTestnet.json";

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

describe("verifyContractDeploymentManifest", () => {
  it("passes a sane manifest whose API relayer env matches deployed contract addresses", () => {
    const checks = verifyContractDeploymentManifest({
      env: {
        GRIDPROOF_CONTRACT_MANIFEST_PATH: manifestPath,
        BOTCHAIN_CHAIN_ID: manifest.chainId,
        BOTCHAIN_NODE_REGISTRY_ADDRESS: manifest.contracts.NodeRegistry,
        BOTCHAIN_UPTIME_ATTESTATION_ADDRESS: manifest.contracts.UptimeAttestation,
        BOTCHAIN_REPUTATION_ESCROW_ADDRESS: manifest.contracts.ReputationEscrow
      },
      ...manifestIo(manifest)
    });

    expect(statuses(checks)).toEqual({
      manifest_file: "pass",
      manifest_shape: "pass",
      network_identity: "pass",
      actors: "pass",
      contract_addresses: "pass",
      contract_params: "pass",
      env_node_registry: "pass",
      env_uptime_attestation: "pass",
      env_reputation_escrow: "pass"
    });
  });

  it("warns when API contract env vars are not available for comparison yet", () => {
    const checks = verifyContractDeploymentManifest({
      env: {
        GRIDPROOF_CONTRACT_MANIFEST_PATH: manifestPath
      },
      ...manifestIo(manifest)
    });

    expect(statuses(checks)).toMatchObject({
      network_identity: "warn",
      env_node_registry: "warn",
      env_uptime_attestation: "warn",
      env_reputation_escrow: "warn"
    });
    expect(byName(checks, "env_uptime_attestation").detail).toContain("BOTCHAIN_UPTIME_ATTESTATION_ADDRESS is not set");
  });

  it("fails when API chain ID points at a different BOT Chain network than the manifest", () => {
    const checks = verifyContractDeploymentManifest({
      env: {
        GRIDPROOF_CONTRACT_MANIFEST_PATH: manifestPath,
        BOTCHAIN_CHAIN_ID: "999999"
      },
      ...manifestIo(manifest)
    });

    expect(byName(checks, "network_identity")).toMatchObject({
      status: "fail",
      detail: "BOTCHAIN_CHAIN_ID=999999 does not match manifest chainId=424242."
    });
  });

  it("fails when API contract env addresses do not match the manifest", () => {
    const checks = verifyContractDeploymentManifest({
      env: {
        GRIDPROOF_CONTRACT_MANIFEST_PATH: manifestPath,
        BOTCHAIN_NODE_REGISTRY_ADDRESS: `0x${"9".repeat(40)}`,
        BOTCHAIN_UPTIME_ATTESTATION_ADDRESS: manifest.contracts.UptimeAttestation,
        BOTCHAIN_REPUTATION_ESCROW_ADDRESS: manifest.contracts.ReputationEscrow
      },
      ...manifestIo(manifest)
    });

    expect(byName(checks, "env_node_registry")).toMatchObject({
      status: "fail",
      detail: `BOTCHAIN_NODE_REGISTRY_ADDRESS=0x${"9".repeat(40)} does not match manifest address ${manifest.contracts.NodeRegistry}.`
    });
  });

  it("fails duplicate contract addresses before a deployment can be treated as demo-ready", () => {
    const checks = verifyContractDeploymentManifest({
      env: {
        GRIDPROOF_CONTRACT_MANIFEST_PATH: manifestPath
      },
      ...manifestIo({
        ...manifest,
        contracts: {
          ...manifest.contracts,
          ReputationEscrow: manifest.contracts.UptimeAttestation
        }
      })
    });

    expect(byName(checks, "contract_addresses")).toMatchObject({
      status: "fail",
      detail: "Contract addresses must be unique."
    });
  });

  it("fails if admin and relayer are the same hot wallet", () => {
    const checks = verifyContractDeploymentManifest({
      env: {
        GRIDPROOF_CONTRACT_MANIFEST_PATH: manifestPath
      },
      ...manifestIo({
        ...manifest,
        relayer: manifest.admin
      })
    });

    expect(byName(checks, "actors")).toMatchObject({
      status: "fail",
      detail: "Admin and relayer are the same address; use a multisig/admin wallet separate from the hot relayer."
    });
  });

  it("fails clearly when the manifest file has not been produced yet", () => {
    const checks = verifyContractDeploymentManifest({
      env: {
        GRIDPROOF_CONTRACT_MANIFEST_PATH: manifestPath
      },
      fileExists: () => false,
      readFile: () => {
        throw new Error("should not read missing files");
      }
    });

    expect(checks).toEqual([
      {
        name: "manifest_file",
        status: "fail",
        detail: `No deployment manifest found at ${manifestPath}. Run the Forge deploy script first: forge script script/Deploy.s.sol:Deploy --root smart-contracts --rpc-url "$BOTCHAIN_RPC_URL" --broadcast`
      }
    ]);
  });
});

function manifestIo(value: unknown): {
  fileExists: (filePath: string) => boolean;
  readFile: (filePath: string) => string;
} {
  return {
    fileExists: (filePath) => filePath === manifestPath,
    readFile: (filePath) => {
      if (filePath !== manifestPath) throw new Error(`Unexpected manifest path ${filePath}`);
      return JSON.stringify(value);
    }
  };
}

function statuses(checks: ContractManifestCheckResult[]): Record<string, ContractManifestCheckResult["status"]> {
  return Object.fromEntries(checks.map((check) => [check.name, check.status]));
}

function byName(checks: ContractManifestCheckResult[], name: string): ContractManifestCheckResult {
  const check = checks.find((candidate) => candidate.name === name);
  if (!check) throw new Error(`Missing check ${name}`);
  return check;
}
