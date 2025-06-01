import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, LexicalEditor } from "lexical";
import {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { createHeadlessEditorForSlideBox } from "../nodes/SlideNode/SlideDeckEditor";
import { SlideDeckData, SlideNode } from "../nodes/SlideNode/SlideNode";

interface EditorRegistry {
  registerEditor: (id: string, editor: LexicalEditor) => void;
  unregisterEditor: (id: string) => void;
  getEditor: (id: string) => LexicalEditor;
}

const EditorRegistryContext = createContext<EditorRegistry | null>(null);

export const EditorRegistryProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [mainEditor] = useLexicalComposerContext();
  const [editorRegistry, setEditorRegistry] = useState<
    Map<string, LexicalEditor>
  >(new Map());

  const headlessListenersRef = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    if (mainEditor) {
      setEditorRegistry((prev) => new Map(prev).set("main", mainEditor));
    }

    return () => {
      headlessListenersRef.current.forEach((unregister) => unregister());
      headlessListenersRef.current.clear();
    };
  }, [mainEditor]);

  const persistNestedEditorChanges = useCallback(
    (editorKey: string, nestedEditorInstance: LexicalEditor) => {
      if (!mainEditor) {
        console.error(
          "[persistNestedEditorChanges] Main editor is not available.",
        );
        return;
      }
      const pathParts = editorKey.split("/");
      if (pathParts.length !== 3) {
        console.error(
          // Changed to error as this is a significant issue
          `[persistNestedEditorChanges] Invalid editorKey format: ${editorKey}. Expected deckNodeKey/slideId/boxId.`,
        );
        return;
      }
      const [deckNodeKey, slideId, boxId] = pathParts as [
        string,
        string,
        string,
      ];

      const newNestedEditorStateJSON = nestedEditorInstance
        .getEditorState()
        .toJSON();

      mainEditor.update(() => {
        const slideDeckNode = $getNodeByKey<SlideNode>(deckNodeKey);
        if (!SlideNode.$isSlideDeckNode(slideDeckNode)) {
          console.error(
            `[persistNestedEditorChanges] SlideDeckNode '${deckNodeKey}' not found or is not a SlideNode.`,
          );
          return;
        }

        const currentDeckData = slideDeckNode.getData();
        const slideIndex = currentDeckData.slides.findIndex(
          (s) => s.id === slideId,
        );

        if (slideIndex === -1) {
          console.error(
            `[persistNestedEditorChanges] Slide '${slideId}' not found in deck '${deckNodeKey}'.`,
          );
          return;
        }

        const targetSlide = currentDeckData.slides[slideIndex];
        if (!targetSlide) {
          console.error(
            `[persistNestedEditorChanges] Target slide data for '${slideId}' is unexpectedly missing.`,
          );
          return;
        }

        const boxIndex = targetSlide.elements.findIndex(
          (el) => el.id === boxId,
        );
        const targetBoxElement = targetSlide.elements[boxIndex];

        if (!targetBoxElement || targetBoxElement.kind !== "box") {
          console.error(
            `[persistNestedEditorChanges] Box '${boxId}' not found or not a box in slide '${slideId}'. Current elements:`,
            targetSlide.elements,
          );
          return;
        }

        // Optimization: Only update if the content has actually changed
        const currentBoxStateString = JSON.stringify(
          targetBoxElement.editorStateJSON,
        );
        const newBoxStateString = JSON.stringify(newNestedEditorStateJSON);

        if (currentBoxStateString === newBoxStateString) {
          // console.log(`[persistNestedEditorChanges] No actual content change for ${editorKey}. Skipping update.`);
          return;
        }

        const newSlides = [...currentDeckData.slides];
        const newElements = [...targetSlide.elements];

        newElements[boxIndex] = {
          ...targetBoxElement,
          editorStateJSON: newNestedEditorStateJSON,
          version: (targetBoxElement.version || 0) + 1,
        };
        newSlides[slideIndex] = {
          ...targetSlide,
          elements: newElements,
        };
        const newDeckData: SlideDeckData = {
          ...currentDeckData,
          slides: newSlides,
        };

        slideDeckNode.setData(newDeckData);
        console.log(
          `[EditorRegistryProvider] Automatically persisted changes from nested editor '${editorKey}' to SlideNode '${deckNodeKey}'.`,
        );
      });
    },
    [mainEditor],
  );

  const getEditorCb = useCallback(
    (id: string): LexicalEditor => {
      if (id === "main" && mainEditor) {
        return mainEditor;
      }

      let editorInstance = editorRegistry.get(id);

      if (editorInstance) {
        return editorInstance;
      }

      // If not a live registered editor, try to create a headless one
      console.log(
        `[EditorRegistry] Headless instance requested for: ${id}. Creating...`,
      );
      const pathParts = id.split("/");
      if (pathParts.length !== 3) {
        throw new Error(
          `Invalid editor id for headless creation: ${id}. Expected deckKey/slideId/boxId.`,
        );
      }
      const [deckNodeKey, slideId, boxId] = pathParts as [
        string,
        string,
        string,
      ];

      if (!mainEditor) {
        throw new Error(
          "Main editor is not available for creating headless editor.",
        );
      }

      editorInstance = createHeadlessEditorForSlideBox(mainEditor, {
        deckNodeKey,
        slideId,
        boxId,
      });

      if (headlessListenersRef.current.has(id)) {
        headlessListenersRef.current.get(id)?.();
      }

      const unregisterListener = editorInstance.registerUpdateListener(
        ({
          editorState,
          prevEditorState,
          // dirtyElements,
          // dirtyLeaves
        }) => {
          // only persist if there are actual content changes, not just selection.
          // `dirtyElements` and `dirtyLeaves` can help determine this.
          // A simple check is if the serialized JSON differs.
          const newJson = JSON.stringify(editorState.toJSON());
          const prevJson = JSON.stringify(prevEditorState.toJSON());

          if (newJson !== prevJson) {
            console.debug(
              `[EditorRegistry] Update listener triggered for headless: ${id}. Propagating changes.`,
            );
            persistNestedEditorChanges(id, editorInstance as LexicalEditor);
          } else {
            console.debug(
              `[EditorRegistry] Update listener for headless ${id}: no JSON change (likely selection).`,
            );
          }
        },
      );
      headlessListenersRef.current.set(id, unregisterListener);
      // --- End of auto-persistence setup ---

      // IMPORTANT: Do NOT add this dynamically created headless editor to `editorRegistry` state.
      // `editorRegistry` state is for live editors managed by React components.
      // Headless editors are ephemeral; if needed again, they are recreated.
      // Their listeners are managed via `headlessListenersRef`.

      return editorInstance;
    },
    [editorRegistry, mainEditor, persistNestedEditorChanges],
  );

  const registerEditorCb = useCallback(
    (id: string, editorToRegister: LexicalEditor) => {
      // if a headless listener exists for this ID, it means a headless instance was created before.
      // now that a live editor is being registered, the headless listener is no longer needed.
      if (headlessListenersRef.current.has(id)) {
        headlessListenersRef.current.get(id)?.();
        headlessListenersRef.current.delete(id);
      }
      setEditorRegistry((prev) => new Map(prev).set(id, editorToRegister));
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
      getEditor: getEditorCb,
    }),
    [registerEditorCb, unregisterEditorCb, getEditorCb],
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
