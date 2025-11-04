import { z } from "zod";

export const TextDeltaEventSchema = z.object({
  type: z.literal("text-delta"),
  id: z.string(),
  runId: z.string(),
  messageId: z.string(),
  delta: z.string(),
});

export const ToolCallEventSchema = z.object({
  type: z.literal("tool-call"),
  id: z.string(),
  runId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.record(z.string(), z.unknown()),
  hookToken: z.string(),
});

export const FinishEventSchema = z.object({
  type: z.literal("finish"),
  id: z.string(),
  runId: z.string(),
  summary: z.string().optional(),
});

export const ErrorEventSchema = z.object({
  type: z.literal("error"),
  id: z.string(),
  runId: z.string(),
  message: z.string(),
  code: z.string().optional(),
});

export const HeartbeatEventSchema = z.object({
  type: z.literal("heartbeat"),
  id: z.string(),
  runId: z.string(),
  ts: z.number(),
});

export const AgentEventSchema = z.discriminatedUnion("type", [
  TextDeltaEventSchema,
  ToolCallEventSchema,
  FinishEventSchema,
  ErrorEventSchema,
  HeartbeatEventSchema,
]);

export type TextDeltaEvent = z.infer<typeof TextDeltaEventSchema>;
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;
export type FinishEvent = z.infer<typeof FinishEventSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
export type HeartbeatEvent = z.infer<typeof HeartbeatEventSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const ToolCallbackBodySchema = z.object({
  hookToken: z.string(),
  toolCallId: z.string(),
  result: z.unknown(),
});

export type ToolCallbackBody = z.infer<typeof ToolCallbackBodySchema>;
