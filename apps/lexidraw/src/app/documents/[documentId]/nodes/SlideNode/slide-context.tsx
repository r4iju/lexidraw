import { createContext, useContext, useState } from "react";
import { LexicalEditor } from "lexical";
import { NodeKey } from "lexical";

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

export const ActiveSlideContext = createContext<{
  activeKey: NodeKey | null;
  setActiveKey: (k: NodeKey | null) => void;
  slideKeys: NodeKey[];
  deckEditor: LexicalEditor | null;
} | null>(null);

export function useActiveSlideKey() {
  const ctx = useContext(ActiveSlideContext);
  if (!ctx)
    throw new Error(
      "useActiveSlideKey must be used within a ActiveSlideContext.Provider",
    );
  return ctx;
}

const SelectionCtx = createContext<{
  selectedId: string | null;
  setSelectedId: (s: string | null) => void;
} | null>(null);

export const SelectionProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <SelectionCtx.Provider value={{ selectedId, setSelectedId }}>
      {children}
    </SelectionCtx.Provider>
  );
};

export function useSelection() {
  const ctx = useContext(SelectionCtx);
  if (!ctx)
    throw new Error("useSelection must be used within a SelectionCtx.Provider");
  return ctx;
}
