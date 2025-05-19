import { createContext, useContext, useState, ReactNode } from "react";

interface DocumentSettingsContextType {
  defaultFontFamily: string | null;
  setDefaultFontFamily: (font: string | null) => void;
}

const DocumentSettingsContext = createContext<
  DocumentSettingsContextType | undefined
>(undefined);

export const useDocumentSettings = () => {
  const context = useContext(DocumentSettingsContext);
  if (!context) {
    throw new Error(
      "useDocumentSettings must be used within a DocumentSettingsProvider",
    );
  }
  return context;
};

interface DocumentSettingsProviderProps {
  children: ReactNode;
  initialDefaultFontFamily?: string | null;
}

export const DocumentSettingsProvider = ({
  children,
  initialDefaultFontFamily = null,
}: DocumentSettingsProviderProps) => {
  const [defaultFontFamily, setDefaultFontFamilyState] = useState<
    string | null
  >(initialDefaultFontFamily);

  const setDefaultFontFamily = (font: string | null) => {
    setDefaultFontFamilyState(font);
  };

  return (
    <DocumentSettingsContext.Provider
      value={{ defaultFontFamily, setDefaultFontFamily }}
    >
      {children}
    </DocumentSettingsContext.Provider>
  );
};
