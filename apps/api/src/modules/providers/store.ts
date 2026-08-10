import { createHash, randomUUID } from "node:crypto";
import type { Provider, RegisterProviderRequest } from "@gridproof/shared-types";
import { isDatabaseConfigured, query } from "../../lib/db.js";
import { appendAuditLog } from "../audit/service.js";
import { demoZones } from "../dashboard/demo-data.js";

const memoryProvidersByWallet = new Map<string, Provider>();

export type RegisterProviderResult = {
  provider: Provider;
  duplicate: boolean;
};

export async function listProviders(): Promise<Provider[]> {
  if (!isDatabaseConfigured()) {
    return Array.from(memoryProvidersByWallet.values()).sort((left, right) =>
      left.walletAddress.localeCompare(right.walletAddress)
    );
  }

  const result = await query<ProviderRow>(
    `
      select id, user_id, wallet_address, provider_type, zone_id, reputation_cache, active
      from providers
      order by wallet_address asc
    `
  );

  return result.rows.map(mapProviderRow);
}

export async function registerProvider(
  input: RegisterProviderRequest,
  actorUserId: string | null = null
): Promise<RegisterProviderResult> {
  const walletAddress = input.walletAddress.toLowerCase();

  if (!isDatabaseConfigured()) {
    const existing = memoryProvidersByWallet.get(walletAddress);
    if (existing) {
      const changed =
        existing.providerType !== input.providerType || existing.zoneId !== input.zoneId || existing.active !== true;
      const provider: Provider = {
        ...existing,
        providerType: input.providerType,
        zoneId: input.zoneId,
        active: true
      };
      memoryProvidersByWallet.set(walletAddress, provider);
      if (changed) await auditProviderRegistration(provider, actorUserId, existing);
      return { provider, duplicate: !changed };
    }

    const provider: Provider = {
      id: randomUUID(),
      userId: actorUserId,
      walletAddress,
      providerType: input.providerType,
      zoneId: input.zoneId,
      reputationCache: 0,
      active: true,
      lastSeenAt: null
    };
    memoryProvidersByWallet.set(walletAddress, provider);
    await auditProviderRegistration(provider, actorUserId, null);
    return { provider, duplicate: false };
  }

  await ensureZone(input.zoneId);
  const before = await findDatabaseProviderByWallet(walletAddress);
  const result = await query<ProviderRow>(
    `
      insert into providers (wallet_address, provider_type, zone_id, active)
      values ($1, $2, $3, true)
      on conflict (wallet_address) do update
      set provider_type = excluded.provider_type,
          zone_id = excluded.zone_id,
          active = true,
          updated_at = now()
      returning id, user_id, wallet_address, provider_type, zone_id, reputation_cache, active
    `,
    [walletAddress, input.providerType, input.zoneId]
  );

  const provider = mapProviderRow(result.rows[0]);
  const duplicate =
    Boolean(before) &&
    before?.providerType === provider.providerType &&
    before.zoneId === provider.zoneId &&
    before.active === provider.active;

  if (!duplicate) await auditProviderRegistration(provider, actorUserId, before);
  return { provider, duplicate };
}

export function clearProviderStore(): void {
  memoryProvidersByWallet.clear();
}

export async function zoneKeyForProviderRegistration(zoneId: string): Promise<string> {
  if (!isDatabaseConfigured()) {
    return demoZones.find((zone) => zone.id === zoneId)?.zoneKey ?? bytes32From(`zone:${zoneId}`);
  }

  const result = await query<{ zone_key: string }>("select zone_key from zones where id = $1", [zoneId]);
  return result.rows[0]?.zone_key ?? bytes32From(`zone:${zoneId}`);
}

async function auditProviderRegistration(
  provider: Provider,
  actorUserId: string | null,
  before: Provider | null
): Promise<void> {
  await appendAuditLog({
    actorUserId,
    subjectProviderId: provider.id,
    action: before ? "provider.registration_updated" : "provider.registered",
    before: before ? { provider: before } : null,
    after: { provider }
  });
}

async function ensureZone(zoneId: string): Promise<void> {
  await query(
    `
      insert into zones (id, zone_key, name, discos_feeder_code, region, centroid_lat, centroid_lng)
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (id) do nothing
    `,
    [
      zoneId,
      bytes32From(`zone:${zoneId}`),
      `Zone ${zoneId.slice(0, 8)}`,
      `DEMO-${zoneId.slice(0, 8)}`,
      "Demo",
      8.133,
      4.25
    ]
  );
}

async function findDatabaseProviderByWallet(walletAddress: string): Promise<Provider | null> {
  const result = await query<ProviderRow>(
    `
      select id, user_id, wallet_address, provider_type, zone_id, reputation_cache, active
      from providers
      where wallet_address = $1
    `,
    [walletAddress]
  );

  const row = result.rows[0];
  return row ? mapProviderRow(row) : null;
}

function bytes32From(value: string): string {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

type ProviderRow = {
  id: string;
  user_id: string | null;
  wallet_address: string;
  provider_type: "sensor" | "reporter";
  zone_id: string;
  reputation_cache: number;
  active: boolean;
};

function mapProviderRow(row: ProviderRow | undefined): Provider {
  if (!row) throw new Error("Provider registration did not return a row");
  return {
    id: row.id,
    userId: row.user_id,
    walletAddress: row.wallet_address,
    providerType: row.provider_type,
    zoneId: row.zone_id,
    reputationCache: row.reputation_cache,
    active: row.active,
    lastSeenAt: null
  };
}
