import {
  type CanonicalElement,
  type DrawingElement,
  isSkeletonElement,
  looksLikeMermaid,
  MERMAID_REJECTION,
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

/**
 * Excalidraw's own `restoreElements`, which is what the editor runs over a
 * scene it is about to open.
 */
export type ElementRestorer = (
  elements: readonly Record<string, unknown>[],
) => readonly Record<string, unknown>[];

export type DrawingTools = {
  convert: SkeletonConverter;
  restore: ElementRestorer;
};

const STICKY_NOTE_BACKGROUND = "#fff9db";
const STICKY_NOTE_SIDE = 180;

/**
 * The canonical elements a payload stores as.
 *
 * Shorthand elements go through the converter as one batch, so bindings and
 * frame membership resolve across the whole payload, and the result takes the
 * place of the first of them; canonical elements keep their positions around
 * it, and array order is z-order. Whatever comes out, canonical or converted,
 * is then restored the way the editor restores a scene it opens, so what is
 * stored is what the browser would have made of it.
 *
 * The two halves cannot reference each other. The converter only sees the
 * skeleton batch, so an arrow bound to a canonical element would silently come
 * out unbound, and a frame listing one would silently not contain it. Both are
 * refused instead.
 *
 * `loadTools` is a thunk because it pulls in a megabytes-large bundle of the
 * editor: a payload that is refused here never pays for it.
 */
export async function normalizeDrawingElements(
  elements: readonly DrawingElement[],
  loadTools: () => Promise<DrawingTools>,
): Promise<CanonicalElement[]> {
  const skeleton: SkeletonElement[] = [];
  const canonical: CanonicalElement[] = [];
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
    canonical.push(element_);
    layout.push(element_);
  }

  assertUniqueIds([...skeleton, ...canonical] as Record<string, unknown>[]);
  assertReferencesResolve(skeleton);

  const tools = await loadTools();
  const converted =
    skeleton.length === 0
      ? []
      : (tools.convert(skeleton.map(expandShorthand)) as CanonicalElement[]);
  const merged = layout.flatMap((slot) =>
    slot === null ? converted : [slot],
  ) as Record<string, unknown>[];

  return restore(merged, tools.restore);
}

/**
 * The scene as the editor would have loaded it: defaults filled in, bindings
 * repaired against what is actually in the payload, element order indexed.
 * Anything the restorer cannot make sense of is the caller's payload, not our
 * bug, so it comes back as a rejection rather than a 500.
 */
function restore(
  elements: readonly Record<string, unknown>[],
  restorer: ElementRestorer,
): CanonicalElement[] {
  try {
    return restorer(elements) as CanonicalElement[];
  } catch (cause) {
    throw new InvalidDrawingError(
      `These elements are not a drawing the editor can open: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
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
