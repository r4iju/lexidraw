import {
  documentHeaderOf,
  PLACEHOLDER_NODE_TYPES,
  PLACEHOLDER_PATTERN,
  withDocumentHeader,
} from "@packages/lexical-nodes";
import {
  IS_CODE,
  type SerializedEditorState,
  type SerializedLexicalNode,
  type SerializedRootNode,
} from "lexical";
import {
  type DocumentFields,
  editorStateToMarkdown,
  interpretDocumentMarkdown,
  unsupportedNodeTypes,
  UnsupportedNodeTypesError,
  type WriteTarget,
} from "./markdown";

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
      `Placeholder ${ref} stands for a block, so a block placeholder must be a top-level line of its own`,
    );
    this.name = "PlaceholderPlacementError";
    this.ref = ref;
  }
}

type StoredPlaceholder = {
  node: SerializedLexicalNode;
  /** Whether the node was a block of its own, a child of a block container. */
  blockLevel: boolean;
};

/**
 * Nodes whose children are blocks, each exported on lines of its own, so a
 * placeholder line inside one stands for a block just as it does at the top.
 * Table cells and list items are left out: markdown has no way to put a
 * block of its own in either.
 */
const BLOCK_CONTAINERS = new Set([
  "root",
  "layout-item",
  "collapsible-content",
  "callout",
]);

type SerializedTextNode = SerializedLexicalNode & {
  text: string;
  format?: number;
};

/** A text or tab node, the only two a placeholder line survives an import as. */
const asText = (node: SerializedLexicalNode): SerializedTextNode | null =>
  (node.type === "text" || node.type === "tab") &&
  "text" in node &&
  typeof node.text === "string"
    ? (node as SerializedTextNode)
    : null;

/**
 * Placeholder-shaped text the editor renders as code is something the caller
 * wrote about a placeholder, not a reference to one, so it is left alone.
 */
const isCode = (node: SerializedTextNode) =>
  ((node.format ?? 0) & IS_CODE) !== 0;

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
      visit(child, BLOCK_CONTAINERS.has(node.type));
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

/**
 * The placeholder a block stands for, when the block is a line holding
 * nothing else. A trailing tab counts as nothing else: markdown keeps one as
 * a node beside the text rather than as part of it.
 */
function blockPlaceholderRef(
  node: SerializedLexicalNode,
): PlaceholderRef | null {
  if (node.type !== "paragraph") return null;
  const children = childrenOf(node);
  if (!children || children.length === 0) return null;
  let line = "";
  for (const child of children) {
    const text = asText(child);
    if (!text || isCode(text)) return null;
    line += text.text;
  }
  const match = BLOCK_PLACEHOLDER.exec(line.trim());
  return match ? refOf(match) : null;
}

