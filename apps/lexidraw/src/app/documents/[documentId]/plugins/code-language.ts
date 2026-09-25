// Shiki's catalogue of languages, without its highlighter, which loads with
// the first code block.
import { bundledLanguagesInfo } from "shiki/langs";

/** `[languageId, friendlyName]` pairs for every language Shiki can load. */
export const CODE_LANGUAGE_OPTIONS: [string, string][] =
  bundledLanguagesInfo.map(({ id, name }) => [id, name]);

const FRIENDLY_NAME_BY_LANGUAGE = new Map(CODE_LANGUAGE_OPTIONS);

/** A language's own ID for any of its names (`ts` for TypeScript). */
export function normalizeCodeLanguage(language: string): string {
  return (
    bundledLanguagesInfo.find(
      ({ id, aliases }) => id === language || aliases?.includes(language),
    )?.id ?? language
  );
}

export function getCodeLanguageFriendlyName(language: string): string {
  const normalized = normalizeCodeLanguage(language);
  return FRIENDLY_NAME_BY_LANGUAGE.get(normalized) ?? normalized;
}
