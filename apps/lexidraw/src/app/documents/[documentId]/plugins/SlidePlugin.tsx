import React, { useEffect, useState, useCallback, ReactNode } from "react";
import {
  LexicalCommand,
  createCommand,
  COMMAND_PRIORITY_EDITOR,
  $insertNodes,
  NodeKey,
  $getNodeByKey,
  $getRoot,
} from "lexical";
import { $dfs } from "@lexical/utils";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import { SlidePageNode as SlidePageNode } from "../nodes/SlideNode/SlidePageNode";
import {
  SlideParentEditorProvider,
  ActiveSlideContext,
} from "../nodes/SlideNode/slide-context";
import { SlideDeckNode } from "../nodes/SlideNode/SlideDeckNode";

export const INSERT_SLIDEDECK_COMMAND: LexicalCommand<void> = createCommand(
  "INSERT_SLIDEDECK_COMMAND",
);

export const INSERT_PAGE_COMMAND: LexicalCommand<void> = createCommand(
  "INSERT_PAGE_COMMAND",
);

export const SlideDeckPlugin: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [editor] = useLexicalComposerContext();
  const [slideKeys, setSlideKeys] = useState<NodeKey[]>([]);
  const [activeKey, setActiveKey] = useState<NodeKey | null>(null);

  useEffect(() => {
    console.log("activeKey", activeKey);
    console.log("slideKeys", slideKeys);
  }, [activeKey, slideKeys]);

  const refreshSlideKeys = useCallback(() => {
    editor.getEditorState().read(() => {
      const keys: NodeKey[] = [];
      for (const { node } of $dfs($getRoot())) {
        if (SlidePageNode.$isSlideContainerNode(node)) keys.push(node.getKey());
      }
      setSlideKeys(keys);
      setActiveKey((prev) =>
        prev && keys.includes(prev) ? prev : (keys[0] ?? null),
      );
    });
  }, [editor]);

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
    if (!editor.hasNodes([SlidePageNode])) {
      console.error(
        "SlideDeckPlugin: SlideContainerNode not registered on the editor.",
      );
      return;
    }

    return mergeRegister(
      editor.registerCommand(
        INSERT_SLIDEDECK_COMMAND,
        () => {
          editor.update(() => {
            const deck = SlideDeckNode.$create();
            const page1 = SlidePageNode.$create();
            deck.append(page1);
            $insertNodes([deck]);
            page1.selectStart();
            setActiveKey(page1.getKey());
          });
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        INSERT_PAGE_COMMAND,
        () => {
          editor.update(() => {
            if (!activeKey) return;
            const activePage = $getNodeByKey(activeKey);
            if (SlidePageNode.$isSlideContainerNode(activePage)) {
              const deck = activePage.getParent();
              if (SlideDeckNode.$isSlideDeckNode(deck)) {
                const newPage = SlidePageNode.$create();
                activePage.insertAfter(newPage);
                newPage.selectStart();
                setActiveKey(newPage.getKey());
              }
            }
          });

          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    );
  }, [editor, activeKey]);

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
