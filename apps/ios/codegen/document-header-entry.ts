import { normalizeDocumentHeader } from "../../../packages/lexical-nodes/src/document-header";
import { propertyValueParts } from "../../lexidraw/src/lib/document-properties";

/** The header as the web's DocumentHeader shows it, read-only. */
function present(header: unknown, lang: string | null) {
  const { subtitle, cover, properties = [], toc } = normalizeDocumentHeader(header);
  return {
    subtitle: subtitle ?? null,
    cover: cover ?? null,
    toc: toc === true,
    properties: properties.map(({ key, value }) => ({
      key,
      parts: propertyValueParts(key, value).map((part) => {
        switch (part.kind) {
          case "status":
            return { kind: part.kind, text: part.text, status: part.text.toLowerCase() };
          case "mention":
            return { kind: part.kind, text: `@${part.name}` };
          case "link":
            return { kind: part.kind, text: part.text, href: part.href };
          // As the web's PropertyDate formats it once hydrated.
          case "date":
            return {
              kind: part.kind,
              text: new Intl.DateTimeFormat(lang || undefined, {
                dateStyle: "medium",
                ...(part.withTime ? { timeStyle: "short" } : {}),
              }).format(part.date),
            };
          default:
            return { kind: part.kind, text: part.text };
        }
      }),
    })),
  };
}

Object.assign(globalThis, {
  documentHeaderPresentation: (header: string, lang: string | null) =>
    JSON.stringify(present(JSON.parse(header), lang)),
});
