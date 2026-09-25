/// <reference types="bun" />
/**
 * Copies Excalidraw's fonts, and the worker it cuts them down in, from the
 * installed `@excalidraw/excalidraw` into `public`, for the app to serve.
 * Generated rather than checked in, so a bump cannot leave them behind; `dev`
 * and `build` run it first.
 *
 * The worker is the package's own module and every chunk it imports, which
 * the bundled copy is pointed at (`excalidraw-worker-loader.cjs` says why).
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { EXCALIDRAW_ASSETS } from "../src/lib/excalidraw-assets";

const dist = join(
  dirname(createRequire(import.meta.url).resolve("@excalidraw/excalidraw")),
  "..",
  "prod",
);
const target = join(import.meta.dir, "..", "public", EXCALIDRAW_ASSETS);

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(join(dist, "fonts"), join(target, "fonts"), { recursive: true });

const pending = ["subset-worker.chunk.js"];
const copied = new Set<string>();
for (let file = pending.pop(); file; file = pending.pop()) {
  if (copied.has(file)) continue;
  copied.add(file);
  const source = await readFile(join(dist, file), "utf8");
  await writeFile(join(target, file), source);
  for (const [, imported] of source.matchAll(
    /(?:from|import)\s*"\.\/([^"]+)"/g,
  ))
    if (imported) pending.push(imported);
}
