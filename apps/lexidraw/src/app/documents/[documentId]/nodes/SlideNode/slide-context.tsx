import { createContext, useContext } from "react";
import { LexicalEditor, NodeKey } from "lexical";

const SlideParentEditorContext = createContext<{
  editor: LexicalEditor;
} | null>(null);

export const SlideParentEditorProvider: React.FC<{
  children: React.ReactNode;
  editor: LexicalEditor;
}> = ({ children, editor }) => (
  <SlideParentEditorContext.Provider value={{ editor }}>
    {children}
  </SlideParentEditorContext.Provider>
);

export function useSlideParentEditor() {
  const ctx = useContext(SlideParentEditorContext);
  if (!ctx)
    throw new Error(
      "useSlideParentEditor must be used within a SlideParentEditorProvider",
    );
  return ctx.editor;
}

// Updated ActiveSlideContext
export const ActiveSlideContext = createContext<{
  activeKey: NodeKey | null;
  setActiveKey: (
    key: NodeKey | null,
    newSelectedElementId?: string | null,
  ) => void;
  slideKeys: NodeKey[];
  deckEditor: LexicalEditor | null;
  selectedElementId: string | null;
  setSelectedElementId: (id: string | null) => void;
  setDeckElement: (element: HTMLElement | null) => void;
} | null>(null);

export function useActiveSlideKey() {
  const ctx = useContext(ActiveSlideContext);
  if (!ctx)
    throw new Error(
      "useActiveSlideKey must be used within an ActiveSlideContext.Provider",
    );
  return ctx;
}
