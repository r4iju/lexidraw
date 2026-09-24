import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import { observeDocumentFonts } from "./editor-fonts";

test("font resources coalesce typing and stop observing on unmount", async () => {
  const editor = createHeadlessEditor({
    namespace: "fonts",
    onError: (error) => {
      throw error;
    },
  });
  const seen: string[][] = [];
  const stop = observeDocumentFonts(editor, (fonts) => seen.push(fonts), 30);
  for (const family of ["Open Sans", "Inter", "Noto Sans JP"]) {
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append(
              $createTextNode("Text").setStyle(`font-family: ${family}`),
            ),
          );
      },
      { discrete: true },
    );
  }
  expect(seen).toEqual([[]]);
  await Bun.sleep(60);
  expect(seen).toEqual([[], ["Noto Sans JP"]]);
  editor.update(
    () => {
      $getRoot().clear();
    },
    { discrete: true },
  );
  stop();
  await Bun.sleep(60);
  expect(seen).toHaveLength(2);
});
