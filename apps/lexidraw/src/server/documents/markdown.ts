import { createHeadlessEditor } from "@lexical/headless";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import {
  $gatherFootnotes,
  collectMarkdownNotes,
  CORE_NODES,
  CORE_TRANSFORMERS,
  type DocumentFields,
  type DocumentHeader,
  documentHeaderOf,
  type FrontMatter,
  frontMatterNote,
  markdownFields,
  readFrontMatter,
  sameTitle,
  writeFrontMatter,
} from "@packages/lexical-nodes";
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
 *
 * With a `title`, a leading `# title` is left out: the document shows its
 * title once, above the content, and a write reads it back from there.
 */
export function editorStateToMarkdown(
  stored: SerializedEditorState,
  { title }: { title?: string } = {},
): string {
  const state =
    title === undefined ? stored : withoutTitleHeading(stored, title);
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
  return interpretMarkdown(markdown).state;
}

/**
 * {@link markdownToEditorState}, with notes on how the markdown was read
 * wherever the writer could have meant something else or will see something
 * it may not expect.
 */
export function interpretMarkdown(markdown: string): {
  state: SerializedEditorState;
  notes: string[];
} {
  const editor = createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error) => {
      throw error;
    },
  });
  let unmatched: string[] = [];
  const { notes } = collectMarkdownNotes(() =>
    editor.update(
      () => {
        $convertFromMarkdownString(markdown, CORE_TRANSFORMERS);
        unmatched = $gatherFootnotes();
      },
      { discrete: true },
    ),
  );
  const state = editor.getEditorState().toJSON();
  return {
    state,
    notes: [
      ...notes,
      ...unmatched.map(
        (label) =>
          `The footnote marker [^${label}] has no note [^${label}]: below it`,
      ),
      ...layoutNotes(state),
    ],
  };
}

export type { DocumentFields };

/** What a write lands on, so the markdown can be read against it. */
export type WriteTarget = {
  id?: string;
  title: string;
  tags?: string[];
  lang?: string | null;
  header?: DocumentHeader;
  /**
   * Whether a leading `# X` may be the document's title: on a replace, or on
   * a write into an empty document, where it could not be anything else.
   */
  titleFromHeading: boolean;
};

export type InterpretedDocument = {
  state: SerializedEditorState;
  notes: string[];
  /** Only what the markdown sets; a field it leaves out is left as it is. */
  fields: DocumentFields;
  /** The header front matter describes, or undefined without front matter. */
  header?: DocumentHeader;
};

const sameTags = (a: string[], b: string[]) =>
  a.length === b.length &&
  [...a].sort().every((tag, index) => tag === [...b].sort()[index]);

/** The part of `frontMatter` that differs from what `target` already has. */
function changedFrontMatter(
  frontMatter: FrontMatter,
  target: WriteTarget,
): FrontMatter {
  const current = target.header ?? {};
  const header = Object.fromEntries(
    Object.entries(frontMatter.header).filter(
      ([key, value]) =>
        JSON.stringify(value) !==
        JSON.stringify(current[key as keyof DocumentHeader]),
    ),
  );
  return {
    title:
      frontMatter.title !== undefined && frontMatter.title !== target.title
        ? frontMatter.title
        : undefined,
    tags:
      frontMatter.tags &&
      !(target.tags && sameTags(frontMatter.tags, target.tags))
        ? frontMatter.tags
        : undefined,
    lang: frontMatter.lang !== (target.lang ?? null) ? frontMatter.lang : null,
    header,
  };
}

/**
 * {@link interpretMarkdown} for a whole write: a leading YAML block sets the
 * entity's fields and the header rather than becoming content, and a leading
 * `# X` becomes the title where it can only be the title.
 */
export function interpretDocumentMarkdown(
  markdown: string,
  target: WriteTarget,
): InterpretedDocument {
  const read = readFrontMatter(markdown);
  const { state, notes } = interpretMarkdown(read.body);
  const { frontMatter } = read;
  const leading: string[] = [...read.notes];
  if (frontMatter) {
    if (frontMatter.id && target.id && frontMatter.id !== target.id) {
      leading.push(
        `The front matter id "${frontMatter.id}" is another document's; this write went to ${target.id}`,
      );
    }
    const note = frontMatterNote(changedFrontMatter(frontMatter, target));
    if (note) leading.push(note);
  }
  const [first, ...rest] = state.root.children;
  const heading = first && isTitleHeading(first) ? nodeText(first).trim() : "";
  const { fields, titleHeading, namedByHeading } = markdownFields(
    frontMatter,
    heading,
    target,
  );
  if (namedByHeading)
    leading.push(`The leading heading "${heading}" became the document title`);
  return {
    state: titleHeading
      ? { ...state, root: { ...state.root, children: rest } }
      : state,
    notes: [...leading, ...notes],
    fields,
    header: frontMatter?.header,
  };
}

