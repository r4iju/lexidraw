import { z } from "zod";
import { drizzle, schema } from "@packages/drizzle";
import { and, eq, or, isNull, ne, desc } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { listenSettings } from "~/app/settings/schema";
import { computeDocKey, computeArticleKey } from "~/server/tts/id";
import { generateDocumentTtsWorkflow } from "~/workflows/document-tts/generate-document-tts-workflow";
import { generateArticleTtsWorkflow } from "~/workflows/article-tts/generate-article-tts-workflow";
import { start } from "workflow/api";
import { TRPCError } from "@trpc/server";
import { PublicAccess } from "@packages/types";
import { del } from "@vercel/blob";
import env from "@packages/env";
import { htmlToPlainText } from "@packages/lexical-nodes";
import {
  InvalidDocumentContentError,
  UnsupportedNodeTypesError,
  editorStateToMarkdown,
  parseEditorState,
} from "~/server/documents/markdown";

const JobStatus = z.enum([
  "queued",
  "processing",
  "ready",
  "error",
  "cancelled",
]);

const TtsJobSnapshot = z.object({
  docKey: z.string(),
  status: JobStatus,
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

type TtsRequest = {
  provider?: string;
  voiceId?: string;
  speed?: number;
  format?: "mp3" | "ogg" | "wav";
  languageCode?: string;
  sampleRate?: number;
};

/**
 * The voice a job reads in: what the call asks for, else the caller's
 * read-aloud settings, as the settings show them.
 */
function ttsConfigFor(input: TtsRequest, stored?: Record<string, unknown>) {
  const asked = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as TtsRequest;
  return { ...listenSettings(stored), ...asked };
}

type VoiceConfig = ReturnType<typeof ttsConfigFor>;

type TtsJob = typeof schema.ttsJobs.$inferSelect;

function snapshotOf(row: TtsJob): TtsJobSnapshot {
  return {
    docKey: row.id,
    status: row.status,
    manifestUrl: row.manifestUrl ?? undefined,
    stitchedUrl: row.stitchedUrl ?? undefined,
    segmentCount: row.segmentCount ?? undefined,
    plannedCount: row.plannedCount ?? undefined,
    error: row.error ?? undefined,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** The job last started or updated for `entityId`, in anyone's voice. */
async function latestJob(entityId: string): Promise<TtsJob | undefined> {
  const rows = await drizzle
    .select()
    .from(schema.ttsJobs)
    .where(eq(schema.ttsJobs.entityId, entityId))
    .orderBy(desc(schema.ttsJobs.updatedAt), desc(schema.ttsJobs.createdAt))
    .limit(1)
    .execute();
  return rows[0];
}

/** What a finished job's manifest lists; a missing or odd one lists nothing. */
const Manifest = z.object({
  segments: z.array(z.unknown()).catch([]),
  stitchedUrl: z.string().optional().catch(undefined),
});

async function manifestOf(row: TtsJob | undefined) {
  if (!row?.manifestUrl) return { segments: [], stitchedUrl: undefined };
  const r = await fetch(row.manifestUrl, { cache: "no-store" });
  if (!r.ok) return { segments: [], stitchedUrl: row.stitchedUrl ?? undefined };
  const manifest = Manifest.catch({ segments: [] }).parse(await r.json());
  return {
    segments: manifest.segments,
    stitchedUrl: manifest.stitchedUrl ?? row.stitchedUrl ?? undefined,
  };
}

/** Starts a run that makes a job's audio, given the run's id. */
type Starter = (runId: string) => Promise<unknown>;

/**
 * A run that has made no progress for this long has died without saying so,
 * as when its workflow was lost, and is started again.
 */
const STALLED_AFTER = 10 * 60 * 1000;

const running = (job: TtsJob) =>
  (job.status === "queued" || job.status === "processing") &&
  Date.now() - new Date(job.updatedAt).getTime() < STALLED_AFTER;

/**
 * The job that makes `entityId`'s audio as `key`. One whose audio is made or
 * being made is answered as it is, whoever started it, so asking again pays
 * for nothing. Otherwise a run is started, from what `prepareStarter` gives
 * back; it is asked only then, since reading a file for its text may fail.
 * With `replacing`, the caller's runs in other voices are cancelled first,
 * as the web's voice picker has always done.
 */
async function startTtsJob({
  entityId,
  userId,
  key,
  cfg,
  prepareStarter,
  replacing = false,
}: {
  entityId: string;
  userId: string;
  key: string;
  cfg: VoiceConfig;
  prepareStarter: () => Starter | Promise<Starter>;
  replacing?: boolean;
}): Promise<TtsJob> {
  if (replacing) {
    await drizzle
      .update(schema.ttsJobs)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(schema.ttsJobs.entityId, entityId),
          eq(schema.ttsJobs.userId, userId),
          ne(schema.ttsJobs.id, key),
          or(
            eq(schema.ttsJobs.status, "queued"),
            eq(schema.ttsJobs.status, "processing"),
          ),
        ),
      )
      .execute();
  }
  const existing = await drizzle.query.ttsJobs.findFirst({
    where: (t) => and(eq(t.id, key), eq(t.entityId, entityId)),
  });
  if (
    existing &&
    ((existing.status === "ready" && existing.manifestUrl) || running(existing))
  ) {
    return existing;
  }
  const startRun = await prepareStarter();
  const runId = crypto.randomUUID();
  const fresh = {
    status: "queued" as const,
    runId,
    ttsConfig: cfg,
    manifestUrl: null,
    stitchedUrl: null,
    segmentCount: null,
    plannedCount: null,
    error: null,
    updatedAt: new Date(),
  };
  const [queued] = await drizzle
    .insert(schema.ttsJobs)
    .values({ id: key, entityId, userId, createdAt: new Date(), ...fresh })
    .onConflictDoUpdate({ target: schema.ttsJobs.id, set: fresh })
    .returning();
  if (!queued) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  try {
    await startRun(runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await drizzle
      .update(schema.ttsJobs)
      .set({ status: "error", error: message, updatedAt: new Date() })
      .where(and(eq(schema.ttsJobs.id, key), eq(schema.ttsJobs.runId, runId)))
      .execute();
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The audio couldn't be started",
      cause: error,
    });
  }
  return queued;
}

const documentRun =
  (documentId: string, markdown: string, cfg: VoiceConfig): Starter =>
  (runId) =>
    start(generateDocumentTtsWorkflow, [documentId, markdown, cfg, runId]);

const articleRun =
  (
    articleId: string,
    plainText: string,
    html: string | undefined,
    cfg: VoiceConfig,
  ): Starter =>
  (runId) =>
    start(generateArticleTtsWorkflow, [articleId, plainText, html, cfg, runId]);

const SavedLink = z.object({
  distilled: z.object({ contentHtml: z.string().optional() }).optional(),
});

/** The page a saved link was read into, as its read-aloud run reads it. */
function distilledHtmlOf(elements: string | null | undefined) {
  if (!elements) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(elements);
  } catch {
    return undefined;
  }
  return SavedLink.safeParse(parsed).data?.distilled?.contentHtml;
}

