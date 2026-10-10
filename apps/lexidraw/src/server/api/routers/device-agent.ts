import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  DeviceMutation,
  DEVICE_AGENT_UNAVAILABLE,
} from "~/lib/agent/device-core";
import type { DeviceAgentDocuments } from "~/server/entities/device-agent";
import { createTRPCRouter, protectedProcedure } from "../trpc";
export function createDeviceAgentRouter(documents: () => DeviceAgentDocuments) {
  const procedure = protectedProcedure.use(async ({ next }) => {
    const result = await next();
    if (!result.ok)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Document action failed. Access or revision may have changed. Retained edits can be retried for their receipt; saved edits remain.",
      });
    return result;
  });
  return createTRPCRouter({
    capability: protectedProcedure.query(() => ({
      available: false,
      images: false,
      reason: DEVICE_AGENT_UNAVAILABLE,
    })),
    source: procedure
      .input(z.strictObject({ documentId: z.string().min(1).max(100) }))
      .query(({ ctx, input }) =>
        documents().read(ctx.session.user.id, input.documentId),
      ),
    commitEdit: procedure
      .input(DeviceMutation)
      .mutation(({ ctx, input }) =>
        documents().apply(ctx.session.user.id, input),
      ),
  });
}
