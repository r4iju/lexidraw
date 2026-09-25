import type Katex from "katex";
import type { KatexOptions } from "katex";

let loaded: typeof Katex | undefined;
let loading: Promise<typeof Katex> | undefined;

/**
 * KaTeX, fetched the first time something asks for it: it is large, and most
 * documents hold no equation.
 */
export function loadKatex() {
  loading ??= import("katex").then((module) => {
    loaded = module.default;
    return loaded;
  });
  return loading;
}

/** KaTeX if it has loaded, for work that cannot wait for it. */
export function loadedKatex() {
  return loaded;
}

export function katexOptions(inline: boolean): KatexOptions {
  return {
    displayMode: !inline,
    errorColor: "var(--destructive)",
    output: "html",
    strict: "warn",
    throwOnError: false,
    trust: false,
  };
}
