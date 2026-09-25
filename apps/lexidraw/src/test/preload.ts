/// <reference types="bun" />
// Next's request storages look for AsyncLocalStorage on the global once, as
// they load, and settle for a stand-in that throws on use when it is missing;
// the components below load them. This is where a Next server puts it.
import "next/dist/server/node-environment-baseline";
import { afterEach } from "bun:test";
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

/**
 * Radix's focus scope sends its unmount event on a timer. Letting pending
 * timers run after every test, in every file, fires it while that file's
 * document is still installed; left for later, it can fire once the file has
 * put the real globals back, when jsdom refuses the event and the suite fails
 * with an unhandled error.
 */
afterEach(() => new Promise((resolve) => setTimeout(resolve, 0)));
