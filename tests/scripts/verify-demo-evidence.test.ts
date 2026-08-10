import { describe, expect, it } from "vitest";

import {
  verifyDemoEvidenceManifest,
  type DemoEvidenceCheckResult
} from "../../scripts/verify-demo-evidence.ts";

const evidencePath = "/tmp/gridproof-demo-evidence.json";

const rehearsalBase = {
  completedAt: "2026-08-09T13:00:00.000Z",
  operator: "GridProof demo operator",
  mode: "hybrid",
  stack: "deployed",
  result: "pass",
  publicWebUrl: "https://gridproof.example",
  apiBaseUrl: "https://api.gridproof.example/api/v1",
  workerBaseUrl: "https://worker.gridproof.example",
  proofUrl: "https://gridproof.example/proof/11111111-1111-4111-8111-111111111111/latest",
  botChainExplorerTxUrl: `https://explorer.botchain.example/tx/0x${"b".repeat(64)}`,
  deploymentVerifyLog: "artifacts/rehearsal-1/deployment-verify.log",
  contractManifestPath: "smart-contracts/deployments/botchainTestnet.json",
  screenshots: [
    { label: "dashboard", urlOrPath: "artifacts/rehearsal-1/dashboard.png" },
    { label: "proof-explorer", urlOrPath: "artifacts/rehearsal-1/proof.png" },
    { label: "bot-chain-explorer", urlOrPath: "artifacts/rehearsal-1/explorer.png" },
    { label: "operations", urlOrPath: "artifacts/rehearsal-1/operations.png" }
  ]
} as const;

const manifest = {
  version: 1,
  generatedAt: "2026-08-09T14:00:00.000Z",
  project: "GridProof",
  rehearsals: [
    {
      ...rehearsalBase,
      id: "live-rehearsal-1"
    },
    {
      ...rehearsalBase,
      id: "live-rehearsal-2",
      completedAt: "2026-08-09T14:00:00.000Z",
      deploymentVerifyLog: "artifacts/rehearsal-2/deployment-verify.log",
      screenshots: rehearsalBase.screenshots.map((screenshot) => ({
        ...screenshot,
        urlOrPath: screenshot.urlOrPath.replace("rehearsal-1", "rehearsal-2")
      }))
    }
  ],
  backup: {
    recordingUrlOrPath: "artifacts/backup/gridproof-demo-backup.mp4",
    scriptVersion: "docs/demo-script.md@2026-08-09",
    screenshots: [
      { label: "dashboard", urlOrPath: "artifacts/backup/dashboard.png" },
      { label: "proof-explorer", urlOrPath: "artifacts/backup/proof.png" },
      { label: "bot-chain-explorer", urlOrPath: "artifacts/backup/explorer.png" }
    ]
  }
} as const;

describe("verifyDemoEvidenceManifest", () => {
  it("passes when two deployed rehearsals and backup artifacts are recorded", () => {
    const checks = verifyDemoEvidenceManifest({
      env: { GRIDPROOF_DEMO_EVIDENCE_PATH: evidencePath },
      ...evidenceIo(manifest)
    });

    expect(statuses(checks)).toMatchObject({
      evidence_file: "pass",
      evidence_shape: "pass",
      rehearsal_count: "pass",
      deployed_rehearsals: "pass",
      rehearsal_results: "pass",
      "rehearsal_artifacts:live-rehearsal-1": "pass",
      "rehearsal_artifacts:live-rehearsal-2": "pass",
      backup_artifacts: "pass"
    });
  });

  it("fails when fewer than two deployed-stack rehearsals passed", () => {
    const checks = verifyDemoEvidenceManifest({
      env: { GRIDPROOF_DEMO_EVIDENCE_PATH: evidencePath },
      ...evidenceIo({
        ...manifest,
        rehearsals: [
          manifest.rehearsals[0],
          {
            ...manifest.rehearsals[1],
            stack: "local"
          }
        ]
      })
    });

    expect(byName(checks, "deployed_rehearsals")).toMatchObject({
      status: "fail",
      detail: "Expected 2 passing rehearsals against the deployed stack, found 1."
    });
  });

  it("fails when a recorded rehearsal did not pass", () => {
    const checks = verifyDemoEvidenceManifest({
      env: { GRIDPROOF_DEMO_EVIDENCE_PATH: evidencePath },
      ...evidenceIo({
        ...manifest,
        rehearsals: [
          manifest.rehearsals[0],
          {
            ...manifest.rehearsals[1],
            result: "fail"
          }
        ]
      })
    });

    expect(byName(checks, "rehearsal_results")).toMatchObject({
      status: "fail",
      detail: "Failed rehearsal(s) still recorded: live-rehearsal-2."
    });
  });

  it("fails when required rehearsal screenshots are missing", () => {
    const checks = verifyDemoEvidenceManifest({
      env: { GRIDPROOF_DEMO_EVIDENCE_PATH: evidencePath },
      ...evidenceIo({
        ...manifest,
        rehearsals: [
          {
            ...manifest.rehearsals[0],
            screenshots: manifest.rehearsals[0].screenshots.filter((screenshot) => screenshot.label !== "operations")
          },
          manifest.rehearsals[1]
        ]
      })
    });

    expect(byName(checks, "rehearsal_artifacts:live-rehearsal-1")).toMatchObject({
      status: "fail",
      detail: "Missing required screenshot label(s): operations."
    });
  });

  it("fails when the backup proof screenshots are incomplete", () => {
    const checks = verifyDemoEvidenceManifest({
      env: { GRIDPROOF_DEMO_EVIDENCE_PATH: evidencePath },
      ...evidenceIo({
        ...manifest,
        backup: {
          ...manifest.backup,
          screenshots: manifest.backup.screenshots.filter((screenshot) => screenshot.label !== "bot-chain-explorer")
        }
      })
    });

    expect(byName(checks, "backup_artifacts")).toMatchObject({
      status: "fail",
      detail: "Backup is missing required screenshot label(s): bot-chain-explorer."
    });
  });

  it("fails clearly when no evidence manifest path is configured", () => {
    expect(() =>
      verifyDemoEvidenceManifest({
        env: {},
        ...evidenceIo(manifest)
      })
    ).toThrow("GRIDPROOF_DEMO_EVIDENCE_PATH is required");
  });

  it("fails clearly when the evidence file has not been created yet", () => {
    const checks = verifyDemoEvidenceManifest({
      env: { GRIDPROOF_DEMO_EVIDENCE_PATH: evidencePath },
      fileExists: () => false,
      readFile: () => {
        throw new Error("should not read missing files");
      }
    });

    expect(checks).toEqual([
      {
        name: "evidence_file",
        status: "fail",
        detail: `No demo evidence manifest found at ${evidencePath}. Copy docs/demo-evidence.example.json and fill it after rehearsals.`
      }
    ]);
  });
});

function evidenceIo(value: unknown): {
  fileExists: (filePath: string) => boolean;
  readFile: (filePath: string) => string;
} {
  return {
    fileExists: (filePath) => filePath === evidencePath,
    readFile: (filePath) => {
      if (filePath !== evidencePath) throw new Error(`Unexpected evidence path ${filePath}`);
      return JSON.stringify(value);
    }
  };
}

function statuses(checks: DemoEvidenceCheckResult[]): Record<string, DemoEvidenceCheckResult["status"]> {
  return Object.fromEntries(checks.map((check) => [check.name, check.status]));
}

function byName(checks: DemoEvidenceCheckResult[], name: string): DemoEvidenceCheckResult {
  const check = checks.find((candidate) => candidate.name === name);
  if (!check) throw new Error(`Missing check ${name}`);
  return check;
}
