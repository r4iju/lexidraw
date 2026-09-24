import { $isTableNode } from "@lexical/table";
import type { EditorState, LexicalEditor } from "lexical";
import { useCallback } from "react";
import {
  $convertToMarkdownString,
  $convertFromMarkdownString,
} from "@lexical/markdown";
import { $isHeadingNode } from "@lexical/rich-text";
import {
  $gatherFootnotes,
  $setDocumentHeader,
  type DocumentFields,
  markdownFields,
  readFrontMatter,
  sameTitle,
} from "@packages/lexical-nodes";
import { $getRoot, $createParagraphNode } from "lexical";
import { PLAYGROUND_TRANSFORMERS } from "../plugins/MarkdownTransformers";

export type MarkdownInsertMode = "start" | "end" | "replace";

/**
 * What an import changes on the document beyond its content: the title, tags
 * and language, each only when it differs from what the document has.
 */
export type MarkdownImport = DocumentFields;

/** The document an import lands in, as far as the import reads it. */
export type ImportTarget = {
  title: string;
  /** The language chosen for the document, or null when it is detected. */
  lang?: string | null;
};

/**
 * Puts `markdown` into the document the way a write through the API would:
 * front matter becomes the header, the tags and the language, a leading
 * `# X` names a document nobody has named (or is dropped when it repeats the
 * title) when it can only be the title, and the notes gather at the end.
 */
export function $insertMarkdown(
  markdown: string,
  mode: MarkdownInsertMode,
  document: ImportTarget,
): MarkdownImport {
  const root = $getRoot();
  const { frontMatter, body } = readFrontMatter(markdown);
  // A temporary parent holds the conversion; it is never inserted.
  const holder = $createParagraphNode();
  $convertFromMarkdownString(body, PLAYGROUND_TRANSFORMERS, holder);
  const nodes = holder.getChildren();

  const [first] = nodes;
  const heading =
    $isHeadingNode(first) && first.getTag() === "h1"
      ? first.getTextContent().trim()
      : "";
  const { fields, titleHeading } = markdownFields(frontMatter, heading, {
    title: document.title,
    titleFromHeading: mode === "replace" || root.isEmpty(),
  });
  if (titleHeading) nodes.shift();

  if (mode === "replace") {
    const previous = root.getChildren();
    nodes.forEach((node, index) => {
      const original = previous[index];
      if (
        $isTableNode(node) &&
        $isTableNode(original) &&
        node.getColumnCount() === original.getColumnCount()
      ) {
        node.setColWidths(original.getColWidths());
      }
    });
    root.clear().append(...nodes);
  } else if (mode === "start") {
    const existing = root.getChildren();
    root.clear().append(...nodes, ...existing);
  } else {
    root.append(...nodes);
  }
  if (frontMatter) $setDocumentHeader(frontMatter.header);
  $gatherFootnotes();

  const changes: MarkdownImport = {};
  if (fields.title && !sameTitle(fields.title, document.title))
    changes.title = fields.title;
  if (fields.tags) changes.tags = fields.tags;
  if (fields.lang !== undefined && fields.lang !== (document.lang ?? null))
    changes.lang = fields.lang;
  return changes;
}

export const useMarkdownTools = () => {
  const convertEditorStateToMarkdown = useCallback(
    (editorState: EditorState): string => {
      return editorState.read(() => {
        try {
          // Always export the whole document by converting from root node
          // This ensures we export everything even if there's a selection
          const root = $getRoot();
          const md = $convertToMarkdownString(PLAYGROUND_TRANSFORMERS, root);
          return md?.trim() ?? "";
        } catch (e) {
          console.error("[convertEditorStateToMarkdown] export error:", e);
          return "";
        }
      });
    },
    [],
  );

  const insertMarkdown = useCallback(
    (
      editor: LexicalEditor,
      markdown: string,
      mode: MarkdownInsertMode,
      document: ImportTarget,
    ): MarkdownImport => {
      let result: MarkdownImport = {};
      editor.update(
        () => {
          result = $insertMarkdown(markdown, mode, document);
        },
        { discrete: true },
      );
      return result;
    },
    [],
  );

  return {
    convertEditorStateToMarkdown,
    insertMarkdown,
  };
};
