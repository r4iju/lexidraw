// a route to save svg thumbnails

import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { supabase } from "~/server/storage";
import { TRPCError } from "@trpc/server";
import { PublicAccess } from "@packages/types";
import { eq, schema } from "@packages/drizzle";

const THEME = {
  DARK: 'dark',
  LIGHT: 'light',
} as const;

const genericSvgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 85.07 80.75">
  <defs>
    <style>
      .cls-1 {
        fill: #010101;
      }

      .cls-2 {
        fill: #81b1e0;
      }
    </style>
  </defs>
  <path class="cls-1" d="M33.88,25.23h15.86v7.21h-15.86v-7.21Z"/>
  <path class="cls-2" d="M53.35,25.23h6.49v7.21h-6.49v-7.21ZM14.42,36.77h25.95v7.21H14.42v-7.21Zm29.56,0h15.86v7.21h-15.86v-7.21Z"/>
  <path class="cls-1" d="M14.42,48.3h15.86v7.21H14.42v-7.21Z"/>
  <path class="cls-2" d="M33.88,48.3h15.86v7.21h-15.86v-7.21Z"/>
  <path class="cls-1" d="M53.35,48.3h6.49v7.21h-6.49v-7.21Z"/>
  <path class="cls-1" d="M78.58,0V7.21h-7.93V73.54h7.93v7.21h-22.35v-7.21h7.21V7.21h-7.21V0h22.35Zm-18.74,10.81v7.21H7.21V62.72H59.84v7.21H0V10.81H59.84Zm25.23,0v59.12h-10.82v-7.21h3.6V18.02h-3.6v-7.21h10.82Z"/>
</svg>`;

async function blobToString(blob: Blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return buffer.toString('utf-8');
}

export const snapshotRouter = createTRPCRouter({
  create: publicProcedure
    .input(z.object({ entityId: z.string(), svg: z.string(), theme: z.enum([THEME.DARK, THEME.LIGHT]) }))
    .mutation(async ({ input, ctx }) => {
      console.log('input', input)
      const entity = await ctx.drizzle.query.entity.findFirst({
        where: (drw, { eq }) => eq(drw.id, input.entityId),
      })
      if (!entity) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found' })
      }

      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEdit = entity.publicAccess === PublicAccess.EDIT;
      if (!isOwner && !anyOneCanEdit) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to save this drawing' })
      }
      const { entityId: entityId, theme, svg } = input;
      const svgBuffer = Buffer.from(svg);
      const { error: uploadError } = await supabase.storage
        .from('excalidraw')
        .upload(`${entityId}-${theme}.svg`, svgBuffer, {
          contentType: 'image/svg+xml',
          upsert: true,
        });

      if (uploadError) throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: uploadError.message,
      });

      const { data, error: signedUrlErr } = await supabase.storage
        .from('excalidraw')
        .createSignedUrl(`${entityId}-${theme}.svg`, 9999999);

      if (signedUrlErr) throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: signedUrlErr.message,
      });

      await ctx.drizzle.update(schema.entity)
        .set({
          [theme === THEME.DARK ? 'screenShotDark' : 'screenShotLight']: data?.signedUrl as string,
        })
        .where(eq(schema.entity.id, entityId))
        .execute();
      return
    }),
  update: publicProcedure
    .input(z.object({ entityId: z.string(), svg: z.string(), theme: z.enum([THEME.DARK, THEME.LIGHT]) }))
    .mutation(async ({ input, ctx }) => {
      const entity = await ctx.drizzle.query.entity.findFirst({
        where: (drw, { eq }) => eq(drw.id, input.entityId),
      })
      if (!entity) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found' })
      }
      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEdit = entity.publicAccess === PublicAccess.EDIT;
      if (!isOwner && !anyOneCanEdit) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to save this drawing' })
      }
      const { entityId: entityId, svg, theme } = input;
      const svgBuffer = Buffer.from(svg);
      const { error: uploadError } = await supabase.storage
        .from('excalidraw')
        .upload(`${entityId}-${theme}.svg`, svgBuffer, {
          contentType: 'image/svg+xml',
        });

      if (uploadError) throw new Error(uploadError.message);
    }),
  get: publicProcedure
    .input(z.object({ entityId: z.string(), theme: z.enum([THEME.DARK, THEME.LIGHT]) }))
    .query(async ({ input, ctx }) => {
      const entity = await ctx.drizzle.query.entity.findFirst({
        where: (drw, { eq }) => eq(drw.id, input.entityId),
      })
      if (!entity) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found' })
      }
      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEditOrView = entity.publicAccess !== PublicAccess.PRIVATE;
      if (!isOwner && !anyOneCanEditOrView) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to view this drawing' })
      }
      const { entityId: entityId, theme } = input;
      const { data: snapshotStream, error } = await supabase.storage.from('excalidraw').download(`${entityId}-${theme}.svg`);
      if (error ?? !snapshotStream) return genericSvgContent;
      const svgString = await blobToString(snapshotStream);
      return svgString;
    }),
  getSignedUrl: publicProcedure
    .input(z.object({ entityId: z.string(), theme: z.enum([THEME.DARK, THEME.LIGHT]) }))
    .query(async ({ input, ctx }) => {
      const entity = await ctx.drizzle.query.entity.findFirst({
        where: (drw, { eq }) => eq(drw.id, input.entityId),
      })
      if (!entity) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Drawing not found' })
      }
      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEditOrView = entity.publicAccess !== PublicAccess.PRIVATE;
      if (!isOwner && !anyOneCanEditOrView) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You are not authorized to view this drawing' })
      }
      const { entityId: entityId, theme } = input;
      const { data: snapshotStream, error } = await supabase.storage.from('excalidraw').download(`${entityId}-${theme}.svg`);
      if (error ?? !snapshotStream) return genericSvgContent;
      const svgString = await blobToString(snapshotStream);
      return svgString;
    }),
});
