import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { CreateDrawing, SaveDrawing } from "./drawings-schema";
import { Prisma, PublicAccess } from "@prisma/client";

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
        include: { user: true, sharedWith: true },
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
})