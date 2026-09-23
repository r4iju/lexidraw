import { PublicAccess } from "@packages/types";
import { schema } from "@packages/drizzle";
import { TRPCError } from "@trpc/server";
import { v4 as uuidV4 } from "uuid";
import { z } from "zod";

import { StaleDocumentError } from "~/server/documents/conflict";
import { drizzleDocumentStore } from "~/server/documents/document-store";
import { DocumentGoneError } from "~/server/documents/write";
import { skeletonConverter } from "~/server/drawings/converter";
import {
  InvalidDrawingError,
  normalizeDrawingElements,
} from "~/server/drawings/normalize";
import {
  findReadableDrawing,
  findWritableDrawing,
  replaceDrawingElements,
} from "~/server/drawings/store";
import {
  type CanonicalElement,
  DrawingElements,
  MERMAID_REJECTION,
} from "~/server/drawings/skeleton-schema";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/** An element on the wire: canonical Excalidraw, so its fields are its own. */
const StoredElement = z.looseObject({});

/**
 * Mermaid reaches the top level too, because the Excalidraw MCP takes it
 * there. Declared rather than stripped, so refusing it is part of the
 * contract instead of a missing-`elements` error.
 */
const mermaid = z
  .string()
  .optional()
  .meta({ description: `Rejected: ${MERMAID_REJECTION}` });

const Iso = z.iso.datetime();

function throwAsDrawingWriteError(error: unknown): never {
  if (error instanceof InvalidDrawingError) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof StaleDocumentError) {
    throw new TRPCError({
      code: "CONFLICT",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof DocumentGoneError) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Drawing not found",
      cause: error,
    });
  }
  throw error;
}

const notFound = () =>
  new TRPCError({ code: "NOT_FOUND", message: "Drawing not found" });

/** Stored `elements` is a JSON array of elements; anything else is corrupt. */
function parseElements(stored: string): CanonicalElement[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (cause) {
    throw new TRPCError({
      code: "UNPROCESSABLE_CONTENT",
      message: "Stored drawing elements are not valid JSON",
      cause,
    });
  }
  if (!Array.isArray(parsed)) {
    throw new TRPCError({
      code: "UNPROCESSABLE_CONTENT",
      message: "Stored drawing elements are not an array",
    });
  }
  return parsed as CanonicalElement[];
}

function parseAppState(stored: string | null): Record<string, unknown> | null {
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function normalize(input: {
  elements: z.output<typeof DrawingElements>;
  mermaid?: string;
}): Promise<CanonicalElement[]> {
  if (input.mermaid !== undefined) {
    throw new TRPCError({ code: "BAD_REQUEST", message: MERMAID_REJECTION });
  }
  try {
    return normalizeDrawingElements(input.elements, await skeletonConverter());
  } catch (error) {
    throwAsDrawingWriteError(error);
  }
}

export const drawingRouter = createTRPCRouter({
  /**
   * The drawing as elements, parsed. `updatedAt` is what a later `put` passes
   * back as `ifUnmodifiedSince`.
   */
  get: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/drawings/{id}",
        tags: ["drawings"],
        summary: "Read a drawing's elements",
        protect: true,
      },
    })
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        title: z.string(),
        elements: z.array(StoredElement),
        appState: z.looseObject({}).nullable(),
        updatedAt: Iso,
      }),
    )
    .query(async ({ input, ctx }) => {
      const drawing = await findReadableDrawing(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );
      if (!drawing) throw notFound();
      return {
        id: drawing.id,
        title: drawing.title,
        elements: parseElements(drawing.elements),
        appState: parseAppState(drawing.appState),
        updatedAt: drawing.updatedAt.toISOString(),
      };
    }),
  /**
   * Replaces a drawing's whole element set with `elements`, given as canonical
   * Excalidraw elements, as the skeleton shorthand, or as a mix; see
   * docs/drawing-format.md. `ifUnmodifiedSince` is the `updatedAt` the caller
   * read, and a write that no longer matches it fails with `CONFLICT` plus
   * `data.currentUpdatedAt` to re-read from.
   */
  put: protectedProcedure
    .meta({
      openapi: {
        method: "PUT",
        path: "/drawings/{id}",
        tags: ["drawings"],
        summary: "Replace a drawing's elements",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.string(),
        elements: DrawingElements,
        ifUnmodifiedSince: Iso.optional(),
        mermaid,
      }),
    )
    .output(
      z.object({
        id: z.string(),
        updatedAt: Iso,
        elementCount: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const drawing = await findWritableDrawing(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );
      if (!drawing) throw notFound();
      const elements = await normalize(input);
      try {
        const written = await replaceDrawingElements(
          drizzleDocumentStore(ctx.drizzle),
          drawing,
          elements,
          input.ifUnmodifiedSince,
        );
        return { ...written, updatedAt: written.updatedAt.toISOString() };
      } catch (error) {
        throwAsDrawingWriteError(error);
      }
    }),
  /**
   * A new drawing owned by the caller, with the defaults the browser opens a
   * drawing with, so the id this answers with is a working URL.
   */
  create: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/drawings",
        tags: ["drawings"],
        summary: "Create a drawing",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.string().min(1).optional(),
        title: z.string().min(1),
        elements: DrawingElements.default([]),
        parentId: z.string().nullish(),
        mermaid,
      }),
    )
    .output(z.object({ id: z.string(), updatedAt: Iso }))
    .mutation(async ({ input, ctx }) => {
      const elements = await normalize(input);
      const now = new Date();
      const rows = await ctx.drizzle
        .insert(schema.entities)
        .values({
          id: input.id ?? uuidV4(),
          createdAt: now,
          updatedAt: now,
          title: input.title,
          userId: ctx.session.user.id,
          entityType: "drawing",
          publicAccess: PublicAccess.PRIVATE,
          elements: JSON.stringify(elements),
          parentId: input.parentId ?? null,
          appState: JSON.stringify({}),
        })
        .onConflictDoNothing()
        .returning({
          id: schema.entities.id,
          updatedAt: schema.entities.updatedAt,
        });
      const row = rows[0];
      if (!row) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `An entity with id "${input.id}" already exists`,
        });
      }
      return { id: row.id, updatedAt: row.updatedAt.toISOString() };
    }),
});