/** Resolves placeholders against the stored document, each at most once. */
class StoredPlaceholders {
  private readonly root: SerializedRootNode;
  private readonly index: Map<PlaceholderRef, StoredPlaceholder>;
  private readonly taken = new Set<PlaceholderRef>();
  private readonly prose = new Map<PlaceholderRef, string>();

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
   * The markdown the node below `ref` renders as after its placeholder line,
   * empty for everything but an article. Derived on demand: only an article
   * has prose, and only one the caller kept needs it.
   */
  proseOf(ref: PlaceholderRef): string {
    const cached = this.prose.get(ref);
    if (cached !== undefined) return cached;
    const entry = this.index.get(ref);
    const derived =
      entry?.node.type === "article" ? articleProse(this.root, entry.node) : "";
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
): string {
  const markdown = editorStateToMarkdown({
    root: { ...root, children: [node] },
  });
  const prose = markdown.replace(LEADING_PLACEHOLDER, "");
  return prose === markdown ? "" : prose;
}

/**
 * `markdown` without the prose below an article's placeholder, when it is
 * still character for character the prose the read derived.
 *
 * The comparison is on the markdown rather than on the parsed blocks because
 * how the prose parses depends on what surrounds it: a list the caller wrote
 * below it would absorb the derived bullets, and a body line of ``` would
 * swallow the rest of the document. Anything but an exact match is prose the
 * caller changed, and that stays whole rather than partly dropped.
 */
function stripArticleProse(
  markdown: string,
  placeholders: StoredPlaceholders,
): string {
  let kept = "";
  let cursor = 0;
  for (const match of markdown.matchAll(EVERY_PLACEHOLDER)) {
    if (match.index !== 0 && markdown[match.index - 1] !== "\n") continue;
    const prose = placeholders.proseOf(refOf(match));
    if (!prose) continue;
    const from = match.index + match[0].length;
    const block = `\n\n${prose}`;
    if (!markdown.startsWith(block, from)) continue;
    const to = from + block.length;
    if (to !== markdown.length && !markdown.startsWith("\n\n", to)) continue;
    kept += markdown.slice(cursor, from);
    cursor = to;
  }
  return kept + markdown.slice(cursor);
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

type SerializedParentNode = SerializedLexicalNode & {
  children: SerializedLexicalNode[];
};

const withChildren = (
  node: SerializedLexicalNode,
  children: SerializedLexicalNode[],
): SerializedParentNode => ({ ...node, children });

function transformChildren(
  children: SerializedLexicalNode[],
  placeholders: StoredPlaceholders,
  blockLevel: boolean,
): SerializedLexicalNode[] {
  const result: SerializedLexicalNode[] = [];
  for (const child of children) {
    // A fenced block is content down to the last character.
    if (child.type === "code") {
      result.push(child);
      continue;
    }
    // Only a line among blocks can stand in for a block. Anywhere else, a
    // lone placeholder goes through the inline path, which rejects a block
    // one.
    const ref = blockLevel ? blockPlaceholderRef(child) : null;
    if (ref) {
      const { node, blockLevel } = placeholders.take(ref);
      // An inline node cannot be a block, so it goes back inside the
      // paragraph the placeholder stood on.
      result.push(blockLevel ? node : withChildren(child, [node]));
      continue;
    }
    const text = child.type === "text" ? asText(child) : null;
    if (text && !isCode(text) && PLACEHOLDER_PATTERN.test(text.text)) {
      result.push(...splitAroundPlaceholders(text, placeholders));
      continue;
    }
    const nested = childrenOf(child);
    result.push(
      nested
        ? withChildren(
            child,
            transformChildren(
              nested,
              placeholders,
              BLOCK_CONTAINERS.has(child.type),
            ),
          )
        : child,
    );
  }
  return result;
}

/** How many columns a table or column layout has. */
function columnCount(node: SerializedLexicalNode): number | undefined {
  if (node.type === "layout-container") return childrenOf(node)?.length;
  return childrenOf(childrenOf(node)?.[0] ?? node)?.reduce(
    (count, cell) =>
      count +
      ("colSpan" in cell && typeof cell.colSpan === "number"
        ? cell.colSpan
        : 1),
    0,
  );
}

/**
 * Widths are set by a person dragging, and markdown has no way to carry them,
 * so a table or column layout that keeps its place and its column count
 * keeps the widths it had.
 */
function keepHandSetWidths(
  child: SerializedLexicalNode,
  previous: SerializedLexicalNode,
): void {
  if (
    child.type !== previous.type ||
    columnCount(child) !== columnCount(previous)
  ) {
    return;
  }
  if (
    child.type === "table" &&
    "colWidths" in previous &&
    Array.isArray(previous.colWidths)
  ) {
    Object.assign(child, { colWidths: [...previous.colWidths] });
  }
  if (
    child.type === "layout-container" &&
    "templateColumns" in previous &&
    typeof previous.templateColumns === "string"
  ) {
    Object.assign(child, { templateColumns: previous.templateColumns });
  }
}

export type ReplacedState = {
  state: SerializedEditorState;
  /** Placeholders the markdown kept, so nodes put back from `stored`. */
  restoredPlaceholders: number;
  /** Placeholders the markdown dropped, so nodes the replace deletes. */
  removedPlaceholders: number;
  /** How the markdown was read; see {@link interpretDocumentMarkdown}. */
  notes: string[];
  /** The entity fields the markdown sets. */
  fields: DocumentFields;
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
  entity?: Omit<WriteTarget, "header" | "titleFromHeading">,
): ReplacedState {
  // A node type the editor cannot build has no placeholder either, so it
  // could only leave through this write unannounced. The read that would have
  // produced this markdown fails on the same types.
  const unsupported = unsupportedNodeTypes(stored);
  if (unsupported.length > 0) {
    throw new UnsupportedNodeTypesError(unsupported);
  }
  const placeholders = new StoredPlaceholders(stored);
  // Without the entity there is no title for a leading heading to be.
  const {
    state: parsed,
    notes,
    fields,
    header,
  } = interpretDocumentMarkdown(stripArticleProse(markdown, placeholders), {
    title: "",
    ...entity,
    header: documentHeaderOf(stored),
    titleFromHeading: entity !== undefined,
  });
  const children = transformChildren(parsed.root.children, placeholders, true);
  children.forEach((child, index) => {
    const previous = stored.root.children[index];
    if (previous) keepHandSetWidths(child, previous);
  });
  const state = { ...stored, root: { ...stored.root, children } };
  return {
    state: header ? withDocumentHeader(state, header) : state,
    restoredPlaceholders: placeholders.restored,
    removedPlaceholders: placeholders.removed,
    notes,
    fields,
  };
}
