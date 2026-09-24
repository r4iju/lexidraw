/// <reference types="bun" />
import { JSDOM } from "jsdom";

/**
 * react-dom and Radix decide once, when first imported, whether there is a
 * document: react-dom picks its input events, Radix whether layout effects
 * run. Every test file shares one process, so whichever file imported them
 * first decided for all. They are loaded here, with a document, before any
 * test file, and the document is taken away again.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
const keys = ["window", "document", "navigator"] as const;
const saved = keys.map((key) => [key, globals[key]] as const);
for (const key of keys)
  globals[key] = (dom.window as unknown as Record<string, unknown>)[key];

await import("react-dom/client");
await import("~/components/ui/dialog");
await import("~/components/ui/dropdown-menu");
await import("~/components/ui/select");

for (const [key, value] of saved) {
  if (value === undefined) delete globals[key];
  else globals[key] = value;
}
