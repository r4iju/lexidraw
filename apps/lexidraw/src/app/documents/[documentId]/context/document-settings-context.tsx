import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

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

/**
 * Calls `onChange` whenever the document's font or language changes, so a
 * setting chosen on its own is saved like an edit to the text; opening the
 * document is not a change.
 */
export function useDocumentSettingsChange(onChange: () => void) {
  const { defaultFontFamily, lang } = useDocumentSettings();
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);
  const last = useRef({ defaultFontFamily, lang });
  useEffect(() => {
    if (
      last.current.defaultFontFamily === defaultFontFamily &&
      last.current.lang === lang
    )
      return;
    last.current = { defaultFontFamily, lang };
    latest.current();
  }, [defaultFontFamily, lang]);
}

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
