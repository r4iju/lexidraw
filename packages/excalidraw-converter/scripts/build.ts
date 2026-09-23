/// <reference types="bun" />
import { rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const stub = join(root, "src", "react-stub.ts");
const unused = join(root, "src", "unused-stub.ts");

/** Reached only from the editor's Mermaid dialog, never from a conversion. */
const UNUSED = /^@excalidraw\/mermaid-to-excalidraw(\/.*)?$/;

await rm(join(root, "dist"), { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(root, "src", "index.ts")],
  outdir: join(root, "dist"),
  target: "node",
  format: "esm",
  minify: true,
  // The editor ships a development and a production build; the production one
  // is the smaller of the two and the one the app renders with.
  conditions: ["production"],
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "react-stub",
      setup(build) {
        build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, () => ({
          path: stub,
        }));
        build.onResolve({ filter: UNUSED }, () => ({ path: unused }));
      },
    },
  ],
});

for (const log of result.logs) console.error(String(log));
if (!result.success) process.exit(1);
for (const output of result.outputs) {
  console.log(`${output.path} (${(output.size / 1024 / 1024).toFixed(1)} MB)`);
}
