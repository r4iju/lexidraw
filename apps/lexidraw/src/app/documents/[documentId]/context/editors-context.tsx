import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  createEditor,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedEditorState as LexicalSerializedEditorState,
  type SerializedRootNode,
  type SerializedLexicalNode,
} from "lexical";
import {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { SlideNode, type SlideElementSpec } from "../nodes/SlideNode/SlideNode";
import { useKeyedSerialization } from "../plugins/LlmChatPlugin/use-serialized-editor-state";
import type {
  KeyedSerializedEditorState,
  SerializedNodeWithKey,
} from "../types";
import { NESTED_EDITOR_NODES } from "../nodes/SlideNode/SlideDeckEditor";

export type EditorRegistryEntry = {
  editor: LexicalEditor;
  keyMap: Map<NodeKey, NodeKey> | null; // originalKey -> newLiveKey
  originalStateRoot: SerializedNodeWithKey | null; // the root of the KeyedSerializedEditorState it was created from
};

type EditorRegistry = {
  registerEditor: (
    id: string,
    editor: LexicalEditor,
    originalStateRoot?: SerializedNodeWithKey,
  ) => void;
  unregisterEditor: (id: string) => void;
  getEditorEntry: (id: string) => EditorRegistryEntry | undefined;
};

const EditorRegistryContext = createContext<EditorRegistry | null>(null);

export const useLexicalTransformation = () => {
  const transformToLexicalSourcedStateRecursive = useCallback(
    (
      keyedNode: SerializedNodeWithKey,
    ): SerializedRootNode<SerializedLexicalNode> => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { key: _key, children, ...lexicalProps } = keyedNode;

      const result = { ...lexicalProps };
      if (children && children.length > 0) {
        result.children = children.map(transformToLexicalSourcedStateRecursive);
      }
      return result as SerializedRootNode<SerializedLexicalNode>;
    },
    [],
  );

  const transformToLexicalSourcedJSON = useCallback(
    (source: KeyedSerializedEditorState): LexicalSerializedEditorState => {
      return {
        root: transformToLexicalSourcedStateRecursive(source.root),
      };
    },
    [transformToLexicalSourcedStateRecursive],
  );

  const getSlideBoxKeyedState = useCallback(
    (
      mainEditor: LexicalEditor,
      deckNodeKey: string,
      slideId: string,
      boxId: string,
    ): KeyedSerializedEditorState | null => {
      let keyedState: KeyedSerializedEditorState | null = null;
      mainEditor.getEditorState().read(() => {
        const slideDeckNode = $getNodeByKey<SlideNode>(deckNodeKey);
        if (!SlideNode.$isSlideDeckNode(slideDeckNode)) return;
        const deckData = slideDeckNode.getData();
        const slide = deckData.slides.find((s) => s.id === slideId);
        if (!slide) return;
        const boxElement = slide.elements.find((el) => el.id === boxId);
        if (boxElement && boxElement.kind === "box") {
          keyedState = boxElement.editorStateJSON;
        }
      });
      if (!keyedState) {
        console.warn(
          `Could not find KeyedSerializedEditorState for ${deckNodeKey}/${slideId}/${boxId}`,
        );
        return null;
      }
      return keyedState;
    },
    [],
  );

  return {
    transformToLexicalSourcedJSON,
    getSlideBoxKeyedState,
  };
};

