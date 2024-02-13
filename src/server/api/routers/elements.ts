import { z } from "zod"
import { createTRPCRouter, protectedProcedure } from "../trpc"
import { Element } from "./drawings-schema"

export const elementRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({ drawingId: z.string(), element: Element }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.element.upsert({
        where: {
          id: input.element.id,
        },
        create: {
          id: input.element.id,
          drawingId: input.drawingId,
          type: input.element.type,
          x: input.element.x,
          y: input.element.y,
          width: input.element.width,
          height: input.element.height,
          properties: input.element.properties,
        },
        update: {
          id: input.element.id,
          drawingId: input.drawingId,
          type: input.element.type,
          x: input.element.x,
          y: input.element.y,
          width: input.element.width,
          height: input.element.height,
          properties: input.element.properties,
        }
      })
    }),
  update: protectedProcedure
    .input(z.object({ drawingId: z.string(), element: Element }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.element.update({
        where: { id: input.element.id },
        data: {
          drawingId: input.drawingId,
          type: input.element.type,
          x: input.element.x,
          y: input.element.y,
          width: input.element.width,
          height: input.element.height,
          properties: input.element.properties,
        }
      })
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.element.delete({
        where: { id: input.id }
      })
    }),
})