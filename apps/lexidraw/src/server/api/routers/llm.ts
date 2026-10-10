import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
const closed = () => {
  throw new TRPCError({
    code: "FORBIDDEN",
    message:
      "Use the bounded account operation. Legacy system-key agent and planner calls are unavailable.",
  });
};
export const llmRouter = createTRPCRouter({
  generate: protectedProcedure
    .input(
      z.object({
        system: z.string().optional(),
        prompt: z.string().optional(),
        messages: z.array(z.unknown()).optional(),
        temperature: z.number().optional(),
        maxOutputTokens: z.number().optional(),
        mode: z.enum(["chat", "agent"]).optional().default("chat"),
        entityId: z.string().optional(),
      }),
    )
    .mutation(closed),
  plan: protectedProcedure
    .input(
      z.object({
        prompt: z.string(),
        availableTools: z.array(z.string()),
        documentMarkdown: z.string().optional(),
        max: z.number().optional(),
        provider: z.string().optional(),
      }),
    )
    .mutation((): { tools: string[]; correlationId: string } => closed()),
  agent: protectedProcedure
    .input(z.object({}))
    .mutation((): { text: string; toolCalls: unknown[] } => closed()),
});
