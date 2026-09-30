import type { OpenApiMeta } from "trpc-to-openapi";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  HTMLBlockSource,
  SavedHTMLBlockSchema,
  type SavedHTMLBlock,
} from "@packages/lexical-nodes/html-block";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../trpc";
import {
  findReadableEntity,
  findWritableEntity,
} from "~/server/entities/readable";
import {
  blocksIn,
  changeBlock,
  savedBlock,
  type BlockChange,
} from "~/server/html-blocks/content";
import { captureBlock } from "~/server/html-blocks/preview";
import { drizzleDocumentStore } from "~/server/documents/document-store";
import { StaleDocumentError } from "~/server/documents/conflict";
import { queueThumbnail } from "~/server/entities/queue-thumbnail";
import { revalidateEntities } from "../entity-cache";
import { isoDate } from "../rest-schemas";
import type { createTRPCContext } from "../trpc";
type Context = Awaited<ReturnType<typeof createTRPCContext>>;
const address = z.object({ id: z.string(), blockId: z.string().uuid() });
const blockSchema = SavedHTMLBlockSchema;
const revisionSchema = z.object({
  id: z.string(),
  updatedAt: isoDate,
  block: blockSchema.optional(),
});
const meta = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: `/${string}`,
  summary: string,
): OpenApiMeta => ({
  openapi: { method, path, tags: ["documents"], summary, protect: true },
});
async function readable(ctx: Context, id: string) {
  const entity = await findReadableEntity(
    ctx.drizzle,
    id,
    ctx.session?.user.id ?? "",
  );
  if (entity?.entityType !== "document")
    throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
  return entity;
}
function identified(elements: string, id: string): SavedHTMLBlock {
  const matching = blocksIn(elements).filter((block) => block.id === id);
  if (matching.length !== 1)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "HTML block not found or identity is ambiguous",
    });
  const block = matching[0];
  if (!block) throw new TRPCError({ code: "NOT_FOUND" });
  if (savedBlock(block, block.id).revision !== block.revision)
    throw new TRPCError({
      code: "CONFLICT",
      message: "HTML block revision is invalid; update through the block API",
    });
  return block;
}
async function write(
  ctx: Context,
  id: string,
  expected: string,
  change: BlockChange,
) {
  const userId = ctx.session?.user.id ?? "";
  const entity = await findWritableEntity(ctx.drizzle, id, userId);
  if (entity?.entityType !== "document")
    throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
  try {
    const result = await changeBlock(
      drizzleDocumentStore(ctx.drizzle, userId, (row) =>
        queueThumbnail(ctx.drizzle, row),
      ),
      { ...entity, tags: [] },
      change,
      expected,
    );
    revalidateEntities(id, entity.parentId);
    return result;
  } catch (error) {
    if (error instanceof StaleDocumentError)
      throw new TRPCError({
        code: "CONFLICT",
        message: error.message,
        cause: error,
      });
    throw new TRPCError({
      code:
        error instanceof Error && error.message === "HTML block not found"
          ? "NOT_FOUND"
          : "BAD_REQUEST",
      message: error instanceof Error ? error.message : "Block write failed",
    });
  }
}
export const htmlBlocksRouter = createTRPCRouter({
  list: publicProcedure
    .meta(meta("GET", "/documents/{id}/html-blocks", "List saved HTML blocks"))
    .input(z.object({ id: z.string() }))
    .output(z.object({ updatedAt: isoDate, blocks: z.array(blockSchema) }))
    .query(async ({ input, ctx }) => {
      const entity = await readable(ctx, input.id);
      return { updatedAt: entity.updatedAt, blocks: blocksIn(entity.elements) };
    }),
  get: publicProcedure
    .meta(
      meta(
        "GET",
        "/documents/{id}/html-blocks/{blockId}",
        "Read an HTML block source and saved defaults",
      ),
    )
    .input(address)
    .output(z.object({ updatedAt: isoDate, block: blockSchema }))
    .query(async ({ input, ctx }) => {
      const entity = await readable(ctx, input.id);
      return {
        updatedAt: entity.updatedAt,
        block: identified(entity.elements, input.blockId),
      };
    }),
  create: protectedProcedure
    .meta(
      meta(
        "POST",
        "/documents/{id}/html-blocks",
        "Insert a self-contained HTML block",
      ),
    )
    .input(
      z.object({
        id: z.string(),
        source: HTMLBlockSource,
        atBlockIndex: z.number().int().nonnegative(),
        ifUnmodifiedSince: z.iso.datetime(),
      }),
    )
    .output(revisionSchema)
    .mutation(({ input, ctx }) =>
      write(ctx, input.id, input.ifUnmodifiedSince, {
        kind: "create",
        source: input.source,
        atBlockIndex: input.atBlockIndex,
      }),
    ),
  update: protectedProcedure
    .meta(
      meta(
        "PUT",
        "/documents/{id}/html-blocks/{blockId}",
        "Replace saved HTML block content while retaining identity",
      ),
    )
    .input(
      address.extend({
        source: HTMLBlockSource,
        ifUnmodifiedSince: z.iso.datetime(),
      }),
    )
    .output(revisionSchema)
    .mutation(({ input, ctx }) =>
      write(ctx, input.id, input.ifUnmodifiedSince, {
        kind: "update",
        source: input.source,
        blockId: input.blockId,
      }),
    ),
  delete: protectedProcedure
    .meta(
      meta(
        "DELETE",
        "/documents/{id}/html-blocks/{blockId}",
        "Delete only the identified HTML block",
      ),
    )
    .input(address.extend({ ifUnmodifiedSince: z.iso.datetime() }))
    .output(revisionSchema)
    .mutation(({ input, ctx }) =>
      write(ctx, input.id, input.ifUnmodifiedSince, {
        kind: "delete",
        blockId: input.blockId,
      }),
    ),
  preview: publicProcedure
    .meta(
      meta(
        "GET",
        "/documents/{id}/html-blocks/{blockId}/preview",
        "Capture the exact saved-state HTML block revision",
      ),
    )
    .input(
      address.extend({
        revision: z.string(),
        width: z.number().int().min(320).max(1280).default(800),
      }),
    )
    .output(
      z.discriminatedUnion("status", [
        z.object({
          status: z.literal("ready"),
          revision: z.string(),
          data: z.string(),
          width: z.number(),
          height: z.number(),
        }),
        z.object({
          status: z.literal("failed"),
          revision: z.string(),
          message: z.string(),
          width: z.number(),
          height: z.number(),
        }),
      ]),
    )
    .query(async ({ input, ctx }) => {
      const entity = await readable(ctx, input.id);
      const block = identified(entity.elements, input.blockId);
      if (input.revision !== block.revision)
        throw new TRPCError({
          code: "CONFLICT",
          message: "HTML block changed; re-read its saved revision",
        });
      let data: string;
      try {
        data = await captureBlock(block, input.width);
      } catch (error) {
        return {
          status: "failed" as const,
          revision: block.revision,
          message:
            error instanceof Error ? error.message : "Preview unavailable",
          width: input.width,
          height: block.height,
        };
      }
      // Re-check permissions and source after capture; a slow result never becomes the latest revision.
      const current = identified(
        (await readable(ctx, input.id)).elements,
        input.blockId,
      );
      if (current.revision !== block.revision)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "HTML block changed during capture; retry against the new revision",
        });
      return {
        status: "ready" as const,
        revision: block.revision,
        data,
        width: input.width,
        height: block.height,
      };
    }),
});
