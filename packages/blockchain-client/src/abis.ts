export const uptimeAttestationAbi = [
  "function commitEpoch(bytes32 zoneId,uint64 epochStart,uint16 uptimeBps,bytes32 evidenceHash)",
  "function getEpoch(bytes32 zoneId,uint64 epochStart) view returns (tuple(bytes32 zoneId,uint64 epochStart,uint16 uptimeBps,bytes32 evidenceHash,address submittedBy))",
  "function isCommitted(bytes32 zoneId,uint64 epochStart) view returns (bool)",
  "event EpochCommitted(bytes32 indexed zoneId,uint64 indexed epochStart,uint16 uptimeBps,bytes32 evidenceHash)"
] as const;

export const nodeRegistryAbi = [
  "function addZone(bytes32 zoneId)",
  "function removeZone(bytes32 zoneId)",
  "function register(bytes32 zoneId,uint8 providerType)",
  "function deactivate(address provider)",
  "function getProvider(address provider) view returns (tuple(bytes32 zoneId,uint8 providerType,uint64 registeredAt,bool active))",
  "function isActive(address provider) view returns (bool)",
  "function zoneOf(address provider) view returns (bytes32)",
  "event ProviderRegistered(address indexed provider,bytes32 indexed zoneId,uint8 providerType)"
] as const;

export const reputationEscrowAbi = [
  "function stake() payable",
  "function withdraw(uint256 amount)",
  "function reward(address provider,uint256 amount,bytes32 evidenceHash)",
  "function slash(address provider,uint256 amount,bytes32 reasonHash)",
  "function stakes(address provider) view returns (uint256)",
  "function reputationScore(address provider) view returns (int256)"
] as const;
