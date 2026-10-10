import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ImageInput, IMAGE_UNAVAILABLE } from "~/lib/images/contracts";
import type { ProImageOperation } from "~/server/pro/image-operation";
import {
  SaveImageInput,
  type GeneratedImages,
} from "~/server/entities/generated-images";
import { createTRPCRouter, protectedProcedure } from "../trpc";
export function createImagePowerRouter(deps: {
  executor?: ProImageOperation;
  images: () => GeneratedImages;
  source: (account: string) => Promise<string>;
}) {
  return createTRPCRouter({
    capability: protectedProcedure.query(() => ({
      available: !!deps.executor,
      maximum: deps.executor?.book.quote ?? 0,
      fixture: !!deps.executor,
      reason: deps.executor
        ? "Injected private image fixture; no actual service verification."
        : IMAGE_UNAVAILABLE,
    })),
    generate: protectedProcedure
      .input(ImageInput)
      .mutation(async ({ ctx, input }) => {
        if (!deps.executor)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: IMAGE_UNAVAILABLE,
          });
        if ((await deps.source(ctx.session.user.id)) !== "pro")
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Select Pro in AI Power",
          });
        return deps.executor.start(ctx.session.user.id, input);
      }),
    operation: protectedProcedure
      .input(z.strictObject({ id: z.string() }))
      .query(({ ctx, input }) => {
        if (!deps.executor)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: IMAGE_UNAVAILABLE,
          });
        return deps.executor.recover(ctx.session.user.id, input.id);
      }),
    save: protectedProcedure
      .input(SaveImageInput)
      .mutation(async ({ ctx, input }) => {
        try {
          return await deps.images().save(ctx.session.user.id, input);
        } catch (error) {
          const expired =
            error instanceof Error &&
            error.message.startsWith("Upload expired");
          throw new TRPCError({
            code: expired ? "PRECONDITION_FAILED" : "BAD_REQUEST",
            message: expired
              ? "Upload expired. Retry the retained image."
              : "Image sync failed. Keep the completed image and retry upload.",
          });
        }
      }),
  });
}
