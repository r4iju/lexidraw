import React, { useEffect } from "react";
import {
  LexicalCommand,
  createCommand,
  COMMAND_PRIORITY_EDITOR,
  $insertNodes,
  $isRootOrShadowRoot,
  $createParagraphNode,
  $getSelection,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $wrapNodeInElement, mergeRegister } from "@lexical/utils";
import {
  SlideContainerNode,
  SlideParentEditorProvider,
} from "../nodes/SlideNode"; // Adjusted path

/*************************************************************************************************
 * 5. Commands + Plugin to create slides in the *main* Lexical editor.                             *
 *************************************************************************************************/

export const INSERT_SLIDE_COMMAND: LexicalCommand<void> = createCommand(
  "INSERT_SLIDE_COMMAND",
);

export const SlideDeckPlugin: React.FC = () => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!editor.hasNodes([SlideContainerNode])) {
      // This check is important to ensure the node is registered before use.
      // Consider moving node registration to where LexicalComposer is initialized.
      console.error(
        "SlideDeckPlugin: SlideContainerNode not registered on the editor.",
      );
      // Depending on project setup, you might throw an error or register it dynamically if possible and desired.
      // For now, we'll log an error, as dynamic registration can be complex.
      // throw new Error("SlideDeckPlugin: SlideContainerNode not registered");
      return; // Prevent plugin registration if node isn't available.
    }

    return mergeRegister(
      editor.registerCommand(
        INSERT_SLIDE_COMMAND,
        () => {
          editor.update(() => {
            // Ensure updates are wrapped in editor.update()
            const selection = editor.getEditorState().read($getSelection);
            const slide = SlideContainerNode.$create();
            $insertNodes([slide]);
            if ($isRootOrShadowRoot(slide.getParentOrThrow())) {
              // Wrap the slide in a paragraph if it's inserted at the root, common practice.
              $wrapNodeInElement(slide, $createParagraphNode).selectEnd();
            }
            // If you want to auto-focus or do something else after insertion, do it here.
          });
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    );
  }, [editor]);

  /* The provider makes the parent editor reachable for nested editors within any slide */
  return (
    <SlideParentEditorProvider editor={editor}>
      {null}
    </SlideParentEditorProvider>
  );
};
