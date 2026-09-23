import {
  PLACEHOLDER_NODE_TYPES,
  PLACEHOLDER_PATTERN,
} from "@packages/lexical-nodes";
import type {
  SerializedEditorState,
  SerializedLexicalNode,
  SerializedRootNode,
} from "lexical";
import { editorStateToMarkdown, markdownToEditorState } from "./markdown";

/** What a placeholder names, such as `chart#2`. The summary is not part of it. */
type PlaceholderRef = string;

// Enough for the caller to spot the placeholder it meant without another
// read, short of pasting every placeholder of a long document into an error.
const LISTED_PLACEHOLDERS = 30;

export class UnknownPlaceholderError extends Error {
  readonly ref: PlaceholderRef;
  /** Every placeholder the stored document does have, in document order. */
  readonly placeholders: PlaceholderRef[];

  constructor(ref: PlaceholderRef, placeholders: PlaceholderRef[]) {
    // The placeholders that do exist are in the message so the caller can fix
    // the reference without re-reading the document.
    const listed = [
      ...placeholders.slice(0, LISTED_PLACEHOLDERS),
      ...(placeholders.length > LISTED_PLACEHOLDERS
        ? [`and ${placeholders.length - LISTED_PLACEHOLDERS} more`]
        : []),
    ];
    super(
      `No placeholder ${ref} in the document; it has ${listed.length === 0 ? "none" : listed.join(", ")}`,
    );
    this.name = "UnknownPlaceholderError";
    this.ref = ref;
    this.placeholders = placeholders;
  }
}

export class DuplicatePlaceholderError extends Error {
  readonly ref: PlaceholderRef;

  constructor(ref: PlaceholderRef) {
    super(
      `Placeholder ${ref} appears more than once; it stands for one node, which can only be kept in one place`,
    );
    this.name = "DuplicatePlaceholderError";
    this.ref = ref;
  }
}

export class PlaceholderPlacementError extends Error {
  readonly ref: PlaceholderRef;

  constructor(ref: PlaceholderRef) {
    super(
      `Placeholder ${ref} stands for a block; keep it alone on its own line rather than inside a line of text`,
    );
    this.name = "PlaceholderPlacementError";
    this.ref = ref;
  }
}

type StoredPlaceholder = {
  node: SerializedLexicalNode;
  /** Whether the node was a direct child of the root. */
  blockLevel: boolean;
};

type SerializedTextNode = SerializedLexicalNode & { text: string };
type SerializedParentNode = SerializedLexicalNode & {
  children: SerializedLexicalNode[];
};

const isTextNode = (node: SerializedLexicalNode): node is SerializedTextNode =>
  node.type === "text" && "text" in node && typeof node.text === "string";

const childrenOf = (
  node: SerializedLexicalNode,
): SerializedLexicalNode[] | null =>
  "children" in node && Array.isArray(node.children)
    ? (node.children as SerializedLexicalNode[])
    : null;

/**
 * Every placeholder the stored document exports, keyed by what the export
 * calls it. The ordinals must be counted the way the export numbers them:
 * depth-first pre-order from the root, per node type.
 */
function indexPlaceholders(
  state: SerializedEditorState,
): Map<PlaceholderRef, StoredPlaceholder> {
  const index = new Map<PlaceholderRef, StoredPlaceholder>();
  const ordinals = new Map<string, number>();
  const visit = (node: SerializedLexicalNode, blockLevel: boolean) => {
    if (PLACEHOLDER_NODE_TYPES.includes(node.type)) {
      const ordinal = (ordinals.get(node.type) ?? 0) + 1;
      ordinals.set(node.type, ordinal);
      index.set(`${node.type}#${ordinal}`, { node, blockLevel });
    }
    for (const child of childrenOf(node) ?? []) {
      visit(child, false);
    }
  };
  for (const child of state.root.children) {
    visit(child, true);
  }
  return index;
}

const BLOCK_PLACEHOLDER = new RegExp(`^${PLACEHOLDER_PATTERN.source}$`);
const EVERY_PLACEHOLDER = new RegExp(PLACEHOLDER_PATTERN.source, "g");
const LEADING_PLACEHOLDER = new RegExp(`^${PLACEHOLDER_PATTERN.source}\\n\\n`);

const refOf = (match: RegExpMatchArray): PlaceholderRef =>
  `${match[1]}#${match[2]}`;

/** The placeholder a block stands for, when the block is one on its own line. */
function blockPlaceholderRef(
  node: SerializedLexicalNode,
): PlaceholderRef | null {
  if (node.type !== "paragraph") return null;
  const children = childrenOf(node);
  const only = children?.length === 1 ? children[0] : undefined;
  if (!only || !isTextNode(only)) return null;
  const match = BLOCK_PLACEHOLDER.exec(only.text.trim());
  return match ? refOf(match) : null;
}

/**
 * `direction` is worked out from the text when a node renders rather than
 * authored, so two blocks that read the same are the same block even when one
 * was parsed on its own and the other inside a document.
 */
function stableShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableShape);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "direction")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableShape(nested)]),
    );
  }
  return value;
}

export function sameBlock(
  left: SerializedLexicalNode,
  right: SerializedLexicalNode,
): boolean {
  return (
    JSON.stringify(stableShape(left)) === JSON.stringify(stableShape(right))
  );
}

