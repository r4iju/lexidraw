import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNodeByKey,
  $isTextNode,
  type LexicalEditor,
  TextNode,
} from "lexical";
import { useEffect } from "react";

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Marks text holding kana as Japanese when the document is in another
 * language. The browser only breaks Japanese between phrases, rather than
 * between any two characters, in text it knows to be Japanese. The mark is on
 * the text's element alone, never in the document.
 */
export function registerTextLanguage(
  editor: LexicalEditor,
  documentLang: string | undefined,
): () => void {
  const japanese = /^ja\b/i.test(documentLang ?? "");
  return editor.registerMutationListener(
    TextNode,
    (mutations) =>
      editor.getEditorState().read(() => {
        for (const [key, mutation] of mutations) {
          if (mutation === "destroyed") continue;
          const node = $getNodeByKey(key);
          const element = editor.getElementByKey(key);
          if (!$isTextNode(node) || !element) continue;
          if (!japanese && KANA.test(node.getTextContent()))
            element.lang = "ja";
          else element.removeAttribute("lang");
        }
      }),
    { skipInitialization: false },
  );
}

export function TextLanguagePlugin({ lang }: { lang?: string }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => registerTextLanguage(editor, lang), [editor, lang]);
  return null;
}
