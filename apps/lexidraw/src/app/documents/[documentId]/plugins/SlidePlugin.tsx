import React, { useEffect, useState, useCallback, ReactNode } from "react";
import {
  LexicalCommand,
  createCommand,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW, // For SELECTION_CHANGE_COMMAND
  NodeKey,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  SELECTION_CHANGE_COMMAND,
  $createParagraphNode, // For adding paragraph after deck
} from "lexical";
import { $dfs, $findMatchingParent } from "@lexical/utils"; // $findMatchingParent
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import { SlidePageNode } from "../nodes/SlideNode/SlidePageNode";
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
  const [activeKey, _setActiveKeyInternal] = useState<NodeKey | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null,
  );

  const setActiveKey = useCallback(
    (key: NodeKey | null, newSelectedElementId: string | null = null) => {
      _setActiveKeyInternal((currentActiveKey) => {
        if (currentActiveKey !== key) {
          setSelectedElementId(newSelectedElementId);
        } else {
          if (newSelectedElementId !== undefined) {
            setSelectedElementId(newSelectedElementId);
          }
        }
        return key;
      });
    },
    [],
  );

  const refreshSlideKeys = useCallback(() => {
    editor.getEditorState().read(() => {
      const keys: NodeKey[] = [];
      const root = $getRoot();
      const deckNodes = root
        .getChildren()
        .filter(SlideDeckNode.$isSlideDeckNode);

      deckNodes.forEach((deckNode) => {
        deckNode.getChildren().forEach((node) => {
          if (SlidePageNode.$isSlidePageNode(node)) {
            keys.push(node.getKey());
          }
        });
      });

      if (keys.length === 0 && deckNodes.length === 0) {
        // Only DFS if no decks found
        for (const { node } of $dfs(root)) {
          if (SlidePageNode.$isSlidePageNode(node)) keys.push(node.getKey());
        }
      }

      setSlideKeys(keys);
      _setActiveKeyInternal((prevActiveKey) => {
        if (prevActiveKey && keys.includes(prevActiveKey)) {
          return prevActiveKey;
        }
        const newActiveKey = keys.length && keys[0] ? keys[0] : null;
        if (newActiveKey !== prevActiveKey) {
          setSelectedElementId(null);
        }
        return newActiveKey;
      });
    });
  }, [editor]);

  useEffect(() => {
    refreshSlideKeys();
    const unregisterUpdate = editor.registerUpdateListener(
      ({ editorState }) => {
        // Avoid refreshSlideKeys on every minor change if possible.
        // This can be performance intensive. Consider specific triggers.
        // For now, let's assume it's needed for dynamic slide addition/removal.
        editorState.read(() => {
          refreshSlideKeys();
        });
      },
    );
    // More targeted refresh:
    const unregisterMutation = editor.registerMutationListener(
      SlideDeckNode,
      () => refreshSlideKeys(),
    );
    const unregisterPageMutation = editor.registerMutationListener(
      SlidePageNode,
      () => refreshSlideKeys(),
    );

    return () => {
      unregisterUpdate();
      unregisterMutation();
      unregisterPageMutation();
    };
  }, [editor, refreshSlideKeys]);

  useEffect(() => {
    if (!editor.hasNodes([SlidePageNode, SlideDeckNode])) {
      console.error(
        "SlideDeckPlugin: SlidePageNode or SlideDeckNode not registered.",
      );
      return;
    }

    return mergeRegister(
      editor.registerCommand(
        INSERT_SLIDEDECK_COMMAND,
        () => {
          editor.update(() => {
            const root = $getRoot();
            // Optional: Prevent multiple decks if desired
            // if (root.getChildren().some(SlideDeckNode.$isSlideDeckNode)) {
            //   return true;
            // }
            const deck = SlideDeckNode.$create();
            const page1 = SlidePageNode.$create();
            deck.append(page1);
            root.append(deck);

            // Add a paragraph after the deck if it's the last child
            if (deck.is(root.getLastChild())) {
              const newParagraph = $createParagraphNode();
              deck.insertAfter(newParagraph);
              // Optionally select the new paragraph to allow immediate typing
              // newParagraph.select(); // This might move focus away from the slide
            }

            setActiveKey(page1.getKey(), null);
            // Lexical selection on the page might be good for focus
            // page1.selectStart();
          });
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        INSERT_PAGE_COMMAND,
        () => {
          editor.update(() => {
            let targetDeck: SlideDeckNode | null = null;
            if (activeKey) {
              const activePageNode = $getNodeByKey(activeKey);
              if (SlidePageNode.$isSlidePageNode(activePageNode)) {
                targetDeck = activePageNode.getParent<SlideDeckNode>();
              }
            } else {
              const root = $getRoot();
              targetDeck =
                (root
                  .getChildren()
                  .find(SlideDeckNode.$isSlideDeckNode) as SlideDeckNode) ||
                null;
            }

            if (SlideDeckNode.$isSlideDeckNode(targetDeck)) {
              const newPage = SlidePageNode.$create();
              const activePageNode = activeKey
                ? $getNodeByKey(activeKey)
                : null;

              if (SlidePageNode.$isSlidePageNode(activePageNode)) {
                activePageNode.insertAfter(newPage);
              } else {
                // Append to deck if no active page or active page not found
                targetDeck.append(newPage);
              }
              setActiveKey(newPage.getKey(), null);
              // newPage.selectStart();
            } else if (!targetDeck) {
              console.warn("No SlideDeckNode found to add a page to.");
            }
          });
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      // Listen to selection changes to deselect active slide if selection moves out
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          const selection = $getSelection();
          let isInSlideContext = false;

          if ($isRangeSelection(selection)) {
            const anchorNode = selection.anchor.getNode();
            const focusNode = selection.focus.getNode();
            if (
              $findMatchingParent(
                anchorNode,
                (n) =>
                  SlidePageNode.$isSlidePageNode(n) ||
                  SlideDeckNode.$isSlideDeckNode(n),
              ) ||
              $findMatchingParent(
                focusNode,
                (n) =>
                  SlidePageNode.$isSlidePageNode(n) ||
                  SlideDeckNode.$isSlideDeckNode(n),
              )
            ) {
              isInSlideContext = true;
            }
          } else if ($isNodeSelection(selection)) {
            const nodes = selection.getNodes();
            if (
              nodes.some(
                (node) =>
                  SlidePageNode.$isSlidePageNode(node) ||
                  SlideDeckNode.$isSlideDeckNode(node) ||
                  $findMatchingParent(node, (n) =>
                    SlideDeckNode.$isSlideDeckNode(n),
                  ),
              )
            ) {
              isInSlideContext = true;
            }
          }

          // If selection is outside slide context, just deselect any currently selected element
          // on the active slide. DO NOT change the activeKey itself here.
          if (!isInSlideContext && selectedElementId !== null) {
            // Check selectedElementId too
            // console.log("Selection moved outside slide context, deselecting element.");
            setSelectedElementId(null);
          }
          // Note: activeKey is NOT changed to null here.
          // This means the current slide remains in view, but no specific element on it is "selected"
          // if the focus/selection moves outside.

          return false; // Allow other selection change handlers to run
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, activeKey, setActiveKey, refreshSlideKeys, selectedElementId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const editorElement = editor.getRootElement();

      // Check if click is outside the editor entirely or specific slide UI elements
      if (
        (editorElement && !editorElement.contains(target)) || // Clicked outside the editor
        !target.closest(
          // Clicked inside editor, but not on slide-related elements
          ".slide-deck-lexical-node, .slide-component-root, .slide-element-draggable, .slide-controls, .slide-element-image, .lexical-nested-content-editable",
        )
      ) {
        // If the SELECTION_CHANGE_COMMAND handles activeKey=null,
        // this might only need to handle selectedElementId.
        // However, SELECTION_CHANGE might not fire for all "outside" clicks if selection doesn't change (e.g. clicking body)
        // So, it's safer to potentially deselect both here if the click is truly "outside".
        if (activeKey !== null) {
          // console.log("Global click outside detected, deselecting active slide and element.");
          // setActiveKey(null, null); // This might be too aggressive if SELECTION_CHANGE handles it
        }
        // Always deselect element if click is outside its specific context
        setSelectedElementId(null);
      }
    };

    document.addEventListener("click", handleClickOutside, true);
    return () => {
      document.removeEventListener("click", handleClickOutside, true);
    };
  }, [editor, activeKey, setActiveKey, setSelectedElementId]); // Added setActiveKey dependency

  return (
    <SlideParentEditorProvider editor={editor}>
      <ActiveSlideContext.Provider
        value={{
          activeKey,
          setActiveKey,
          slideKeys,
          deckEditor: editor,
          selectedElementId,
          setSelectedElementId,
        }}
      >
        {children}
      </ActiveSlideContext.Provider>
    </SlideParentEditorProvider>
  );
};
