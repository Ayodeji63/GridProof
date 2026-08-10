import { Contract, Interface, JsonRpcProvider, Wallet, type ContractTransactionResponse } from "ethers";
import { z } from "zod";
import { bytes32Schema, providerTypeSchema, walletAddressSchema, type ProviderType } from "@gridproof/shared-types";
import { nodeRegistryAbi, reputationEscrowAbi, uptimeAttestationAbi } from "./abis.js";

export const blockchainClientConfigSchema = z.object({
  rpcUrl: z.string().url(),
  relayerPrivateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  contracts: z.object({
    NodeRegistry: walletAddressSchema,
    UptimeAttestation: walletAddressSchema,
    ReputationEscrow: walletAddressSchema
  })
});
export type BlockchainClientConfig = z.infer<typeof blockchainClientConfigSchema>;

export type CommitEpochInput = {
  zoneId: z.infer<typeof bytes32Schema>;
  epochStart: bigint;
  uptimeBps: number;
  evidenceHash: z.infer<typeof bytes32Schema>;
};

export type ChainTransactionReceipt = {
  hash: string;
  blockNumber: number;
  status: 0 | 1 | null;
};

export type NodeRegistryProvider = {
  zoneId: z.infer<typeof bytes32Schema>;
  providerTypeId: 0 | 1;
  registeredAt: bigint;
  active: boolean;
};

const nodeRegistryInterface = new Interface(nodeRegistryAbi);

export class GridProofBlockchainClient {
  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet;
  readonly nodeRegistry: Contract;
  readonly uptimeAttestation: Contract;
  readonly reputationEscrow: Contract;

  constructor(config: BlockchainClientConfig) {
    const parsed = blockchainClientConfigSchema.parse(config);
    this.provider = new JsonRpcProvider(parsed.rpcUrl);
    this.signer = new Wallet(parsed.relayerPrivateKey, this.provider);
    this.nodeRegistry = new Contract(parsed.contracts.NodeRegistry, nodeRegistryAbi, this.signer);
    this.uptimeAttestation = new Contract(parsed.contracts.UptimeAttestation, uptimeAttestationAbi, this.signer);
    this.reputationEscrow = new Contract(parsed.contracts.ReputationEscrow, reputationEscrowAbi, this.signer);
  }

  async commitEpoch(input: CommitEpochInput): Promise<ContractTransactionResponse> {
    bytes32Schema.parse(input.zoneId);
    bytes32Schema.parse(input.evidenceHash);
    if (!Number.isInteger(input.uptimeBps) || input.uptimeBps < 0 || input.uptimeBps > 10_000) {
      throw new Error("uptimeBps must be an integer from 0 to 10000");
    }

    const commitEpoch = this.uptimeAttestation.commitEpoch as (
      zoneId: string,
      epochStart: bigint,
      uptimeBps: number,
      evidenceHash: string
    ) => Promise<ContractTransactionResponse>;

    return commitEpoch(
      input.zoneId,
      input.epochStart,
      input.uptimeBps,
      input.evidenceHash
    );
  }

  async isCommitted(zoneId: string, epochStart: bigint): Promise<boolean> {
    bytes32Schema.parse(zoneId);
    const isCommitted = this.uptimeAttestation.isCommitted as (zoneId: string, epochStart: bigint) => Promise<boolean>;
    return isCommitted(zoneId, epochStart);
  }

  async getTransactionReceipt(txHash: string): Promise<ChainTransactionReceipt | null> {
    const receipt = await this.provider.getTransactionReceipt(txHash);
    if (!receipt) return null;

    return {
      hash: receipt.hash,
      blockNumber: receipt.blockNumber,
      status: receipt.status as 0 | 1 | null
    };
  }

  async getProviderRegistration(providerWallet: string): Promise<NodeRegistryProvider> {
    walletAddressSchema.parse(providerWallet);
    const getProvider = this.nodeRegistry.getProvider as (provider: string) => Promise<{
      zoneId: string;
      providerType: bigint | number;
      registeredAt: bigint | number;
      active: boolean;
    }>;
    const provider = await getProvider(providerWallet);
    const providerTypeId = Number(provider.providerType);
    if (providerTypeId !== 0 && providerTypeId !== 1) {
      throw new Error(`Unexpected NodeRegistry provider type ${providerTypeId}`);
    }

    return {
      zoneId: bytes32Schema.parse(provider.zoneId),
      providerTypeId,
      registeredAt: BigInt(provider.registeredAt),
      active: provider.active
    };
  }
}

export function providerTypeIdFor(providerType: ProviderType): 0 | 1 {
  providerTypeSchema.parse(providerType);
  return providerType === "sensor" ? 0 : 1;
}

export function encodeNodeRegistryRegisterCall(zoneId: string, providerType: ProviderType): string {
  bytes32Schema.parse(zoneId);
  return nodeRegistryInterface.encodeFunctionData("register", [zoneId, providerTypeIdFor(providerType)]);
}
