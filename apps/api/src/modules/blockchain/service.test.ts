import { describe, expect, it } from "vitest";
import { commitInputFromPending, confirmationUpdateFromReceipt, explorerUrlForTx } from "./service.js";

describe("blockchain submission service", () => {
  it("derives UptimeAttestation commit input from a pending commitment row", () => {
    const input = commitInputFromPending({
      commitment_id: "commitment-1",
      zone_key: `0x${"a".repeat(64)}`,
      epoch_start: new Date("2026-08-09T12:00:00.000Z"),
      uptime_bps: 5000,
      evidence_hash: `0x${"e".repeat(64)}`
    });

    expect(input).toEqual({
      zoneId: `0x${"a".repeat(64)}`,
      epochStart: 1786276800n,
      uptimeBps: 5000,
      evidenceHash: `0x${"e".repeat(64)}`
    });
  });

  it("maps successful chain receipts to confirmed commitment updates", () => {
    const update = confirmationUpdateFromReceipt(
      {
        hash: `0x${"9".repeat(64)}`,
        blockNumber: 4242,
        status: 1
      },
      "https://explorer.botchain.test/"
    );

    expect(update).toMatchObject({
      status: "confirmed",
      blockNumber: 4242,
      explorerUrl: `https://explorer.botchain.test/tx/0x${"9".repeat(64)}`
    });
    expect(update?.confirmedAt).toEqual(expect.any(String));
  });

  it("maps reverted chain receipts to failed commitment updates", () => {
    const update = confirmationUpdateFromReceipt({
      hash: `0x${"8".repeat(64)}`,
      blockNumber: 4243,
      status: 0
    });

    expect(update).toEqual({
      status: "failed",
      blockNumber: 4243,
      explorerUrl: null,
      confirmedAt: null
    });
  });

  it("keeps missing or pending receipts unresolved", () => {
    expect(confirmationUpdateFromReceipt(null)).toBeNull();
    expect(
      confirmationUpdateFromReceipt({
        hash: `0x${"7".repeat(64)}`,
        blockNumber: 4244,
        status: null
      })
    ).toBeNull();
  });

  it("builds explorer transaction URLs without double slashes", () => {
    expect(explorerUrlForTx(`0x${"6".repeat(64)}`, "https://explorer.botchain.test/")).toBe(
      `https://explorer.botchain.test/tx/0x${"6".repeat(64)}`
    );
    expect(explorerUrlForTx(`0x${"6".repeat(64)}`)).toBeNull();
  });
});
