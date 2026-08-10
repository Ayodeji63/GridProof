import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type CheckStatus = "pass" | "warn" | "fail";

export type DemoEvidenceCheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
};

type DemoEvidenceVerifierOptions = {
  env?: NodeJS.ProcessEnv;
  readFile?: (filePath: string) => string;
  fileExists?: (filePath: string) => boolean;
};

type DemoEvidenceManifest = {
  version: 1;
  generatedAt: string;
  project: "GridProof";
  rehearsals: DemoRehearsalEvidence[];
  backup: DemoBackupEvidence;
};

type DemoRehearsalEvidence = {
  id: string;
  completedAt: string;
  operator: string;
  mode: "sensor" | "reporter" | "hybrid";
  stack: "local" | "deployed";
  result: "pass" | "fail";
  publicWebUrl: string;
  apiBaseUrl: string;
  workerBaseUrl?: string;
  proofUrl: string;
  botChainExplorerTxUrl: string;
  deploymentVerifyLog: string;
  contractManifestPath: string;
  screenshots: DemoArtifact[];
  notes?: string;
};

type DemoBackupEvidence = {
  recordingUrlOrPath: string;
  screenshots: DemoArtifact[];
  scriptVersion: string;
};

type DemoArtifact = {
  label: string;
  urlOrPath: string;
};

function main(): void {
  const checks = verifyDemoEvidenceManifest();
  printResults(checks);

  if (checks.some((check) => check.status === "fail")) {
    process.exitCode = 1;
  }
}

export function verifyDemoEvidenceManifest(options: DemoEvidenceVerifierOptions = {}): DemoEvidenceCheckResult[] {
  const env = options.env ?? process.env;
  const manifestPath = evidenceManifestPathFromEnv(env);
  const fileExists = options.fileExists ?? existsSync;
  const readFile = options.readFile ?? ((filePath: string) => readFileSync(filePath, "utf8"));

  const checks: DemoEvidenceCheckResult[] = [];

  if (!fileExists(manifestPath)) {
    return [
      {
        name: "evidence_file",
        status: "fail",
        detail: `No demo evidence manifest found at ${manifestPath}. Copy docs/demo-evidence.example.json and fill it after rehearsals.`
      }
    ];
  }

  checks.push({ name: "evidence_file", status: "pass", detail: `Loaded ${manifestPath}.` });

  let manifest: DemoEvidenceManifest;
  try {
    manifest = parseManifest(readFile(manifestPath));
    checks.push({ name: "evidence_shape", status: "pass", detail: "Demo evidence manifest has the expected GridProof shape." });
  } catch (error) {
    checks.push({ name: "evidence_shape", status: "fail", detail: errorMessage(error) });
    return checks;
  }

  checks.push(checkRehearsalCount(manifest));
  checks.push(checkDeployedRehearsals(manifest));
  checks.push(checkRehearsalResults(manifest));
  checks.push(...checkRehearsalArtifacts(manifest));
  checks.push(checkBackup(manifest));

  return checks;
}

function evidenceManifestPathFromEnv(env: NodeJS.ProcessEnv): string {
  const manifestPath = env.GRIDPROOF_DEMO_EVIDENCE_PATH?.trim();
  if (!manifestPath) {
    throw new Error(
      "GRIDPROOF_DEMO_EVIDENCE_PATH is required. Example: GRIDPROOF_DEMO_EVIDENCE_PATH=docs/demo-evidence.json pnpm deployment:evidence"
    );
  }

  return resolve(manifestPath);
}

function parseManifest(raw: string): DemoEvidenceManifest {
  const value = JSON.parse(raw) as unknown;
  const record = objectRecord(value);
  if (!record) throw new Error("Evidence manifest must be a JSON object.");
  if (record.version !== 1) throw new Error("version must be 1.");
  if (record.project !== "GridProof") throw new Error("project must be GridProof.");

  const rehearsals = arrayOfObjects(record.rehearsals, "rehearsals").map(parseRehearsal);
  const backup = parseBackup(record.backup);

  return {
    version: 1,
    generatedAt: requiredDateTime(record.generatedAt, "generatedAt"),
    project: "GridProof",
    rehearsals,
    backup
  };
}

function parseRehearsal(value: Record<string, unknown>, index: number): DemoRehearsalEvidence {
  const prefix = `rehearsals[${index}]`;
  return {
    id: requiredString(value.id, `${prefix}.id`),
    completedAt: requiredDateTime(value.completedAt, `${prefix}.completedAt`),
    operator: requiredString(value.operator, `${prefix}.operator`),
    mode: requiredEnum(value.mode, `${prefix}.mode`, ["sensor", "reporter", "hybrid"]),
    stack: requiredEnum(value.stack, `${prefix}.stack`, ["local", "deployed"]),
    result: requiredEnum(value.result, `${prefix}.result`, ["pass", "fail"]),
    publicWebUrl: requiredUrl(value.publicWebUrl, `${prefix}.publicWebUrl`),
    apiBaseUrl: requiredUrl(value.apiBaseUrl, `${prefix}.apiBaseUrl`),
    workerBaseUrl: optionalUrl(value.workerBaseUrl, `${prefix}.workerBaseUrl`),
    proofUrl: requiredUrl(value.proofUrl, `${prefix}.proofUrl`),
    botChainExplorerTxUrl: requiredUrl(value.botChainExplorerTxUrl, `${prefix}.botChainExplorerTxUrl`),
    deploymentVerifyLog: requiredString(value.deploymentVerifyLog, `${prefix}.deploymentVerifyLog`),
    contractManifestPath: requiredString(value.contractManifestPath, `${prefix}.contractManifestPath`),
    screenshots: arrayOfObjects(value.screenshots, `${prefix}.screenshots`).map((artifact, artifactIndex) =>
      parseArtifact(artifact, `${prefix}.screenshots[${artifactIndex}]`)
    ),
    notes: optionalString(value.notes, `${prefix}.notes`)
  };
}

