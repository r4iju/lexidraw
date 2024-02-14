import { z } from "zod"
import { createTRPCRouter, protectedProcedure } from "../trpc"

export const appStateRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({ drawingId: z.string(), appState: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.appState.create({
        data: {
          drawingId: input.drawingId,
          appState: input.appState,
        },
      })
    }),
  upsert: protectedProcedure
    .input(z.object({ drawingId: z.string(), appState: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.appState.upsert({
        where: {
          drawingId: input.drawingId,
        },
        create: {
          drawingId: input.drawingId,
          appState: input.appState,
        },
        update: {
          drawingId: input.drawingId,
          appState: input.appState,
        }
      })
    }),
  update: protectedProcedure
    .input(z.object({ drawingId: z.string(), appState: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.appState.update({
        where: { drawingId: input.drawingId },
        data: {
          drawingId: input.drawingId,
          appState: input.appState,
        }
      })
    }),
  delete: protectedProcedure
    .input(z.object({ drawingId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.appState.delete({
        where: { drawingId: input.drawingId }
      })
    }),
})