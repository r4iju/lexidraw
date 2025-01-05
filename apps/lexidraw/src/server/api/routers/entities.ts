import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { CreateEntity, SaveEntity } from "./entities-schema";
import { PublicAccess, AccessLevel } from "@packages/types";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, ne, or, schema, sql } from "@packages/drizzle";
import { AppState } from "@dwelle/excalidraw/dist/excalidraw/types";
import env from "@packages/env";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidV4 } from "uuid";
import { s3 } from "~/server/s3";

export const entityRouter = createTRPCRouter({
  create: protectedProcedure
    .input(CreateEntity)
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .insert(schema.entities)
        .values({
          id: input.id,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: undefined,
          title: input.title,
          userId: ctx.session?.user.id,
          entityType: input.entityType,
          publicAccess: PublicAccess.PRIVATE,
          elements: input.elements,
          appState: JSON.stringify({}),
        })
        .onConflictDoNothing()
        .returning();
    }),
  save: publicProcedure.input(SaveEntity).mutation(async ({ input, ctx }) => {
    const userId = ctx.session?.user.id ?? "";
    const drawings = await ctx.drizzle
      .select({
        count: sql<number>`cast(count(${schema.entities.id}) as int)`,
      })
      .from(schema.entities)
      .leftJoin(schema.users, eq(schema.entities.userId, schema.users.id))
      .leftJoin(
        schema.sharedEntities,
        eq(schema.entities.id, schema.sharedEntities.entityId),
      )
      .where(
        and(
          or(
            eq(schema.entities.userId, userId),
            eq(schema.sharedEntities.userId, userId),
            eq(schema.entities.publicAccess, PublicAccess.EDIT),
          ),
          isNull(schema.entities.deletedAt),
        ),
      )
      .groupBy(schema.entities.id)
      .having(({ count }) => eq(count, 1))
      .execute();

    if (!drawings[0]) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You are not authorized to save this drawing",
      });
    }
    let appState: null | string = null;
    if (input.appState) {
      appState = JSON.stringify({
        ...(input.appState as unknown as AppState),
        collaborators: (input.appState as unknown as AppState).collaborators
          ? Object.fromEntries(
              (input.appState as unknown as AppState).collaborators.entries(),
            )
          : undefined,
      });
    }
    await ctx.drizzle
      .update(schema.entities)
      .set({
        id: input.id,
        title: input.title,
        appState: appState,
        elements: input.elements,
      })
      .where(eq(schema.entities.id, input.id))
      .execute();
  }),
  load: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id ?? "";

      const entities = await ctx.drizzle
        .select({
          id: schema.entities.id,
          title: schema.entities.title,
          appState: schema.entities.appState,
          elements: schema.entities.elements,
          entityType: schema.entities.entityType,
          publicAccess: schema.entities.publicAccess,
          sharedWithId: schema.sharedEntities.userId,
          sharedAccessLevel: schema.sharedEntities.accessLevel,
          ownerId: schema.users.id,
        })
        .from(schema.entities)
        .where(
          and(
            eq(schema.entities.id, input.id),
            isNull(schema.entities.deletedAt),
            or(
              eq(schema.entities.userId, userId),
              eq(schema.sharedEntities.userId, userId),
              ne(schema.entities.publicAccess, PublicAccess.PRIVATE),
            ),
          ),
        )
        .leftJoin(
          schema.sharedEntities,
          and(
            eq(schema.sharedEntities.entityId, schema.entities.id),
            eq(schema.sharedEntities.userId, userId),
          ),
        )
        .leftJoin(schema.users, eq(schema.users.id, schema.entities.userId))
        .execute();
      const entity = entities[0];
      if (!entity) {
        throw new TRPCError({
          message: "Drawing not found",
          code: "NOT_FOUND",
        });
      }

      const sharedEntities = await ctx.drizzle
        .select()
        .from(schema.sharedEntities)
        .where(eq(schema.sharedEntities.entityId, input.id));

      const hasEditAccess =
        entity.ownerId === ctx.session?.user?.id ||
        entity.sharedAccessLevel === AccessLevel.EDIT ||
        entity.publicAccess === PublicAccess.EDIT;
      const accessLevel = hasEditAccess ? AccessLevel.EDIT : AccessLevel.READ;

      return {
        id: entity.id,
        title: entity.title,
        appState: entity.appState,
        elements: entity.elements,
        publicAccess: entity.publicAccess,
        sharedWith: sharedEntities.map((entity) => ({
          userId: entity.id,
          accessLevel: entity.accessLevel,
        })),
        accessLevel,
      };
    }),
  list: protectedProcedure
    .input(z.object({
      directoryId: z.string().nullable(),
    }))
    .query(async ({ ctx, input }) => {
      const drawings = await ctx.drizzle
        .select({
          id: schema.entities.id,
          title: schema.entities.title,
          entityType: schema.entities.entityType,
          createdAt: schema.entities.createdAt,
        updatedAt: schema.entities.updatedAt,
        screenShotLight: schema.entities.screenShotLight,
        screenShotDark: schema.entities.screenShotDark,
        userId: schema.entities.userId,
        publicAccess: schema.entities.publicAccess,
        parentId: schema.entities.parentId,
        sharedWithCount: sql<number>`count(${schema.sharedEntities.userId})`,
      })
      .from(schema.entities)
      .leftJoin(schema.users, eq(schema.entities.userId, schema.users.id))
      .leftJoin(
        schema.sharedEntities,
        eq(schema.entities.id, schema.sharedEntities.entityId),
      )
      .where(
        and(
          or(
            eq(schema.entities.userId, ctx.session.user.id),
            eq(schema.sharedEntities.userId, ctx.session.user.id),
          ),
          isNull(schema.entities.deletedAt),
          (input.directoryId ? eq(schema.entities.parentId, input.directoryId) : isNull(schema.entities.parentId)),
        ),
      )
      .groupBy(schema.entities.id)
      .orderBy(desc(schema.entities.updatedAt))
      .execute();

    return drawings;
  }),
  getSharedInfo: protectedProcedure
    .input(z.object({ drawingId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sharedDrawings = await ctx.drizzle
        .select({
          drawingId: schema.sharedEntities.entityId,
          userId: schema.sharedEntities.userId,
          accessLevel: schema.sharedEntities.accessLevel,
          email: schema.users.email,
          name: schema.users.name,
        })
        .from(schema.sharedEntities)
        .leftJoin(
          schema.users,
          eq(schema.sharedEntities.userId, schema.users.id),
        )
        .where(eq(schema.sharedEntities.entityId, input.drawingId))
        .execute();

      return sharedDrawings;
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.drizzle
        .update(schema.entities)
        .set({
          deletedAt: new Date(),
        })
        .where(eq(schema.entities.id, input.id))
        .execute();
    }),
  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        publicAccess: z
          .enum([PublicAccess.READ, PublicAccess.EDIT, PublicAccess.PRIVATE])
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      console.log("update with input: ", input);
      const drawings = await ctx.drizzle
        .select({
          count: sql<number>`cast(count(${schema.entities.id}) as int)`,
        })
        .from(schema.entities)
        .leftJoin(schema.users, eq(schema.entities.userId, schema.users.id))
        .leftJoin(
          schema.sharedEntities,
          eq(schema.entities.id, schema.sharedEntities.entityId),
        )
        .where(
          and(
            or(
              eq(schema.entities.userId, ctx.session?.user.id as string),
              eq(schema.sharedEntities.userId, ctx.session?.user.id as string),
            ),
            isNull(schema.entities.deletedAt),
          ),
        )
        .groupBy(schema.entities.id)
        .having(({ count }) => eq(count, 1))
        .execute();

      if (!drawings[0]) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to save this drawing",
        });
      }

      ctx.drizzle
        .update(schema.entities)
        .set({
          title: input.title,
          publicAccess: input.publicAccess,
        })
        .where(eq(schema.entities.id, input.id))
        .execute();
    }),
  share: protectedProcedure
    .input(
      z.object({
        drawingId: z.string(),
        userEmail: z.string(),
        accessLevel: z.enum([AccessLevel.READ, AccessLevel.EDIT]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      console.log("share with input: ", input);

      const sharedWith = await ctx.drizzle
        .select()
        .from(schema.sharedEntities)
        // .where(eq(
        //   schema.sharedEntity.entityId, input.drawingId
        // ))
        .execute();
      console.log("sharedWith: ", sharedWith);

      // Ensure the current user is the owner of the drawing or has EDIT rights
      const entities = await ctx.drizzle
        .select({
          id: schema.entities.id,
        })
        .from(schema.entities)
        .where(
          and(
            eq(schema.entities.id, input.drawingId),
            or(
              // Owner
              eq(schema.entities.userId, ctx.session.user.id),
              // Editor
              and(
                eq(schema.sharedEntities.userId, ctx.session.user.id),
                eq(schema.sharedEntities.entityId, input.drawingId),
                eq(schema.sharedEntities.accessLevel, AccessLevel.EDIT),
              ),
            ),
          ),
        )
        .leftJoin(
          schema.sharedEntities,
          eq(schema.entities.id, schema.sharedEntities.entityId),
        )
        .execute();

      if (!entities[0]) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to share this drawing",
        });
      } else {
        console.log("found applicable entity", entities[0].id);
      }

      // Find the user by email
      const userToShareWith = await ctx.drizzle.query.users.findFirst({
        where: (user, { eq }) => eq(user.email, input.userEmail),
      });

      if (!userToShareWith) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Sorry that user doesn't exist",
        });
      } else {
        console.log("found user to share with: ", userToShareWith);
      }

      await ctx.drizzle
        .insert(schema.sharedEntities)
        .values({
          id: `${input.drawingId}-${userToShareWith.id}`,
          entityId: input.drawingId,
          userId: userToShareWith.id,
          accessLevel: input.accessLevel,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.sharedEntities.id,
          set: {
            accessLevel: input.accessLevel,
          },
        })
        .execute();

      return { success: true, message: "Drawing shared successfully" };
    }),
  changeAccessLevel: protectedProcedure
    .input(
      z.object({
        drawingId: z.string(),
        userId: z.string(),
        accessLevel: z.enum([AccessLevel.READ, AccessLevel.EDIT]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Ensure the current user is the owner of the drawing or has EDIT rights
      const drawings = await ctx.drizzle
        .select({
          count: sql<number>`cast(count(${schema.entities.id}) as int)`,
        })
        .from(schema.entities)
        .leftJoin(schema.users, eq(schema.entities.userId, schema.users.id))
        .leftJoin(
          schema.sharedEntities,
          eq(schema.entities.id, schema.sharedEntities.entityId),
        )
        .where(
          and(
            or(
              eq(schema.entities.userId, ctx.session?.user.id as string),
              eq(schema.sharedEntities.userId, ctx.session?.user.id as string),
            ),
            isNull(schema.entities.deletedAt),
          ),
        )
        .groupBy(schema.entities.id)
        .having(({ count }) => eq(count, 1))
        .execute();

      if (!drawings[0]) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "You are not authorized to change access level of this drawing",
        });
      }

      await ctx.drizzle
        .update(schema.sharedEntities)
        .set({
          accessLevel: input.accessLevel,
        })
        .where(
          and(
            eq(schema.sharedEntities.entityId, input.drawingId),
            eq(schema.sharedEntities.userId, input.userId),
          ),
        )
        .execute();
      return { success: true, message: "Access level changed successfully" };
    }),
  unShare: protectedProcedure
    .input(z.object({ drawingId: z.string(), userId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.drizzle
        .delete(schema.sharedEntities)
        .where(
          and(
            eq(schema.sharedEntities.entityId, input.drawingId),
            eq(schema.sharedEntities.userId, input.userId),
          ),
        )
        .execute();
      return { success: true, message: "Drawing unshared successfully" };
    }),
  generateUploadUrl: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        // svg, jpeg, webp, avif or png
        contentType: z.enum([
          "image/svg+xml",
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/avif",
        ]),
        mode: z.enum(["direct", "redirect"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const entity = (
        await ctx.drizzle
          .select({
            id: ctx.schema.entities.id,
            userId: ctx.schema.entities.userId,
            publicAccess: ctx.schema.entities.publicAccess,
          })
          .from(schema.entities)
          .where(eq(schema.entities.id, input.entityId))
      )[0];

      if (!entity) {
        console.error("entity not found");
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Drawing not found",
        });
      }

      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEdit = entity.publicAccess === PublicAccess.EDIT;

      if (!isOwner && !anyOneCanEdit) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to view this drawing",
        });
      }

      const { entityId, contentType } = input;
      const extension = contentType.split("/")[1]?.replace(/\+.*$/, "");
      const randomId = uuidV4();

      // let's make sure we have both dark and light themes
      const fileName = `${entityId}-${randomId}.${extension}`;
      console.log("fileName", fileName);

      const fileUrl = `${ctx.headers.get("origin")}/api/images/${fileName}`;
      console.log("fileUrl", fileUrl);

      try {
        const uploadCommand = new PutObjectCommand({
          Bucket: env.SUPABASE_S3_BUCKET,
          Key: fileName,
          ContentType: contentType,
        });
        const downloadCommand = new GetObjectCommand({
          Bucket: env.SUPABASE_S3_BUCKET,
          Key: fileName,
        });

        const [signedUploadUrl, signedDownloadUrl] = await Promise.all([
          getSignedUrl(s3, uploadCommand, {
            expiresIn: 15 * 60, // 15 minutes
          }),
          getSignedUrl(s3, downloadCommand, {
            expiresIn: 7 * 24 * 60 * 60, // 7 days
          }),
        ]);

        await ctx.drizzle
          .insert(ctx.schema.uploadedImages)
          .values({
            id: randomId,
            userId: ctx.session.user.id,
            entityId: entityId,
            fileName: fileName,
            signedUploadUrl: signedUploadUrl,
            signedDownloadUrl: signedDownloadUrl,
          })
          .onConflictDoUpdate({
            target: ctx.schema.uploadedImages.id,
            set: {
              signedUploadUrl: signedUploadUrl,
              signedDownloadUrl: signedDownloadUrl,
            },
          })
          .execute();

        return {
          signedUploadUrl,
          signedDownloadUrl,
        };
      } catch (error) {
        console.error(`Failed to generate signed URL`, error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate signed URL",
        });
      }
    }),
});
