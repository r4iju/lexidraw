import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { CreateDrawing, SaveDrawing } from "./drawings-schema";
import { PublicAccess, AccessLevel } from "@packages/types";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, gte, isNotNull, isNull, or, schema, sql } from "@packages/drizzle";

export const drawingRouter = createTRPCRouter({
  create: protectedProcedure
    .input(CreateDrawing)
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .insert(schema.drawing)
        .values({
          id: input.id,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: undefined,
          title: input.title,
          userId: ctx.session?.user.id,
          publicAccess: PublicAccess.PRIVATE,
          elements: JSON.stringify([]),
          appState: JSON.stringify({}),
        })
        .onConflictDoNothing()
        .returning()
    }),
  save: publicProcedure
    .input(SaveDrawing)
    .mutation(async ({ input, ctx }) => {
      const drawings = await ctx.drizzle.select({
        count: sql<number>`cast(count(${schema.drawing.id}) as int)`,
      })
        .from(schema.drawing)
        .leftJoin(schema.user, eq(schema.drawing.userId, schema.user.id))
        .leftJoin(schema.sharedDrawing, eq(schema.drawing.id, schema.sharedDrawing.drawingId))
        .where(and(
          or(
            eq(schema.drawing.userId, ctx.session?.user.id as string),
            eq(schema.sharedDrawing.userId, ctx.session?.user.id as string)
          ),
          isNull(schema.drawing.deletedAt)
        ))
        .groupBy(schema.drawing.id)
        .having(({ count }) => eq(count, 1))
        .execute();

      if (!drawings[0]) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to save this drawing' });
      }

      await ctx.drizzle.update(schema.drawing)
        .set({
          id: input.id,
          title: input.title,
          appState: JSON.stringify({
            ...input.appState,
            collaborators: input.appState.collaborators ? Object.fromEntries(input.appState.collaborators.entries()) : undefined
          }),
          elements: JSON.stringify(input.elements),
        })
        .where(eq(schema.drawing.id, input.id))
        .execute();
    }),
  load: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {

      const drawings = await ctx.drizzle.select(
        {
          id: schema.drawing.id,
          appState: schema.drawing.appState,
          elements: schema.drawing.elements,
          publicAccess: schema.drawing.publicAccess,
          sharedWithId: schema.sharedDrawing.userId,
          sharedAccessLevel: schema.sharedDrawing.accessLevel,
          ownerId: schema.user.id,
        }
      )
        .from(schema.drawing)
        .where(and(
          eq(schema.drawing.id, input.id),
          isNull(schema.drawing.deletedAt),
          or(
            eq(schema.drawing.userId, ctx.session?.user?.id as string),
            eq(schema.sharedDrawing.userId, ctx.session?.user?.id as string),
            eq(schema.drawing.publicAccess, PublicAccess.PRIVATE)
          )
        ))
        .leftJoin(schema.sharedDrawing, and(
          eq(schema.sharedDrawing.drawingId, schema.drawing.id),
          eq(schema.sharedDrawing.userId, ctx.session?.user?.id as string)
        ))
        .leftJoin(schema.user, eq(schema.user.id, schema.drawing.userId))
        .execute();
      const drawing = drawings[0];
      if (!drawing) {
        throw new TRPCError({
          message: 'Drawing not found', code: 'NOT_FOUND'
        })
      }

      const sharedDrawings = await ctx.drizzle.select()
        .from(schema.sharedDrawing)
        .where(eq(schema.sharedDrawing.drawingId, input.id))

      const hasEditAccess = drawing.ownerId === ctx.session?.user?.id ||
        drawing.sharedAccessLevel === AccessLevel.EDIT ||
        drawing.publicAccess === PublicAccess.EDIT;
      const accessLevel = hasEditAccess ? AccessLevel.EDIT : AccessLevel.READ;

      return {
        id: drawing.id,
        appState: drawing.appState,
        elements: drawing.elements,
        publicAccess: drawing.publicAccess,
        sharedWith: sharedDrawings.map((user) => ({ userId: user.id, accessLevel: user.accessLevel })),
        accessLevel
      };
    }),
  list: protectedProcedure
    .query(async ({ ctx }) => {
      const drawings = await ctx.drizzle.select({
        id: schema.drawing.id,
        title: schema.drawing.title,
        createdAt: schema.drawing.createdAt,
        updatedAt: schema.drawing.updatedAt,
        userId: schema.drawing.userId,
        publicAccess: schema.drawing.publicAccess,
      })
        .from(schema.drawing)
        .leftJoin(schema.user, eq(schema.drawing.userId, schema.user.id))
        .leftJoin(schema.sharedDrawing, eq(schema.drawing.id, schema.sharedDrawing.drawingId))
        .where(and(
          or(
            eq(schema.drawing.userId, ctx.session.user.id),
            eq(schema.sharedDrawing.userId, ctx.session.user.id)
          ),
          isNull(schema.drawing.deletedAt)
        ))
        .groupBy(schema.drawing.id)
        .orderBy(desc(schema.drawing.updatedAt))
        .execute();

      return drawings;
    }),
  getSharedInfo: protectedProcedure
    .input(z.object({ drawingId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sharedDrawings = await ctx.drizzle.select({
        drawingId: schema.sharedDrawing.drawingId,
        userId: schema.sharedDrawing.userId,
        accessLevel: schema.sharedDrawing.accessLevel,
        email: schema.user.email,
        name: schema.user.name,
      })
        .from(schema.sharedDrawing)
        .leftJoin(schema.user, eq(schema.sharedDrawing.userId, schema.user.id))
        .where(eq(schema.sharedDrawing.drawingId, input.drawingId))
        .execute();

      return sharedDrawings;
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.drizzle.update(schema.drawing)
        .set({
          deletedAt: new Date()
        })
        .where(eq(schema.drawing.id, input.id)).execute();
    }),
  update: publicProcedure
    .input(z.object({ id: z.string(), title: z.string().optional(), publicAccess: z.enum([PublicAccess.READ, PublicAccess.EDIT, PublicAccess.PRIVATE]).optional() }))
    .mutation(async ({ input, ctx }) => {
      console.log('update with input: ', input);
      const drawings = await ctx.drizzle.select({
        count: sql<number>`cast(count(${schema.drawing.id}) as int)`,
      })
        .from(schema.drawing)
        .leftJoin(schema.user, eq(schema.drawing.userId, schema.user.id))
        .leftJoin(schema.sharedDrawing, eq(schema.drawing.id, schema.sharedDrawing.drawingId))
        .where(and(
          or(
            eq(schema.drawing.userId, ctx.session?.user.id as string),
            eq(schema.sharedDrawing.userId, ctx.session?.user.id as string)
          ),
          isNull(schema.drawing.deletedAt)
        ))
        .groupBy(schema.drawing.id)
        .having(({ count }) => eq(count, 1))
        .execute();

      if (!drawings[0]) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to save this drawing' });
      }

      ctx.drizzle.update(schema.drawing)
        .set({
          title: input.title,
          publicAccess: input.publicAccess,
        })
        .where(eq(schema.drawing.id, input.id))
        .execute();
    }),
  share: protectedProcedure
    .input(z.object({ drawingId: z.string(), userEmail: z.string(), accessLevel: z.enum([AccessLevel.READ, AccessLevel.EDIT]) }))
    .mutation(async ({ input, ctx }) => {
      // Ensure the current user is the owner of the drawing or has EDIT rights
      const drawings = await ctx.drizzle
        .select()
        .from(schema.drawing)
        .where(and(
          eq(schema.drawing.id, input.drawingId),
          or(
            eq(schema.drawing.userId, ctx.session.user.id),
            and(
              eq(schema.sharedDrawing.userId, ctx.session.user.id),
              eq(schema.sharedDrawing.drawingId, input.drawingId),
              eq(schema.sharedDrawing.accessLevel, AccessLevel.EDIT)
            )
          )
        ))
        .execute();

      if (!drawings[0]) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to share this drawing' });
      }

      // Find the user by email
      const userToShareWith = await ctx.drizzle.query.user.findFirst({
        where: (user, { eq }) => eq(user.email, input.userEmail)
      });

      if (!userToShareWith) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User to share with not found' });
      }

      await ctx.drizzle.insert(schema.sharedDrawing)
        .values({
          id: `${input.drawingId}-${userToShareWith.id}`,
          drawingId: input.drawingId,
          userId: userToShareWith.id,
          accessLevel: input.accessLevel,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.sharedDrawing.id,
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
        count: sql<number>`cast(count(${schema.drawing.id}) as int)`,
      })
        .from(schema.drawing)
        .leftJoin(schema.user, eq(schema.drawing.userId, schema.user.id))
        .leftJoin(schema.sharedDrawing, eq(schema.drawing.id, schema.sharedDrawing.drawingId))
        .where(and(
          or(
            eq(schema.drawing.userId, ctx.session?.user.id as string),
            eq(schema.sharedDrawing.userId, ctx.session?.user.id as string)
          ),
          isNull(schema.drawing.deletedAt)
        ))
        .groupBy(schema.drawing.id)
        .having(({ count }) => eq(count, 1))
        .execute();

      if (!drawings[0]) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to change access level of this drawing' });
      }

      await ctx.drizzle.update(schema.sharedDrawing)
        .set({
          accessLevel: input.accessLevel,
        })
        .where(and(
          eq(schema.sharedDrawing.drawingId, input.drawingId),
          eq(schema.sharedDrawing.userId, input.userId)
        ))
        .execute();
      return { success: true, message: 'Access level changed successfully' };
    }),
  unShare: protectedProcedure
    .input(z.object({ drawingId: z.string(), userId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.drizzle.delete(schema.sharedDrawing)
        .where(and(
          eq(schema.sharedDrawing.drawingId, input.drawingId),
          eq(schema.sharedDrawing.userId, input.userId)
        ))
        .execute();
      return { success: true, message: 'Drawing unshared successfully' };
    }),
})