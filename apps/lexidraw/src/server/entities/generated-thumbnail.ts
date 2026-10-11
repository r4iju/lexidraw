import { and, eq, isNull, schema, type drizzle } from "@packages/drizzle";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  GeneratedThumbnailInput,
  ThumbnailReceipt,
  ThumbnailSnapshot,
} from "~/lib/images/thumbnail-receipt";
import { protectedProcedure } from "~/server/api/trpc";
import { revalidateEntitiesAndParents } from "~/server/api/entity-cache";
import { findEntityFor } from "./readable";

async function readThumbnail(
  db: typeof drizzle,
  entityId: string,
  account: string,
) {
  const entity = await findEntityFor(db, entityId, account, "thumbnail");
  if (!entity) throw new TRPCError({ code: "NOT_FOUND" });
  const row = await db
    .select({
      light: schema.entities.screenShotLight,
      dark: schema.entities.screenShotDark,
      at: schema.entities.thumbnailUpdatedAt,
    })
    .from(schema.entities)
    .where(
      and(eq(schema.entities.id, entityId), isNull(schema.entities.deletedAt)),
    )
    .get();
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return {
    entity,
    snapshot: ThumbnailSnapshot.parse({
      light: row.light,
      dark: row.dark,
      revision: row.at?.getTime() ?? null,
    }),
  };
}

export const generatedThumbnailProcedures = {
  generatedThumbnail: protectedProcedure
    .input(z.strictObject({ entityId: z.string().min(1).max(100) }))
    .output(ThumbnailSnapshot)
    .query(
      async ({ ctx, input }) =>
        (await readThumbnail(ctx.drizzle, input.entityId, ctx.session.user.id))
          .snapshot,
    ),
  commitGeneratedThumbnail: protectedProcedure
    .input(GeneratedThumbnailInput)
    .output(ThumbnailReceipt)
    .mutation(async ({ ctx, input }) => {
      const account = ctx.session.user.id;
      const { entity } = await readThumbnail(
        ctx.drizzle,
        input.entityId,
        account,
      );
      const image = await ctx.drizzle
        .select({ id: schema.generatedImages.id })
        .from(schema.generatedImages)
        .where(
          and(
            eq(schema.generatedImages.accountId, account),
            eq(schema.generatedImages.entityId, input.entityId),
            eq(schema.generatedImages.idempotencyKey, input.uploadId),
            eq(schema.generatedImages.state, "registered"),
          ),
        )
        .get();
      if (!image)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Registered entity image required",
        });
      const url = `/api/generated-images/${image.id}`;
      const revision = Math.max(Date.now(), (input.expected.revision ?? 0) + 1);
      const stored = await ctx.drizzle
        .update(schema.entities)
        .set({
          screenShotLight: url,
          screenShotDark: url,
          thumbnailUpdatedAt: new Date(revision),
        })
        .where(
          and(
            eq(schema.entities.id, input.entityId),
            isNull(schema.entities.deletedAt),
            eq(schema.entities.screenShotLight, input.expected.light),
            eq(schema.entities.screenShotDark, input.expected.dark),
            input.expected.revision === null
              ? isNull(schema.entities.thumbnailUpdatedAt)
              : eq(
                  schema.entities.thumbnailUpdatedAt,
                  new Date(input.expected.revision),
                ),
          ),
        )
        .returning({ id: schema.entities.id });
      if (!stored.length)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Thumbnail changed. Read it again before saving.",
        });
      const { snapshot } = await readThumbnail(
        ctx.drizzle,
        input.entityId,
        account,
      );
      if (
        snapshot.light !== url ||
        snapshot.dark !== url ||
        snapshot.revision !== revision
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "Thumbnail readback did not confirm this image",
        });
      await revalidateEntitiesAndParents(
        ctx.drizzle,
        input.entityId,
        entity.parentId,
      );
      return ThumbnailReceipt.parse({
        kind: "saved",
        purpose: "generated-thumbnail",
        entityId: input.entityId,
        uploadId: input.uploadId,
        ...snapshot,
      });
    }),
};