/** Resolves placeholders against the stored document, each at most once. */
class StoredPlaceholders {
  private readonly root: SerializedRootNode;
  private readonly index: Map<PlaceholderRef, StoredPlaceholder>;
  private readonly taken = new Set<PlaceholderRef>();
  private readonly prose = new Map<PlaceholderRef, SerializedLexicalNode[]>();

  constructor(stored: SerializedEditorState) {
    this.root = stored.root;
    this.index = indexPlaceholders(stored);
  }

  take(ref: PlaceholderRef): StoredPlaceholder {
    const entry = this.index.get(ref);
    if (!entry) {
      throw new UnknownPlaceholderError(ref, [...this.index.keys()]);
    }
    if (this.taken.has(ref)) {
      throw new DuplicatePlaceholderError(ref);
    }
    this.taken.add(ref);
    return entry;
  }

  /**
   * The blocks the node below `ref` renders as after its placeholder line,
   * or none when it renders as the line alone. Derived on demand: only an
   * article has prose, and only one the caller kept needs it.
   */
  proseOf(ref: PlaceholderRef): SerializedLexicalNode[] {
    const cached = this.prose.get(ref);
    if (cached) return cached;
    const entry = this.index.get(ref);
    const derived =
      entry && entry.node.type === "article"
        ? articleProse(this.root, entry.node)
        : [];
    this.prose.set(ref, derived);
    return derived;
  }

  get restored(): number {
    return this.taken.size;
  }

  get removed(): number {
    return this.index.size - this.taken.size;
  }
}

function articleProse(
  root: SerializedRootNode,
  node: SerializedLexicalNode,
): SerializedLexicalNode[] {
  const markdown = editorStateToMarkdown({
    root: { ...root, children: [node] },
  });
  return markdownToEditorState(markdown.replace(LEADING_PLACEHOLDER, "")).root
    .children;
}

/**
 * How many blocks after `index` repeat `prose`, in order. They came from the
 * read the caller edited, so keeping them would print the article twice; a
 * block the caller changed ends the run and stays as content of its own.
 */
function matchedProse(
  children: SerializedLexicalNode[],
  index: number,
  prose: SerializedLexicalNode[],
): number {
  let matched = 0;
  while (matched < prose.length) {
    const next = children[index + 1 + matched];
    const expected = prose[matched];
    if (!next || !expected || !sameBlock(next, expected)) break;
    matched += 1;
  }
  return matched;
}

/** `text` with `slice` in place of its text, keeping its format and style. */
const piece = (
  text: SerializedTextNode,
  slice: string,
): SerializedTextNode => ({
  ...text,
  text: slice,
});

/** [text before][the stored node][text after], per placeholder in `text`. */
function splitAroundPlaceholders(
  text: SerializedTextNode,
  placeholders: StoredPlaceholders,
): SerializedLexicalNode[] {
  const pieces: SerializedLexicalNode[] = [];
  let cursor = 0;
  for (const match of text.text.matchAll(EVERY_PLACEHOLDER)) {
    const ref = refOf(match);
    const { node, blockLevel } = placeholders.take(ref);
    if (blockLevel) {
      throw new PlaceholderPlacementError(ref);
    }
    const before = text.text.slice(cursor, match.index);
    if (before) pieces.push(piece(text, before));
    pieces.push(node);
    cursor = match.index + match[0].length;
  }
  const after = text.text.slice(cursor);
  if (after) pieces.push(piece(text, after));
  return pieces;
}

const withChildren = (
  node: SerializedLexicalNode,
  children: SerializedLexicalNode[],
): SerializedParentNode => ({ ...node, children });

function transformChildren(
  children: SerializedLexicalNode[],
  placeholders: StoredPlaceholders,
): SerializedLexicalNode[] {
  const result: SerializedLexicalNode[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!child) continue;
    const ref = blockPlaceholderRef(child);
    if (ref) {
      const { node, blockLevel } = placeholders.take(ref);
      // An inline node cannot be a block, so it goes back inside the
      // paragraph the placeholder stood on.
      result.push(blockLevel ? node : withChildren(child, [node]));
      index += matchedProse(children, index, placeholders.proseOf(ref));
      continue;
    }
    if (isTextNode(child) && PLACEHOLDER_PATTERN.test(child.text)) {
      result.push(...splitAroundPlaceholders(child, placeholders));
      continue;
    }
    const nested = childrenOf(child);
    result.push(
      nested
        ? withChildren(child, transformChildren(nested, placeholders))
        : child,
    );
  }
  return result;
}

export type ReplacedState = {
  state: SerializedEditorState;
  /** Placeholders the markdown kept, so nodes put back from `stored`. */
  restoredPlaceholders: number;
  /** Placeholders the markdown dropped, so nodes the replace deletes. */
  removedPlaceholders: number;
};

/**
 * `stored` rewritten to hold what `markdown` says, with every placeholder the
 * markdown still carries standing for the node it named in `stored`. Nodes
 * without a markdown form only survive a round trip this way, so a placeholder
 * the caller deleted is how that node is deleted.
 */
export function replaceStateFromMarkdown(
  stored: SerializedEditorState,
  markdown: string,
): ReplacedState {
  const placeholders = new StoredPlaceholders(stored);
  const parsed = markdownToEditorState(markdown);
  const children = transformChildren(parsed.root.children, placeholders);
  return {
    state: { ...stored, root: { ...stored.root, children } },
    restoredPlaceholders: placeholders.restored,
    removedPlaceholders: placeholders.removed,
  };
}