export const EditorRegistryProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [mainEditor] = useLexicalComposerContext();
  const [editorRegistry, setEditorRegistry] = useState<
    Map<string, EditorRegistryEntry>
  >(() => new Map());
  const { serializeEditorStateWithKeys } = useKeyedSerialization();

  // For headless editors, to manage their update listeners
  const headlessListenersRef = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    if (mainEditor) {
      setEditorRegistry((prev) =>
        new Map(prev).set("main", {
          editor: mainEditor,
          keyMap: null,
          originalStateRoot: null,
        }),
      );
    }
    return () => {
      headlessListenersRef.current.forEach((unregister) => unregister());
      headlessListenersRef.current.clear();
    };
  }, [mainEditor]);

  const persistNestedEditorChanges = useCallback(
    (editorKey: string, nestedEditorInstance: LexicalEditor) => {
      if (!mainEditor || !serializeEditorStateWithKeys) return;
      console.log(
        `[persistNestedEditorChanges] Called for editorKey: ${editorKey}`,
      );

      const pathParts = editorKey.split("/");
      if (pathParts.length !== 3) {
        console.error(
          `[persistNestedEditorChanges] Invalid editorKey format: ${editorKey}`,
        );
        return;
      }
      const [deckNodeKey, slideId, boxId] = pathParts as [
        string,
        string,
        string,
      ];

      const newKeyedState = serializeEditorStateWithKeys(
        nestedEditorInstance.getEditorState(),
      );

      if (!newKeyedState) {
        console.error(
          `[persistNestedEditorChanges] Failed to serialize ${editorKey}. newKeyedState is null/undefined.`,
        );
        return;
      }

      // DETAILED LOG of what is about to be persisted
      console.log(
        `[persistNestedEditorChanges] For ${editorKey}, newKeyedState to be persisted:`,
        JSON.stringify(newKeyedState, null, 2),
      );
      try {
        const firstParagraphChildren =
          newKeyedState.root.children?.[0]?.children;
        console.log(
          `[persistNestedEditorChanges] For ${editorKey}, first paragraph's children in newKeyedState:`,
          JSON.stringify(firstParagraphChildren, null, 2),
        );
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        // ignore if structure is unexpected for this specific log
      }

      mainEditor.update(() => {
        const slideDeckNode = $getNodeByKey<SlideNode>(deckNodeKey);
        if (!SlideNode.$isSlideDeckNode(slideDeckNode)) {
          console.warn(
            `[persistNestedEditorChanges] SlideDeckNode ${deckNodeKey} not found.`,
          );
          return;
        }

        const currentDeckData = slideDeckNode.getData();
        const slideIndex = currentDeckData.slides.findIndex(
          (s) => s.id === slideId,
        );
        if (slideIndex === -1) {
          console.warn(
            `[persistNestedEditorChanges] Slide ${slideId} not found in deck ${deckNodeKey}.`,
          );
          return;
        }

        const targetSlide = currentDeckData.slides[slideIndex];
        if (!targetSlide) return; // Should not happen if slideIndex is valid

        const boxIndex = targetSlide.elements.findIndex(
          (el) => el.id === boxId,
        );
        const targetBoxElement = targetSlide.elements[boxIndex] as
          | Extract<SlideElementSpec, { kind: "box" }>
          | undefined;

        if (!targetBoxElement || targetBoxElement.kind !== "box") {
          console.warn(
            `[persistNestedEditorChanges] Target box ${boxId} on slide ${slideId} not found or not a box.`,
          );
          return;
        }

        if (
          JSON.stringify(targetBoxElement.editorStateJSON) ===
          JSON.stringify(newKeyedState)
        ) {
          console.log(
            `[persistNestedEditorChanges] No logical state change detected for ${editorKey} after stringify comparison. Bailing out of persistence.`,
          );
          return;
        }
        console.log(
          `[persistNestedEditorChanges] Persisting changes for ${editorKey} as states differ.`,
        );

        const newSlides = [...currentDeckData.slides];
        const newElements = [...targetSlide.elements];
        newElements[boxIndex] = {
          ...targetBoxElement,
          editorStateJSON: newKeyedState, // Update with the state from headless editor
          version: (targetBoxElement.version || 0) + 1,
        };
        newSlides[slideIndex] = { ...targetSlide, elements: newElements };
        slideDeckNode.setData({ ...currentDeckData, slides: newSlides });
        console.log(
          `[persistNestedEditorChanges] setData called on main editor for deck ${deckNodeKey} due to changes in nested editor ${editorKey}`,
        );
      });
    },
    [mainEditor, serializeEditorStateWithKeys],
  );

  const { transformToLexicalSourcedJSON, getSlideBoxKeyedState } =
    useLexicalTransformation();

  const buildKeyMapRecursive = useCallback(
    (
      originalNode: SerializedNodeWithKey,
      liveNode: LexicalNode | null, // It might be null if structure mismatches, though ideally not for initial hydration
      map: Map<NodeKey, NodeKey>,
    ): void => {
      if (!liveNode) return; // Cannot map if live counterpart doesn't exist

      map.set(originalNode.key, liveNode.getKey());

      if (
        $isElementNode(liveNode) &&
        originalNode.children &&
        originalNode.children.length > 0
      ) {
        const liveChildren = liveNode.getChildren();
        for (let i = 0; i < originalNode.children.length; i++) {
          const originalChild = originalNode.children[i];
          if (originalChild && liveChildren[i]) {
            buildKeyMapRecursive(
              originalChild,
              liveChildren[i] as LexicalNode,
              map,
            );
          }
        }
      }
    },
    [],
  );

  const getEditorEntryCb = useCallback(
    (id: string): EditorRegistryEntry | undefined => {
      if (editorRegistry.has(id)) {
        return editorRegistry.get(id);
      }

      // If not a live registered editor, try to create a headless one for a slide box
      const pathParts = id.split("/");
      if (pathParts.length === 3 && mainEditor) {
        const [deckNodeKey, slideId, boxId] = pathParts as [
          string,
          string,
          string,
        ];
        const originalKeyedState = getSlideBoxKeyedState(
          mainEditor,
          deckNodeKey,
          slideId,
          boxId,
        );

        if (!originalKeyedState) {
          console.warn(
            `No original state found for headless ${id}, cannot create.`,
          );
          return undefined;
        }

        const lexicalCompatibleJSON =
          transformToLexicalSourcedJSON(originalKeyedState);

        const headlessEditor = createEditor({
          nodes: NESTED_EDITOR_NODES,
          onError: (error) =>
            console.error(`Headless editor error for ${id}:`, error),
        });

        try {
          const initialEditorState = headlessEditor.parseEditorState(
            lexicalCompatibleJSON,
          );
          headlessEditor.setEditorState(initialEditorState);
        } catch (e) {
          console.error(
            `Failed to parse/set EditorState for headless ${id}:`,
            e,
            lexicalCompatibleJSON,
          );
          return undefined;
        }

        const keyMap = new Map<NodeKey, NodeKey>();
        headlessEditor.getEditorState().read(() => {
          buildKeyMapRecursive(originalKeyedState.root, $getRoot(), keyMap);
        });

        // Setup auto-persistence for this headless editor
        if (headlessListenersRef.current.has(id)) {
          headlessListenersRef.current.get(id)?.(); // Clear previous listener if any
        }
        const unregisterListener = headlessEditor.registerUpdateListener(
          ({ editorState, prevEditorState }) => {
            const currentEditorStateJSON = editorState.toJSON();
            const prevEditorStateJSON = prevEditorState.toJSON();

            // Short-circuit if states are identical string-wise (basic check)
            const currentStr = JSON.stringify(currentEditorStateJSON);
            const prevStr = JSON.stringify(prevEditorStateJSON);

            if (currentStr === prevStr) {
              console.log(
                `[EditorRegistry Listener - SKIPPING PERSIST] Editor ID: ${id}. Current and prev states are identical string-wise.`,
              );
              return;
            }

            console.log(
              `[EditorRegistry Listener - PERSISTING] Editor ID: ${id}. States differ.`,
            );
            // For debugging, you can log the differences or parts of the states:
            // console.log(`[EditorRegistry Listener] Prev Editor State for ${id}:`, prevStr.substring(0, 300));
            // console.log(`[EditorRegistry Listener] Curr Editor State for ${id}:`, currentStr.substring(0, 300));

            persistNestedEditorChanges(id, headlessEditor);
          },
        );
        headlessListenersRef.current.set(id, unregisterListener);

        const entry: EditorRegistryEntry = {
          editor: headlessEditor,
          keyMap,
          originalStateRoot: originalKeyedState.root,
        };
        // DO NOT add to editorRegistry state, it's ephemeral and managed by headlessListenersRef for persistence
        return entry;
      }
      return undefined;
    },
    [
      buildKeyMapRecursive,
      editorRegistry,
      getSlideBoxKeyedState,
      mainEditor,
      persistNestedEditorChanges,
      transformToLexicalSourcedJSON,
    ],
  );

  const registerEditorCb = useCallback(
    (
      id: string,
      editorToRegister: LexicalEditor,
      originalStateRoot?: SerializedNodeWithKey,
    ) => {
      if (headlessListenersRef.current.has(id)) {
        headlessListenersRef.current.get(id)?.();
        headlessListenersRef.current.delete(id);
      }
      // For live editors, keyMap might be null if not initialized from specific keyed state or needs to be built by consumer
      // Or, if originalStateRoot is provided, we could potentially build a keyMap here too.
      // For now, keeping it simple: live editors registered this way don't automatically get a keyMap from the registry.
      // The component registering it (e.g. SlideDeckEditor) would manage its own key mapping if needed.
      setEditorRegistry((prev) =>
        new Map(prev).set(id, {
          editor: editorToRegister,
          keyMap: null,
          originalStateRoot: originalStateRoot ?? null,
        }),
      );
    },
    [],
  );

  const unregisterEditorCb = useCallback((id: string) => {
    if (headlessListenersRef.current.has(id)) {
      headlessListenersRef.current.get(id)?.();
      headlessListenersRef.current.delete(id);
    }
    setEditorRegistry((prev) => {
      const newMap = new Map(prev);
      newMap.delete(id);
      return newMap;
    });
  }, []);

  const registryApi = useMemo<EditorRegistry>(
    () => ({
      registerEditor: registerEditorCb,
      unregisterEditor: unregisterEditorCb,
      getEditorEntry: getEditorEntryCb,
    }),
    [registerEditorCb, unregisterEditorCb, getEditorEntryCb],
  );

  return (
    <EditorRegistryContext.Provider value={registryApi}>
      {children}
    </EditorRegistryContext.Provider>
  );
};

export const useEditorRegistry = () => {
  const context = useContext(EditorRegistryContext);
  if (!context) {
    throw new Error(
      "useEditorRegistry must be used within an EditorRegistryProvider",
    );
  }
  return context;
};
