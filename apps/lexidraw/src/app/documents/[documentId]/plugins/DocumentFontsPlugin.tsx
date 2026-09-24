import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useCallback, useSyncExternalStore } from "react";
import { contentFonts } from "~/lib/document-fonts";
import { FontResources } from "../document-typography";

export function DocumentFontsPlugin() {
  const [editor] = useLexicalComposerContext();
  const subscribe = useCallback(
    (changed: () => void) => editor.registerUpdateListener(changed),
    [editor],
  );
  const snapshot = useCallback(() => editor.getEditorState(), [editor]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  return <FontResources fonts={contentFonts(JSON.stringify(state))} />;
}
