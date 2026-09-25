/**
 * Downloads the render fonts into `fonts/` and checks them against their
 * pinned hashes. Any failure fails the build, so a deployment never ships a
 * renderer that draws Japanese text and emoji as blanks.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { RENDER_FONTS } from "../src/lib/render-fonts";

const dir = path.join(import.meta.dir, "..", "fonts");
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

await mkdir(dir, { recursive: true });
const failures: string[] = [];
await Promise.all(
  RENDER_FONTS.map(async (font) => {
    const file = path.join(dir, font.file);
    const existing = await readFile(file).catch(() => null);
    if (existing && sha256(existing) === font.sha256) return;
    try {
      const response = await fetch(font.url, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const actual = sha256(bytes);
      if (actual !== font.sha256)
        throw new Error(`sha256 ${actual}, expected ${font.sha256}`);
      await writeFile(`${file}.part`, bytes);
      await rename(`${file}.part`, file);
      console.log(`fetch-fonts: ${font.file} (${bytes.byteLength} bytes)`);
    } catch (error) {
      failures.push(`${font.file} from ${font.url}: ${String(error)}`);
    }
  }),
);
if (failures.length > 0) {
  console.error(`fetch-fonts: failed\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
