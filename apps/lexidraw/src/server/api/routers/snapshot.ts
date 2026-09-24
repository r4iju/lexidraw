import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import {
  generateClientTokenFromReadWriteToken,
  type GenerateClientTokenOptions,
} from "@vercel/blob/client";
import env from "@packages/env";
import { findWritableEntity } from "~/server/entities/readable";
import { thumbnailPathname } from "~/server/entities/thumbnail";

const THEME = {
  DARK: "dark",
  LIGHT: "light",
} as const;

export const snapshotRouter = createTRPCRouter({
  /**
   * A client token per theme, for the icon modal to upload a picture with; it
   * then stores the URLs through `entities.update`.
   */
  generateClientUploadTokens: publicProcedure
    .input(
      z.object({
        entityId: z.string(),
        contentType: z.enum([
          "image/svg+xml",
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/avif",
        ]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { entityId, contentType } = input;
      const entity = await findWritableEntity(
        ctx.drizzle,
        entityId,
        ctx.session?.user.id ?? "",
      );
      if (!entity)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Drawing not found",
        });

      const ext = contentType.split("/")[1]?.replace(/\+.*$/, "");
      if (!ext)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid content type",
        });

      const themes = [THEME.DARK, THEME.LIGHT] as const;

      /* Produce one token per theme */
      const results = await Promise.all(
        themes.map(async (theme) => {
          const pathname = thumbnailPathname(entityId, theme, ext);
          const token = await generateClientTokenFromReadWriteToken({
            token: env.BLOB_READ_WRITE_TOKEN,
            pathname,
            allowedContentTypes: [
              "image/svg+xml",
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/avif",
            ],
          } satisfies GenerateClientTokenOptions);

          return { theme, token, pathname };
        }),
      );

      return results;
    }),
});
