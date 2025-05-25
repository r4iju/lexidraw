import { useEffect, useMemo } from "react";
import {
  LexicalCommand,
  createCommand,
  COMMAND_PRIORITY_EDITOR,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";

import {
  SlideNode,
  DEFAULT_SLIDE_DECK_DATA,
} from "../nodes/SlideNode/SlideNode";

export const INSERT_SLIDEDECK_COMMAND: LexicalCommand<void> = createCommand(
  "INSERT_SLIDEDECK_COMMAND",
);

export function SlidePlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!editor.hasNodes([SlideNode])) {
      throw new Error("SlidePlugin: SlideDeckNode not registered on editor");
    }

    return mergeRegister(
      editor.registerCommand(
        INSERT_SLIDEDECK_COMMAND,
        () => {
          editor.update(() => {
            const selection = $getSelection();
            const root = $getRoot();

            const slideDeckNode = SlideNode.$createSlideNode(
              DEFAULT_SLIDE_DECK_DATA,
            );

            if ($isRangeSelection(selection)) {
              const { anchor } = selection;
              const anchorNode = anchor.getNode();
              const anchorNodeParent = anchorNode.getParent();

              if (
                anchorNodeParent === root &&
                anchorNode.is(root.getLastChild()) &&
                anchorNode.getTextContentSize() === 0
              ) {
                anchorNode.replace(slideDeckNode);
              } else {
                anchorNode
                  .getTopLevelElementOrThrow()
                  .insertAfter(slideDeckNode);
              }
            } else {
              root.append(slideDeckNode);
            }

            const newParagraph = $createParagraphNode();
            slideDeckNode.insertAfter(newParagraph);
            newParagraph.select();
          });
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    );
  }, [editor]);

  return null;
}
