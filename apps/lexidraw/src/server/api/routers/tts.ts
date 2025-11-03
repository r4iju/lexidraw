import { z } from "zod";
import { drizzle, schema } from "@packages/drizzle";
import { and, eq, or, isNull, ne } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { computeDocKey, computeArticleKey } from "~/server/tts/id";
import { generateDocumentTtsWorkflow } from "~/workflows/document-tts/generate-document-tts-workflow";
import { generateArticleTtsWorkflow } from "~/workflows/article-tts/generate-article-tts-workflow";
import { start } from "workflow/api";
import { TRPCError } from "@trpc/server";
import { PublicAccess } from "@packages/types";
import { del } from "@vercel/blob";
import type { TtsSegment } from "~/server/tts/types";

const TtsJobSnapshot = z.object({
  docKey: z.string(),
  status: z.enum(["queued", "processing", "ready", "error"]),
  manifestUrl: z.string().url().optional(),
  stitchedUrl: z.string().url().optional(),
  segmentCount: z.number().optional(),
  plannedCount: z.number().optional(),
  error: z.string().optional(),
  updatedAt: z.string(),
});

export type TtsJobSnapshot = z.infer<typeof TtsJobSnapshot>;

async function assertCanAccessDocumentOrThrow(
  userId: string | undefined,
  documentId: string,
) {
  if (!userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const rows = await drizzle
    .select({ id: schema.entities.id })
    .from(schema.entities)
    .leftJoin(
      schema.sharedEntities,
      eq(schema.sharedEntities.entityId, schema.entities.id),
    )
    .where(
      and(
        eq(schema.entities.id, documentId),
        eq(schema.entities.entityType, "document"),
        isNull(schema.entities.deletedAt),
        or(
          eq(schema.entities.userId, userId),
          eq(schema.sharedEntities.userId, userId),
          ne(schema.entities.publicAccess, PublicAccess.PRIVATE),
        ),
      ),
    )
    .limit(1)
    .execute();

  if (!rows[0]) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
}

async function assertCanAccessArticleOrThrow(
  userId: string | undefined,
  articleId: string,
) {
  if (!userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const rows = await drizzle
    .select({ id: schema.entities.id })
    .from(schema.entities)
    .leftJoin(
      schema.sharedEntities,
      eq(schema.sharedEntities.entityId, schema.entities.id),
    )
    .where(
      and(
        eq(schema.entities.id, articleId),
        eq(schema.entities.entityType, "url"),
        isNull(schema.entities.deletedAt),
        or(
          eq(schema.entities.userId, userId),
          eq(schema.sharedEntities.userId, userId),
          ne(schema.entities.publicAccess, PublicAccess.PRIVATE),
        ),
      ),
    )
    .limit(1)
    .execute();

  if (!rows[0]) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
}

export const ttsRouter = createTRPCRouter({
  startDocumentTts: protectedProcedure
    .input(
      z.object({
        documentId: z.string(),
        markdown: z.string().optional(),
        provider: z.string().optional(),
        voiceId: z.string().optional(),
        speed: z.number().optional(),
        format: z.enum(["mp3", "ogg", "wav"]).optional(),
        languageCode: z.string().optional(),
        sampleRate: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id;
      await assertCanAccessDocumentOrThrow(userId, input.documentId);
      const userCfg = ctx.session?.user?.config?.tts ?? {};
      const cfg = {
        provider: input.provider ?? (userCfg.provider as string) ?? "kokoro",
        voiceId: input.voiceId ?? (userCfg.voiceId as string) ?? "Alva",
        speed: input.speed ?? (userCfg.speed as number) ?? 1,
        format:
          input.format ?? (userCfg.format as "mp3" | "ogg" | "wav") ?? "mp3",
        languageCode:
          input.languageCode ?? (userCfg.languageCode as string) ?? "en-US",
        sampleRate:
          input.sampleRate ?? (userCfg.sampleRate as number | undefined),
      };
      const docKey = computeDocKey(input.documentId, cfg);

      const existing = await drizzle.query.ttsJobs.findFirst({
        where: (t) => and(eq(t.id, docKey), eq(t.entityId, input.documentId)),
      });
      if (existing?.status === "ready" && existing.manifestUrl) {
        return {
          docKey,
          status: existing.status,
          manifestUrl: existing.manifestUrl,
          stitchedUrl: existing.stitchedUrl ?? undefined,
          segmentCount: existing.segmentCount ?? undefined,
          plannedCount:
            (existing as { plannedCount?: number | null }).plannedCount ??
            undefined,
          updatedAt: new Date(existing.updatedAt).toISOString(),
        } satisfies TtsJobSnapshot;
      }

      // Upsert queued
      await drizzle
        .insert(schema.ttsJobs)
        .values({
          id: docKey,
          entityId: input.documentId,
          userId,
          status: "queued",
          ttsConfig: cfg as unknown as Record<string, unknown>,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.ttsJobs.id,
          set: { status: "queued", updatedAt: new Date() },
        })
        .execute();

      // Fire workflow (do not await full run)
      // Fire-and-forget: start workflow and return immediately
      void start(generateDocumentTtsWorkflow, [
        input.documentId,
        input.markdown ?? "",
        cfg,
      ]);

      return {
        docKey,
        status: "queued",
        updatedAt: new Date().toISOString(),
      } satisfies TtsJobSnapshot;
    }),

  getDocumentTtsStatus: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertCanAccessDocumentOrThrow(
        ctx.session?.user?.id,
        input.documentId,
      );
      const row = await drizzle.query.ttsJobs.findFirst({
        where: (t) => eq(t.entityId, input.documentId),
      });
      if (!row) {
        return {
          docKey: "",
          status: "queued",
          updatedAt: new Date().toISOString(),
        } as TtsJobSnapshot;
      }
      return {
        docKey: row.id,
        status: row.status as TtsJobSnapshot["status"],
        manifestUrl: row.manifestUrl ?? undefined,
        stitchedUrl: row.stitchedUrl ?? undefined,
        segmentCount: row.segmentCount ?? undefined,
        plannedCount:
          (row as { plannedCount?: number | null }).plannedCount ?? undefined,
        error: row.error ?? undefined,
        updatedAt: new Date(row.updatedAt).toISOString(),
      } satisfies TtsJobSnapshot;
    }),

  getDocumentTtsManifest: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertCanAccessDocumentOrThrow(
        ctx.session?.user?.id,
        input.documentId,
      );
      const row = await drizzle.query.ttsJobs.findFirst({
        where: (t) => eq(t.entityId, input.documentId),
      });
      console.log("[trpc][tts][getDocumentTtsManifest] row", row);
      if (!row?.manifestUrl) return { segments: [], stitchedUrl: undefined };
      const r = await fetch(row.manifestUrl, { cache: "no-store" });
      if (!r.ok)
        return { segments: [], stitchedUrl: row.stitchedUrl ?? undefined };
      const json = (await r.json()) as {
        segments?: unknown[];
        stitchedUrl?: string;
      };
      return {
        segments: Array.isArray(json.segments) ? json.segments : [],
        stitchedUrl: json.stitchedUrl ?? row.stitchedUrl ?? undefined,
      };
    }),

  deleteDocumentTts: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id;
      await assertCanAccessDocumentOrThrow(userId, input.documentId);

      const row = await drizzle.query.ttsJobs.findFirst({
        where: (t) => eq(t.entityId, input.documentId),
      });

      if (!row) {
        return { deleted: false };
      }

      const urlsToDelete: string[] = [];

      // Fetch manifest to get all segment URLs
      if (row.manifestUrl) {
        urlsToDelete.push(row.manifestUrl);
        try {
          const manifestResponse = await fetch(row.manifestUrl, {
            cache: "no-store",
          });
          if (manifestResponse.ok) {
            const manifest = (await manifestResponse.json()) as {
              segments?: TtsSegment[];
              stitchedUrl?: string;
            };

            // Add stitched URL if it exists
            if (manifest.stitchedUrl) {
              urlsToDelete.push(manifest.stitchedUrl);
            }

            // Add all segment audio URLs
            if (Array.isArray(manifest.segments)) {
              for (const segment of manifest.segments) {
                if (segment.audioUrl) {
                  urlsToDelete.push(segment.audioUrl);
                }
              }
            }
          }
        } catch (e) {
          console.warn(
            "[trpc][tts][deleteDocumentTts] Failed to fetch manifest",
            e,
          );
        }
      }

      // Delete all blob files
      if (urlsToDelete.length > 0) {
        try {
          await del(urlsToDelete);
        } catch (e) {
          console.warn(
            "[trpc][tts][deleteDocumentTts] Failed to delete some blobs",
            e,
          );
        }
      }

      // Reset database record
      await drizzle
        .update(schema.ttsJobs)
        .set({
          status: "queued",
          manifestUrl: null,
          stitchedUrl: null,
          segmentCount: null,
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.ttsJobs.id, row.id))
        .execute();

      return { deleted: true };
    }),

  startArticleTts: protectedProcedure
    .input(
      z.object({
        articleId: z.string(),
        plainText: z.string().optional(),
        provider: z.string().optional(),
        voiceId: z.string().optional(),
        speed: z.number().optional(),
        format: z.enum(["mp3", "ogg", "wav"]).optional(),
        languageCode: z.string().optional(),
        sampleRate: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id;
      await assertCanAccessArticleOrThrow(userId, input.articleId);
      const userCfg = ctx.session?.user?.config?.tts ?? {};
      const cfg = {
        provider: input.provider ?? (userCfg.provider as string) ?? "kokoro",
        voiceId: input.voiceId ?? (userCfg.voiceId as string) ?? "Alva",
        speed: input.speed ?? (userCfg.speed as number) ?? 1,
        format:
          input.format ?? (userCfg.format as "mp3" | "ogg" | "wav") ?? "mp3",
        languageCode:
          input.languageCode ?? (userCfg.languageCode as string) ?? "en-US",
        sampleRate:
          input.sampleRate ?? (userCfg.sampleRate as number | undefined),
      };
      const articleKey = computeArticleKey(input.articleId, cfg);

      const existing = await drizzle.query.ttsJobs.findFirst({
        where: (t) =>
          and(eq(t.id, articleKey), eq(t.entityId, input.articleId)),
      });
      if (existing?.status === "ready" && existing.manifestUrl) {
        return {
          docKey: articleKey,
          status: existing.status,
          manifestUrl: existing.manifestUrl,
          stitchedUrl: existing.stitchedUrl ?? undefined,
          segmentCount: existing.segmentCount ?? undefined,
          plannedCount:
            (existing as { plannedCount?: number | null }).plannedCount ??
            undefined,
          updatedAt: new Date(existing.updatedAt).toISOString(),
        } satisfies TtsJobSnapshot;
      }

      // Upsert queued
      await drizzle
        .insert(schema.ttsJobs)
        .values({
          id: articleKey,
          entityId: input.articleId,
          userId,
          status: "queued",
          ttsConfig: cfg as unknown as Record<string, unknown>,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.ttsJobs.id,
          set: { status: "queued", updatedAt: new Date() },
        })
        .execute();

      // Fetch HTML content from entity for section extraction
      let htmlContent: string | undefined;
      const entity = await drizzle.query.entities.findFirst({
        where: (t) => eq(t.id, input.articleId),
      });
      if (entity?.elements) {
        try {
          const parsed = JSON.parse(entity.elements) as {
            distilled?: { contentHtml?: string };
          };
          htmlContent = parsed.distilled?.contentHtml;
        } catch {
          // ignore parse errors
        }
      }

      // Fire workflow (do not await full run)
      void start(generateArticleTtsWorkflow, [
        input.articleId,
        input.plainText ?? "",
        htmlContent,
        cfg,
      ]);

      return {
        docKey: articleKey,
        status: "queued",
        updatedAt: new Date().toISOString(),
      } satisfies TtsJobSnapshot;
    }),

  getArticleTtsStatus: protectedProcedure
    .input(z.object({ articleId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertCanAccessArticleOrThrow(
        ctx.session?.user?.id,
        input.articleId,
      );
      const row = await drizzle.query.ttsJobs.findFirst({
        where: (t) => eq(t.entityId, input.articleId),
      });
      if (!row) {
        return {
          docKey: "",
          status: "queued",
          updatedAt: new Date().toISOString(),
        } as TtsJobSnapshot;
      }
      return {
        docKey: row.id,
        status: row.status as TtsJobSnapshot["status"],
        manifestUrl: row.manifestUrl ?? undefined,
        stitchedUrl: row.stitchedUrl ?? undefined,
        segmentCount: row.segmentCount ?? undefined,
        plannedCount:
          (row as { plannedCount?: number | null }).plannedCount ?? undefined,
        error: row.error ?? undefined,
        updatedAt: new Date(row.updatedAt).toISOString(),
      } satisfies TtsJobSnapshot;
    }),

  getArticleTtsManifest: protectedProcedure
    .input(z.object({ articleId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertCanAccessArticleOrThrow(
        ctx.session?.user?.id,
        input.articleId,
      );
      const row = await drizzle.query.ttsJobs.findFirst({
        where: (t) => eq(t.entityId, input.articleId),
      });
      console.log("[trpc][tts][getArticleTtsManifest] row", row);
      if (!row?.manifestUrl) return { segments: [], stitchedUrl: undefined };
      const r = await fetch(row.manifestUrl, { cache: "no-store" });
      if (!r.ok)
        return { segments: [], stitchedUrl: row.stitchedUrl ?? undefined };
      const json = (await r.json()) as {
        segments?: unknown[];
        stitchedUrl?: string;
      };
      return {
        segments: Array.isArray(json.segments) ? json.segments : [],
        stitchedUrl: json.stitchedUrl ?? row.stitchedUrl ?? undefined,
      };
    }),

  deleteArticleTts: protectedProcedure
    .input(z.object({ articleId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id;
      await assertCanAccessArticleOrThrow(userId, input.articleId);

      const row = await drizzle.query.ttsJobs.findFirst({
        where: (t) => eq(t.entityId, input.articleId),
      });

      if (!row) {
        return { deleted: false };
      }

      const urlsToDelete: string[] = [];

      // Fetch manifest to get all segment URLs
      if (row.manifestUrl) {
        urlsToDelete.push(row.manifestUrl);
        try {
          const manifestResponse = await fetch(row.manifestUrl, {
            cache: "no-store",
          });
          if (manifestResponse.ok) {
            const manifest = (await manifestResponse.json()) as {
              segments?: TtsSegment[];
              stitchedUrl?: string;
            };

            // Add stitched URL if it exists
            if (manifest.stitchedUrl) {
              urlsToDelete.push(manifest.stitchedUrl);
            }

            // Add all segment audio URLs
            if (Array.isArray(manifest.segments)) {
              for (const segment of manifest.segments) {
                if (segment.audioUrl) {
                  urlsToDelete.push(segment.audioUrl);
                }
              }
            }
          }
        } catch (e) {
          console.warn(
            "[trpc][tts][deleteArticleTts] Failed to fetch manifest",
            e,
          );
        }
      }

      // Delete all blob files
      if (urlsToDelete.length > 0) {
        try {
          await del(urlsToDelete);
        } catch (e) {
          console.warn(
            "[trpc][tts][deleteArticleTts] Failed to delete some blobs",
            e,
          );
        }
      }

      // Reset database record
      await drizzle
        .update(schema.ttsJobs)
        .set({
          status: "queued",
          manifestUrl: null,
          stitchedUrl: null,
          segmentCount: null,
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.ttsJobs.id, row.id))
        .execute();

      return { deleted: true };
    }),
});
