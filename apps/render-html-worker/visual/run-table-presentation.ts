/**
 * Runs the table presentation check alone, on a throwaway document:
 * `VISUAL_APP_URL=http://localhost:3033 bun apps/render-html-worker/visual/run-table-presentation.ts`.
 * `VISUAL_PROFILE` points the browser at a signed-in profile, and `--keep`
 * leaves the document for a look by hand.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";
import { devCli } from "@packages/dev-stack";
import { appUrl } from "./app-url";
import {
  checkTablePresentation,
  createTablePresentationDocument,
} from "./check-table-presentation";

if (process.env.CI)
  throw new Error(
    "Visual checks require the local dev stack; do not run in CI",
  );
const keep = process.argv.includes("--keep");

// biome-ignore lint/suspicious/noExplicitAny: the dev app's own reply
const cli: (...args: string[]) => Promise<any> = devCli(appUrl);
const id = await createTablePresentationDocument(cli);

const browser = await puppeteer.launch({
  headless: true,
  userDataDir:
    process.env.VISUAL_PROFILE ??
    join(await mkdtemp(join(tmpdir(), "table-presentation-")), "browser"),
});
try {
  // A profile reopens its last tabs, behind the one this drives.
  const [page = await browser.newPage(), ...restored] = await browser.pages();
  for (const restoredPage of restored) await restoredPage.close();
  await checkTablePresentation(page, id);
} finally {
  await browser.close();
  if (keep) console.log(`Kept ${appUrl}/documents/${id}`);
  else await cli("doc", "delete", id);
}
