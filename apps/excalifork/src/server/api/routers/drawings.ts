import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { CreateEntity, SaveEntity } from "./drawings-schema";
import { PublicAccess, AccessLevel } from "@packages/types";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, gte, isNotNull, isNull, or, schema, sql } from "@packages/drizzle";
import { AppState } from "@excalidraw/excalidraw/types/types";
import { entity } from "node_modules/@packages/drizzle/dist/drizzle-schema";

export const entityRouter = createTRPCRouter({
  create: protectedProcedure
    .input(CreateEntity)
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .insert(schema.entity)
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
        .returning()
    }),
  save: publicProcedure
    .input(SaveEntity)
    .mutation(async ({ input, ctx }) => {
      const drawings = await ctx.drizzle.select({
        count: sql<number>`cast(count(${schema.entity.id}) as int)`,
      })
        .from(schema.entity)
        .leftJoin(schema.user, eq(schema.entity.userId, schema.user.id))
        .leftJoin(schema.sharedEntity, eq(schema.entity.id, schema.sharedEntity.entityId))
        .where(and(
          or(
            eq(schema.entity.userId, ctx.session?.user.id as string),
            eq(schema.sharedEntity.userId, ctx.session?.user.id as string)
          ),
          isNull(schema.entity.deletedAt)
        ))
        .groupBy(schema.entity.id)
        .having(({ count }) => eq(count, 1))
        .execute();

      if (!drawings[0]) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to save this drawing' });
      }
      let appState: null | string = null
      if (input.appState) {
        appState = JSON.stringify({
          ...(input.appState as unknown as AppState),
          collaborators: (input.appState as unknown as AppState).collaborators ? Object.fromEntries((input.appState as unknown as AppState).collaborators.entries()) : undefined
        });
      }
      await ctx.drizzle.update(schema.entity)
        .set({
          id: input.id,
          title: input.title,
          appState: appState,
          elements: input.elements,
        })
        .where(eq(schema.entity.id, input.id))
        .execute();
    }),
  load: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {

      const entities = await ctx.drizzle.select(
        {
          id: schema.entity.id,
          appState: schema.entity.appState,
          elements: schema.entity.elements,
          entityType: schema.entity.entityType,
          publicAccess: schema.entity.publicAccess,
          sharedWithId: schema.sharedEntity.userId,
          sharedAccessLevel: schema.sharedEntity.accessLevel,
          ownerId: schema.user.id,
        }
      )
        .from(schema.entity)
        .where(and(
          eq(schema.entity.id, input.id),
          isNull(schema.entity.deletedAt),
          or(
            eq(schema.entity.userId, ctx.session?.user?.id as string),
            eq(schema.sharedEntity.userId, ctx.session?.user?.id as string),
            eq(schema.entity.publicAccess, PublicAccess.PRIVATE)
          )
        ))
        .leftJoin(schema.sharedEntity, and(
          eq(schema.sharedEntity.entityId, schema.entity.id),
          eq(schema.sharedEntity.userId, ctx.session?.user?.id as string)
        ))
        .leftJoin(schema.user, eq(schema.user.id, schema.entity.userId))
        .execute();
      const entity = entities[0];
      if (!entity) {
        throw new TRPCError({
          message: 'Drawing not found', code: 'NOT_FOUND'
        })
      }

      const sharedEntities = await ctx.drizzle.select()
        .from(schema.sharedEntity)
        .where(eq(schema.sharedEntity.entityId, input.id))

      const hasEditAccess = entity.ownerId === ctx.session?.user?.id ||
        entity.sharedAccessLevel === AccessLevel.EDIT ||
        entity.publicAccess === PublicAccess.EDIT;
      const accessLevel = hasEditAccess ? AccessLevel.EDIT : AccessLevel.READ;

      return {
        id: entity.id,
        appState: entity.appState,
        elements: entity.elements,
        publicAccess: entity.publicAccess,
        sharedWith: sharedEntities.map((entity) => ({ userId: entity.id, accessLevel: entity.accessLevel })),
        accessLevel
      };
    }),
  list: protectedProcedure
    .query(async ({ ctx }) => {
      const drawings = await ctx.drizzle.select({
        id: schema.entity.id,
        title: schema.entity.title,
        entityType: schema.entity.entityType,
        createdAt: schema.entity.createdAt,
        updatedAt: schema.entity.updatedAt,
        userId: schema.entity.userId,
        publicAccess: schema.entity.publicAccess,
        sharedWithCount: sql<number>`count(${schema.sharedEntity.userId})`,
      })
        .from(schema.entity)
        .leftJoin(schema.user, eq(schema.entity.userId, schema.user.id))
        .leftJoin(schema.sharedEntity, eq(schema.entity.id, schema.sharedEntity.entityId))
        .where(and(
          or(
            eq(schema.entity.userId, ctx.session.user.id),
            eq(schema.sharedEntity.userId, ctx.session.user.id)
          ),
          isNull(schema.entity.deletedAt)
        ))
        .groupBy(schema.entity.id)
        .orderBy(desc(schema.entity.updatedAt))
        .execute();

      return drawings;
    }),
  getSharedInfo: protectedProcedure
    .input(z.object({ drawingId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sharedDrawings = await ctx.drizzle.select({
        drawingId: schema.sharedEntity.entityId,
        userId: schema.sharedEntity.userId,
        accessLevel: schema.sharedEntity.accessLevel,
        email: schema.user.email,
        name: schema.user.name,
      })
        .from(schema.sharedEntity)
        .leftJoin(schema.user, eq(schema.sharedEntity.userId, schema.user.id))
        .where(eq(schema.sharedEntity.entityId, input.drawingId))
        .execute();

      return sharedDrawings;
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.drizzle.update(schema.entity)
        .set({
          deletedAt: new Date()
        })
        .where(eq(schema.entity.id, input.id)).execute();
    }),
  update: publicProcedure
    .input(z.object({ id: z.string(), title: z.string().optional(), publicAccess: z.enum([PublicAccess.READ, PublicAccess.EDIT, PublicAccess.PRIVATE]).optional() }))
    .mutation(async ({ input, ctx }) => {
      console.log('update with input: ', input);
      const drawings = await ctx.drizzle.select({
        count: sql<number>`cast(count(${schema.entity.id}) as int)`,
      })
        .from(schema.entity)
        .leftJoin(schema.user, eq(schema.entity.userId, schema.user.id))
        .leftJoin(schema.sharedEntity, eq(schema.entity.id, schema.sharedEntity.entityId))
        .where(and(
          or(
            eq(schema.entity.userId, ctx.session?.user.id as string),
            eq(schema.sharedEntity.userId, ctx.session?.user.id as string)
          ),
          isNull(schema.entity.deletedAt)
        ))
        .groupBy(schema.entity.id)
        .having(({ count }) => eq(count, 1))
        .execute();

      if (!drawings[0]) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to save this drawing' });
      }

      ctx.drizzle.update(schema.entity)
        .set({
          title: input.title,
          publicAccess: input.publicAccess,
        })
        .where(eq(schema.entity.id, input.id))
        .execute();
    }),
  share: protectedProcedure
    .input(z.object({ drawingId: z.string(), userEmail: z.string(), accessLevel: z.enum([AccessLevel.READ, AccessLevel.EDIT]) }))
    .mutation(async ({ input, ctx }) => {

      console.log('share with input: ', input);

      const sharedWith = await ctx.drizzle
        .select()
        .from(schema.sharedEntity)
        // .where(eq(
        //   schema.sharedEntity.entityId, input.drawingId
        // ))
        .execute();
      console.log('sharedWith: ', sharedWith);

      // Ensure the current user is the owner of the drawing or has EDIT rights
      const entities = await ctx.drizzle
        .select({
          id: schema.entity.id,
        })
        .from(schema.entity)
        .where(and(
          eq(schema.entity.id, input.drawingId),
          or(
            // Owner
            eq(schema.entity.userId, ctx.session.user.id),
            // Editor
            and(
              eq(schema.sharedEntity.userId, ctx.session.user.id),
              eq(schema.sharedEntity.entityId, input.drawingId),
              eq(schema.sharedEntity.accessLevel, AccessLevel.EDIT)
            )
          )
        ))
        .leftJoin(schema.sharedEntity, eq(schema.entity.id, schema.sharedEntity.entityId))
        .execute();

      if (!entities[0]) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to share this drawing' });
      } else {
        console.log('found applicable entity', entity.id);
      }

      // Find the user by email
      const userToShareWith = await ctx.drizzle.query.user.findFirst({
        where: (user, { eq }) => eq(user.email, input.userEmail)
      });

      if (!userToShareWith) {
        throw new TRPCError({ code: 'NOT_FOUND', message: "Sorry that user doesn't exist" });
      } else {
        console.log('found user to share with: ', userToShareWith);
      }

      await ctx.drizzle.insert(schema.sharedEntity)
        .values({
          id: `${input.drawingId}-${userToShareWith.id}`,
          entityId: input.drawingId,
          userId: userToShareWith.id,
          accessLevel: input.accessLevel,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.sharedEntity.id,
          set: {
            accessLevel: input.accessLevel,
          }
        })
        .execute();

      return { success: true, message: 'Drawing shared successfully' };
    }),
  changeAccessLevel: protectedProcedure
    .input(z.object({ drawingId: z.string(), userId: z.string(), accessLevel: z.enum([AccessLevel.READ, AccessLevel.EDIT]) }))
    .mutation(async ({ input, ctx }) => {
      // Ensure the current user is the owner of the drawing or has EDIT rights
      const drawings = await ctx.drizzle.select({
        count: sql<number>`cast(count(${schema.entity.id}) as int)`,
      })
        .from(schema.entity)
        .leftJoin(schema.user, eq(schema.entity.userId, schema.user.id))
        .leftJoin(schema.sharedEntity, eq(schema.entity.id, schema.sharedEntity.entityId))
        .where(and(
          or(
            eq(schema.entity.userId, ctx.session?.user.id as string),
            eq(schema.sharedEntity.userId, ctx.session?.user.id as string)
          ),
          isNull(schema.entity.deletedAt)
        ))
        .groupBy(schema.entity.id)
        .having(({ count }) => eq(count, 1))
        .execute();

      if (!drawings[0]) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to change access level of this drawing' });
      }

      await ctx.drizzle.update(schema.sharedEntity)
        .set({
          accessLevel: input.accessLevel,
        })
        .where(and(
          eq(schema.sharedEntity.entityId, input.drawingId),
          eq(schema.sharedEntity.userId, input.userId)
        ))
        .execute();
      return { success: true, message: 'Access level changed successfully' };
    }),
  unShare: protectedProcedure
    .input(z.object({ drawingId: z.string(), userId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.drizzle.delete(schema.sharedEntity)
        .where(and(
          eq(schema.sharedEntity.entityId, input.drawingId),
          eq(schema.sharedEntity.userId, input.userId)
        ))
        .execute();
      return { success: true, message: 'Drawing unshared successfully' };
    }),
})