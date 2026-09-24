import type { CSSProperties, ReactNode } from "react";
import {
  contentFonts,
  documentFont,
  documentLanguage,
  documentSettings,
  languageFont,
} from "~/lib/document-fonts";

export function FontResources({
  fonts,
  lang,
}: {
  fonts: string[];
  lang?: string;
}) {
  const resources = fonts.flatMap((family) => {
    const cjk = languageFont(lang, family);
    return cjk ? [family, cjk] : [family];
  });
  return [...new Set(resources)].map((name) => {
    const font = documentFont(name);
    // Keep semantic saved names while applying the document reading stacks.
    const aliases = /^[\p{L}\p{N} -]+$/u.test(name)
      ? [name, `'${name}'`, `"${name}"`]
          .flatMap((value) => [
            `.document-content [style*=${JSON.stringify(`font-family: ${value}`)}]`,
            `.document-content [style*=${JSON.stringify(`font-family:${value}`)}]`,
          ])
          .join(",")
      : "";
    return (
      <span key={name} hidden>
        {font.href && <link rel="stylesheet" href={font.href} />}
        {aliases && (
          <style>{`${aliases} { font-family: ${font.family} !important; }`}</style>
        )}
      </span>
    );
  });
}

export function DocumentTypography({
  children,
  entity,
}: {
  children: ReactNode;
  entity: { elements: string | null; appState: string | null };
}) {
  const settings = documentSettings(entity.appState);
  const font = documentFont(settings.defaultFontFamily);
  const lang = documentLanguage(entity.elements, settings.lang);
  const style: CSSProperties & { "--doc-font": string } = {
    "--doc-font": font.family,
    fontFamily: font.family,
  };
  return (
    <div
      className="document-typography h-full min-h-0"
      lang={lang}
      style={style}
    >
      <FontResources
        lang={lang}
        fonts={[
          settings.defaultFontFamily || "sans",
          ...contentFonts(entity.elements),
        ]}
      />
      {children}
    </div>
  );
}
