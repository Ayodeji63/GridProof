import type { EvidenceEvent } from "@gridproof/shared-types";

/**
 * Stable identity of the device or person behind an evidence event.
 *
 * Corroboration is counted per real-world witness, not per row: ten readings from
 * one ESP32 are one witness, not ten. `providerId` alone is not usable for this,
 * because the in-memory ingestion path mints a fresh UUID per event, so prefer the
 * device/wallet identity carried in `rawPayload` and fall back to `providerId`.
 */
export function evidenceSourceIdentity(evidence: EvidenceEvent): string {
  const payload = evidence.rawPayload;

  const deviceId = trimmedString(payload.deviceId);
  if (deviceId) return `device:${deviceId.toLowerCase()}`;

  const reporterWallet = trimmedString(payload.reporterWallet);
  if (reporterWallet) return `wallet:${reporterWallet.toLowerCase()}`;

  const providerWallet = trimmedString(payload.providerWallet);
  if (providerWallet) return `wallet:${providerWallet.toLowerCase()}`;

  return `provider:${evidence.providerId}`;
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
