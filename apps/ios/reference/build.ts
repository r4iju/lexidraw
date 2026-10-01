import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const hooks = fileURLToPath(new URL("./structural-hooks.ts", import.meta.url));
const nestedHooks = fileURLToPath(new URL("./nested-composer-hooks.ts", import.meta.url));
const output = await Bun.build({
  entrypoints: [fileURLToPath(new URL("./entry.ts", import.meta.url))],
  target: "browser",
  format: "iife",
  minify: true,
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "original-structural-plugin-hooks",
      setup(build) {
        build.onLoad({ filter: /LexicalNestedComposer\.dev\.js$/ }, async ({ path }) => {
          const original = await Bun.file(path).text();
          const contents = original.replace("from 'react';", `from ${JSON.stringify(nestedHooks)};`);
          if (contents === original || /from 'react'/.test(contents)) throw new Error("Nested composer hooks changed shape");
          return { contents, loader: "js", resolveDir: dirname(path) };
        });
        build.onLoad(
          {
            filter:
              /plugins\/(?:CalloutPlugin\/index\.tsx|CollapsiblePlugin\/index\.ts|LayoutPlugin\/LayoutPlugin\.tsx|KeywordsPlugin\/index\.ts|EmojisPlugin\/index\.ts)$/,
          },
          async ({ path }) => {
            const original = await Bun.file(path).text();
            const contents = original
              .replace(
                'from "@lexical/react/LexicalComposerContext"',
                `from ${JSON.stringify(hooks)}`,
              )
              .replace('from "react"', `from ${JSON.stringify(hooks)}`);
            const adapted = contents.replace('from "@lexical/react/useLexicalTextEntity"', `from ${JSON.stringify(hooks)}`);
            if (
              contents === original ||
              /from "react"|from "@lexical\/react\//.test(adapted)
            )
              throw new Error(
                `The structural hook imports changed shape: ${path}`,
              );
            return {
              contents: adapted,
              loader: path.endsWith("tsx") ? "tsx" : "ts",
              resolveDir: dirname(path),
            };
          },
        );
      },
    },
  ],
});
if (!output.success)
  throw new AggregateError(output.logs, "Reference bundle failed");
const artifact = output.outputs[0];
if (!artifact || output.outputs.length !== 1)
  throw new Error("Reference build did not produce one artifact");
await Bun.write(
  new URL("./dist/lexical-reference.js", import.meta.url),
  artifact,
);
