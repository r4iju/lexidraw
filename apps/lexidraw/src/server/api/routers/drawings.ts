import { queueThumbnail } from "~/server/entities/queue-thumbnail";
import { PublicAccess } from "@packages/types";
import { type drizzle, schema } from "@packages/drizzle";
import { TRPCError } from "@trpc/server";
import { v4 as uuidV4 } from "uuid";
import { z } from "zod";

import { StaleDocumentError } from "~/server/documents/conflict";
import { drizzleDocumentStore } from "~/server/documents/document-store";
import { DocumentGoneError } from "~/server/documents/write";
import { drawingTools } from "~/server/drawings/converter";
import {
  InvalidDrawingError,
  normalizeDrawingElements,
} from "~/server/drawings/normalize";
import {
  MAX_RENDER_BYTES,
  MAX_RENDER_PIXELS,
  MAX_RENDER_SCALE,
  RENDER_FORMATS,
  RenderTooLargeError,
  renderDrawing,
} from "~/server/drawings/render";
import {
  findReadableDrawing,
  findWritableDrawing,
  replaceDrawingElements,
} from "~/server/drawings/store";
import { resolveParentDirectory } from "~/server/entities/readable";
import {
  type CanonicalElement,
  DrawingElements,
  MERMAID_REJECTION,
} from "~/server/drawings/skeleton-schema";
import {
  revalidateEntities,
  revalidateEntitiesAndParents,
} from "../entity-cache";
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

/**
 * A write adds two statuses a read cannot reach: the 409 its precondition
 * guards, and the 403 a read-scope token earns for attempting a mutation.
 */
const READ_ERRORS = [400, 401, 404, 422, 500];
const WRITE_ERRORS = [400, 401, 403, 404, 409, 422, 500];
/** A read that also refuses an image too big for one response body. */
const RENDER_ERRORS = [400, 401, 404, 413, 422, 500];

/** Reported as the image measures itself, so neither format is rounded. */
const SIDE =
  "The image's own size: pixels for png, scene units for svg, which may be fractional.";

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

