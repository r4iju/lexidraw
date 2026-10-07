import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { LexicalEditor, NodeKey } from "lexical";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { SerializedNodeWithKey } from "../types";

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

export const EditorRegistryProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [mainEditor] = useLexicalComposerContext();
  const [editorRegistry, setEditorRegistry] = useState<
    Map<string, EditorRegistryEntry>
  >(() => new Map());

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
  }, [mainEditor]);

  const getEditorEntryCb = useCallback(
    (id: string): EditorRegistryEntry | undefined => editorRegistry.get(id),
    [editorRegistry],
  );

  const registerEditorCb = useCallback(
    (
      id: string,
      editorToRegister: LexicalEditor,
      originalStateRoot?: SerializedNodeWithKey,
    ) => {
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
