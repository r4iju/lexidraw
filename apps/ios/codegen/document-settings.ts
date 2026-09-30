import {
  documentFont,
  documentLanguage,
  documentSettings,
  documentText,
} from "../../lexidraw/src/lib/document-fonts";

declare const DOCUMENT_FONT_RULES: {
  languages: string[];
  variables: Record<string, string>;
}[];
declare const DOCUMENT_NEXT_FONTS: Record<string, string>;

function metadata(elements: string, appState: string | null) {
  const settings = documentSettings(appState);
  const language = documentLanguage(elements, settings.lang);
  const font = documentFont(settings.defaultFontFamily);
  const variables: Record<string, string> = { ...DOCUMENT_NEXT_FONTS };
  for (const rule of DOCUMENT_FONT_RULES) {
    if (
      !rule.languages.length ||
      rule.languages.some(
        (tag) =>
          language?.toLowerCase() === tag ||
          language?.toLowerCase().startsWith(`${tag}-`),
      )
    ) {
      Object.assign(variables, rule.variables);
    }
  }
  const expand = (value: string, depth = 0): string => {
    if (depth > 16) throw new Error("Recursive document font variables");
    return value.replace(/var\((--[a-z0-9-]+)\)/g, (_, name: string) => {
      const replacement = variables[name];
      if (!replacement)
        throw new Error(`Unported document font variable: ${name} (#130)`);
      return expand(replacement, depth + 1);
    });
  };
  return {
    language: language ?? null,
    fontFamily: expand(font.family),
    fontResource: font.href ?? null,
    text: documentText(elements),
  };
}

Object.assign(globalThis, {
  documentSettingsMetadata: (elements: string, appState: string | null) =>
    JSON.stringify(metadata(elements, appState)),
});
