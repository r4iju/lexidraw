/**
 * Every failure the CLI reports. `code` is the contract: it stays stable while
 * the message is free to change, so a caller can branch on it.
 */
export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: { exitCode?: number; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details ?? {};
  }
}

/** Anything the caller typed wrong, which is worth a distinct exit code. */
export function usageError(
  message: string,
  details?: Record<string, unknown>,
): CliError {
  return new CliError("USAGE", message, { exitCode: 2, details });
}

export function formatError(error: unknown): string {
  if (error instanceof CliError) {
    return JSON.stringify(
      { code: error.code, message: error.message, ...error.details },
      null,
      2,
    );
  }
  return JSON.stringify(
    { code: "INTERNAL", message: describe(error) },
    null,
    2,
  );
}

export function exitCodeOf(error: unknown): number {
  return error instanceof CliError ? error.exitCode : 1;
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
