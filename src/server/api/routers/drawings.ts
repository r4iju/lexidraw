import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { CreateDrawing, SaveDrawing } from "./drawings-schema";
import { AccessLevel, PublicAccess } from "@prisma/client";
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
        },
      })
    }),
  save: protectedProcedure
    .input(SaveDrawing)
    .mutation(async ({ input, ctx }) => {

      await ctx.db.element.deleteMany({
        where: { drawingId: input.id }
      })

      await ctx.db.drawing.update({
        where: { id: input.id },
        data: {
          id: input.id,
          title: input.title,
          appState: {
            upsert: {
              where: {
                drawingId: input.id,
              },
              update: { appState: { set: input.appState } },
              create: { appState: input.appState }
            }
          },
          elements: {
            createMany: {
              data: input.elements,
              skipDuplicates: true,
            }
          }
        }
      })
    }),
  load: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {


      if (!ctx.session?.user) {

      }
      const drawing = await ctx.db.drawing.findFirstOrThrow({
        where: {
          id: input.id,
          publicAccess: {
            in: !ctx.session?.user ? [PublicAccess.READ, PublicAccess.EDIT] : [PublicAccess.EDIT, PublicAccess.READ, PublicAccess.PRIVATE]
          },
        },
        include: { elements: true, appState: true, user: true, sharedWith: true }
      });

      if (drawing.elementsOrder && drawing.elementsOrder.length > 0) {
        const orderIndex: Record<string, number> = drawing.elementsOrder.reduce((acc, id, index) => {
          acc[id] = index;
          return acc;
        }, {} as Record<string, number>);
        drawing.elements.sort((a, b) => {
          return (orderIndex[a.id] ?? Number.MAX_VALUE) - (orderIndex[b.id] ?? Number.MAX_VALUE);
        });
      }

      return drawing;


    }),
  list: protectedProcedure
    .query(async ({ ctx }) => {
      return await ctx.db.drawing.findMany({
        where: { userId: ctx.session?.user.id, deletedAt: null },
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
  update: protectedProcedure
    .input(z.object({ id: z.string(), title: z.string().optional(), publicAccess: z.enum([PublicAccess.READ, PublicAccess.EDIT, PublicAccess.PRIVATE]).optional() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.drawing.update({
        where: { id: input.id },
        data: {
          title: input.title,
          publicAccess: input.publicAccess,
        },
      })
    }),
  setElementsOrder: protectedProcedure
    .input(z.object({ drawingId: z.string(), elementsOrder: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.drawing.update({
        where: { id: input.drawingId },
        data: {
          elementsOrder: input.elementsOrder,
        }
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