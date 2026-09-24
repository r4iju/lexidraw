import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const here = fileURLToPath(new URL("./", import.meta.url));
const output = resolve(root, ".playwright-mcp/document-snapshots");
const fixtureId = "98683bf7-3f2c-4c60-acd3-a82f24f805ad";
const update = process.argv.includes("--update");
if (process.env.CI)
  throw new Error(
    "Visual snapshots require the local dev stack; do not run in CI",
  );
await mkdir(output, { recursive: true });

async function cli(...args: string[]) {
  const child = Bun.spawn(
    ["bun", resolve(root, "apps/cli/src/main.ts"), "--profile", "dev", ...args],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      // Never let a shell override redirect this suite to production.
      env: {
        ...process.env,
        LEXIDRAW_URL: "http://localhost:3025",
        LEXIDRAW_TOKEN: undefined,
      },
    },
  );
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status) throw new Error(stderr);
  return JSON.parse(stdout);
}

// Rebuild from source every run, so changing a fixture is enough to test it.
const markdown = (
  await readFile(resolve(here, "fixtures/kitchen-sink.md"), "utf8")
).replace(/<!-- TODO[\s\S]*?-->/g, "");
const markdownPath = resolve(output, "fixture.md");
await writeFile(markdownPath, markdown);
await cli(
  "doc",
  "put",
  fixtureId,
  "--replace",
  "--file",
  markdownPath,
  "--if-unmodified-since",
  "latest",
);
const doc = await cli("doc", "get", fixtureId, "--format", "json");
const blocks = JSON.parse(
  await readFile(resolve(here, "fixtures/kitchen-sink.blocks.json"), "utf8"),
);
doc.content.root.children.push(...blocks);
const payload = resolve(output, "fixture.json");
await writeFile(
  payload,
  JSON.stringify({
    elements: JSON.stringify(doc.content),
    ifUnmodifiedSince: doc.updatedAt,
  }),
);
await cli(
  "api",
  "PUT",
  `/entities/${fixtureId}`,
  "--json",
  await readFile(payload, "utf8"),
);

let failures = 0;
let totalBytes = 0;
for (const width of [375, 768, 1280]) {
  for (const theme of ["light", "dark"]) {
    const name = `${width}-${theme}.png`;
    const actualPath = resolve(output, name);
    await cli(
      "doc",
      "render",
      fixtureId,
      "--width",
      String(width),
      "--theme",
      theme,
      "--out",
      actualPath,
    );
    const full = PNG.sync.read(await readFile(actualPath));
    if (full.width !== width)
      throw new Error(`Expected ${width}px, received ${full.width}`);
    // Bound repository size while retaining the top of the reading view at 1:1.
    const actual = new PNG({ width, height: Math.min(full.height, 6000) });
    PNG.bitblt(full, actual, 0, 0, width, actual.height, 0, 0);
    const encoded = PNG.sync.write(actual);
    await writeFile(actualPath, encoded);
    const baselinePath = resolve(here, "baselines", name);
    totalBytes += encoded.length;
    if (update) {
      await writeFile(baselinePath, encoded);
      console.log(`Updated ${name} (${width}×${actual.height})`);
      continue;
    }
    let baseline: PNG;
    try {
      baseline = PNG.sync.read(await readFile(baselinePath));
    } catch {
      throw new Error(
        `Missing ${baselinePath}; review captures then run with --update`,
      );
    }
    if (baseline.width !== actual.width || baseline.height !== actual.height) {
      console.error(`${name}: dimensions changed`);
      failures++;
      continue;
    }
    const diff = new PNG({ width, height: actual.height });
    const changed = pixelmatch(
      baseline.data,
      actual.data,
      diff.data,
      width,
      actual.height,
      { threshold: 0.15 },
    );
    const ratio = changed / (width * actual.height);
    console.log(`${name}: ${(ratio * 100).toFixed(3)}% changed`);
    if (ratio > 0.005) {
      failures++;
      await writeFile(
        resolve(output, `${width}-${theme}-diff.png`),
        PNG.sync.write(diff),
      );
    }
  }
}
console.log(`Six captures: ${totalBytes} bytes. Artifacts: ${output}`);
if (failures) throw new Error(`${failures} visual comparisons failed`);
