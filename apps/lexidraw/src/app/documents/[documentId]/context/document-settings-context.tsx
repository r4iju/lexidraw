import { createContext, useContext, useState, type ReactNode } from "react";

interface DocumentSettingsContextType {
  lang: string | null;
  setLang: (lang: string | null) => void;
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
  initialLang?: string | null;
}

export const DocumentSettingsProvider = ({
  children,
  initialDefaultFontFamily = null,
  initialLang = null,
}: DocumentSettingsProviderProps) => {
  const [lang, setLang] = useState(initialLang);
  const [defaultFontFamily, setDefaultFontFamilyState] = useState<
    string | null
  >(initialDefaultFontFamily);

  const setDefaultFontFamily = (font: string | null) => {
    setDefaultFontFamilyState(font);
  };

  return (
    <DocumentSettingsContext.Provider
      value={{ defaultFontFamily, setDefaultFontFamily, lang, setLang }}
    >
      {children}
    </DocumentSettingsContext.Provider>
  );
};
