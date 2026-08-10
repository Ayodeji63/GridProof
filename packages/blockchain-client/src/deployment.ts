import { readFileSync } from "node:fs";
import { z } from "zod";
import { walletAddressSchema } from "@gridproof/shared-types";
import { blockchainClientConfigSchema, type BlockchainClientConfig } from "./client.js";

export const deploymentManifestSchema = z.object({
  network: z.string().min(1),
  chainId: z.string().regex(/^\d+$/),
  deployedAt: z.string().datetime({ offset: true }),
  admin: walletAddressSchema,
  relayer: walletAddressSchema,
  contracts: z.object({
    NodeRegistry: walletAddressSchema,
    UptimeAttestation: walletAddressSchema,
    ReputationEscrow: walletAddressSchema
  }),
  params: z.object({
    epochDurationSeconds: z.string().regex(/^\d+$/),
    slashPolicyCap: z.string().regex(/^\d+$/),
    minimumStake: z.string().regex(/^\d+$/),
    withdrawCooldownSeconds: z.string().regex(/^\d+$/)
  })
});
export type DeploymentManifest = z.infer<typeof deploymentManifestSchema>;

export function parseDeploymentManifest(value: unknown): DeploymentManifest {
  return deploymentManifestSchema.parse(value);
}

export function loadDeploymentManifest(filePath: string): DeploymentManifest {
  return parseDeploymentManifest(JSON.parse(readFileSync(filePath, "utf8")));
}

export function blockchainConfigFromDeployment(input: {
  manifest: DeploymentManifest;
  rpcUrl: string;
  relayerPrivateKey: string;
}): BlockchainClientConfig {
  return blockchainClientConfigSchema.parse({
    rpcUrl: input.rpcUrl,
    relayerPrivateKey: input.relayerPrivateKey,
    contracts: input.manifest.contracts
  });
}
