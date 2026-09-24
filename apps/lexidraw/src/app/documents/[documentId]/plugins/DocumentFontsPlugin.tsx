import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useState } from "react";
import { observeDocumentFonts } from "~/lib/editor-fonts";
import { FontResources } from "../document-typography";

export function DocumentFontsPlugin({ lang }: { lang?: string }) {
  const [editor] = useLexicalComposerContext();
  const [fonts, setFonts] = useState<string[]>([]);
  // Lexical owns the document; only publish its font list after typing settles.
  useEffect(() => observeDocumentFonts(editor, setFonts), [editor]);
  return <FontResources lang={lang} fonts={fonts} />;
}
