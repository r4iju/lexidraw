// src/server/api/routers/snapshotRouter.ts
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { put } from "@vercel/blob"; // ⬅️ Vercel Blob SDK
import { PublicAccess } from "@packages/types";
import { eq, schema } from "@packages/drizzle";
import {
  generateClientTokenFromReadWriteToken,
  GenerateClientTokenOptions,
} from "@vercel/blob/client";
import env from "@packages/env";

const THEME = {
  DARK: "dark",
  LIGHT: "light",
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

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

const uploadSvg = async (
  key: string,
  data: Buffer,
): Promise<string /* public url */> => {
  const blob = await put(key, data, {
    access: "public", // presigned URLs don’t exist – public is fine
    contentType: "image/svg+xml",
  }); // uses BLOB_READ_WRITE_TOKEN automatically:contentReference[oaicite:0]{index=0}
  return blob.url; // immutable, globally‑cached URL
};

const fetchToBuffer = async (url: string): Promise<Buffer> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

const fetchToString = async (url: string): Promise<string> =>
  (await fetchToBuffer(url)).toString("utf-8");

/* ------------------------------------------------------------------ */
/* router                                                              */
/* ------------------------------------------------------------------ */

export const snapshotRouter = createTRPCRouter({
  /* -------------------------- CREATE -------------------------------- */
  create: publicProcedure
    .input(
      z.object({
        entityId: z.string(),
        svg: z.string(),
        theme: z.enum([THEME.DARK, THEME.LIGHT]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const entity = await ctx.drizzle.query.entities.findFirst({
        where: (drw, { eq }) => eq(drw.id, input.entityId),
      });
      if (!entity)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Drawing not found",
        });

      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEdit = entity.publicAccess === PublicAccess.EDIT;
      if (!isOwner && !anyOneCanEdit)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to save this drawing",
        });

      const key = `${input.entityId}-${input.theme}.svg`;
      const url = await uploadSvg(key, Buffer.from(input.svg));

      await ctx.drizzle
        .update(schema.entities)
        .set({
          [input.theme === THEME.DARK ? "screenShotDark" : "screenShotLight"]:
            url,
        })
        .where(eq(schema.entities.id, input.entityId))
        .execute();
    }),

  /* -------------------------- UPDATE -------------------------------- */
  update: publicProcedure
    .input(
      z.object({
        entityId: z.string(),
        svg: z.string(),
        theme: z.enum([THEME.DARK, THEME.LIGHT]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const entity = await ctx.drizzle.query.entities.findFirst({
        where: (drw, { eq }) => eq(drw.id, input.entityId),
      });
      if (!entity)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Drawing not found",
        });

      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEdit = entity.publicAccess === PublicAccess.EDIT;
      if (!isOwner && !anyOneCanEdit)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to save this drawing",
        });

      const key = `${input.entityId}-${input.theme}.svg`;
      const url = await uploadSvg(key, Buffer.from(input.svg));

      await ctx.drizzle
        .update(schema.entities)
        .set({
          [input.theme === THEME.DARK ? "screenShotDark" : "screenShotLight"]:
            url,
        })
        .where(eq(schema.entities.id, input.entityId))
        .execute();

      return { url };
    }),

  /* ----------------------- BINARY→BASE‑64 ------------------------- */
  getSvgData: publicProcedure
    .input(
      z.object({
        entityId: z.string(),
        theme: z.enum([THEME.DARK, THEME.LIGHT]),
      }),
    )
    .query(async ({ input, ctx }) => {
      const entity = await ctx.drizzle.query.entities.findFirst({
        where: (drw, { eq }) => eq(drw.id, input.entityId),
      });
      if (!entity)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Drawing not found",
        });

      const url =
        (input.theme === THEME.DARK
          ? entity.screenShotDark
          : entity.screenShotLight) ?? "";
      if (!url)
        throw new TRPCError({ code: "NOT_FOUND", message: "Missing SVG" });

      const svgBase64 = (await fetchToBuffer(url)).toString("base64");
      return `data:image/svg+xml;base64,${svgBase64}`;
    }),

  /* ---------------------------- GET --------------------------------- */
  get: publicProcedure
    .input(
      z.object({
        entityId: z.string(),
        theme: z.enum([THEME.DARK, THEME.LIGHT]),
      }),
    )
    .query(async ({ input, ctx }) => {
      const entity = await ctx.drizzle.query.entities.findFirst({
        where: (drw, { eq }) => eq(drw.id, input.entityId),
      });
      if (!entity)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Drawing not found",
        });

      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEditOrView = entity.publicAccess !== PublicAccess.PRIVATE;
      if (!isOwner && !anyOneCanEditOrView)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to view this drawing",
        });

      const url =
        (input.theme === THEME.DARK
          ? entity.screenShotDark
          : entity.screenShotLight) ?? "";
      return url ? await fetchToString(url) : genericSvgContent;
    }),

  /* ---------------------- “SIGNED”_URL_(alias) ---------------------- */
  getSignedUrl: publicProcedure
    .input(
      z.object({
        entityId: z.string(),
        theme: z.enum([THEME.DARK, THEME.LIGHT]),
      }),
    )
    .query(async ({ input, ctx }) => {
      // kept for backward‑compat – now just returns the permanent public URL
      const entity = await ctx.drizzle.query.entities.findFirst({
        where: (drw, { eq }) => eq(drw.id, input.entityId),
      });
      if (!entity)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Drawing not found",
        });

      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEditOrView = entity.publicAccess !== PublicAccess.PRIVATE;
      if (!isOwner && !anyOneCanEditOrView)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to view this drawing",
        });

      const url =
        (input.theme === THEME.DARK
          ? entity.screenShotDark
          : entity.screenShotLight) ?? "";
      return url;
    }),

  /** Step1 – hand the browser a client‑token */
  generateClientUploadTokens: publicProcedure
    .input(
      z.object({
        entityId: z.string(),
        contentType: z.enum([
          "image/svg+xml",
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/avif",
        ]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { entityId, contentType } = input;
      const entity = await ctx.drizzle.query.entities.findFirst({
        where: (e, { eq }) => eq(e.id, entityId),
      });
      if (!entity)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Drawing not found",
        });

      const isOwner = entity.userId === ctx.session?.user.id;
      const anyoneCanEdit = entity.publicAccess === PublicAccess.EDIT;
      if (!isOwner && !anyoneCanEdit)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Forbidden",
        });

      const ext = contentType.split("/")[1]?.replace(/\+.*$/, "");
      if (!ext)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid content type",
        });

      const themes = [THEME.DARK, THEME.LIGHT] as const;

      /* Produce one token per theme */
      const results = await Promise.all(
        themes.map(async (theme) => {
          const pathname = `${entityId}-${theme}.${ext}`; // final blob path (immutable)
          const token = await generateClientTokenFromReadWriteToken({
            token: env.BLOB_READ_WRITE_TOKEN,
            pathname,
            allowedContentTypes: [contentType],
            allowOverwrite: true,
            // Uncomment to let Vercel call you back when the file is fully stored
            // onUploadCompleted: {
            //   callbackUrl: `${env.NEXT_PUBLIC_SITE_URL}/api/blobCallback`,
            //   // payload: JSON.stringify({ entityId, theme }),
            // },
          } satisfies GenerateClientTokenOptions);

          return { theme, token, pathname };
        }),
      );

      return results; // [{ theme:'dark', token:'vercel_blob_client_…', pathname:'123-dark.png' }, …]
    }),

  /** (Optional)  Step3 – save the final blob URL once the browser is done */
  saveUploadedUrl: publicProcedure
    .input(
      z.object({
        entityId: z.string(),
        theme: z.enum([THEME.DARK, THEME.LIGHT]),
        url: z.string().url(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const column =
        input.theme === THEME.DARK ? "screenShotDark" : "screenShotLight";
      await ctx.drizzle
        .update(schema.entities)
        .set({ [column]: input.url })
        .where(eq(schema.entities.id, input.entityId))
        .execute();
    }),
});
