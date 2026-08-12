import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type CheckStatus = "pass" | "warn" | "fail";

export type ContractManifestCheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
};

type ContractManifestVerifierOptions = {
  env?: NodeJS.ProcessEnv;
  readFile?: (filePath: string) => string;
  fileExists?: (filePath: string) => boolean;
};

type DeploymentManifest = {
  network: string;
  chainId: string;
  deployedAt: string;
  admin: string;
  relayer: string;
  contracts: {
    NodeRegistry: string;
    UptimeAttestation: string;
    ReputationEscrow: string;
  };
  params: {
    epochDurationSeconds: string;
    slashPolicyCap: string;
    minimumStake: string;
    withdrawCooldownSeconds: string;
  };
};

const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const zeroAddress = "0x0000000000000000000000000000000000000000";

function main(): void {
  const checks = verifyContractDeploymentManifest();
  printResults(checks);

  if (checks.some((check) => check.status === "fail")) {
    process.exitCode = 1;
  }
}

export function verifyContractDeploymentManifest(
  options: ContractManifestVerifierOptions = {}
): ContractManifestCheckResult[] {
  const env = options.env ?? process.env;
  const manifestPath = contractManifestPathFromEnv(env);
  const fileExists = options.fileExists ?? existsSync;
  const readFile = options.readFile ?? ((filePath: string) => readFileSync(filePath, "utf8"));

  const checks: ContractManifestCheckResult[] = [];

  if (!fileExists(manifestPath)) {
    return [
      {
        name: "manifest_file",
        status: "fail",
        detail: `No deployment manifest found at ${manifestPath}. Run the Forge deploy script first: forge script script/Deploy.s.sol:Deploy --root smart-contracts --rpc-url "$BOTCHAIN_RPC_URL" --broadcast`
      }
    ];
  }

  checks.push({ name: "manifest_file", status: "pass", detail: `Loaded ${manifestPath}.` });

  let manifest: DeploymentManifest;
  try {
    manifest = parseManifest(readFile(manifestPath));
    checks.push({ name: "manifest_shape", status: "pass", detail: "Deployment manifest has the expected GridProof shape." });
  } catch (error) {
    checks.push({ name: "manifest_shape", status: "fail", detail: errorMessage(error) });
    return checks;
  }

  checks.push(checkNetworkIdentity(manifest, env));
  checks.push(checkActors(manifest));
  checks.push(checkContracts(manifest));
  checks.push(checkParams(manifest));
  checks.push(...checkApiEnvAlignment(manifest, env));

  return checks;
}

function contractManifestPathFromEnv(env: NodeJS.ProcessEnv): string {
  const explicitPath = env.GRIDPROOF_CONTRACT_MANIFEST_PATH?.trim();
  if (explicitPath) return resolve(explicitPath);

  const network = env.GRIDPROOF_CONTRACT_NETWORK?.trim();
  if (network) {
    return resolve("smart-contracts", "deployments", `${network}.json`);
  }

  return resolve("smart-contracts", "deployments", "botchainTestnet.json");
}

function parseManifest(raw: string): DeploymentManifest {
  const value = JSON.parse(raw) as unknown;
  const record = objectRecord(value);
  if (!record) throw new Error("Manifest must be a JSON object.");

  const contracts = objectRecord(record.contracts);
  const params = objectRecord(record.params);
  if (!contracts) throw new Error("Manifest contracts must be an object.");
  if (!params) throw new Error("Manifest params must be an object.");

  const manifest = {
    network: requiredString(record.network, "network"),
    chainId: requiredDigits(record.chainId, "chainId"),
    deployedAt: requiredDateTime(record.deployedAt, "deployedAt"),
    admin: requiredAddress(record.admin, "admin"),
    relayer: requiredAddress(record.relayer, "relayer"),
    contracts: {
      NodeRegistry: requiredAddress(contracts.NodeRegistry, "contracts.NodeRegistry"),
      UptimeAttestation: requiredAddress(contracts.UptimeAttestation, "contracts.UptimeAttestation"),
      ReputationEscrow: requiredAddress(contracts.ReputationEscrow, "contracts.ReputationEscrow")
    },
    params: {
      epochDurationSeconds: requiredDigits(params.epochDurationSeconds, "params.epochDurationSeconds"),
      slashPolicyCap: requiredDigits(params.slashPolicyCap, "params.slashPolicyCap"),
      minimumStake: requiredDigits(params.minimumStake, "params.minimumStake"),
      withdrawCooldownSeconds: requiredDigits(params.withdrawCooldownSeconds, "params.withdrawCooldownSeconds")
    }
  };

  if (BigInt(manifest.chainId) <= 0n) throw new Error("chainId must be greater than zero.");
  if (BigInt(manifest.params.epochDurationSeconds) <= 0n) {
    throw new Error("params.epochDurationSeconds must be greater than zero.");
  }

  return manifest;
}

function checkNetworkIdentity(manifest: DeploymentManifest, env: NodeJS.ProcessEnv): ContractManifestCheckResult {
  const expectedChainId = env.BOTCHAIN_CHAIN_ID?.trim();
  if (!expectedChainId) {
    return {
      name: "network_identity",
      status: "warn",
      detail: "BOTCHAIN_CHAIN_ID is not set; cannot compare API relayer chain ID to the manifest."
    };
  }

  if (expectedChainId !== manifest.chainId) {
    return {
      name: "network_identity",
      status: "fail",
      detail: `BOTCHAIN_CHAIN_ID=${expectedChainId} does not match manifest chainId=${manifest.chainId}.`
    };
  }

  return {
    name: "network_identity",
    status: "pass",
    detail: `Manifest network ${manifest.network} uses chain ID ${manifest.chainId}.`
  };
}

