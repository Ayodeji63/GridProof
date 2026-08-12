const GRIDPROOF_TIME_ZONE = "Africa/Lagos";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: GRIDPROOF_TIME_ZONE
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: GRIDPROOF_TIME_ZONE
});

export function formatGridProofDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return `${dateFormatter.format(date)} at ${timeFormatter.format(date)} WAT`;
}
