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

export default function CodeHighlightPlugin(): null {
  const [editor] = useLexicalComposerContext();
  // Shiki owns tokenization; Lexical retains selection while replacing token nodes.
  useEffect(() => {
    let disposed = false;
    let unregister: (() => void) | undefined;
    let highlighter: Highlighter | undefined;
    const pending = new Set<string>();
    // Shiki is large, so it loads with the first code block, not the editor.
    const start = async () => {
      const [
        { bundledLanguages, createHighlighter },
        { registerCodeHighlighting },
      ] = await Promise.all([import("shiki"), import("@lexical/code-shiki")]);
      if (disposed) return;
      const loaded = await createHighlighter({
        themes: ["github-light", "github-dark-default"],
        langs: [],
      });
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
            void loaded.loadLanguage(supported).then(() => {
              if (!disposed)
                editor.update(
                  () => {
                    for (const current of $nodesOfType(CodeNode)) {
                      if (
                        current.getLanguage()?.replace(/^diff-/, "") ===
                        supported
                      )
                        current.markDirty();
                    }
                  },
                  { tag: HISTORY_MERGE_TAG },
                );
            });
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
        { tag: HISTORY_MERGE_TAG },
      );
    };
    let started = false;
    const stopWatching = editor.registerMutationListener(
      DocumentCodeNode,
      (mutations) => {
        if (started || ![...mutations.values()].includes("created")) return;
        started = true;
        void start();
      },
    );
    return () => {
      disposed = true;
      stopWatching();
      unregister?.();
      highlighter?.dispose();
    };
  }, [editor]);
  return null;
}
