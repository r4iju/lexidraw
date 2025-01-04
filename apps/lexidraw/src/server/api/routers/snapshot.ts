import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { PublicAccess } from "@packages/types";
import { eq, schema } from "@packages/drizzle";
import { s3 } from "~/server/s3";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
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

const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
};

const streamToString = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
};

const generatePresignedUrl = async (bucket: string, key: string) => {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: 7 * 24 * 60 * 60 }); // 7 days
};

export const snapshotRouter = createTRPCRouter({
  create: publicProcedure
    .input(
      z.object({
        entityId: z.string(),
        svg: z.string(),
        theme: z.enum([THEME.DARK, THEME.LIGHT]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      console.log("input", input);
      const entity = await ctx.drizzle.query.entities.findFirst({
        where: (drw, { eq }) => eq(drw.id, input.entityId),
      });
      if (!entity) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Drawing not found",
        });
      }

      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEdit = entity.publicAccess === PublicAccess.EDIT;
      if (!isOwner && !anyOneCanEdit) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to save this drawing",
        });
      }
      const { entityId, theme, svg } = input;
      const svgBuffer = Buffer.from(svg);

      try {
        const uploadParams = {
          Bucket: env.SUPABASE_S3_BUCKET,
          Key: `${entityId}-${theme}.svg`,
          Body: svgBuffer,
          ContentType: "image/svg+xml",
        };
        await s3.send(new PutObjectCommand(uploadParams));

        const signedUrl = await generatePresignedUrl(
          env.SUPABASE_S3_BUCKET,
          `${entityId}-${theme}.svg`,
        );

        await ctx.drizzle
          .update(schema.entities)
          .set({
            [theme === THEME.DARK ? "screenShotDark" : "screenShotLight"]:
              signedUrl,
          })
          .where(eq(schema.entities.id, entityId))
          .execute();
      } catch (error) {
        let errorMessage = "Failed to upload blob due to unknown reason.";
        if (error instanceof Error) {
          errorMessage = error.message;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: errorMessage,
        });
      }
    }),
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
      console.log("entity", entity);
      if (!entity) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Drawing not found",
        });
      }
      const isOwner = entity.userId === ctx.session?.user.id;
      console.log("isOwner", isOwner);
      const anyOneCanEdit = entity.publicAccess === PublicAccess.EDIT;
      console.log("anyOneCanEdit", anyOneCanEdit);
      if (!isOwner && !anyOneCanEdit) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to save this drawing",
        });
      }
      const { entityId, svg, theme } = input;
      const svgBuffer = Buffer.from(svg);
      console.log("svgBuffer", svgBuffer);
      try {
        const uploadParams = {
          Bucket: env.SUPABASE_S3_BUCKET,
          Key: `${entityId}-${theme}.svg`,
          Body: svgBuffer,
          ContentType: "image/svg+xml",
        };
        const res = await s3.send(new PutObjectCommand(uploadParams));
        console.log("uploaded to s3 with res", res);
        return res;
      } catch (error) {
        let errorMessage = "Failed to update snapshot due to an unknown error.";
        if (error instanceof Error) {
          errorMessage = error.message;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: errorMessage,
        });
      }
    }),
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
      if (!entity) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Drawing not found",
        });
      }

      const { entityId, theme } = input;

      try {
        const getObjectParams = {
          Bucket: env.SUPABASE_S3_BUCKET,
          Key: `${entityId}-${theme}.svg`,
        };
        const { Body } = await s3.send(new GetObjectCommand(getObjectParams));
        if (!Body) throw new Error("Failed to retrieve SVG data");
        const svgBuffer = await streamToBuffer(Body as Readable);
        const svgBase64 = svgBuffer.toString("base64");
        return `data:image/svg+xml;base64,${svgBase64}`;
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Failed to retrieve SVG data";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: errorMessage,
        });
      }
    }),

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
      if (!entity) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Drawing not found",
        });
      }
      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEditOrView = entity.publicAccess !== PublicAccess.PRIVATE;
      if (!isOwner && !anyOneCanEditOrView) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to view this drawing",
        });
      }
      const { entityId, theme } = input;

      try {
        const getObjectParams = {
          Bucket: env.SUPABASE_S3_BUCKET,
          Key: `${entityId}-${theme}.svg`,
        };
        const { Body } = await s3.send(new GetObjectCommand(getObjectParams));
        if (!Body) return genericSvgContent;
        const svgString = await streamToString(Body as Readable);
        return svgString;
      } catch (error) {
        return genericSvgContent;
      }
    }),
  getSignedUrl: publicProcedure
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
      console.log("entity", entity);
      if (!entity) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Drawing not found",
        });
      }
      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEditOrView = entity.publicAccess !== PublicAccess.PRIVATE;
      console.log("isOwner", isOwner);
      console.log("anyOneCanEditOrView", anyOneCanEditOrView);
      if (!isOwner && !anyOneCanEditOrView) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to view this drawing",
        });
      }
      const { entityId, theme } = input;

      try {
        const signedUrl = await generatePresignedUrl(
          env.SUPABASE_S3_BUCKET,
          `${entityId}-${theme}.svg`,
        );
        return signedUrl;
      } catch (error) {
        let errorMessage =
          "Failed to generate signed URL due to an unknown error.";
        if (error instanceof Error) {
          errorMessage = error.message;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: errorMessage,
        });
      }
    }),
  generateUploadUrls: publicProcedure
    .input(
      z.object({
        entityId: z.string(),
        // svg, jpeg or png
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

      // Fetch the entity
      const entity = await ctx.drizzle
        .select({
          id: ctx.schema.entities.id,
          userId: ctx.schema.entities.userId,
          publicAccess: ctx.schema.entities.publicAccess,
        })
        .from(ctx.schema.entities)
        .where(eq(ctx.schema.entities.id, entityId))
        .then((rows) => rows[0]);

      if (!entity) {
        console.error("Entity not found");
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Drawing not found",
        });
      }

      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEdit = entity.publicAccess === PublicAccess.EDIT;

      if (!isOwner && !anyOneCanEdit) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to view this drawing",
        });
      }

      const extension = contentType.split("/")[1]?.replace(/\+.*$/, "");
      const themes = [THEME.DARK, THEME.LIGHT];
      const now = new Date();

      // Generate file details for both themes
      const files = themes.map((theme) => {
        const fileName = `${entityId}-${theme}.${extension}`;
        return {
          theme,
          fileName,
          uploadCommand: new PutObjectCommand({
            Bucket: env.SUPABASE_S3_BUCKET,
            Key: fileName,
            ContentType: contentType,
          }),
          downloadCommand: new GetObjectCommand({
            Bucket: env.SUPABASE_S3_BUCKET,
            Key: fileName,
          }),
        };
      });

      // Generate signed URLs and update entity
      const signedUrls = await Promise.all(
        files.map(
          async ({ theme, fileName, uploadCommand, downloadCommand }) => {
            try {
              const [signedUploadUrl, signedDownloadUrl] = await Promise.all([
                getSignedUrl(s3, uploadCommand, { expiresIn: 15 * 60 }), // 15 minutes
                getSignedUrl(s3, downloadCommand, {
                  expiresIn: 7 * 24 * 60 * 60,
                }), // 7 days
              ]);

              const fieldToUpdate =
                theme === THEME.DARK ? "screenShotDark" : "screenShotLight";
              await ctx.drizzle
                .update(ctx.schema.entities)
                .set({
                  [fieldToUpdate]: signedDownloadUrl,
                  updatedAt: now, // Update the entity's timestamp
                })
                .where(eq(ctx.schema.entities.id, entityId))
                .execute();
              await ctx.drizzle
                .insert(ctx.schema.uploadedImages)
                .values({
                  id: `${entity.id}-${theme}`,
                  userId: ctx.session?.user.id ?? "",
                  entityId,
                  fileName,
                  kind: "thumbnail",
                  signedUploadUrl,
                  signedDownloadUrl,
                })
                .onConflictDoUpdate({
                  target: ctx.schema.uploadedImages.id,
                  set: {
                    signedUploadUrl: signedUploadUrl,
                    signedDownloadUrl: signedDownloadUrl,
                  },
                })
                .execute();

              return {
                theme,
                signedUploadUrl,
                signedDownloadUrl,
                key: fileName,
                bucket: env.SUPABASE_S3_BUCKET,
              };
            } catch (error) {
              console.error(
                `Failed to generate signed URL for theme ${theme}:`,
                error,
              );
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to generate signed URL",
              });
            }
          },
        ),
      );

      return signedUrls;
    }),
});
