import type { CSSProperties, ReactNode } from "react";
import {
  contentFonts,
  documentFont,
  documentLanguage,
  documentSettings,
} from "~/lib/document-fonts";

export function FontResources({ fonts }: { fonts: string[] }) {
  return [...new Set(fonts)].map((name) => {
    const font = documentFont(name);
    // Old documents name bundled faces directly; map them without rewriting saved text.
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
        {font.href && (
          <link rel="stylesheet" href={font.href} precedence="document-font" />
        )}
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
  const style: CSSProperties & { "--doc-font": string } = {
    "--doc-font": font.family,
    fontFamily: font.family,
  };
  return (
    <div
      className="document-typography h-full min-h-0"
      lang={documentLanguage(entity.elements, settings.lang)}
      style={style}
    >
      <FontResources
        fonts={[
          settings.defaultFontFamily || "sans",
          ...contentFonts(entity.elements),
        ]}
      />
      {children}
    </div>
  );
}
