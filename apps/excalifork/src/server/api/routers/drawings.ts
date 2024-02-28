import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { CreateDrawing, SaveDrawing } from "./drawings-schema";
import { AccessLevel, type Prisma, PublicAccess } from "@packages/db";
import { TRPCError } from "@trpc/server";

export const drawingRouter = createTRPCRouter({
  create: protectedProcedure
    .input(CreateDrawing)
    .mutation(async ({ input, ctx }) => {
      return await ctx.db.drawing.create({
        data: {
          id: input.id,
          title: input.title,
          userId: ctx.session?.user.id,
          elements: [],
          appState: {},
        },
      })
    }),
  save: publicProcedure
    .input(SaveDrawing)
    .mutation(async ({ input, ctx }) => {

      const drawing = await ctx.db.drawing.count({
        where: {
          id: input.id,
          deletedAt: null,
          OR: [
            { userId: ctx.session?.user?.id },
            { sharedWith: { some: { userId: ctx.session?.user?.id, accessLevel: AccessLevel.EDIT } } },
            { publicAccess: PublicAccess.EDIT },
          ],
        },
      });
      if (!drawing) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to save this drawing' });
      }

      await ctx.db.drawing.update({
        where: { id: input.id },
        data: {
          id: input.id,
          title: input.title,
          appState: {
            ...input.appState,
            collaborators: input.appState.collaborators ? Object.fromEntries(input.appState.collaborators.entries()) : undefined
          },
          elements: input.elements,
        }
      })
    }),
  load: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const drawing = await ctx.db.drawing.findFirstOrThrow({
        where: {
          id: input.id,
          deletedAt: null,
          OR: [
            { userId: ctx.session?.user?.id },
            { sharedWith: { some: { userId: ctx.session?.user?.id } } },
            { publicAccess: { not: PublicAccess.PRIVATE } },
          ],
        },
        include: { user: true, sharedWith: true }
      });

      // should be based on 1. is owner, 2. sharedWith edit permission, 3. publicAccess has edit permission
      const hasEditAccess = drawing.userId === ctx.session?.user?.id ||
        drawing.sharedWith.some(s => s.userId === ctx.session?.user?.id && s.accessLevel === AccessLevel.EDIT) ||
        drawing.publicAccess === PublicAccess.EDIT;
      const accessLevel = hasEditAccess ? AccessLevel.EDIT : AccessLevel.READ;

      return {
        id: drawing.id,
        appState: drawing.appState as Prisma.JsonObject,
        elements: drawing.elements as Prisma.JsonArray,
        publicAccess: drawing.publicAccess,
        sharedWith: drawing.sharedWith.map((user) => ({ userId: user.id, accessLevel: user.accessLevel })),
        accessLevel
      };


    }),
  list: protectedProcedure
    .query(async ({ ctx }) => {
      return await ctx.db.drawing.findMany({
        where: {
          OR: [
            { userId: ctx.session?.user.id },
            { sharedWith: { some: { userId: ctx.session?.user.id } } }
          ],
          deletedAt: null
        },
        include: {
          user: true, sharedWith: {
            include: { user: true }
          }
        },
        orderBy: { updatedAt: 'desc' },
      })
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.drawing.update({
        where: { id: input.id },
        data: { deletedAt: new Date() }
      })
    }),
  update: publicProcedure
    .input(z.object({ id: z.string(), title: z.string().optional(), publicAccess: z.enum([PublicAccess.READ, PublicAccess.EDIT, PublicAccess.PRIVATE]).optional() }))
    .mutation(async ({ input, ctx }) => {
      const drawing = await ctx.db.drawing.count({
        where: {
          id: input.id,
          deletedAt: null,
          OR: [
            { userId: ctx.session?.user?.id },
            { sharedWith: { some: { userId: ctx.session?.user?.id, accessLevel: AccessLevel.EDIT } } },
            { publicAccess: PublicAccess.EDIT },
          ],
        },
      });
      if (!drawing) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to update this drawing' });
      }
      await ctx.db.drawing.update({
        where: { id: input.id },
        data: {
          title: input.title,
          publicAccess: input.publicAccess,
        },
      })
    }),
  share: protectedProcedure
    .input(z.object({ drawingId: z.string(), userEmail: z.string(), accessLevel: z.enum([AccessLevel.READ, AccessLevel.EDIT]) }))
    .mutation(async ({ input, ctx }) => {
      // Ensure the current user is the owner of the drawing or has EDIT rights
      const drawing = await ctx.db.drawing.findFirst({
        where: {
          id: input.drawingId,
          OR: [
            { sharedWith: { some: { userId: ctx.session.user.id, accessLevel: AccessLevel.EDIT } } },
            { userId: ctx.session.user.id }
          ] // Shared EDIT rights check
        }
      });

      if (!drawing) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to share this drawing' });
      }

      // Find the user by email
      const userToShareWith = await ctx.db.user.findUnique({
        where: { email: input.userEmail },
      });

      if (!userToShareWith) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User to share with not found' });
      }

      // Create or update the SharedDrawing entry
      await ctx.db.sharedDrawing.upsert({
        where: {
          uniqueDrawingUserShare: {
            drawingId: input.drawingId,
            userId: userToShareWith.id,
          }
        },
        update: {
          accessLevel: input.accessLevel,
        },
        create: {
          drawingId: input.drawingId,
          userId: userToShareWith.id,
          accessLevel: input.accessLevel,
        },
      });

      return { success: true, message: 'Drawing shared successfully' };
    }),
  changeAccessLevel: protectedProcedure
    .input(z.object({ drawingId: z.string(), userId: z.string(), accessLevel: z.enum([AccessLevel.READ, AccessLevel.EDIT]) }))
    .mutation(async ({ input, ctx }) => {
      // Ensure the current user is the owner of the drawing or has EDIT rights
      const drawing = await ctx.db.drawing.findFirst({
        where: {
          id: input.drawingId,
          OR: [
            { sharedWith: { some: { userId: ctx.session.user.id, accessLevel: AccessLevel.EDIT } } },
            { userId: ctx.session.user.id }
          ]
        }
      });

      if (!drawing) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to change access level for this drawing' });
      }

      // Update the SharedDrawing entry
      await ctx.db.sharedDrawing.upsert({
        where: {
          uniqueDrawingUserShare: {
            drawingId: input.drawingId,
            userId: input.userId,
          }
        },
        create: {
          accessLevel: input.accessLevel,
          userId: input.userId,
          drawingId: input.drawingId,
        },
        update: {
          accessLevel: input.accessLevel,
          userId: input.userId,
          drawingId: input.drawingId,
        }
      });

      return { success: true, message: 'Access level changed successfully' };
    }),
  unShare: protectedProcedure
    .input(z.object({ drawingId: z.string(), userId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.sharedDrawing.delete({
        where: {
          uniqueDrawingUserShare: {
            drawingId: input.drawingId,
            userId: input.userId,
          }
        }
      });

      return { success: true, message: 'Drawing unshared successfully' };
    }),
})