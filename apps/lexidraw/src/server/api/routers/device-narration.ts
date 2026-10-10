import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { SaveRecording } from "~/lib/narration/device-contracts";
import { DEVICE_NARRATION_UNAVAILABLE } from "~/lib/narration/portable";
import type { GeneratedRecordings } from "~/server/entities/generated-recordings";
import { createTRPCRouter, protectedProcedure } from "../trpc";
const Request = z.strictObject({ documentId: z.string().min(1).max(100) });
export function createDeviceNarrationRouter(deps: {
  records: () => GeneratedRecordings;
  read: (account: string, document: string) => Promise<string>;
}) {
  return createTRPCRouter({
    capability: protectedProcedure.query(() => ({
      available: false,
      reason: DEVICE_NARRATION_UNAVAILABLE,
    })),
    source: protectedProcedure
      .input(Request)
      .query(({ ctx, input }) =>
        deps.read(ctx.session.user.id, input.documentId),
      ),
    save: protectedProcedure
      .input(SaveRecording)
      .mutation(async ({ ctx, input }) => {
        try {
          await deps.records().cleanup();
          return await deps.records().save(ctx.session.user.id, input);
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error &&
              error.message.startsWith("Upload expired")
                ? "Upload expired. Retry retained audio with a new upload identity."
                : "Recording sync failed. Retain completed audio and retry sync without regeneration.",
          });
        }
      }),
    saved: protectedProcedure
      .input(Request)
      .query(({ ctx, input }) =>
        deps.records().saved(ctx.session.user.id, input.documentId),
      ),
  });
}
