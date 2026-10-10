import { z } from "zod";
import { Usage, SUBCREDITS } from "~/server/pro/contracts";
import { ImageCompletion, ImagePricebook } from "~/lib/images/contracts";
export const AGENT_BOOK = {
  version: "private-agent-2026-10-v1",
  provider: "openai",
  model: "gpt-5.4-mini",
  inputNanoUsd: 750,
  cachedInputNanoUsd: 75,
  outputNanoUsd: 4500,
  creditNanoUsd: 3_000_000,
  maxInputTokens: 4096,
  maxOutputTokens: 512,
  maxInputBytes: 1500,
  maxElapsedMs: 120_000,
  maxCycles: 6,
  maxTools: 8,
  maxTextSteps: 13,
  maxSearchSteps: 2,
  maxImageSteps: 0,
  maxAttempts: 15,
  textMaximumNanoUsd: 5_376_000,
  searchMaximumNanoUsd: 5_000_000,
  maximumNanoUsd: 79_888_000,
  quote: 26_629_334,
  provenance: "published-reference-unverified-account" as const,
};
export const SandboxTask = z.strictObject({
  kind: z.literal("summarize_numbers"),
  values: z
    .array(z.number().finite().min(-1000000).max(1000000))
    .min(1)
    .max(100),
});
export type SandboxTask = z.infer<typeof SandboxTask>;
export const SandboxBook = z.strictObject({
  provider: z.string().min(1).max(100),
  endpoint: z.literal("typed-task-v1"),
  maximumNanoUsd: z.number().int().positive().max(100000000),
  maxSteps: z.literal(2),
  maxDurationMs: z.literal(6000),
  maxInputBytes: z.literal(4096),
  maxOutputBytes: z.literal(1500),
  network: z.literal("none"),
  secrets: z.literal("none"),
});
export const AgentBook = z
  .strictObject({
    version: z.string(),
    provider: z.literal("openai"),
    model: z.string().min(1),
    inputNanoUsd: z.number().int().nonnegative().max(1_000_000),
    cachedInputNanoUsd: z.number().int().nonnegative().max(1_000_000),
    outputNanoUsd: z.number().int().nonnegative().max(1_000_000),
    creditNanoUsd: z.number().int().positive(),
    maxInputTokens: z.literal(4096),
    maxOutputTokens: z.literal(512),
    maxInputBytes: z.literal(1500),
    maxElapsedMs: z.literal(120000),
    maxCycles: z.literal(6),
    maxTools: z.literal(8),
    maxTextSteps: z.literal(13),
    maxSearchSteps: z.literal(2),
    maxImageSteps: z.union([z.literal(0), z.literal(1)]),
    maxAttempts: z.number().int().min(15).max(18),
    sandbox: SandboxBook.optional(),
    delegation: z
      .strictObject({
        maxDepth: z.literal(1),
        maxCalls: z.literal(1),
        maxCycles: z.literal(2),
      })
      .optional(),
    textMaximumNanoUsd: z.number().int().positive(),
    searchMaximumNanoUsd: z.number().int().positive(),
    maximumNanoUsd: z.number().int().positive(),
    quote: z.number().int().positive(),
    provenance: z.enum([
      "published-reference-unverified-account",
      "deterministic-whole-action-fixture",
    ]),
    image: ImagePricebook.optional(),
  })
  .superRefine((x, ctx) => {
    const textMaximum =
      x.maxInputTokens * x.inputNanoUsd + x.maxOutputTokens * x.outputNanoUsd;
    const maximum =
      x.maxTextSteps * x.textMaximumNanoUsd +
      x.maxSearchSteps * x.searchMaximumNanoUsd +
      (x.image?.maximumNanoUsd ?? 0) +
      (x.sandbox ? x.sandbox.maximumNanoUsd * x.sandbox.maxSteps : 0);
    if (
      x.textMaximumNanoUsd !== textMaximum ||
      !Number.isSafeInteger(maximum * SUBCREDITS) ||
      x.maximumNanoUsd !== maximum ||
      x.quote !== Math.ceil((maximum * SUBCREDITS) / x.creditNanoUsd) ||
      x.maxImageSteps !== (x.image ? 1 : 0) ||
      x.maxAttempts !== 15 + (x.image ? 1 : 0) + (x.sandbox?.maxSteps ?? 0) ||
      (x.image && x.provenance !== "deterministic-whole-action-fixture")
    )
      ctx.addIssue({
        code: "custom",
        message: "Complete verified action bound required",
      });
  });
export type AgentBook = z.infer<typeof AgentBook>;
export const AgentInput = z
  .strictObject({
    idempotencyKey: z.string().min(1).max(100),
    documentId: z.string().min(1).max(100),
    revision: z.number().int().nonnegative(),
    prompt: z.string().min(1).max(1500),
    acceptedMaximum: z.number().int().nonnegative(),
  })
  .refine(
    (x) => new TextEncoder().encode(x.prompt).length <= 1500,
    "Prompt exceeds bounded input",
  );
