import { createContext, PropsWithChildren, useContext } from "react";
import { useRuntimeToolsFactory } from "./tool-factory";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useChatDispatch } from "./llm-chat-context";
import { useImageInsertion } from "~/hooks/use-image-insertion";
import { useImageGeneration } from "~/hooks/use-image-generation";
import { RuntimeToolMap } from "../../context/llm-context";

const RuntimeToolsCtx = createContext<RuntimeToolMap | null>(null);

export function RuntimeToolsProvider({ children }: PropsWithChildren) {
  const [editor] = useLexicalComposerContext();
  const dispatch = useChatDispatch();
  const { searchAndInsertImage } = useImageInsertion();
  const { generateAndInsertImage } = useImageGeneration();

  const tools = useRuntimeToolsFactory({
    editor,
    dispatch,
    searchAndInsertImageFunc: searchAndInsertImage,
    generateAndInsertImageFunc: generateAndInsertImage,
  });

  return (
    <RuntimeToolsCtx.Provider value={tools}>
      {children}
    </RuntimeToolsCtx.Provider>
  );
}

export function useRuntimeTools() {
  const tools = useContext(RuntimeToolsCtx);
  if (!tools) {
    throw new Error("RuntimeToolsProvider not found");
  }
  return tools;
}
