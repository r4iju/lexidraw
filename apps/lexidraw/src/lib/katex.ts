import type Katex from "katex";
import type { KatexOptions } from "katex";
import { loadOnce } from "./load-once";

let loaded: typeof Katex | undefined;

/**
 * KaTeX and its stylesheet, fetched the first time something asks for them:
 * they are large, and most documents hold no equation.
 */
export const loadKatex = loadOnce(() =>
  import("./katex-chunk").then((module) => {
    loaded = module.default;
    return loaded;
  }),
);

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
