import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type MultilineElementTransformer,
  type Transformer,
} from "@lexical/markdown";
import {
  $createParagraphNode,
  $isElementNode,
  type ElementNode,
  type LexicalNode,
} from "lexical";
import { reportMarkdownNote } from "./markdown-notes.js";
import {
  type CalloutKind,
  CalloutNode,
  isCalloutKind,
} from "./nodes/CalloutNode.js";
import { CollapsibleContainerNode } from "./nodes/CollapsibleContainerNode.js";
import { CollapsibleContentNode } from "./nodes/CollapsibleContentNode.js";
import { CollapsibleTitleNode } from "./nodes/CollapsibleTitleNode.js";
import { LayoutContainerNode } from "./nodes/LayoutContainerNode.js";
import { LayoutItemNode } from "./nodes/LayoutItemNode.js";

/** Resolves the complete transformer list a nested conversion should use. */
export type TransformerSource = () => Transformer[];

/**
 * Obsidian's callout types and Docusaurus's admonitions, by the GitHub kind
 * nearest in meaning. Where Obsidian and GitHub disagree on a word, GitHub's
 * reading wins: `important` is its own kind and `caution` is the red one.
 */
const CALLOUT_ALIASES: Record<string, CalloutKind> = {
  note: "note",
  info: "note",
  todo: "note",
  abstract: "note",
  summary: "note",
  tldr: "note",
  example: "note",
  quote: "note",
  cite: "note",
  tip: "tip",
  hint: "tip",
  success: "tip",
  check: "tip",
  done: "tip",
  important: "important",
  question: "important",
  help: "important",
  faq: "important",
  warning: "warning",
  attention: "warning",
  caution: "caution",
  danger: "caution",
  error: "caution",
  failure: "caution",
  fail: "caution",
  missing: "caution",
  bug: "caution",
};

const capitalise = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/**
 * The kind a marker names and the title it carries. A word that is not one
 * of the five kinds keeps itself as the title when the author gave none, so
 * `> [!danger]` still reads "Danger" above a caution callout.
 */
function resolveCallout(
  marker: string,
  title: string,
  written: string,
): { kind: CalloutKind; title: string } {
  const word = marker.toLowerCase();
  const kind = CALLOUT_ALIASES[word] ?? "note";
  if (isCalloutKind(word)) return { kind, title };
  const resolvedTitle = title || capitalise(word);
  const reason = CALLOUT_ALIASES[word] ? "" : " (an unknown kind)";
  reportMarkdownNote(
    `${written} became a ${kind} callout${reason} titled "${resolvedTitle}"; reads write it as ${calloutHead(kind, resolvedTitle)}`,
  );
  return { kind, title: resolvedTitle };
}

const calloutHead = (kind: CalloutKind, title: string) =>
  `> [!${kind.toUpperCase()}]${title ? ` ${title}` : ""}`;

const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * Walks `lines` from `from`, skipping fenced code, and answers the index of
 * the line where the block opened on `from` closes: `opens` and `closes`
 * count how many blocks a line opens and closes. Null when it never closes.
 */
function findClose(
  lines: readonly string[],
  from: number,
  opens: (line: string) => number,
  closes: (line: string) => number,
): number | null {
  let depth = 0;
  let fence: string | null = null;
  for (let index = from; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      if (marker?.startsWith(fence) && line.trim() === marker) fence = null;
      continue;
    }
    if (marker && index !== from) {
      fence = marker;
      continue;
    }
    depth += opens(line) - closes(line);
    if (depth <= 0) return index;
  }
  return null;
}

/** `markdown` parsed into `container`, which never ends up empty. */
function $fill(
  container: ElementNode,
  markdown: string,
  transformers: TransformerSource,
): void {
  $convertFromMarkdownString(markdown, transformers(), container);
  if (container.getChildrenSize() === 0) {
    container.append($createParagraphNode());
  }
}

/** Blank lines are dropped from either end, so the blocks decide spacing. */
const trimBlankLines = (lines: string[]) => {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start++;
  while (end > start && lines[end - 1]?.trim() === "") end--;
  return lines.slice(start, end);
};

const exportBlocks = (transformers: TransformerSource, node: ElementNode) =>
  $convertToMarkdownString(transformers(), node);

/** `body` as the lines of an HTML-style block, blank-line padded for GitHub. */
const padded = (body: string) => (body ? ["", body, ""] : []);

const noShortcut = () => false as const;

const CALLOUT_START = /^>\s?\[!([A-Za-z][\w-]*)\]([+-]?)(?:\s+(.*?))?\s*$/;

