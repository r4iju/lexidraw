export type CodeModeRequest = {
  correlationId: string;
  code: string;
  initialDoc: unknown;
  toolParams?: Record<string, unknown>;
};

export type CodeModeResponse =
  | {
      correlationId: string;
      ok: true;
      newDoc?: unknown;
      ops?: unknown[];
      logs?: string[];
    }
  | {
      correlationId: string;
      ok: false;
      error: string;
      logs?: string[];
    };

export function generateCorrelationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as { randomUUID: () => string }).randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isCodeModeResponse(
  value: unknown,
  correlationId: string,
): value is CodeModeResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.correlationId !== correlationId) return false;
  if (v.ok === true) return true;
  if (v.ok === false && typeof v.error === "string") return true;
  return false;
}
