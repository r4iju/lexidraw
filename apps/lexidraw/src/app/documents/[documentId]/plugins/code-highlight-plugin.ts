import { $createCodeHighlightNode, CodeNode } from "@lexical/code";
import { registerCodeHighlighting, type Tokenizer } from "@lexical/code-shiki";
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
import {
  bundledLanguages,
  createHighlighter,
  type BundledLanguage,
} from "shiki";

export default function CodeHighlightPlugin(): null {
  const [editor] = useLexicalComposerContext();
  // Shiki owns tokenization; Lexical retains selection while replacing token nodes.
  useEffect(() => {
    let disposed = false;
    let unregister: (() => void) | undefined;
    const pending = new Set<string>();
    const ready = createHighlighter({
      themes: ["github-light", "github-dark-default"],
      langs: [],
    });
    void ready.then((highlighter) => {
      if (disposed) {
        highlighter.dispose();
        return;
      }
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
            !highlighter.getLoadedLanguages().includes(supported) &&
            !pending.has(supported)
          ) {
            pending.add(supported);
            void highlighter.loadLanguage(supported).then(() => {
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
          const tokens = highlighter.codeToTokens(node.getTextContent(), {
            lang:
              supported && highlighter.getLoadedLanguages().includes(supported)
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
    });
    return () => {
      disposed = true;
      unregister?.();
      void ready.then((h) => h.dispose());
    };
  }, [editor]);
  return null;
}
