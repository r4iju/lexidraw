import {
  CANONICAL_ONLY_FIELDS,
  type CanonicalElement,
  type DrawingElement,
  looksLikeMermaid,
  MERMAID_REJECTION,
  SKELETON_ONLY_FIELDS,
  type SkeletonElement,
} from "./skeleton-schema";

/** Anything the caller can fix by sending a different payload. */
export class InvalidDrawingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDrawingError";
  }
}

/** Turns skeleton elements into canonical ones; see `converter.ts`. */
export type SkeletonConverter = (
  skeleton: readonly SkeletonElement[],
) => readonly Record<string, unknown>[];

const STICKY_NOTE_BACKGROUND = "#fff9db";
const STICKY_NOTE_SIDE = 180;

/**
 * Whether an element is shorthand rather than a stored element. The shorthand
 * never carries the bookkeeping the editor stamps on every element it saves,
 * and the fields that only exist in the shorthand settle the case on their own.
 */
export function isSkeletonElement(element: DrawingElement): boolean {
  const value = element as Record<string, unknown>;
  if (SKELETON_ONLY_FIELDS.some((field) => value[field] !== undefined)) {
    return true;
  }
  if (value.type === "stickynote") return true;
  return !CANONICAL_ONLY_FIELDS.some((field) => value[field] !== undefined);
}

/**
 * The canonical elements a payload stores as.
 *
 * Raw elements are stored exactly as they arrived: a caller that read a
 * drawing, changed one element and wrote it back gets its drawing back, not a
 * re-stamped copy. Skeleton elements go through the converter as one batch, so
 * bindings and frame membership resolve across the whole payload, and the
 * result takes the place of the first of them; raw elements keep their
 * positions around it, and array order is z-order.
 *
 * The two halves cannot reference each other. The converter only sees the
 * skeleton batch, so an arrow bound to a raw element would silently come out
 * unbound, and a frame listing one would silently not contain it. Both are
 * refused instead.
 */
export function normalizeDrawingElements(
  elements: readonly DrawingElement[],
  convert: SkeletonConverter,
): CanonicalElement[] {
  const skeleton: SkeletonElement[] = [];
  const raw: CanonicalElement[] = [];
  // `null` marks where the converted batch goes back in.
  const layout: (CanonicalElement | null)[] = [];

  for (const element of elements) {
    if (looksLikeMermaid(element)) {
      throw new InvalidDrawingError(MERMAID_REJECTION);
    }
    if (isSkeletonElement(element)) {
      skeleton.push(element as SkeletonElement);
      if (!layout.includes(null)) layout.push(null);
      continue;
    }
    const element_ = element as CanonicalElement;
    raw.push(element_);
    layout.push(element_);
  }

  assertUniqueIds([...skeleton, ...raw] as Record<string, unknown>[]);
  assertReferencesResolve(skeleton);

  if (skeleton.length === 0) return raw;

  const converted = convert(
    skeleton.map(expandShorthand),
  ) as CanonicalElement[];
  return layout.flatMap((slot) => (slot === null ? converted : [slot]));
}

/**
 * Shorthand that is ours rather than Excalidraw's, rewritten into the
 * skeleton the converter understands.
 */
function expandShorthand(element: SkeletonElement): SkeletonElement {
  if (element.type !== "stickynote") return element;
  const { text, fontSize, backgroundColor, ...rest } = element;
  return {
    ...rest,
    type: "rectangle",
    width: element.width ?? STICKY_NOTE_SIDE,
    height: element.height ?? STICKY_NOTE_SIDE,
    backgroundColor: backgroundColor ?? STICKY_NOTE_BACKGROUND,
    fillStyle: "solid",
    label: { text, ...(fontSize === undefined ? {} : { fontSize }) },
  } as SkeletonElement;
}

/**
 * The converter drops an element whose id it has already seen, and the editor
 * keys its scene by id, so a duplicate would lose a shape without saying so.
 */
function assertUniqueIds(elements: readonly Record<string, unknown>[]): void {
  const seen = new Set<string>();
  for (const element of elements) {
    const id = element.id;
    if (typeof id !== "string") continue;
    if (seen.has(id)) {
      throw new InvalidDrawingError(`duplicate element id "${id}"`);
    }
    seen.add(id);
  }
}

function assertReferencesResolve(skeleton: readonly SkeletonElement[]): void {
  const ids = new Set(
    skeleton
      .map((element) => (element as Record<string, unknown>).id)
      .filter((id): id is string => typeof id === "string"),
  );
  for (const element of skeleton) {
    const value = element as Record<string, unknown>;
    for (const side of ["start", "end"] as const) {
      const endpoint = value[side] as { id?: unknown } | undefined;
      if (typeof endpoint?.id === "string" && !ids.has(endpoint.id)) {
        throw new InvalidDrawingError(
          `${value.type} ${side} binds to "${endpoint.id}", which is not a skeleton element in this payload`,
        );
      }
    }
    const children = value.children;
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      if (typeof child === "string" && !ids.has(child)) {
        throw new InvalidDrawingError(
          `frame child "${child}" is not a skeleton element in this payload`,
        );
      }
    }
  }
}