const isTitleHeading = (node: SerializedLexicalNode) =>
  node.type === "heading" && "tag" in node && node.tag === "h1";

/**
 * `state` without a leading `# title`. Documents written before the title
 * showed above the content often start with one.
 */
export function withoutTitleHeading(
  state: SerializedEditorState,
  title: string,
): SerializedEditorState {
  const [first, ...rest] = state.root.children;
  if (!first || !isTitleHeading(first) || !sameTitle(nodeText(first), title))
    return state;
  return { ...state, root: { ...state.root, children: rest } };
}

type Walked = SerializedLexicalNode & { children?: Walked[] };

function* walk(node: Walked): Generator<Walked> {
  yield node;
  for (const child of node.children ?? []) yield* walk(child);
}

/**
 * A table this many columns wide or wider scrolls sideways on a 375px phone,
 * where the column is 343px and each table column at least 30vw.
 */
const PHONE_TABLE_COLUMNS = 4;

const columnCount = (table: Walked) =>
  (table.children?.[0]?.children ?? []).reduce(
    (count, cell) =>
      count +
      ("colSpan" in cell && typeof cell.colSpan === "number"
        ? cell.colSpan
        : 1),
    0,
  );

function layoutNotes(state: SerializedEditorState): string[] {
  const wide = [...walk(state.root as Walked)]
    .filter((node) => node.type === "table")
    .map(columnCount)
    .filter((columns) => columns >= PHONE_TABLE_COLUMNS);
  if (wide.length === 0) return [];
  const fewest = Math.min(...wide);
  const most = Math.max(...wide);
  const span = fewest === most ? `${most}` : `${fewest} to ${most}`;
  const tables =
    wide.length === 1
      ? `A table of ${span} columns scrolls`
      : `${wide.length} tables of ${span} columns scroll`;
  return [
    `${tables} sideways on phones; fewer columns, or a list, read better there`,
  ];
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * What the markdown form of `state` leaves out, so a reader knows what a
 * replace from that markdown keeps, and what it drops.
 */
export function markdownLosses(state: SerializedEditorState): string[] {
  let layouts = 0;
  let tables = 0;
  let images = 0;
  let styledText = 0;
  let marks = 0;
  for (const node of walk(state.root as Walked)) {
    const fields = node as Walked & Record<string, unknown>;
    if (
      node.type === "layout-container" &&
      typeof fields.templateColumns === "string" &&
      new Set(fields.templateColumns.trim().split(/\s+/)).size > 1
    ) {
      layouts++;
    }
    if (node.type === "table" && Array.isArray(fields.colWidths)) tables++;
    if (
      node.type === "image" &&
      [fields.width, fields.height].some(
        (size) => typeof size === "number" && size > 0,
      )
    ) {
      images++;
    }
    if (
      node.type === "text" &&
      typeof fields.style === "string" &&
      fields.style.trim() !== ""
    ) {
      styledText++;
    }
    if (node.type === "mark") marks++;
  }
  const losses: string[] = [];
  if (layouts > 0) {
    losses.push(
      `${plural(layouts, "column layout")} ${layouts === 1 ? "has" : "have"} uneven widths, which <columns> does not carry; a replace keeps them while each layout keeps its position and column count`,
    );
  }
  if (tables > 0) {
    losses.push(
      `${plural(tables, "table")} ${tables === 1 ? "has" : "have"} column widths set by hand, which markdown does not carry; a replace keeps them while each table keeps its position and column count`,
    );
  }
  if (images > 0) {
    losses.push(
      `${plural(images, "image")} ${images === 1 ? "has a size" : "have sizes"} set by hand, which markdown does not carry; a replace resets ${images === 1 ? "it" : "them"} to fit the column`,
    );
  }
  if (styledText > 0) {
    losses.push(
      `${plural(styledText, "run")} of text ${styledText === 1 ? "has" : "have"} a colour, font or size, which markdown does not carry; a replace drops it`,
    );
  }
  if (marks > 0) {
    losses.push(
      `${plural(marks, "comment highlight")} ${marks === 1 ? "is" : "are"} not in markdown; a replace removes the highlight, not the comment`,
    );
  }
  return losses;
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

// Enough for the caller to recognise the heading it meant without another
// read, short of pasting a long document's whole outline into an error.
const LISTED_HEADINGS = 20;

const headingCount = (count: number) =>
  `${count} top-level heading${count === 1 ? "" : "s"}`;

export class HeadingNotFoundError extends Error {
  readonly text: string;
  /** Every top-level heading the document does have, in document order. */
  readonly headings: string[];

  constructor(text: string, headings: string[]) {
    // The headings that do exist are in the message so the caller can pick
    // one without re-reading the document.
    const listed = [
      ...headings
        .slice(0, LISTED_HEADINGS)
        .map((heading) => JSON.stringify(heading)),
      ...(headings.length > LISTED_HEADINGS
        ? [`and ${headings.length - LISTED_HEADINGS} more`]
        : []),
    ];
    super(
      `No top-level heading matches ${JSON.stringify(text)}; the document has ${listed.length === 0 ? "none" : listed.join(", ")}`,
    );
    this.name = "HeadingNotFoundError";
    this.text = text;
    this.headings = headings;
  }
}

export class AmbiguousHeadingError extends Error {
  readonly text: string;
  readonly candidates: HeadingCandidate[];
  /** The `nth` that pointed past the candidates, when there was one. */
  readonly nth?: number;

  constructor(text: string, candidates: HeadingCandidate[], nth?: number) {
    // The candidates are in the message as well as on the error so a client
    // that only surfaces the message can still tell the caller what exists.
    super(
      [
        nth === undefined
          ? `${headingCount(candidates.length)} ${candidates.length === 1 ? "matches" : "match"} ${JSON.stringify(text)}; pass nth to choose one:`
          : `nth ${nth} is past the ${headingCount(candidates.length)} matching ${JSON.stringify(text)}:`,
        ...candidates.map(
          (candidate) =>
            `#${candidate.nth} ${candidate.tag} ${JSON.stringify(candidate.text)} at block ${candidate.blockIndex}`,
        ),
      ].join("\n"),
    );
    this.name = "AmbiguousHeadingError";
    this.text = text;
    this.candidates = candidates;
    this.nth = nth;
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

/**
 * All text below `node`, in document order, with the line breaks it renders
 * as. Formatting is dropped: a heading is matched by what it reads as, not by
 * the bold or italic runs it happens to be split into.
 */
function nodeText(node: SerializedLexicalNode): string {
  const parts: string[] = [];
  const visit = (current: SerializedLexicalNode) => {
    if (current.type === "linebreak") {
      parts.push("\n");
    }
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

type TopLevelHeading = Omit<HeadingCandidate, "nth">;

function topLevelHeadings(state: SerializedEditorState): TopLevelHeading[] {
  const headings: TopLevelHeading[] = [];
  state.root.children.forEach((child, blockIndex) => {
    if (child.type !== "heading") {
      return;
    }
    headings.push({
      blockIndex,
      tag: "tag" in child && typeof child.tag === "string" ? child.tag : "",
      text: nodeText(child),
    });
  });
  return headings;
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
      const headings = topLevelHeadings(state);
      const wanted = foldHeadingText(placement.text);
      const candidates: HeadingCandidate[] = headings
        .filter((heading) => foldHeadingText(heading.text) === wanted)
        .map((heading, index) => ({ nth: index + 1, ...heading }));
      if (candidates.length === 0) {
        throw new HeadingNotFoundError(
          placement.text,
          headings.map((heading) => heading.text),
        );
      }
      if (placement.nth === undefined && candidates.length > 1) {
        throw new AmbiguousHeadingError(placement.text, candidates);
      }
      const chosen = candidates[(placement.nth ?? 1) - 1];
      if (!chosen) {
        throw new AmbiguousHeadingError(
          placement.text,
          candidates,
          placement.nth,
        );
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
  /** The language the document settings chose, if any. */
  lang?: string | null;
  header?: DocumentHeader;
};

export function withFrontmatter(
  meta: DocumentFrontmatter,
  markdown: string,
): string {
  return `${writeFrontMatter({ ...meta, header: meta.header ?? {} })}\n${markdown}`;
}

/** A document as a read returns it: front matter, then the body. */
export function documentMarkdown(
  state: SerializedEditorState,
  meta: DocumentFrontmatter,
): string {
  return withFrontmatter(
    { ...meta, header: documentHeaderOf(state) },
    editorStateToMarkdown(state, { title: meta.title }),
  );
}
