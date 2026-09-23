import { createHeadlessEditor } from "@lexical/headless";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import { CORE_NODES, CORE_TRANSFORMERS } from "@packages/lexical-nodes";
import {
  $getRoot,
  type SerializedEditorState,
  type SerializedLexicalNode,
} from "lexical";

// Registered implicitly by every Lexical editor.
const BUILTIN_NODE_TYPES = ["root", "paragraph", "text", "linebreak", "tab"];

const SUPPORTED_NODE_TYPES = new Set([
  ...BUILTIN_NODE_TYPES,
  ...CORE_NODES.map((node) => node.getType()),
]);

export class UnsupportedNodeTypesError extends Error {
  readonly types: string[];

  constructor(types: string[]) {
    super(
      `Document contains node types without a markdown form yet: ${types.join(", ")}`,
    );
    this.name = "UnsupportedNodeTypesError";
    this.types = types;
  }
}

export class InvalidDocumentContentError extends Error {
  constructor() {
    super("Document content is not a Lexical editor state");
    this.name = "InvalidDocumentContentError";
  }
}

// documents.create accepts any JSON as content, so stored content is not
// trusted to be an editor state.
export function parseEditorState(elements: string): SerializedEditorState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(elements);
  } catch {
    throw new InvalidDocumentContentError();
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("root" in parsed) ||
    typeof parsed.root !== "object" ||
    parsed.root === null ||
    !("children" in parsed.root) ||
    !Array.isArray(parsed.root.children)
  ) {
    throw new InvalidDocumentContentError();
  }
  return parsed as SerializedEditorState;
}

/** Node types in document order, each listed once. */
export function collectNodeTypes(state: SerializedEditorState): string[] {
  const seen = new Set<string>();
  const visit = (node: SerializedLexicalNode) => {
    seen.add(node.type);
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children as SerializedLexicalNode[]) {
        visit(child);
      }
    }
  };
  visit(state.root);
  return [...seen];
}

export function unsupportedNodeTypes(state: SerializedEditorState): string[] {
  return collectNodeTypes(state).filter(
    (type) => !SUPPORTED_NODE_TYPES.has(type),
  );
}

/**
 * Converts a stored document to markdown with the headless editor. Throws
 * UnsupportedNodeTypesError when the document holds node types the nodes
 * package does not register yet, so the caller can name them.
 */
export function editorStateToMarkdown(state: SerializedEditorState): string {
  const unsupported = unsupportedNodeTypes(state);
  if (unsupported.length > 0) {
    throw new UnsupportedNodeTypesError(unsupported);
  }
  // Lexical refuses to set a state whose root has no children.
  if (state.root.children.length === 0) {
    return "";
  }
  const editor = createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error) => {
      throw error;
    },
  });
  editor.setEditorState(editor.parseEditorState(state));
  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(CORE_TRANSFORMERS, $getRoot()));
}

/** The blocks markdown parses to, as a state whose root holds only them. */
export function markdownToEditorState(markdown: string): SerializedEditorState {
  const editor = createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, CORE_TRANSFORMERS);
    },
    { discrete: true },
  );
  return editor.getEditorState().toJSON();
}

/**
 * `state` with `blocks` spliced in at `index` among the root's children,
 * without touching `state`. Inserting serialized nodes keeps blocks that have
 * no markdown form, and any node the running editor would not know how to
 * build, byte-identical: they are never re-parsed or re-serialized.
 */
export function insertBlocks(
  state: SerializedEditorState,
  index: number,
  blocks: SerializedLexicalNode[],
): SerializedEditorState {
  const children = state.root.children;
  return {
    ...state,
    root: {
      ...state.root,
      children: [
        ...children.slice(0, index),
        ...blocks,
        ...children.slice(index),
      ],
    },
  };
}

/** {@link insertBlocks} at the end of the root's children. */
export function appendBlocks(
  state: SerializedEditorState,
  blocks: SerializedLexicalNode[],
): SerializedEditorState {
  return insertBlocks(state, state.root.children.length, blocks);
}

/** Where an insert puts its blocks among the root's children. */
export type InsertPlacement =
  | { kind: "end" }
  | { kind: "afterHeading"; text: string; nth?: number }
  | { kind: "atBlockIndex"; index: number };

/** A top-level heading an `afterHeading` placement could have meant. */
export type HeadingCandidate = {
  /** 1-based position among the matching headings, in document order. */
  nth: number;
  blockIndex: number;
  /** The heading level as Lexical stores it, such as `h2`. */
  tag: string;
  text: string;
};

export class HeadingNotFoundError extends Error {
  readonly text: string;

  constructor(text: string) {
    super(`No top-level heading matches ${JSON.stringify(text)}`);
    this.name = "HeadingNotFoundError";
    this.text = text;
  }
}

