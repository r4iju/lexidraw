import { z } from "zod";

import { inDialect } from "~/server/api/schema-dialect";

/**
 * A drawing write accepts two shapes over one pipeline: canonical Excalidraw
 * elements, and the skeleton shorthand agents already know from the official
 * Excalidraw MCP. Both are described here so the OpenAPI document carries the
 * contract, and both are validated here: which of the two an element is is
 * decided by {@link isSkeletonElement} before it is parsed, so an element is
 * only ever measured against the shape it claims to be. A union would instead
 * fall through to the other shape and hand the converter a payload no schema
 * ever checked.
 *
 * Mermaid is not one of them. It needs a real browser to lay out, so a payload
 * that carries it is refused by name in `normalize.ts` rather than being
 * half-converted server-side.
 */
export const MERMAID_REJECTION =
  "Mermaid is not a write format; convert it in the browser";

/**
 * A drawing the editor can still open. Excalidraw slows to a crawl well before
 * this, and a payload this size is far past the 4.5 MB request body the app is
 * deployed behind, so the cap is a guard rail rather than a target.
 */
export const MAX_DRAWING_ELEMENTS = 10_000;

const finite = z.number().finite();

/**
 * One `[x, y]` pair. An array of length two rather than a tuple: zod writes a
 * tuple as `prefixItems` plus `items: false`, and a strict MCP client rejects
 * a `false` where a schema belongs and drops the whole tool. The constraint is
 * the same either way — exactly two numbers.
 */
const Point = z.array(finite).length(2);

/** Fields only a canonical element carries; see {@link isSkeletonElement}. */
export const CANONICAL_ONLY_FIELDS = [
  "version",
  "versionNonce",
  "seed",
  "isDeleted",
] as const;

/** Fields only the shorthand carries. */
export const SKELETON_ONLY_FIELDS = [
  "label",
  "start",
  "end",
  "children",
] as const;

const Label = z.looseObject({
  text: z.string(),
  fontSize: finite.positive().optional(),
});

/** A binding names the element it attaches to, or asks for one to be made. */
const Endpoint = z.looseObject({
  id: z.string().optional(),
  type: z.enum(["rectangle", "ellipse", "diamond", "text"]).optional(),
  text: z.string().optional(),
});

const ShapeSkeleton = z.looseObject({
  type: z.enum(["rectangle", "ellipse", "diamond"]),
  id: z.string().optional(),
  x: finite,
  y: finite,
  width: finite.optional(),
  height: finite.optional(),
  label: Label.optional(),
});

/**
 * Our own shorthand, not Excalidraw's: a filled rounded rectangle carrying its
 * text, so an agent does not have to remember the colour every time.
 */
const StickyNoteSkeleton = z.looseObject({
  type: z.literal("stickynote"),
  id: z.string().optional(),
  x: finite,
  y: finite,
  width: finite.optional(),
  height: finite.optional(),
  text: z.string(),
  fontSize: finite.positive().optional(),
  backgroundColor: z.string().optional(),
});

const TextSkeleton = z.looseObject({
  type: z.literal("text"),
  id: z.string().optional(),
  x: finite,
  y: finite,
  text: z.string(),
  fontSize: finite.positive().optional(),
});

const Points = z.array(Point);

const LinearSkeleton = z.looseObject({
  type: z.enum(["arrow", "line"]),
  id: z.string().optional(),
  x: finite,
  y: finite,
  width: finite.optional(),
  height: finite.optional(),
  label: Label.optional(),
  start: Endpoint.optional(),
  end: Endpoint.optional(),
  points: Points.optional(),
});

const FrameSkeleton = z.looseObject({
  type: z.enum(["frame", "magicframe"]),
  id: z.string().optional(),
  children: z.array(z.string()),
  name: z.string().optional(),
});

const SkeletonElement = z.discriminatedUnion("type", [
  ShapeSkeleton,
  StickyNoteSkeleton,
  TextSkeleton,
  LinearSkeleton,
  FrameSkeleton,
]);

/**
 * A canonical element. The editor owns most of its fields, so unknown ones are
 * kept as they arrive, but everything the converter, the restorer or the
 * editor reads positionally is typed: a `points` array of anything but pairs
 * of numbers, or a text element with no text, crashes the editor on open.
 */
const rawCommon = {
  id: z.string().min(1),
  x: finite,
  y: finite,
  width: finite,
  height: finite,
  angle: finite.optional(),
  strokeColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  fillStyle: z.string().optional(),
  strokeWidth: finite.optional(),
  strokeStyle: z.string().optional(),
  roughness: finite.optional(),
  opacity: finite.optional(),
  groupIds: z.array(z.string()).optional(),
  frameId: z.string().nullish(),
  index: z.string().nullish(),
  seed: finite.optional(),
  version: finite.optional(),
  versionNonce: finite.optional(),
  isDeleted: z.boolean().optional(),
  updated: finite.optional(),
  link: z.string().nullish(),
  locked: z.boolean().optional(),
  boundElements: z
    .array(z.looseObject({ id: z.string(), type: z.string() }))
    .nullish(),
};

