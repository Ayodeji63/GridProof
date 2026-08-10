import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { clearAuditLogStore, listMemoryAuditLogs } from "../audit/service.js";
import { clearProviderStore, listProviders, registerProvider, zoneKeyForProviderRegistration } from "./store.js";

const zoneId = "8a27f3e2-2608-4a88-b8db-efce68be2a59";
const otherZoneId = "378b2fae-55dd-488f-aefd-c9bc17f8d4ff";

describe("provider store", () => {
  afterEach(() => {
    clearProviderStore();
    clearAuditLogStore();
    delete process.env.DATABASE_URL;
  });

  it("lowercases wallet addresses, stores providers, and lists them in wallet order", async () => {
    await registerProvider({
      walletAddress: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      providerType: "sensor",
      zoneId
    });
    const { provider } = await registerProvider({
      walletAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      providerType: "reporter",
      zoneId: otherZoneId
    });

    expect(provider.walletAddress).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect((await listProviders()).map((item) => item.walletAddress)).toEqual([
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    ]);
  });

  it("treats unchanged registrations as duplicates without extra audit noise", async () => {
    const input = {
      walletAddress: "0x1111111111111111111111111111111111111111",
      providerType: "reporter" as const,
      zoneId
    };
    const first = await registerProvider(input, "7af7b612-2b58-4ed4-87bc-a2eb02225729");
    const second = await registerProvider(input, "7af7b612-2b58-4ed4-87bc-a2eb02225729");

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.provider).toEqual(first.provider);
    expect(listMemoryAuditLogs("provider.registered")).toHaveLength(1);
    expect(listMemoryAuditLogs("provider.registration_updated")).toHaveLength(0);
  });

  it("audits material provider registration updates", async () => {
    const input = {
      walletAddress: "0x1111111111111111111111111111111111111111",
      providerType: "reporter" as const,
      zoneId
    };
    await registerProvider(input);
    const updated = await registerProvider({ ...input, providerType: "sensor", zoneId: otherZoneId });

    const updateAudit = listMemoryAuditLogs("provider.registration_updated")[0];
    expect(updated.duplicate).toBe(false);
    expect(updated.provider).toMatchObject({ providerType: "sensor", zoneId: otherZoneId, active: true });
    if (!updateAudit) throw new Error("Expected provider update audit log");
    expect(updateAudit.before?.provider).toMatchObject({ providerType: "reporter", zoneId });
    expect(updateAudit.after?.provider).toMatchObject({ providerType: "sensor", zoneId: otherZoneId });
  });

  it("uses configured demo zone keys and deterministic bytes32 fallback keys", async () => {
    const unknownZoneId = "86fd83e9-e32a-4bc1-a7bf-2859992573f5";

    expect(await zoneKeyForProviderRegistration(zoneId)).toBe(`0x${"a".repeat(64)}`);
    expect(await zoneKeyForProviderRegistration(unknownZoneId)).toBe(bytes32From(`zone:${unknownZoneId}`));
  });
});

function bytes32From(value: string): string {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}
