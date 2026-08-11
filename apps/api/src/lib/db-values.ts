/**
 * PostgreSQL's `pg` driver returns `bigint` (`int8`) columns as strings so it
 * does not silently lose precision. API block numbers are JSON numbers, so
 * convert them only after proving the value is a non-negative safe integer.
 */
export function blockNumberFromDatabase(value: string | number | null): number | null {
  if (value === null) return null;

  const blockNumber = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
    throw new Error(`Invalid database block number: ${value}`);
  }

  return blockNumber;
}