/** A render, with the one refusal it can raise turned into a 400. */
async function renderOrThrow(
  elements: readonly CanonicalElement[],
  options: Parameters<typeof renderDrawing>[1],
) {
  try {
    return await renderDrawing(elements, options);
  } catch (error) {
    if (error instanceof RenderTooLargeError) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error.message,
        cause: error,
      });
    }
    throw error;
  }
}

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
    return await normalizeDrawingElements(input.elements, drawingTools);
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
        errorResponses: READ_ERRORS,
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
   * The drawing as a picture: the editor's own SVG export, or that SVG
   * rasterised to PNG with the editor's fonts.
   *
   * The image travels in the JSON body rather than as the response itself,
   * because every REST path here is served by one adapter that answers
   * `application/json` and nothing else. `data` is therefore the SVG source as
   * text, or the PNG base64-encoded, and `encoding` says which; `contentType`
   * is what the bytes would be served as. A caller writing a file decodes one
   * field, which is the price of the whole surface being one generated
   * contract.
   */
  render: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/drawings/{id}/render",
        tags: ["drawings"],
        summary: "Render a drawing as SVG or PNG",
        description: `Returns the image in the JSON body: \`data\` is the SVG source when \`format=svg\`, and the PNG base64-encoded when \`format=png\`, as \`encoding\` says. \`scale\` multiplies the raster and is ignored by \`svg\`. SVG text names the Excalidraw font families without embedding them, so a viewer without them installed substitutes; the PNG is drawn with the fonts this server carries. Two ceilings apply: a raster over ${MAX_RENDER_PIXELS / 1_000_000} megapixels is refused with 400, and an encoded image over ${MAX_RENDER_BYTES / 1_000_000} MB with 413. A smaller \`scale\`, or \`svg\`, answers either.`,
        protect: true,
        errorResponses: RENDER_ERRORS,
      },
    })
    .input(
      z.object({
        id: z.string(),
        format: z.enum(RENDER_FORMATS).default("svg"),
        scale: z.coerce
          .number()
          .int()
          .min(1)
          .max(MAX_RENDER_SCALE)
          .default(1)
          .meta({
            description: `Raster pixels per scene unit, 1 to ${MAX_RENDER_SCALE}; png only.`,
          }),
      }),
    )
    .output(
      z.object({
        id: z.string(),
        format: z.enum(RENDER_FORMATS),
        contentType: z.string(),
        encoding: z.enum(["utf-8", "base64"]),
        width: z.number().positive().meta({ description: SIDE }),
        height: z.number().positive().meta({ description: SIDE }),
        data: z.string(),
        /** The revision rendered, so a caller can tell one render from a later one. */
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
      const appState = parseAppState(drawing.appState);
      const background = appState?.viewBackgroundColor;
      const rendered = await renderOrThrow(parseElements(drawing.elements), {
        format: input.format,
        scale: input.scale,
        background: typeof background === "string" ? background : null,
      });
      const data =
        rendered.format === "svg"
          ? rendered.svg
          : Buffer.from(rendered.png).toString("base64");
      // After encoding rather than before: the pixel count bounds the raster,
      // not the JSON it travels in, and how far a drawing compresses is only
      // known once it has.
      const bytes = Buffer.byteLength(data);
      if (bytes > MAX_RENDER_BYTES) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: `This render encodes to ${Math.round(bytes / 100_000) / 10} MB, over the ${MAX_RENDER_BYTES / 1_000_000} MB a response can carry; ${rendered.format === "png" ? "ask for a smaller scale or for svg" : "the drawing is too detailed to return as one image"}`,
        });
      }
      return {
        id: drawing.id,
        format: rendered.format,
        contentType: rendered.contentType,
        encoding:
          rendered.format === "svg" ? ("utf-8" as const) : ("base64" as const),
        width: rendered.width,
        height: rendered.height,
        data,
        updatedAt: drawing.updatedAt.toISOString(),
      };
    }),
  /**
   * Replaces a drawing's whole element set with `elements`, given as canonical
   * Excalidraw elements, as the skeleton shorthand, or as a mix; see
   * docs/drawing-format.md. `ifUnmodifiedSince` is the `updatedAt` the caller
   * read, and a write that no longer matches it fails with `CONFLICT` plus
   * `data.currentUpdatedAt` to re-read from. It is mandatory: replacing every
   * element of a drawing someone else has meanwhile edited is the one write
   * that cannot be merged afterwards, and a caller with nothing to say here
   * wants `create` instead.
   */
  put: protectedProcedure
    .meta({
      openapi: {
        method: "PUT",
        path: "/drawings/{id}",
        tags: ["drawings"],
        summary: "Replace a drawing's elements",
        protect: true,
        errorResponses: WRITE_ERRORS,
      },
    })
    .input(
      z.object({
        id: z.string(),
        elements: DrawingElements,
        ifUnmodifiedSince: Iso,
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
          drizzleDocumentStore(ctx.drizzle, (row) =>
            queueThumbnail(ctx.drizzle, row),
          ),
          drawing,
          elements,
          input.ifUnmodifiedSince,
        );
        // The parent too: a directory listing shows each child's updatedAt.
        revalidateEntities(input.id, drawing.parentId);
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
        errorResponses: WRITE_ERRORS,
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
    // `elementCount` is the converter's answer, not the payload's length: one
    // shorthand element becomes several stored ones, so a create says how many
    // it actually wrote, exactly as `put` does.
    .output(
      z.object({
        id: z.string(),
        updatedAt: Iso,
        elementCount: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const parentId = await resolveParentDirectory(
        ctx.drizzle,
        input.parentId,
        ctx.session.user.id,
        "drawing",
      );
      const elements = await normalize(input);
      const now = new Date();
      const rows = await insertDrawing(ctx.drizzle, {
        id: input.id ?? uuidV4(),
        createdAt: now,
        updatedAt: now,
        title: input.title,
        userId: ctx.session.user.id,
        entityType: "drawing",
        publicAccess: PublicAccess.PRIVATE,
        elements: JSON.stringify(elements),
        parentId,
        appState: JSON.stringify({}),
      });
      const row = rows[0];
      if (!row) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `An entity with id "${input.id}" already exists`,
        });
      }
      await queueThumbnail(ctx.drizzle, {
        ...row,
        entityType: "drawing",
        elements: JSON.stringify(elements),
        appState: "{}",
      });
      await revalidateEntitiesAndParents(ctx.drizzle, row.id, parentId);
      return {
        id: row.id,
        updatedAt: row.updatedAt.toISOString(),
        elementCount: elements.length,
      };
    }),
});

/** The insert, with anything the database says about it kept server-side. */
async function insertDrawing(
  db: typeof drizzle,
  values: typeof schema.entities.$inferInsert,
) {
  try {
    return await db
      .insert(schema.entities)
      .values(values)
      .onConflictDoNothing()
      .returning({
        id: schema.entities.id,
        updatedAt: schema.entities.updatedAt,
      });
  } catch (cause) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Could not create the drawing",
      cause,
    });
  }
}