async function articleHtmlOf(articleId: string) {
  const entity = await drizzle.query.entities.findFirst({
    where: (t) => eq(t.id, articleId),
    columns: { elements: true },
  });
  return distilledHtmlOf(entity?.elements);
}

/** The caller's read-aloud settings, read fresh rather than from the session. */
async function storedTtsOf(userId: string) {
  const user = await drizzle.query.users.findFirst({
    where: (users, { eq }) => eq(users.id, userId),
    columns: { config: true },
  });
  return user?.config?.tts;
}

/** A document's text as the web's Listen reads it from the editor. */
function documentMarkdownOf(elements: string) {
  let markdown: string;
  try {
    markdown = editorStateToMarkdown(parseEditorState(elements));
  } catch (error) {
    if (
      error instanceof InvalidDocumentContentError ||
      error instanceof UnsupportedNodeTypesError
    ) {
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: error.message,
        cause: error,
      });
    }
    throw error;
  }
  if (!markdown.trim()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "There is nothing in this document to read aloud",
    });
  }
  return markdown;
}

/**
 * How each kind of file is read aloud: the key its audio is kept under, and
 * the run that reads its stored content, as the web's Listen reads it.
 */
const READERS = {
  document: {
    keyOf: computeDocKey,
    runOf: (id: string, elements: string, cfg: VoiceConfig) =>
      documentRun(id, documentMarkdownOf(elements), cfg),
  },
  url: {
    keyOf: computeArticleKey,
    runOf: (id: string, elements: string, cfg: VoiceConfig) => {
      const html = distilledHtmlOf(elements);
      if (!html) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This link's page hasn't been read yet",
        });
      }
      return articleRun(id, htmlToPlainText(html), html, cfg);
    },
  },
} as const;

