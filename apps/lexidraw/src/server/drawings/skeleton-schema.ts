import { z } from "zod";

/**
 * A drawing write accepts two shapes over one pipeline: canonical Excalidraw
 * elements, and the skeleton shorthand agents already know from the official
 * Excalidraw MCP. Both are described here so the OpenAPI document carries the
 * contract; which of the two an element is is decided in `normalize.ts`.
 *
 * Mermaid is not one of them. It needs a real browser to lay out, so a payload
 * that carries it is refused here rather than half-converted server-side.
 */
export const MERMAID_REJECTION =
  "Mermaid is not a write format; convert it in the browser";

const finite = z.number().finite();

/** Every canonical element type the editor stores. `selection` is transient. */
export const ELEMENT_TYPES = [
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
  "freedraw",
  "image",
  "frame",
  "magicframe",
  "embeddable",
  "iframe",
] as const;

/** Fields only a canonical element carries; see `isSkeletonElement`. */
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
  points: z.array(z.tuple([finite, finite])).optional(),
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

/** A canonical element, kept whole: the editor owns the rest of its fields. */
const RawElement = z.looseObject({
  type: z.enum(ELEMENT_TYPES),
  id: z.string().min(1),
  x: finite,
  y: finite,
  width: finite,
  height: finite,
});

/**
 * Mermaid is recognised so it can be refused by name. It is in the union, and
 * in the published schema, because a write that carried it has to come back
 * with {@link MERMAID_REJECTION} rather than "nothing in the union matched"; a
 * shape error over REST reads as "Input validation failed", which tells the
 * caller nothing it can act on. `normalize.ts` does the refusing.
 */
const MermaidElement = z.looseObject({ type: z.literal("mermaid") }).meta({
  description: `Rejected: ${MERMAID_REJECTION}`,
});

export const looksLikeMermaid = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  ((value as Record<string, unknown>).type === "mermaid" ||
    typeof (value as Record<string, unknown>).mermaid === "string");

const Element = z.union([SkeletonElement, RawElement, MermaidElement]);

export const DrawingElements = z.array(Element);

export type DrawingElement = z.output<typeof Element>;
export type SkeletonElement = z.output<typeof SkeletonElement>;
export type RawElement = z.output<typeof RawElement>;

/** A stored element, canonical by the time it gets here. */
export type CanonicalElement = Record<string, unknown> & { id: string };
