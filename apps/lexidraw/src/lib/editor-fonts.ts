import type { LexicalEditor } from "lexical";
import { contentFonts } from "./document-fonts";

export function observeDocumentFonts(
  editor: LexicalEditor,
  changed: (fonts: string[]) => void,
  delay = 250,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous = "";
  const scan = () => {
    const fonts = contentFonts(JSON.stringify(editor.getEditorState()));
    const key = JSON.stringify(fonts.sort());
    if (key !== previous) {
      previous = key;
      changed(fonts);
    }
  };
  scan();
  const unregister = editor.registerUpdateListener(
    ({ dirtyElements, dirtyLeaves }) => {
      if (!dirtyElements.size && !dirtyLeaves.size) return;
      clearTimeout(timer);
      timer = setTimeout(scan, delay);
    },
  );
  return () => {
    clearTimeout(timer);
    unregister();
  };
}
