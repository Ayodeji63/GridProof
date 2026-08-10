import {
  encodeNodeRegistryRegisterCall,
  GridProofBlockchainClient,
  providerTypeIdFor
} from "@gridproof/blockchain-client";
import type { ProviderChainRegistration, RegisterProviderRequest } from "@gridproof/shared-types";
import { zoneKeyForProviderRegistration } from "./store.js";

export async function providerChainRegistrationFor(input: RegisterProviderRequest): Promise<ProviderChainRegistration> {
  const providerWallet = input.walletAddress.toLowerCase();
  const zoneKey = await zoneKeyForProviderRegistration(input.zoneId);
  const providerTypeId = providerTypeIdFor(input.providerType);
  const contractAddress = process.env.BOTCHAIN_NODE_REGISTRY_ADDRESS ?? null;
  const chainId = process.env.BOTCHAIN_CHAIN_ID ?? process.env.BOTCHAIN_TESTNET_CHAIN_ID ?? null;
  const explorerUrl = providerExplorerUrl(providerWallet, process.env.BOTCHAIN_EXPLORER_BASE_URL);
  const configured = Boolean(contractAddress && chainId);
  const data = contractAddress ? encodeNodeRegistryRegisterCall(zoneKey, input.providerType) : null;
  const onChain = await readOnChainRegistration(input, zoneKey, providerTypeId);

  return {
    configured,
    mode: "wallet_self_service",
    chainId,
    contractAddress,
    explorerUrl,
    providerWallet,
    providerType: input.providerType,
    providerTypeId,
    zoneId: input.zoneId,
    zoneKey,
    registerCall: {
      to: contractAddress,
      functionName: "register",
      args: [zoneKey, providerTypeId],
      data
    },
    onChain,
    reason: configured
      ? "Provider must call NodeRegistry.register from their own wallet; the backend cannot register a different msg.sender."
      : "Set BOTCHAIN_NODE_REGISTRY_ADDRESS and BOTCHAIN_CHAIN_ID after deployment to enable wallet self-registration."
  };
}

async function readOnChainRegistration(
  input: RegisterProviderRequest,
  expectedZoneKey: string,
  expectedProviderTypeId: 0 | 1
): Promise<ProviderChainRegistration["onChain"]> {
  const client = createClientFromEnv();
  if (!client) return null;

  try {
    const registration = await client.getProviderRegistration(input.walletAddress);
    return {
      active: registration.active,
      zoneKey: registration.zoneId,
      providerTypeId: registration.providerTypeId,
      matchesRequest:
        registration.active &&
        registration.zoneId.toLowerCase() === expectedZoneKey.toLowerCase() &&
        registration.providerTypeId === expectedProviderTypeId,
      checkedAt: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function createClientFromEnv(): GridProofBlockchainClient | null {
  const rpcUrl = process.env.BOTCHAIN_RPC_URL;
  const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY;
  const nodeRegistry = process.env.BOTCHAIN_NODE_REGISTRY_ADDRESS;
  const uptimeAttestation = process.env.BOTCHAIN_UPTIME_ATTESTATION_ADDRESS;
  const reputationEscrow = process.env.BOTCHAIN_REPUTATION_ESCROW_ADDRESS;

  if (!rpcUrl || !relayerPrivateKey || !nodeRegistry || !uptimeAttestation || !reputationEscrow) {
    return null;
  }

  return new GridProofBlockchainClient({
    rpcUrl,
    relayerPrivateKey,
    contracts: {
      NodeRegistry: nodeRegistry,
      UptimeAttestation: uptimeAttestation,
      ReputationEscrow: reputationEscrow
    }
  });
}

function providerExplorerUrl(providerWallet: string, explorerBaseUrl?: string): string | null {
  if (!explorerBaseUrl) return null;
  return `${explorerBaseUrl.replace(/\/$/, "")}/address/${providerWallet}`;
}
