import { $createCodeHighlightNode, CodeNode } from "@lexical/code";
import type { Tokenizer } from "@lexical/code-shiki";
import { DocumentCodeNode } from "@packages/lexical-nodes";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createLineBreakNode,
  $createTabNode,
  $nodesOfType,
  HISTORY_MERGE_TAG,
  type LexicalNode,
  tokenizeRawText,
} from "lexical";
import { useEffect } from "react";
import type { BundledLanguage, Highlighter } from "shiki";
import { holdCapture } from "~/lib/capture-hold";

export default function CodeHighlightPlugin(): null {
  const [editor] = useLexicalComposerContext();
  // Shiki owns tokenization; Lexical retains selection while replacing token nodes.
  useEffect(() => {
    let disposed = false;
    let unregister: (() => void) | undefined;
    let highlighter: Highlighter | undefined;
    const pending = new Set<string>();
    const holds = new Set<() => void>();
    /** Holds a capture of the page until the release it returns is called. */
    const holdUntilDrawn = () => {
      const release = holdCapture();
      holds.add(release);
      return () => {
        holds.delete(release);
        release();
      };
    };
    // Shiki is large, so it loads with the first code block, not the editor.
    const start = async () => {
      const [
        { bundledLanguages, createHighlighter },
        { loadCodeLanguage, registerCodeHighlighting },
      ] = await Promise.all([import("shiki"), import("@lexical/code-shiki")]);
      if (disposed) return;
      // The blocks already there are highlighted as highlighting starts, so a
      // capture waiting on it gets them highlighted, not plain for a moment;
      // @lexical/code-shiki keeps its own copy of each language.
      const present = editor.getEditorState().read(() =>
        $nodesOfType(CodeNode).flatMap((node) => {
          const language = node.getLanguage();
          const lang = language?.replace(/^diff-/, "");
          return language && lang && Object.hasOwn(bundledLanguages, lang)
            ? [{ language, lang: lang as BundledLanguage }]
            : [];
        }),
      );
      const loaded = await createHighlighter({
        themes: ["github-light", "github-dark-default"],
        langs: [...new Set(present.map(({ lang }) => lang))],
      });
      await Promise.all(
        present.map(({ language }) => loadCodeLanguage(language)),
      );
      if (disposed) {
        loaded.dispose();
        return;
      }
      highlighter = loaded;
      const tokenizer: Tokenizer = {
        defaultLanguage: null,
        defaultTheme: "none",
        $tokenize(node, language) {
          const lang = language?.replace(/^diff-/, "") || "text";
          // Shiki's registry is the authoritative list of supported language IDs.
          const supported = Object.hasOwn(bundledLanguages, lang)
            ? (lang as BundledLanguage)
            : null;
          if (
            supported &&
            !loaded.getLoadedLanguages().includes(supported) &&
            !pending.has(supported)
          ) {
            pending.add(supported);
            const highlighted = holdUntilDrawn();
            void loaded.loadLanguage(supported).then(() => {
              if (disposed) return highlighted();
              editor.update(
                () => {
                  for (const current of $nodesOfType(CodeNode)) {
                    if (
                      current.getLanguage()?.replace(/^diff-/, "") === supported
                    )
                      current.markDirty();
                  }
                },
                { tag: HISTORY_MERGE_TAG, onUpdate: highlighted },
              );
            }, highlighted);
          }
          const tokens = loaded.codeToTokens(node.getTextContent(), {
            lang:
              supported && loaded.getLoadedLanguages().includes(supported)
                ? supported
                : "text",
            themes: { light: "github-light", dark: "github-dark-default" },
            defaultColor: false,
          }).tokens;
          const nodes: LexicalNode[] = [];
          tokens.forEach((line, index) => {
            if (index) nodes.push($createLineBreakNode());
            for (const token of line) {
              const style = Object.entries(token.htmlStyle ?? {})
                .map(([key, value]) => `${key}:${value}`)
                .join(";");
              tokenizeRawText(token.content, {
                text: (text) =>
                  nodes.push($createCodeHighlightNode(text).setStyle(style)),
                tab: () => nodes.push($createTabNode()),
                linebreak: () => nodes.push($createLineBreakNode()),
              });
            }
          });
          return nodes;
        },
      };
      editor.update(
        () => {
          unregister = registerCodeHighlighting(editor, tokenizer);
        },
        { tag: HISTORY_MERGE_TAG, onUpdate: drawn },
      );
    };
    let started = false;
    let drawn = () => {};
    const stopWatching = editor.registerMutationListener(
      DocumentCodeNode,
      (mutations) => {
        if (started || ![...mutations.values()].includes("created")) return;
        started = true;
        drawn = holdUntilDrawn();
        start().catch(drawn);
      },
    );
    return () => {
      disposed = true;
      for (const release of holds) release();
      stopWatching();
      unregister?.();
      highlighter?.dispose();
    };
  }, [editor]);
  return null;
}
