import { createContext, useContext } from "react";

/** The open document's title, for what opens over it, like a drawing editor. */
const DocumentTitleContext = createContext<string | null>(null);

export const DocumentTitleProvider = DocumentTitleContext.Provider;

/** Null where no document is open, such as a render outside the editor. */
export function useDocumentTitle(): string | null {
  return useContext(DocumentTitleContext);
}
