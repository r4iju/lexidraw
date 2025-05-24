import React, { useEffect, useState, useCallback, ReactNode } from "react";
import {
  LexicalCommand,
  createCommand,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  NodeKey,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  SELECTION_CHANGE_COMMAND,
  $createParagraphNode,
} from "lexical";
import { $dfs, $findMatchingParent } from "@lexical/utils";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import { SlidePageNode } from "../nodes/SlideNode/SlidePageNode";
import {
  ActiveSlideContext,
  SlideModalProvider,
} from "../nodes/SlideNode/slide-context";
import { SlideDeckNode } from "../nodes/SlideNode/SlideDeckNode";
import { SlideControls } from "../nodes/SlideNode/slide-controls";

export const INSERT_SLIDEDECK_COMMAND: LexicalCommand<void> = createCommand(
  "INSERT_SLIDEDECK_COMMAND",
);

export const INSERT_PAGE_COMMAND: LexicalCommand<void> = createCommand(
  "INSERT_PAGE_COMMAND",
);

export const SlidePlugin: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [editor] = useLexicalComposerContext();
  const [slideKeys, setSlideKeys] = useState<NodeKey[]>([]);
  const [activeKey, _setActiveKeyInternal] = useState<NodeKey | null>(null);
  const [visibleKey, setVisibleKey] = useState<NodeKey | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null,
  );
  const [deckElement, setDeckElement] = useState<HTMLElement | null>(null);

  const setActiveKey = useCallback(
    (key: NodeKey | null, newSelectedElementId: string | null = null) => {
      if (key === null) {
        setDeckElement(null);
      } else {
        // When a slide becomes active, it must also become the visible one.
        setVisibleKey(key);
      }
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
    [setDeckElement],
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

      setSlideKeys((prevKeys) => {
        if (
          prevKeys.length === keys.length &&
          prevKeys.every((key, index) => key === keys[index])
        ) {
          // no changes, return previous array
          return prevKeys;
        }
        return keys;
      });

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

      setVisibleKey((prevVisibleKey) => {
        if (prevVisibleKey && keys.includes(prevVisibleKey)) {
          return prevVisibleKey; // Keep the current visible slide if it still exists
        }
        return keys.length > 0 && keys[0] ? keys[0] : null; // Otherwise, default to the first slide
      });
    });
  }, [editor]);

  useEffect(() => {
    refreshSlideKeys();
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

  // Effect to handle clicks on the deck background for deselecting elements
  useEffect(() => {
    const editorRootElem = editor.getRootElement();
    if (!editorRootElem) return;

    // Query for the deck element within the editor's root
    const deckMainElement = editorRootElem.querySelector<HTMLElement>(
      ".slide-deck-lexical-node",
    );

    if (deckMainElement) {
      const handleDeckBackgroundClick = (event: MouseEvent) => {
        // Check if the click target is the deck itself.
        // Clicks on children (slides, elements within slides, controls) should have their own
        // handlers that call event.stopPropagation(), meaning this listener should primarily catch
        // clicks directly on the deck's background area.
        if (event.target === deckMainElement) {
          if (selectedElementId !== null) {
            setSelectedElementId(null); // Deselect the element, keep slide active
          }
        }
      };

      deckMainElement.addEventListener("click", handleDeckBackgroundClick);
      return () => {
        deckMainElement.removeEventListener("click", handleDeckBackgroundClick);
      };
    }
    // Adding selectedElementId and setSelectedElementId to dependencies
    // ensures the listener uses the latest state if it were to be re-bound, though typically
    // this effect binds once per editor/deck presence.
  }, [editor, selectedElementId, setSelectedElementId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const editorElement = editor.getRootElement();

      // If the editor isn't mounted yet, do nothing.
      if (!editorElement) {
        return;
      }

      // If the click is on any modal (identified by role="dialog"),
      // do not proceed with deactivating the active slide.
      // The modal itself will handle its close operations.
      if (target.closest('[role="dialog"]')) {
        return;
      }

      // Define what counts as being "inside" the slide UI.
      // The two key components are the deck itself and our external controls.
      const isClickOnSlideUI = target.closest(
        ".slide-deck-lexical-node, .slide-controls",
      );

      // If the click is NOT on any slide-related UI (and not on a modal),
      // we should deselect.
      if (!isClickOnSlideUI) {
        // Only update state if a slide is currently active to avoid needless re-renders.
        if (activeKey !== null) {
          setActiveKey(null, null);
        }
      }
    };

    document.addEventListener("click", handleClickOutside, true);
    return () => {
      document.removeEventListener("click", handleClickOutside, true);
    };
  }, [editor, activeKey, setActiveKey]);

  useEffect(() => {
    const deck = document.querySelector<HTMLElement>(
      ".slide-deck-lexical-node",
    );
    if (!deck) return;
    const index = visibleKey ? slideKeys.indexOf(visibleKey) : 0;
    if (index === -1) return; // no visible slide, do nothing
    const target = index * deck.clientWidth;
    deck.scrollTo({ left: target, behavior: "smooth" });
  }, [visibleKey, slideKeys]);

  return (
    <ActiveSlideContext.Provider
      value={{
        activeKey,
        visibleKey,
        setActiveKey,
        slideKeys,
        deckEditor: editor,
        selectedElementId,
        setSelectedElementId,
        setDeckElement,
      }}
    >
      <SlideModalProvider>
        {children}
        <SlideControls deckElement={deckElement} />
      </SlideModalProvider>
    </ActiveSlideContext.Provider>
  );
};