export class AmbiguousHeadingError extends Error {
  readonly text: string;
  readonly candidates: HeadingCandidate[];

  constructor(text: string, candidates: HeadingCandidate[]) {
    // The candidates are in the message as well as on the error so a client
    // that only surfaces the message can still tell the caller what exists.
    super(
      [
        `${candidates.length} top-level heading${candidates.length === 1 ? "" : "s"} match ${JSON.stringify(text)}; pass nth to choose one:`,
        ...candidates.map(
          (candidate) =>
            `#${candidate.nth} ${candidate.tag} ${JSON.stringify(candidate.text)} at block ${candidate.blockIndex}`,
        ),
      ].join("\n"),
    );
    this.name = "AmbiguousHeadingError";
    this.text = text;
    this.candidates = candidates;
  }
}

export class BlockIndexOutOfRangeError extends Error {
  readonly index: number;
  readonly length: number;

  constructor(index: number, length: number) {
    super(
      `Block index ${index} is out of range; the document has ${length} top-level block${length === 1 ? "" : "s"}, so 0 to ${length} are insertable and ${length} appends`,
    );
    this.name = "BlockIndexOutOfRangeError";
    this.index = index;
    this.length = length;
  }
}

/** All text below `node`, in document order. */
function nodeText(node: SerializedLexicalNode): string {
  const parts: string[] = [];
  const visit = (current: SerializedLexicalNode) => {
    if ("text" in current && typeof current.text === "string") {
      parts.push(current.text);
    }
    if ("children" in current && Array.isArray(current.children)) {
      for (const child of current.children as SerializedLexicalNode[]) {
        visit(child);
      }
    }
  };
  visit(node);
  return parts.join("");
}

// Headings are matched the way a caller reads them off the rendered document,
// not the way they are stored: a caller cannot see the whitespace or the
// casing markdown happened to leave behind.
const foldHeadingText = (text: string) =>
  text.trim().replace(/\s+/g, " ").toLowerCase();

function headingCandidates(
  state: SerializedEditorState,
  text: string,
): HeadingCandidate[] {
  const wanted = foldHeadingText(text);
  const candidates: HeadingCandidate[] = [];
  state.root.children.forEach((child, blockIndex) => {
    if (child.type !== "heading") {
      return;
    }
    const headingText = nodeText(child);
    if (foldHeadingText(headingText) !== wanted) {
      return;
    }
    candidates.push({
      nth: candidates.length + 1,
      blockIndex,
      tag: "tag" in child && typeof child.tag === "string" ? child.tag : "",
      text: headingText,
    });
  });
  return candidates;
}

/**
 * The index among the root's children where `placement` puts its blocks, or a
 * throw naming what the caller could have meant instead.
 */
export function resolveInsertIndex(
  state: SerializedEditorState,
  placement: InsertPlacement,
): number {
  const length = state.root.children.length;
  switch (placement.kind) {
    case "end":
      return length;
    case "atBlockIndex":
      // `length` is in range: inserting after the last block is an append.
      if (
        !Number.isInteger(placement.index) ||
        placement.index < 0 ||
        placement.index > length
      ) {
        throw new BlockIndexOutOfRangeError(placement.index, length);
      }
      return placement.index;
    case "afterHeading": {
      const candidates = headingCandidates(state, placement.text);
      if (candidates.length === 0) {
        throw new HeadingNotFoundError(placement.text);
      }
      if (placement.nth === undefined && candidates.length > 1) {
        throw new AmbiguousHeadingError(placement.text, candidates);
      }
      // An nth past the end is ambiguous too: the candidates say what exists.
      const chosen = candidates[(placement.nth ?? 1) - 1];
      if (!chosen) {
        throw new AmbiguousHeadingError(placement.text, candidates);
      }
      return chosen.blockIndex + 1;
    }
  }
}

export type DocumentFrontmatter = {
  id: string;
  title: string;
  /** Slash-joined directory titles ending in the document title. */
  path: string;
  updatedAt: Date;
  tags: string[];
};

// JSON string literals are valid YAML double-quoted scalars, so titles with
// colons, quotes, or hashes survive.
const yaml = (value: string) => JSON.stringify(value);

export function withFrontmatter(
  meta: DocumentFrontmatter,
  markdown: string,
): string {
  const lines = [
    "---",
    `id: ${yaml(meta.id)}`,
    `title: ${yaml(meta.title)}`,
    `path: ${yaml(meta.path)}`,
    `updatedAt: ${yaml(meta.updatedAt.toISOString())}`,
    `tags: [${meta.tags.map(yaml).join(", ")}]`,
    "---",
    "",
  ];
  return `${lines.join("\n")}\n${markdown}`;
}