function checkActors(manifest: DeploymentManifest): ContractManifestCheckResult {
  const admin = manifest.admin.toLowerCase();
  const relayer = manifest.relayer.toLowerCase();
  if (admin === zeroAddress || relayer === zeroAddress) {
    return { name: "actors", status: "fail", detail: "Admin and relayer must not be the zero address." };
  }

  if (admin === relayer) {
    return {
      name: "actors",
      status: "fail",
      detail: "Admin and relayer are the same address; use a multisig/admin wallet separate from the hot relayer."
    };
  }

  return {
    name: "actors",
    status: "pass",
    detail: "Manifest uses separate non-zero admin and relayer addresses."
  };
}

function checkContracts(manifest: DeploymentManifest): ContractManifestCheckResult {
  const addresses = Object.values(manifest.contracts).map((address) => address.toLowerCase());
  if (addresses.includes(zeroAddress)) {
    return { name: "contract_addresses", status: "fail", detail: "Contract addresses must not include the zero address." };
  }

  if (new Set(addresses).size !== addresses.length) {
    return { name: "contract_addresses", status: "fail", detail: "Contract addresses must be unique." };
  }

  return {
    name: "contract_addresses",
    status: "pass",
    detail: "NodeRegistry, UptimeAttestation, and ReputationEscrow addresses are unique and non-zero."
  };
}

function checkParams(manifest: DeploymentManifest): ContractManifestCheckResult {
  const epochDurationSeconds = BigInt(manifest.params.epochDurationSeconds);
  const withdrawCooldownSeconds = BigInt(manifest.params.withdrawCooldownSeconds);

  if (epochDurationSeconds > 86_400n) {
    return {
      name: "contract_params",
      status: "warn",
      detail: "Epoch duration is longer than one day; confirm this is intentional for the demo cadence."
    };
  }

  if (withdrawCooldownSeconds === 0n) {
    return {
      name: "contract_params",
      status: "warn",
      detail: "Withdraw cooldown is zero; acceptable for local tests, but document the risk before a live fallback-mode demo."
    };
  }

  return {
    name: "contract_params",
    status: "pass",
    detail: "Epoch duration and escrow timing parameters are non-zero and demo-compatible."
  };
}

function checkApiEnvAlignment(manifest: DeploymentManifest, env: NodeJS.ProcessEnv): ContractManifestCheckResult[] {
  return [
    compareAddressEnv("env_node_registry", "BOTCHAIN_NODE_REGISTRY_ADDRESS", manifest.contracts.NodeRegistry, env),
    compareAddressEnv("env_uptime_attestation", "BOTCHAIN_UPTIME_ATTESTATION_ADDRESS", manifest.contracts.UptimeAttestation, env),
    compareAddressEnv("env_reputation_escrow", "BOTCHAIN_REPUTATION_ESCROW_ADDRESS", manifest.contracts.ReputationEscrow, env)
  ];
}

function compareAddressEnv(
  name: string,
  envName: string,
  manifestAddress: string,
  env: NodeJS.ProcessEnv
): ContractManifestCheckResult {
  const value = env[envName]?.trim();
  if (!value) {
    return {
      name,
      status: "warn",
      detail: `${envName} is not set; set it to ${manifestAddress} in the API service before live submission.`
    };
  }

  if (!addressPattern.test(value)) {
    return { name, status: "fail", detail: `${envName} is not a valid EVM address.` };
  }

  if (value.toLowerCase() !== manifestAddress.toLowerCase()) {
    return {
      name,
      status: "fail",
      detail: `${envName}=${value} does not match manifest address ${manifestAddress}.`
    };
  }

  return { name, status: "pass", detail: `${envName} matches the deployment manifest.` };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function requiredDigits(value: unknown, name: string): string {
  const normalized = requiredString(value, name);
  if (!/^\d+$/.test(normalized)) throw new Error(`${name} must contain only digits.`);
  return normalized;
}

function requiredDateTime(value: unknown, name: string): string {
  const normalized = requiredString(value, name);
  if (Number.isNaN(Date.parse(normalized))) throw new Error(`${name} must be a valid ISO date-time string.`);
  return normalized;
}

function requiredAddress(value: unknown, name: string): string {
  const normalized = requiredString(value, name);
  if (!addressPattern.test(normalized)) throw new Error(`${name} must be an EVM address.`);
  return normalized;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function printResults(checks: ContractManifestCheckResult[]): void {
  console.log("GridProof contract deployment manifest verification");
  for (const check of checks) {
    console.log(`${icon(check.status)} ${check.name}: ${check.detail}`);
  }

  const passed = checks.filter((check) => check.status === "pass").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  const failed = checks.filter((check) => check.status === "fail").length;
  console.log(`\nSummary: ${passed} passed, ${warnings} warning(s), ${failed} failed.`);
}

function icon(status: CheckStatus): string {
  if (status === "pass") return "✓";
  if (status === "warn") return "!";
  return "✗";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const invokedScript = process.argv[1]?.replace(/\\/g, "/");

if (invokedScript?.endsWith("/verify-contract-manifest.ts") || invokedScript?.endsWith("/verify-contract-manifest.js")) {
  try {
    main();
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
