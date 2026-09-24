import { z } from "zod";

export const documentSettingsSchema = z
  .object({
    defaultFontFamily: z.string().nullable().optional(),
    lang: z.string().nullable().optional(),
  })
  .passthrough();

export function documentSettings(appState: string | null) {
  return documentSettingsSchema.parse(JSON.parse(appState || "{}"));
}

const bundledFonts: Record<string, string> = {
  Fredoka: "--font-fredoka",
  Inter: "--font-inter",
  "Ubuntu Mono": "--font-ubuntu-mono",
  "M PLUS Rounded 1c": "--font-mplus",
  "Noto Sans JP": "--font-noto",
  "Noto Sans SC": "--font-noto-sc",
  "Noto Sans TC": "--font-noto-tc",
  "Noto Sans KR": "--font-noto-kr",
  "Source Serif 4": "--font-source-serif",
  "Noto Serif JP": "--font-serif-jp",
  "Noto Serif SC": "--font-serif-sc",
  "Noto Serif TC": "--font-serif-tc",
  "Noto Serif KR": "--font-serif-kr",
  "Yusei Magic": "--font-yusei",
  "Kosugi Maru": "--font-kosugi",
  "Sawarabi Mincho": "--font-sawarabi",
};
const systemFonts = new Set([
  "Arial",
  "Courier New",
  "Georgia",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Charter",
]);
export function fontName(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}
export function documentFont(value?: string | null): {
  family: string;
  href?: string;
} {
  const name = fontName(value || "sans");
  const normalized = name.toLowerCase();
  const readingFace = ["sans", "sans-serif", "system-ui"].includes(normalized)
    ? "sans"
    : ["mono", "monospace"].includes(normalized)
      ? "mono"
      : normalized === "serif"
        ? "serif"
        : null;
  if (readingFace) return { family: `var(--doc-font-${readingFace})` };
  const bundled = Object.entries(bundledFonts).find(
    ([family]) => family.toLowerCase() === normalized,
  )?.[1];
  if (bundled) return { family: `var(${bundled}), var(--doc-font-sans)` };
  // Font stacks and CSS variables already express their own fallback.
  if (name.includes(",") || name.startsWith("var(")) return { family: name };
  return {
    family: `${JSON.stringify(name)}, var(--doc-font-sans)`,
    ...(![...systemFonts].some((family) => family.toLowerCase() === normalized)
      ? { href: `/api/fonts?family=${encodeURIComponent(name)}` }
      : {}),
  };
}

export function documentText(elements: string | null) {
  const parts: string[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "text" && typeof child === "string") parts.push(child);
      else if (typeof child === "object") visit(child);
    }
  }
  visit(JSON.parse(elements || "{}"));
  return parts.join(" ");
}

export function documentLanguage(
  elements: string | null,
  stored?: string | null,
) {
  if (stored) return stored;
  const text = documentText(elements);
  const letters = text.match(/\p{L}/gu)?.length || 1;
  const count = (pattern: RegExp) => text.match(pattern)?.length || 0;
  if (count(/\p{Script=Hangul}/gu) / letters > 0.2) return "ko";
  const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const han = count(/\p{Script=Han}/gu);
  if ((kana + han) / letters > 0.2) return kana ? "ja" : "zh-Hans";
  return "en";
}

export function contentFonts(elements: string | null) {
  const names = new Set<string>();
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "style" && typeof child === "string") {
        const match = /(?:^|;)\s*font-family:\s*([^;]+)/i.exec(child);
        if (match?.[1]) names.add(fontName(match[1].split(",")[0] || match[1]));
      } else if (typeof child === "object") visit(child);
    }
  }
  visit(JSON.parse(elements || "{}"));
  return [...names];
}