/**
 * A file that can be read aloud, as the web offers Listen on it, with how it
 * is read, in the caller's own read-aloud settings.
 */
async function listenableOrNotFound(id: string, userId: string) {
  const [[entity], stored] = await Promise.all([
    drizzle
      .select({
        entityType: schema.entities.entityType,
        elements: schema.entities.elements,
      })
      .from(schema.entities)
      .leftJoin(
        schema.sharedEntities,
        and(
          eq(schema.sharedEntities.entityId, schema.entities.id),
          eq(schema.sharedEntities.userId, userId),
        ),
      )
      .where(
        and(
          eq(schema.entities.id, id),
          isNull(schema.entities.deletedAt),
          or(
            eq(schema.entities.userId, userId),
            eq(schema.sharedEntities.userId, userId),
            ne(schema.entities.publicAccess, PublicAccess.PRIVATE),
          ),
        ),
      )
      .limit(1)
      .execute(),
    storedTtsOf(userId),
  ]);
  if (!entity) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Entity not found" });
  }
  if (entity.entityType !== "document" && entity.entityType !== "url") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only documents and links can be read aloud",
    });
  }
  const reader = READERS[entity.entityType];
  const cfg = ttsConfigFor({}, stored);
  return {
    cfg,
    key: reader.keyOf(id, cfg),
    runOf: () => reader.runOf(id, entity.elements, cfg),
  };
}

const ListenedSegment = z.object({
  index: z.number().int(),
  text: z.string(),
  audioUrl: z.url(),
  sectionTitle: z.string().optional(),
  durationSec: z.number().optional(),
});

/** How far a file's audio is, with its parts once all are made. */
const Listening = z
  .object({
    status: z.enum(["none", ...JobStatus.options]),
    plannedCount: z.number().int().optional(),
    segmentCount: z.number().int().optional(),
    error: z.string().optional(),
    segments: z.array(ListenedSegment),
  })
  .meta({ id: "Listening" });

