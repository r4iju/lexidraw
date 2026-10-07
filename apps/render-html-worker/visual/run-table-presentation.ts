/**
 * Runs the table presentation check alone, on a throwaway document:
 * `VISUAL_APP_URL=http://localhost:3033 bun apps/render-html-worker/visual/run-table-presentation.ts`.
 * `VISUAL_PROFILE` points the browser at a signed-in profile, and `--keep`
 * leaves the document for a look by hand.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";
import { devCli } from "@packages/dev-stack";
import { appUrl } from "./app-url";
import {
  TABLE_PRESENTATION_ROOT,
  checkTablePresentation,
} from "./check-table-presentation";

if (process.env.CI)
  throw new Error(
    "Visual checks require the local dev stack; do not run in CI",
  );
const keep = process.argv.includes("--keep");

// biome-ignore lint/suspicious/noExplicitAny: the dev app's own reply
const cli: (...args: string[]) => Promise<any> = devCli(appUrl);
const scratch = await mkdtemp(join(tmpdir(), "table-presentation-"));
const doc = await cli("doc", "create", "--title", "Visual check · tables");
const payload = join(scratch, "tables.json");
await writeFile(
  payload,
  JSON.stringify({
    elements: JSON.stringify({ root: TABLE_PRESENTATION_ROOT }),
    appState: JSON.stringify({ defaultFontFamily: null, lang: null }),
    ifUnmodifiedSince: (await cli("doc", "get", doc.id, "--format", "json"))
      .updatedAt,
  }),
);
await cli("api", "PUT", `/entities/${doc.id}`, "--json", `@${payload}`);

const browser = await puppeteer.launch({
  headless: true,
  userDataDir: process.env.VISUAL_PROFILE ?? join(scratch, "browser"),
});
try {
  const [page = await browser.newPage()] = await browser.pages();
  await checkTablePresentation(page, doc.id);
} finally {
  await browser.close();
  if (keep) console.log(`Kept ${appUrl}/documents/${doc.id}`);
  else await cli("doc", "delete", doc.id);
}