export function createCalloutTransformer(
  transformers: TransformerSource,
): MultilineElementTransformer {
  return {
    dependencies: [CalloutNode],
    export: (node) => {
      if (!CalloutNode.$isCalloutNode(node)) return null;
      const body = exportBlocks(transformers, node);
      const lines = body ? body.split("\n") : [];
      return [
        calloutHead(node.getKind(), node.getTitle()),
        ...lines.map((line) => (line ? `> ${line}` : ">")),
      ].join("\n");
    },
    handleImportAfterStartMatch: ({
      lines,
      rootNode,
      startLineIndex,
      startMatch,
    }) => {
      const [, marker = "", , title = ""] = startMatch;
      let end = startLineIndex;
      while (/^>/.test(lines[end + 1] ?? "")) end++;
      const { kind, title: resolvedTitle } = resolveCallout(
        marker,
        title,
        `[!${marker}]`,
      );
      const callout = CalloutNode.$createCalloutNode(kind, resolvedTitle);
      const body = lines
        .slice(startLineIndex + 1, end + 1)
        .map((line) => line.replace(/^> ?/, ""));
      $fill(callout, trimBlankLines(body).join("\n"), transformers);
      rootNode.append(callout);
      return [true, end];
    },
    regExpStart: CALLOUT_START,
    replace: noShortcut,
    type: "multiline-element",
  };
}

const ADMONITION_START =
  /^(:{3,})\s*([A-Za-z][\w-]*)(?:\[(.*)\])?(?:\s+(.*?))?\s*$/;
const ADMONITION_END = /^:{3,}\s*$/;

/**
 * Docusaurus admonitions, `:::tip[Title]` down to a bare `:::`. They import
 * as callouts and are written back in the GitHub form, so only import is
 * here.
 */
export function createAdmonitionTransformer(
  transformers: TransformerSource,
): MultilineElementTransformer {
  return {
    dependencies: [CalloutNode],
    handleImportAfterStartMatch: ({
      lines,
      rootNode,
      startLineIndex,
      startMatch,
    }) => {
      const [, , marker = "", bracketed, trailing] = startMatch;
      const end = findClose(
        lines,
        startLineIndex,
        (line) => (ADMONITION_START.test(line) ? 1 : 0),
        (line) => (ADMONITION_END.test(line) ? 1 : 0),
      );
      if (end === null) return null;
      const written = `:::${marker}`;
      const { kind, title } = resolveCallout(
        marker,
        (bracketed ?? trailing ?? "").trim(),
        written,
      );
      if (isCalloutKind(marker.toLowerCase())) {
        reportMarkdownNote(
          `${written} became a ${kind} callout; reads write it as ${calloutHead(kind, title)}`,
        );
      }
      const callout = CalloutNode.$createCalloutNode(kind, title);
      $fill(
        callout,
        lines.slice(startLineIndex + 1, end).join("\n"),
        transformers,
      );
      rootNode.append(callout);
      return [true, end];
    },
    regExpStart: ADMONITION_START,
    replace: noShortcut,
    type: "multiline-element",
  };
}

const DETAILS_OPEN = /<details(?:\s[^>]*)?>/gi;
const DETAILS_CLOSE = /<\/details\s*>/gi;
const SUMMARY = /^\s*<summary>(.*?)<\/summary>\s*/is;
const count = (pattern: RegExp) => (line: string) =>
  line.match(pattern)?.length ?? 0;

/**
 * `markdown`'s inline content as the children of `target`, which holds
 * inline nodes directly.
 */
function $fillInline(
  target: ElementNode,
  markdown: string,
  transformers: TransformerSource,
) {
  const scratch = $createParagraphNode();
  $convertFromMarkdownString(markdown, transformers(), scratch);
  const inline: LexicalNode[] = [];
  for (const block of scratch.getChildren()) {
    if ($isElementNode(block)) inline.push(...block.getChildren());
  }
  target.append(...inline);
}

