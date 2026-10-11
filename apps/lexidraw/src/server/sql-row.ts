import { z } from "zod";

// libSQL supports number, bigint and decimal string integer modes. Reject
// precision loss before a persisted count, timestamp or amount enters a domain.
export const SqlInteger = z.union([
  z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  z.bigint().min(0n).max(BigInt(Number.MAX_SAFE_INTEGER)).transform(Number),
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
]);
export const SqlSum = SqlInteger.nullable().transform((value) => value ?? 0);
export const SqlFlag = SqlInteger.pipe(z.union([z.literal(0), z.literal(1)]));
