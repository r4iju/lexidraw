/**
 * What a log line may say about a failure. A Drizzle query error's message
 * quotes the query's parameters, which on `Users` include password hashes, so
 * only the driver's code or the error's name is kept.
 */
export function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const cause = error.cause as { code?: unknown } | undefined;
  return typeof cause?.code === "string" ? cause.code : error.name;
}
