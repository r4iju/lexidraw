// a route to save svg thumbnails

import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { supabase } from "~/server/storage";
import { TRPCError } from "@trpc/server";
import { PublicAccess } from "@packages/db";
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

const THEME = {
  DARK: 'dark',
  LIGHT: 'light',
} as const;

// Initialize DOMPurify
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

const genericSvgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-alert-circle"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>`;

async function blobToString(blob: Blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return buffer.toString('utf-8');
}

export const snapshotRouter = createTRPCRouter({
  create: publicProcedure
    .input(z.object({ drawingId: z.string(), svg: z.string(), theme: z.enum([THEME.DARK, THEME.LIGHT]) }))
    .mutation(async ({ input, ctx }) => {
      const drawing = await ctx.db.drawing.findFirstOrThrow({
        where: { id: input.drawingId },
      });
      const isOwner = drawing.userId === ctx.session?.user.id;
      const anyOneCanEdit = drawing.publicAccess === PublicAccess.EDIT;
      if (!isOwner && !anyOneCanEdit) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to save this drawing' })
      }
      const { drawingId, theme, svg } = input;
      const svgBuffer = Buffer.from(svg);
      const { error: uploadError } = await supabase.storage.from('excalidraw').upload(`${drawingId}-${theme}.svg`, svgBuffer, {
        contentType: 'image/svg+xml',
        upsert: true,
      });

      if (uploadError) throw new Error(uploadError.message);

    }),
  update: publicProcedure
    .input(z.object({ drawingId: z.string(), svg: z.string(), theme: z.enum([THEME.DARK, THEME.LIGHT]) }))
    .mutation(async ({ input, ctx }) => {
      const drawing = await ctx.db.drawing.findFirstOrThrow({
        where: { id: input.drawingId },
      });
      const isOwner = drawing.userId === ctx.session?.user.id;
      const anyOneCanEdit = drawing.publicAccess === PublicAccess.EDIT;
      if (!isOwner && !anyOneCanEdit) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to save this drawing' })
      }
      const { drawingId, svg, theme } = input;
      const svgBuffer = Buffer.from(svg);
      const { error: uploadError } = await supabase.storage.from('excalidraw').upload(`${drawingId}-${theme}.svg`, svgBuffer, {
        contentType: 'image/svg+xml',
      });

      if (uploadError) throw new Error(uploadError.message);
    }),
  get: publicProcedure
    .input(z.object({ drawingId: z.string(), theme: z.enum([THEME.DARK, THEME.LIGHT]) }))
    .query(async ({ input, ctx }) => {
      const drawing = await ctx.db.drawing.findFirstOrThrow({
        where: { id: input.drawingId },
      });
      const isOwner = drawing.userId === ctx.session?.user.id;
      const anyOneCanEditOrView = drawing.publicAccess !== PublicAccess.PRIVATE;
      if (!isOwner && !anyOneCanEditOrView) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to view this drawing' })
      }
      const { drawingId, theme } = input;
      const { data: snapshotStream, error } = await supabase.storage.from('excalidraw').download(`${drawingId}-${theme}.svg`);
      if (error ?? !snapshotStream) return genericSvgContent;
      const svgString = await blobToString(snapshotStream);
      const cleanSvgContent = DOMPurify.sanitize(svgString);
      return cleanSvgContent;
    }),
});