export function createDetailsTransformer(
  transformers: TransformerSource,
): MultilineElementTransformer {
  return {
    dependencies: [
      CollapsibleContainerNode,
      CollapsibleTitleNode,
      CollapsibleContentNode,
    ],
    export: (node, exportChildren) => {
      if (!CollapsibleContainerNode.$isCollapsibleContainerNode(node)) {
        return null;
      }
      const title = node
        .getChildren()
        .find(CollapsibleTitleNode.$isCollapsibleTitleNode);
      const content = node
        .getChildren()
        .find(CollapsibleContentNode.$isCollapsibleContentNode);
      const body = content ? exportBlocks(transformers, content) : "";
      return [
        node.getOpen() ? "<details open>" : "<details>",
        `<summary>${title ? exportChildren(title).replace(/\n/g, " ") : ""}</summary>`,
        ...padded(body),
        "</details>",
      ].join("\n");
    },
    handleImportAfterStartMatch: ({
      lines,
      rootNode,
      startLineIndex,
      startMatch,
    }) => {
      const end = findClose(
        lines,
        startLineIndex,
        count(DETAILS_OPEN),
        count(DETAILS_CLOSE),
      );
      if (end === null) return null;
      const first = (lines[startLineIndex] ?? "").slice(
        (startMatch.index ?? 0) + startMatch[0].length,
      );
      const closing = lines[end] ?? "";
      const inner =
        end === startLineIndex
          ? [first.slice(0, first.search(DETAILS_CLOSE))]
          : [
              first,
              ...lines.slice(startLineIndex + 1, end),
              closing.slice(0, closing.search(DETAILS_CLOSE)),
            ];
      const text = inner.join("\n");
      const summary = SUMMARY.exec(text);
      const title = summary?.[1]?.trim() ?? "";
      const body = summary ? text.slice(summary[0].length) : text;
      if (!summary) {
        reportMarkdownNote(
          "A <details> block has no <summary>, so its collapsible has no title",
        );
      }
      const container =
        CollapsibleContainerNode.$createCollapsibleContainerNode(
          /\bopen\b/i.test(startMatch[0]),
        );
      const titleNode = CollapsibleTitleNode.$createCollapsibleTitleNode();
      $fillInline(titleNode, title, transformers);
      const content = CollapsibleContentNode.$createCollapsibleContentNode();
      $fill(content, trimBlankLines(body.split("\n")).join("\n"), transformers);
      container.append(titleNode, content);
      rootNode.append(container);
      return [true, end];
    },
    regExpStart: /^\s*<details(?:\s[^>]*)?>/i,
    replace: noShortcut,
    type: "multiline-element",
  };
}

const COLUMNS_OPEN = /^\s*<columns(?:\s[^>]*)?>\s*$/i;
const COLUMNS_CLOSE = /^\s*<\/columns\s*>\s*$/i;
const COLUMN_OPEN = /^\s*<column(?:\s[^>]*)?>(.*)$/i;
const COLUMN_CLOSE = /^(.*?)<\/column\s*>\s*$/i;

/** The body lines of each `<column>` between a `<columns>` pair. */
function splitColumns(lines: readonly string[]): string[][] {
  const columns: string[][] = [];
  let current: string[] | null = null;
  let nested = 0;
  let fence: string | null = null;
  const open = () => {
    current = [];
    columns.push(current);
    return current;
  };
  for (const line of lines) {
    const marker = FENCE.exec(line)?.[1];
    if (fence || marker) {
      if (!fence) fence = marker ?? null;
      else if (marker?.startsWith(fence) && line.trim() === marker)
        fence = null;
      (current ?? open()).push(line);
      continue;
    }
    if (current === null) {
      const start = COLUMN_OPEN.exec(line);
      if (!start && line.trim() === "") continue;
      // Content outside any column still belongs to the layout.
      const column = open();
      if (!start) {
        column.push(line);
        continue;
      }
      const rest = start[1] ?? "";
      const close = COLUMN_CLOSE.exec(rest);
      column.push(close ? (close[1] ?? "") : rest);
      if (close) current = null;
      continue;
    }
    if (COLUMNS_OPEN.test(line)) nested++;
    if (COLUMNS_CLOSE.test(line)) nested--;
    const close = nested === 0 ? COLUMN_CLOSE.exec(line) : null;
    (current as string[]).push(close ? (close[1] ?? "") : line);
    if (close) current = null;
  }
  return columns;
}

/**
 * Notion's column syntax. Widths are not part of it, so every column comes in
 * equal; a whole-document replace puts a hand-set template back.
 */
export function createColumnsTransformer(
  transformers: TransformerSource,
): MultilineElementTransformer {
  return {
    dependencies: [LayoutContainerNode, LayoutItemNode],
    export: (node) => {
      if (!LayoutContainerNode.$isLayoutContainerNode(node)) return null;
      const columns = node
        .getChildren()
        .filter(LayoutItemNode.$isLayoutItemNode)
        .flatMap((item) => [
          "<column>",
          ...padded(exportBlocks(transformers, item)),
          "</column>",
        ]);
      return ["<columns>", ...columns, "</columns>"].join("\n");
    },
    handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
      const end = findClose(
        lines,
        startLineIndex,
        (line) => (COLUMNS_OPEN.test(line) ? 1 : 0),
        (line) => (COLUMNS_CLOSE.test(line) ? 1 : 0),
      );
      if (end === null) return null;
      const columns = splitColumns(lines.slice(startLineIndex + 1, end));
      if (columns.length === 0) return null;
      const layout = LayoutContainerNode.$createLayoutContainerNode(
        columns.map(() => "1fr").join(" "),
      );
      for (const column of columns) {
        const item = LayoutItemNode.$createLayoutItemNode();
        $fill(item, trimBlankLines(column).join("\n"), transformers);
        layout.append(item);
      }
      rootNode.append(layout);
      return [true, end];
    },
    regExpStart: COLUMNS_OPEN,
    replace: noShortcut,
    type: "multiline-element",
  };
}
