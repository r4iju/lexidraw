import { drizzle as db, schema } from "@packages/drizzle";

export type LlmAuditEvent = {
  requestId: string;
  timestampMs: number;
  route: "/api/llm/stream" | "/api/llm/generate" | "/api/llm/agent" | "server/actions/autocomplete";
  mode: "chat" | "agent" | "autocomplete";
  userId: string;
  entityId?: string | null;
  provider: string;
  modelId: string;
  temperature: number;
  maxOutputTokens: number;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  latencyMs: number;
  stream: boolean;
  toolCalls?: { name: string; count: number }[];
  promptLen?: number;
  messagesCount?: number;
  errorCode?: string;
  errorMessage?: string;
  httpStatus?: number;
};

export async function recordLlmAudit(event: LlmAuditEvent): Promise<void> {
  const row = {
    id: undefined,
    createdAt: new Date(event.timestampMs),
    requestId: event.requestId,
    userId: event.userId,
    entityId: event.entityId ?? null,
    mode: event.mode,
    route: event.route,
    provider: event.provider,
    modelId: event.modelId,
    temperature: event.temperature,
    maxOutputTokens: event.maxOutputTokens,
    promptTokens: event.usage?.promptTokens ?? null,
    completionTokens: event.usage?.completionTokens ?? null,
    totalTokens: event.usage?.totalTokens ?? null,
    latencyMs: Math.max(0, Math.round(event.latencyMs)),
    stream: event.stream ? 1 : 0,
    toolCalls: event.toolCalls ? (event.toolCalls as unknown as string) : null,
    promptLen: event.promptLen ?? null,
    messagesCount: event.messagesCount ?? null,
    errorCode: event.errorCode ?? null,
    errorMessage: event.errorMessage ?? null,
    httpStatus: event.httpStatus ?? null,
  } as unknown as typeof schema.llmAuditEvents.$inferInsert;

  await db.insert(schema.llmAuditEvents).values(row).run();
}

export async function withTiming<T>(fn: () => Promise<T>): Promise<{ result: T; elapsedMs: number }>
{
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  return { result, elapsedMs: end - start };
}