export type AgentInput = z.infer<typeof AgentInput>;
export const Phase = z.enum([
  "plan",
  "decision",
  "generation",
  "search",
  "image",
  "sandbox",
  "delegate_plan",
  "delegate_generation",
]);
export type Phase = z.infer<typeof Phase>;
export const AgentAttemptDescriptor = z.strictObject({
  key: z.string().min(1).max(100),
  phase: Phase,
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type AgentAttemptDescriptor = z.infer<typeof AgentAttemptDescriptor>;
export const Plan = z.strictObject({
  edits: z.array(z.string().min(1).max(200)).min(1).max(6),
});
const optionalQuery = { query: z.string().max(300).optional() };
export const Decision = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("append"), ...optionalQuery }),
  z.object({ kind: z.literal("search"), query: z.string().min(1).max(300) }),
  z.object({ kind: z.literal("image"), ...optionalQuery }),
  z.object({ kind: z.literal("sandbox"), task: SandboxTask, ...optionalQuery }),
  z.object({
    kind: z.literal("delegate"),
    objective: z.string().min(1).max(300),
    ...optionalQuery,
  }),
  z.object({ kind: z.literal("done"), ...optionalQuery }),
]);
export const DelegatedPlan = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("generate") }),
  z.strictObject({ kind: z.literal("sandbox"), task: SandboxTask }),
]);
export const Delegation = z.strictObject({
  depth: z.literal(1),
  objective: z.string().min(1).max(300),
});
const requestFields = {
  prompt: z.string().min(1).max(1500),
  context: z.string().max(4096),
  query: z.string().max(300).optional(),
  progress: z
    .strictObject({
      planned: z.array(z.string().min(1).max(200)).max(6),
      completed: z.number().int().min(0).max(6),
    })
    .optional(),
  task: z.never().optional(),
  delegation: z.never().optional(),
};
export const AgentRequest = z
  .discriminatedUnion("phase", [
    z.strictObject({
      ...requestFields,
      phase: z.enum(["plan", "decision", "generation", "search", "image"]),
    }),
    z.strictObject({
      ...requestFields,
      phase: z.literal("sandbox"),
      task: SandboxTask,
      delegation: Delegation.optional(),
    }),
    z.strictObject({
      ...requestFields,
      phase: z.enum(["delegate_plan", "delegate_generation"]),
      delegation: Delegation,
    }),
  ])
  .refine(
    (x) => new TextEncoder().encode(JSON.stringify(x)).length + 1024 <= 4096,
    "Approved bounded request required",
  );
export type AgentRequest = z.infer<typeof AgentRequest>;
export const Generation = z.strictObject({
  text: z
    .string()
    .min(1)
    .max(1500)
    .refine(
      (x) => new TextEncoder().encode(x).length <= 1500,
      "Output byte cap exceeded",
    ),
});
export const Search = z.strictObject({
  results: z
    .array(
      z.strictObject({
        title: z.string().max(200),
        url: z.url().max(1000),
        snippet: z.string().max(500),
      }),
    )
    .max(5),
});
export const AgentCompletion = z
  .strictObject({
    kind: z.literal("agent"),
    phase: Phase,
    output: z.unknown(),
    usage: Usage,
    actualCostNanoUsd: z.number().int().nonnegative().optional(),
    estimatedCostNanoUsd: z.number().int().nonnegative().optional(),
    providerResponseId: z.string().max(200).optional(),
  })
  .superRefine((x, ctx) => {
    const schema =
      x.phase === "plan"
        ? Plan
        : x.phase === "decision"
          ? Decision
          : x.phase === "generation"
            ? Generation
            : x.phase === "search"
              ? Search
              : x.phase === "delegate_plan"
                ? DelegatedPlan
                : x.phase === "sandbox" || x.phase === "delegate_generation"
                  ? Generation
                  : ImageCompletion;
    if (!schema.safeParse(x.output).success)
      ctx.addIssue({ code: "custom", message: "Invalid approved tool output" });
  });
export type AgentCompletion = z.infer<typeof AgentCompletion>;
export const Receipt = z.strictObject({
  revision: z.number().int().nonnegative(),
  description: z.string().max(1500),
});
export const Report = z.strictObject({
  status: z.enum([
    "pending",
    "complete",
    "partial",
    "failed",
    "cancelled",
    "cap_exhausted",
    "reconciling",
  ]),
  completed: z.array(Receipt),
  incomplete: z.array(z.string().max(200)),
  reason: z.string().max(300).optional(),
});
export type Report = z.infer<typeof Report>;
export const Edit = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("append"),
    text: z.string().min(1).max(1500),
  }),
  z.strictObject({
    kind: z.literal("image"),
    image: ImageCompletion.shape.image,
  }),
]);
export type Edit = z.infer<typeof Edit>;
export function agentCharge(c: AgentCompletion, book: AgentBook) {
  if (c.phase === "image") {
    const usage = ImageCompletion.parse(c.output).usage,
      rates = ImagePricebook.parse(book.image);
    return (
      ((usage.inputTokens * rates.inputTokenNanoUsd +
        (usage.thinkingTokens + usage.textOutputTokens) *
          rates.outputTokenNanoUsd +
        usage.outputImages * rates.outputImageNanoUsd) *
        SUBCREDITS) /
      rates.creditNanoUsd
    );
  }
  const cost =
    c.phase === "sandbox"
      ? SandboxBook.parse(book.sandbox).maximumNanoUsd
      : c.phase === "search"
        ? book.searchMaximumNanoUsd
        : (c.usage.input - c.usage.cachedInput) * book.inputNanoUsd +
          c.usage.cachedInput * book.cachedInputNanoUsd +
          c.usage.output * book.outputNanoUsd;
  return (cost * SUBCREDITS) / book.creditNanoUsd;
}