const Binding = z
  .looseObject({
    elementId: z.string(),
    focus: finite.optional(),
    gap: finite.optional(),
  })
  .nullable();

const RawLinear = z.looseObject({
  ...rawCommon,
  type: z.enum(["arrow", "line"]),
  points: Points.optional(),
  startBinding: Binding.optional(),
  endBinding: Binding.optional(),
});

const RawFreedraw = z.looseObject({
  ...rawCommon,
  type: z.literal("freedraw"),
  points: Points.optional(),
  pressures: z.array(finite).optional(),
});

const RawText = z.looseObject({
  ...rawCommon,
  type: z.literal("text"),
  text: z.string(),
  originalText: z.string().optional(),
  fontSize: finite.positive().optional(),
  fontFamily: finite.optional(),
  containerId: z.string().nullish(),
});

const RawShape = z.looseObject({
  ...rawCommon,
  type: z.enum([
    "rectangle",
    "ellipse",
    "diamond",
    "image",
    "frame",
    "magicframe",
    "embeddable",
    "iframe",
  ]),
});

const RawElement = z.discriminatedUnion("type", [
  RawLinear,
  RawFreedraw,
  RawText,
  RawShape,
]);

/**
 * Mermaid is recognised so it can be refused by name, both as an element and
 * as the bare `{ mermaid }` object the official MCP takes. It is in the
 * published schema because a write that carried it has to come back with
 * {@link MERMAID_REJECTION} rather than "nothing matched"; a shape error over
 * REST reads as "Input validation failed", which tells the caller nothing it
 * can act on. `normalize.ts` does the refusing.
 */
const MermaidElement = z.looseObject({}).meta({
  description: `Rejected: ${MERMAID_REJECTION}`,
});

export const looksLikeMermaid = (value: unknown): boolean =>
  isRecord(value) &&
  (value.type === "mermaid" || typeof value.mermaid === "string");

/**
 * Whether an element is shorthand rather than a stored element. The shorthand
 * never carries the bookkeeping the editor stamps on every element it saves,
 * and the fields that only exist in the shorthand settle the case on their
 * own. This is the only classifier: parsing and normalizing both ask it, so an
 * element cannot be validated as one shape and converted as the other.
 */
export function isSkeletonElement(element: unknown): boolean {
  if (!isRecord(element)) return false;
  if (SKELETON_ONLY_FIELDS.some((field) => element[field] !== undefined)) {
    return true;
  }
  if (element.type === "stickynote") return true;
  return !CANONICAL_ONLY_FIELDS.some((field) => element[field] !== undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type SchemaFor =
  | typeof SkeletonElement
  | typeof RawElement
  | typeof MermaidElement;

const schemaFor = (value: unknown): SchemaFor => {
  if (looksLikeMermaid(value)) return MermaidElement;
  return isSkeletonElement(value) ? SkeletonElement : RawElement;
};

/**
 * The two shapes as published; the runtime check picks between them. Run
 * through {@link inDialect} to the portable dialect, because this object is what both the
 * OpenAPI document and the MCP tool schemas carry, and a nullable field zod
 * writes as `type: ["string", "null"]` reads as a plain string to a client
 * that takes `type` for a string.
 */
const published: Record<string, unknown> = inDialect(
  z.toJSONSchema(z.union([SkeletonElement, RawElement, MermaidElement]), {
    io: "input",
  }),
  "portable",
);
delete published.$schema;

const Element = z
  .unknown()
  .check((ctx) => {
    if (!isRecord(ctx.value)) {
      ctx.issues.push({
        code: "invalid_type",
        expected: "object",
        input: ctx.value,
        message: "Expected an Excalidraw element object",
      });
      return;
    }
    const result = schemaFor(ctx.value).safeParse(ctx.value);
    if (result.success) return;
    for (const issue of result.error.issues) {
      // Reported as the chosen schema saw it, so the path stays
      // `elements[3].points[0]` rather than collapsing to the element.
      ctx.issues.push({ ...issue, input: ctx.value } as never);
    }
  })
  // Nothing is rebuilt: an element that passes its own schema is stored as the
  // caller wrote it, and `restoreElements` is what fills the rest in.
  .transform((value) => value as DrawingElement)
  .meta(published as never);

export const DrawingElements = z.array(Element).max(MAX_DRAWING_ELEMENTS);

export type DrawingElement =
  | z.output<typeof SkeletonElement>
  | z.output<typeof RawElement>
  | z.output<typeof MermaidElement>;
export type SkeletonElement = z.output<typeof SkeletonElement>;
export type RawElement = z.output<typeof RawElement>;

/** A stored element, canonical by the time it gets here. */
export type CanonicalElement = Record<string, unknown> & { id: string };
