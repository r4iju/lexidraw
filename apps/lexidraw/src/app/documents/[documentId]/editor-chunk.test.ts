import { describe, expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { dirname } from "node:path";

const transpiler = new Bun.Transpiler({ loader: "tsx" });
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * The packages a module pulls in as it loads, by the name it imports them
 * under (`shiki/langs`, not just `shiki`): everything reached through
 * static imports, through the app's and the workspace's own files, stopping
 * at `import()`, which a bundler leaves for later. Stylesheets are not code
 * and stay out of the count.
 */
function eagerPackages(entry: string) {
  const packages = new Map<string, string>();
  const seen = new Set<string>();
  const visit = (file: string, from: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const { kind, path } of transpiler.scanImports(
      readFileSync(file, "utf8"),
    )) {
      if (kind !== "import-statement" && kind !== "require-call") continue;
      let resolved: string;
      try {
        resolved = realpathSync(Bun.resolveSync(path, dirname(file)));
      } catch {
        continue;
      }
      if (!SOURCE.test(resolved)) continue;
      if (/\/node_modules\//.test(resolved)) {
        if (!packages.has(path))
          packages.set(path, `${from} → ${file.replace(/^.*\/src\//, "")}`);
      } else {
        visit(resolved, file.replace(/^.*\/src\//, ""));
      }
    }
  };
  visit(realpathSync(entry), "entry");
  return packages;
}

// Shiki's language list (`shiki/langs`) is a catalogue of `import()`s; the
// highlighter itself is the weight.
const HEAVY =
  /^(?:@excalidraw\/|mermaid(?:\/|$)|recharts(?:\/|$)|katex(?:\/|$)|shiki$|@shikijs\/|@lexical\/code-shiki|ai$|@ai-sdk\/|@openrouter\/)/;

describe("the document editor's first chunk", () => {
  test("leaves Excalidraw, mermaid, charts, KaTeX, Shiki and the AI SDKs for when they are used", () => {
    const eager = eagerPackages(`${import.meta.dir}/document-editor.tsx`);
    const heavy = [...eager]
      .filter(([name]) => HEAVY.test(name))
      .map(([name, via]) => `${name} (via ${via})`);
    expect(heavy).toEqual([]);
  });
});
