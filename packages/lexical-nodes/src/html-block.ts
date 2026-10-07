import { z } from "zod";

export const HTML_BLOCK_LIMIT = 128 * 1024;
export const HTMLBlockSource = z
  .object({
    html: z.string().max(HTML_BLOCK_LIMIT),
    css: z.string().max(HTML_BLOCK_LIMIT).default(""),
    javascript: z.string().max(HTML_BLOCK_LIMIT).default(""),
    data: z.record(z.string(), z.unknown()).default({}),
    defaults: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .default({}),
    description: z.string().min(1).max(500),
    height: z.number().int().min(180).max(900).default(360),
  })
  .passthrough();
export type HTMLBlockSourceValue = z.infer<typeof HTMLBlockSource>;
export const SavedHTMLBlockSchema = HTMLBlockSource.extend({
  id: z.string().uuid(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SavedHTMLBlock = z.infer<typeof SavedHTMLBlockSchema>;

export function parseHTMLBlockSource(value: unknown): HTMLBlockSourceValue {
  const source = HTMLBlockSource.parse(value);
  const check = (item: unknown, depth = 0): void => {
    if (depth > 32) throw new Error("Embedded data exceeds nesting limit");
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (Array.isArray(item)) {
      for (const value of item) check(value, depth + 1);
      return;
    }
    if (
      item &&
      typeof item === "object" &&
      Object.getPrototypeOf(item) === Object.prototype
    ) {
      for (const value of Object.values(item)) check(value, depth + 1);
      return;
    }
    throw new Error("HTML block content must contain only JSON values");
  };
  check(source);
  if (
    new TextEncoder().encode(JSON.stringify(source)).length > HTML_BLOCK_LIMIT
  )
    throw new Error("HTML block exceeds the 128 KiB saved-content limit");
  return source;
}

export const HTML_BLOCK_THEMES = ["light", "dark"] as const;
export type HTMLBlockTheme = (typeof HTML_BLOCK_THEMES)[number];
/**
 * The document's --foreground and --font-sans (apps/lexidraw globals.css), so a
 * block without its own colours reads as part of the page it sits on.
 */
const INK: Record<HTMLBlockTheme, string> = {
  light: "oklch(0.23 0.01 285)",
  dark: "oklch(0.92 0.005 285)",
};
const FONT =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/**
 * The page a block runs and is captured in. Its surface stays transparent so
 * the document shows through, unless the block's CSS paints its own.
 */
export function snapshotDocument(
  html: string,
  css: string,
  theme: HTMLBlockTheme = "light",
): string {
  return `<!doctype html><html data-theme="${theme}" style="color-scheme:${theme}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; base-uri 'none'; form-action 'none'; script-src 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="${theme}"><style>html{background:transparent;color:${INK[theme]};font:16px/1.5 ${FONT}}body{margin:0;padding:16px;overflow-wrap:anywhere}*,*:before,*:after{box-sizing:border-box}input,select,button,textarea{font:inherit;max-width:100%}${css.replace(/</g, "\\3c ")}</style></head><body>${html}</body></html>`;
}
