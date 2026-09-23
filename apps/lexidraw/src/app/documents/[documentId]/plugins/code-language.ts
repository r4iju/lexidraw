import {
  getCodeLanguageOptions,
  normalizeCodeLanguage,
} from "@lexical/code-shiki";

/** `[languageId, friendlyName]` pairs for every language Shiki can load. */
export const CODE_LANGUAGE_OPTIONS: [string, string][] =
  getCodeLanguageOptions();

const FRIENDLY_NAME_BY_LANGUAGE = new Map(CODE_LANGUAGE_OPTIONS);

export function getCodeLanguageFriendlyName(language: string): string {
  const normalized = normalizeCodeLanguage(language);
  return FRIENDLY_NAME_BY_LANGUAGE.get(normalized) ?? normalized;
}
