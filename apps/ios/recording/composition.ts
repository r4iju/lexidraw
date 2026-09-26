/**
 * Records what the web editor saves for each composition iOS recorded in
 * web-composition.json: the UI script writes the calls the Japanese keyboard
 * made on the editor, and this makes the same calls through Chrome's IME
 * input on a throwaway document on a local dev stack, saves, and adds what
 * the server stored. `bun run record:composition` runs both.
 *
 * Needs the dev app running (LEXIDRAW_DEV_URL, http://localhost:3025 by
 * default), the dev account in ~/.lexidraw-dev-account and the CLI's dev
 * keychain token, as the render worker's visual suite does.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { devCli, signInToDev } from "@packages/dev-stack";
import puppeteer, { type CDPSession, type Page } from "puppeteer";
import { z } from "zod";

const appUrl = process.env.LEXIDRAW_DEV_URL ?? "http://localhost:3025";
if (!["localhost", "127.0.0.1"].includes(new URL(appUrl).hostname))
  throw new Error("Composition fixtures only record against a local stack");
const cli = devCli(appUrl);

const fixturePath = fileURLToPath(
  new URL("../EditorUITests/Fixtures/web-composition.json", import.meta.url),
);

type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };

const jsonValue: z.ZodType<JSONValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);
/** A call the iOS keyboard made on the editor, as TextInputRecord codes it. */
const call = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("setMarkedText"),
    text: z.string(),
    selectedRange: z.tuple([z.number(), z.number()]),
  }),
  z.object({ name: z.literal("unmarkText") }),
  z.object({ name: z.literal("insertText"), text: z.string() }),
  z.object({ name: z.literal("deleteBackward") }),
]);
const shortcut = z.enum(["⌘b", "←"]);
const fixture = z.object({
  recordedOn: z.string(),
  recordedWith: z.string().optional(),
  cases: z.array(
    z.object({
      name: z.string(),
      start: jsonValue,
      shortcuts: z.array(shortcut),
      input: z.array(call),
      saved: jsonValue.optional(),
    }),
  ),
});
type Case = z.infer<typeof fixture>["cases"][number];

const storedDocument = z.object({ content: jsonValue, updatedAt: z.string() });
const createdDocument = z.object({ id: z.string() });

async function stored(id: string) {
  return storedDocument.parse(await cli("doc", "get", id, "--format", "json"));
}

/** The caret at the end of the document's last block, as a click puts it. */
async function caretAtEnd(page: Page) {
  await page.evaluate(() => {
    const content = window.document.querySelector<HTMLElement>(
      '[id^="lexical-content-"]',
    );
    const block = content?.lastElementChild;
    if (!content || !block) throw new Error("No block to put the caret in");
    content.focus();
    const walker = window.document.createTreeWalker(
      block,
      NodeFilter.SHOW_TEXT,
    );
    let last: Node | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      last = node;
    const offset = last?.textContent?.length ?? 0;
    window
      .getSelection()
      ?.setBaseAndExtent(last ?? block, offset, last ?? block, offset);
  });
  await pause(300);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One key of an IME: Chrome sends a keydown of the Process key before the
 * composition changes, which is what Lexical times its composition start by.
 */
async function imeKey(client: CDPSession, change: () => Promise<unknown>) {
  await client.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Process",
    windowsVirtualKeyCode: 229,
  });
  await change();
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Process",
    windowsVirtualKeyCode: 229,
  });
  await pause(50);
}

async function record(page: Page, testCase: Case) {
  const { id } = createdDocument.parse(
    await cli("doc", "create", "--title", `iOS composition ${testCase.name}`),
  );
  try {
    const created = await stored(id);
    await cli(
      "api",
      "PUT",
      `/entities/${id}`,
      "--json",
      JSON.stringify({
        elements: JSON.stringify(testCase.start),
        ifUnmodifiedSince: created.updatedAt,
      }),
    );
    const before = await stored(id);
    await page.goto(`${appUrl}/documents/${id}`, { waitUntil: "networkidle2" });
    await page.waitForSelector(
      '[id^="lexical-content-"][contenteditable="true"]',
    );
    await caretAtEnd(page);
    for (const key of testCase.shortcuts) {
      if (key === "⌘b") {
        await page.keyboard.down("Meta");
        await page.keyboard.press("b");
        await page.keyboard.up("Meta");
      } else {
        await page.keyboard.press("ArrowLeft");
      }
      await pause(100);
    }
    const client = await page.createCDPSession();
    let marked = "";
    for (const input of testCase.input) {
      switch (input.name) {
        case "setMarkedText": {
          const [location, length] = input.selectedRange;
          marked = input.text;
          await imeKey(client, () =>
            client.send("Input.imeSetComposition", {
              text: input.text,
              selectionStart: location,
              selectionEnd: location + length,
            }),
          );
          break;
        }
        case "unmarkText": {
          const text = marked;
          await imeKey(client, () => client.send("Input.insertText", { text }));
          marked = "";
          break;
        }
        case "insertText":
          await imeKey(client, () =>
            client.send("Input.insertText", { text: input.text }),
          );
          marked = "";
          break;
        case "deleteBackward":
          await page.keyboard.press("Backspace");
          break;
      }
    }
    await pause(300);
    await page.keyboard.down("Meta");
    await page.keyboard.press("s");
    await page.keyboard.up("Meta");
    for (let attempt = 0; ; attempt++) {
      const after = await stored(id);
      if (after.updatedAt !== before.updatedAt) return after.content;
      if (attempt > 40)
        throw new Error(`${testCase.name}: the web editor never saved`);
      await pause(250);
    }
  } finally {
    await cli("doc", "delete", id);
  }
}

const recorded = fixture.parse(JSON.parse(await readFile(fixturePath, "utf8")));
const browser = await puppeteer.launch();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await signInToDev(page, appUrl);
  const cases: Case[] = [];
  for (const testCase of recorded.cases)
    cases.push({ ...testCase, saved: await record(page, testCase) });
  const written = {
    ...recorded,
    recordedWith: await browser.version(),
    cases,
  };
  await writeFile(fixturePath, `${JSON.stringify(written, null, 2)}\n`);
} finally {
  await browser.close();
}
