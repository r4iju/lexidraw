import React, { useEffect, useState, useCallback, ReactNode } from "react";
import {
  LexicalCommand,
  createCommand,
  COMMAND_PRIORITY_EDITOR,
  $insertNodes,
  $isRootOrShadowRoot,
  $createParagraphNode,
  $getRoot,
  NodeKey,
} from "lexical";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $dfs, $wrapNodeInElement, mergeRegister } from "@lexical/utils";
import {
  SlideContainerNode,
  SlideParentEditorProvider,
  ActiveSlideContext,
} from "../nodes/SlideNode/SlideNode";

export const INSERT_SLIDE_COMMAND: LexicalCommand<void> = createCommand(
  "INSERT_SLIDE_COMMAND",
);

export const SlideDeckPlugin: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [editor] = useLexicalComposerContext();
  const [slideKeys, setSlideKeys] = useState<NodeKey[]>([]);
  const [activeKey, setActiveKey] = useState<NodeKey | null>(null);

  /** gather slide keys from current editorState */
  const refreshSlideKeys = useCallback(() => {
    editor.getEditorState().read(() => {
      const keys: NodeKey[] = [];
      const root = $getRoot();
      for (const { node } of $dfs(root)) {
        if (SlideContainerNode.$isSlideContainerNode(node)) {
          keys.push(node.getKey());
        }
      }
      setSlideKeys(keys);
      if ((!activeKey || !keys.includes(activeKey)) && keys.length) {
        setActiveKey(keys[0] as string);
      }
    });
  }, [editor, activeKey]);

  useEffect(() => {
    refreshSlideKeys(); // Initial refresh
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        refreshSlideKeys();
      });
    });
  }, [editor, refreshSlideKeys]);

  /** Command to insert a new slide */
  useEffect(() => {
    if (!editor.hasNodes([SlideContainerNode])) {
      console.error(
        "SlideDeckPlugin: SlideContainerNode not registered on the editor.",
      );
      return;
    }

    return mergeRegister(
      editor.registerCommand(
        INSERT_SLIDE_COMMAND,
        () => {
          editor.update(() => {
            const slide = SlideContainerNode.$create();
            $insertNodes([slide]);
            if ($isRootOrShadowRoot(slide.getParentOrThrow())) {
              $wrapNodeInElement(slide, $createParagraphNode).selectEnd();
            }
          });
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    );
  }, [editor]);

  return (
    <SlideParentEditorProvider editor={editor}>
      <ActiveSlideContext.Provider
        value={{
          activeKey,
          setActiveKey,
          slideKeys,
          deckEditor: editor,
        }}
      >
        {children}
      </ActiveSlideContext.Provider>
    </SlideParentEditorProvider>
  );
};