function parseBackup(value: unknown): DemoBackupEvidence {
  const record = objectRecord(value);
  if (!record) throw new Error("backup must be an object.");
  return {
    recordingUrlOrPath: requiredString(record.recordingUrlOrPath, "backup.recordingUrlOrPath"),
    screenshots: arrayOfObjects(record.screenshots, "backup.screenshots").map((artifact, index) =>
      parseArtifact(artifact, `backup.screenshots[${index}]`)
    ),
    scriptVersion: requiredString(record.scriptVersion, "backup.scriptVersion")
  };
}

function parseArtifact(value: Record<string, unknown>, prefix: string): DemoArtifact {
  return {
    label: requiredString(value.label, `${prefix}.label`),
    urlOrPath: requiredString(value.urlOrPath, `${prefix}.urlOrPath`)
  };
}

function checkRehearsalCount(manifest: DemoEvidenceManifest): DemoEvidenceCheckResult {
  if (manifest.rehearsals.length < 2) {
    return {
      name: "rehearsal_count",
      status: "fail",
      detail: `Expected at least 2 full rehearsals, found ${manifest.rehearsals.length}.`
    };
  }

  return {
    name: "rehearsal_count",
    status: "pass",
    detail: `Recorded ${manifest.rehearsals.length} full rehearsals.`
  };
}

function checkDeployedRehearsals(manifest: DemoEvidenceManifest): DemoEvidenceCheckResult {
  const deployedPasses = manifest.rehearsals.filter((rehearsal) => rehearsal.stack === "deployed" && rehearsal.result === "pass");
  if (deployedPasses.length < 2) {
    return {
      name: "deployed_rehearsals",
      status: "fail",
      detail: `Expected 2 passing rehearsals against the deployed stack, found ${deployedPasses.length}.`
    };
  }

  return {
    name: "deployed_rehearsals",
    status: "pass",
    detail: "Two passing deployed-stack rehearsals are recorded."
  };
}

function checkRehearsalResults(manifest: DemoEvidenceManifest): DemoEvidenceCheckResult {
  const failed = manifest.rehearsals.filter((rehearsal) => rehearsal.result === "fail");
  if (failed.length > 0) {
    return {
      name: "rehearsal_results",
      status: "fail",
      detail: `Failed rehearsal(s) still recorded: ${failed.map((rehearsal) => rehearsal.id).join(", ")}.`
    };
  }

  return {
    name: "rehearsal_results",
    status: "pass",
    detail: "All recorded rehearsals passed."
  };
}

function checkRehearsalArtifacts(manifest: DemoEvidenceManifest): DemoEvidenceCheckResult[] {
  return manifest.rehearsals.map((rehearsal) => {
    const requiredLabels = new Set(["dashboard", "proof-explorer", "bot-chain-explorer", "operations"]);
    const labels = new Set(rehearsal.screenshots.map((artifact) => artifact.label));
    const missing = [...requiredLabels].filter((label) => !labels.has(label));

    if (missing.length > 0) {
      return {
        name: `rehearsal_artifacts:${rehearsal.id}`,
        status: "fail",
        detail: `Missing required screenshot label(s): ${missing.join(", ")}.`
      };
    }

    return {
      name: `rehearsal_artifacts:${rehearsal.id}`,
      status: "pass",
      detail: "Dashboard, proof explorer, BOT Chain explorer, and operations screenshots are recorded."
    };
  });
}

function checkBackup(manifest: DemoEvidenceManifest): DemoEvidenceCheckResult {
  const labels = new Set(manifest.backup.screenshots.map((artifact) => artifact.label));
  const missing = ["dashboard", "proof-explorer", "bot-chain-explorer"].filter((label) => !labels.has(label));
  if (missing.length > 0) {
    return {
      name: "backup_artifacts",
      status: "fail",
      detail: `Backup is missing required screenshot label(s): ${missing.join(", ")}.`
    };
  }

  return {
    name: "backup_artifacts",
    status: "pass",
    detail: "Backup recording and screenshot set are recorded."
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, name);
}

function requiredDateTime(value: unknown, name: string): string {
  const normalized = requiredString(value, name);
  if (Number.isNaN(Date.parse(normalized))) throw new Error(`${name} must be a valid ISO date-time string.`);
  return normalized;
}

function requiredUrl(value: unknown, name: string): string {
  const normalized = requiredString(value, name);
  try {
    return new URL(normalized).toString();
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
}

function optionalUrl(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredUrl(value, name);
}

function requiredEnum<const T extends readonly string[]>(value: unknown, name: string, allowed: T): T[number] {
  if (typeof value === "string" && allowed.includes(value)) return value;
  throw new Error(`${name} must be one of ${allowed.join(", ")}.`);
}

function arrayOfObjects(value: unknown, name: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value.map((item, index) => {
    const record = objectRecord(item);
    if (!record) throw new Error(`${name}[${index}] must be an object.`);
    return record;
  });
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function printResults(checks: DemoEvidenceCheckResult[]): void {
  console.log("GridProof demo evidence verification");
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

if (invokedScript?.endsWith("/verify-demo-evidence.ts") || invokedScript?.endsWith("/verify-demo-evidence.js")) {
  try {
    main();
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