async function listeningOf(
  job: TtsJob | undefined,
): Promise<z.infer<typeof Listening>> {
  if (!job) return { status: "none", segments: [] };
  const segments =
    job.status === "ready"
      ? (await manifestOf(job)).segments.flatMap((segment) => {
          const parsed = ListenedSegment.safeParse(segment);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
  return {
    status: job.status,
    plannedCount: job.plannedCount ?? undefined,
    segmentCount: job.segmentCount ?? undefined,
    error: job.error ?? undefined,
    segments,
  };
}

/** Whatever of `entityId`'s audio there is, and its job, so it is made anew. */
async function deleteAudioOf(entityId: string, from: string) {
  const row = await drizzle.query.ttsJobs.findFirst({
    where: (t) => eq(t.entityId, entityId),
  });
  if (!row) return { deleted: false };

  const urlsToDelete: string[] = [];
  if (row.manifestUrl) {
    urlsToDelete.push(row.manifestUrl);
    try {
      const manifestResponse = await fetch(row.manifestUrl, {
        cache: "no-store",
      });
      if (manifestResponse.ok) {
        const manifest = Manifest.parse(await manifestResponse.json());
        if (manifest.stitchedUrl) urlsToDelete.push(manifest.stitchedUrl);
        for (const segment of manifest.segments) {
          const audioUrl = z.object({ audioUrl: z.string() }).safeParse(segment)
            .data?.audioUrl;
          if (audioUrl) urlsToDelete.push(audioUrl);
        }
      }
    } catch (e) {
      console.warn(`[trpc][tts][${from}] Failed to fetch manifest`, e);
    }
  }

  if (urlsToDelete.length > 0) {
    try {
      await del(urlsToDelete);
    } catch (e) {
      console.warn(`[trpc][tts][${from}] Failed to delete some blobs`, e);
    }
  }

  // A run still making it finds its job gone and stops.
  await drizzle
    .delete(schema.ttsJobs)
    .where(eq(schema.ttsJobs.id, row.id))
    .execute();
  return { deleted: true };
}

const LISTEN_ERRORS = [400, 401, 403, 404, 422, 500];

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
      const userId = ctx.session.user.id;
      await assertCanAccessDocumentOrThrow(userId, input.documentId);
      const cfg = ttsConfigFor(input, await storedTtsOf(userId));
      const job = await startTtsJob({
        entityId: input.documentId,
        userId,
        key: computeDocKey(input.documentId, cfg),
        cfg,
        prepareStarter: () =>
          documentRun(input.documentId, input.markdown ?? "", cfg),
        replacing: true,
      });
      return snapshotOf(job);
    }),

  getDocumentTtsStatus: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertCanAccessDocumentOrThrow(
        ctx.session?.user?.id,
        input.documentId,
      );
      const row = await latestJob(input.documentId);
      return row ? snapshotOf(row) : null;
    }),

  getDocumentTtsManifest: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertCanAccessDocumentOrThrow(
        ctx.session?.user?.id,
        input.documentId,
      );
      return manifestOf(await latestJob(input.documentId));
    }),

  deleteDocumentTts: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertCanAccessDocumentOrThrow(
        ctx.session.user.id,
        input.documentId,
      );
      return deleteAudioOf(input.documentId, "deleteDocumentTts");
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
      const userId = ctx.session.user.id;
      await assertCanAccessArticleOrThrow(userId, input.articleId);
      const cfg = ttsConfigFor(input, await storedTtsOf(userId));
      const job = await startTtsJob({
        entityId: input.articleId,
        userId,
        key: computeArticleKey(input.articleId, cfg),
        cfg,
        prepareStarter: async () =>
          articleRun(
            input.articleId,
            input.plainText ?? "",
            await articleHtmlOf(input.articleId),
            cfg,
          ),
        replacing: true,
      });
      return snapshotOf(job);
    }),

  getArticleTtsStatus: protectedProcedure
    .input(z.object({ articleId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertCanAccessArticleOrThrow(
        ctx.session?.user?.id,
        input.articleId,
      );
      const row = await latestJob(input.articleId);
      return row ? snapshotOf(row) : null;
    }),

  getArticleTtsManifest: protectedProcedure
    .input(z.object({ articleId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertCanAccessArticleOrThrow(
        ctx.session?.user?.id,
        input.articleId,
      );
      return manifestOf(await latestJob(input.articleId));
    }),

  deleteArticleTts: protectedProcedure
    .input(z.object({ articleId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertCanAccessArticleOrThrow(ctx.session.user.id, input.articleId);
      return deleteAudioOf(input.articleId, "deleteArticleTts");
    }),

  listen: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/entities/{id}/listen",
        tags: ["entities"],
        summary:
          "Read a document or link aloud in the caller's voice; answers the audio when it is already made",
        protect: true,
        errorResponses: LISTEN_ERRORS,
      },
    })
    .input(z.object({ id: z.string() }))
    .output(Listening)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const listenable = await listenableOrNotFound(input.id, userId);
      const job = await startTtsJob({
        entityId: input.id,
        userId,
        key: listenable.key,
        cfg: listenable.cfg,
        prepareStarter: listenable.runOf,
      });
      return listeningOf(job);
    }),

  listening: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/entities/{id}/listen",
        tags: ["entities"],
        summary:
          "How far the caller's audio of a document or link is, with its parts once all are made",
        protect: true,
        errorResponses: LISTEN_ERRORS,
      },
    })
    .input(z.object({ id: z.string() }))
    .output(Listening)
    .query(async ({ input, ctx }) => {
      const { key } = await listenableOrNotFound(input.id, ctx.session.user.id);
      const job = await drizzle.query.ttsJobs.findFirst({
        where: (t) => and(eq(t.id, key), eq(t.entityId, input.id)),
      });
      return listeningOf(job);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const manifestUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/tts/${input.id}/manifest.json`;
      const res = await fetch(manifestUrl, { cache: "no-store" });
      if (!res.ok) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "TTS manifest not found",
        });
      }
      const json = await res.json();
      return { ...json, manifestUrl };
    }),
});
