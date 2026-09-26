/**
 * Records what the web editor saves after Japanese composition, for the iOS
 * editor's UI tests to compare with. Each case opens a throwaway document on
 * a local dev stack, types the marked text the iOS Japanese keyboard produces
 * for the same keys through Chrome's IME input, saves, and reads back what
 * the server stored.
 *
 * Needs the dev app running (LEXIDRAW_DEV_URL, http://localhost:3025 by
 * default), the dev account in ~/.lexidraw-dev-account and the CLI's dev
 * keychain token, as the render worker's visual suite does.
 */
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import puppeteer, {
  type CDPSession,
  type KeyInput,
  type Page,
} from "puppeteer";
import { z } from "zod";

const appUrl = process.env.LEXIDRAW_DEV_URL ?? "http://localhost:3025";
if (!["localhost", "127.0.0.1"].includes(new URL(appUrl).hostname))
  throw new Error("Composition fixtures only record against a local stack");

const root = fileURLToPath(new URL("../../../", import.meta.url));
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

const paragraph = (children: JSONValue[]): JSONValue => ({
  type: "paragraph",
  version: 1,
  children,
  direction: null,
  format: "",
  indent: 0,
  textFormat: 0,
  textStyle: "",
});

const document = (...children: JSONValue[]): JSONValue => ({
  root: {
    type: "root",
    version: 1,
    children,
    direction: null,
    format: "",
    indent: 0,
  },
});

const plainText = (text: string): JSONValue => ({
  type: "text",
  version: 1,
  text,
  detail: 0,
  format: 0,
  mode: "normal",
  style: "",
});

/**
 * What the iOS Japanese (Romaji) keyboard sends for "nihonn" and the 日本
 * candidate: the marked text after each key, then the candidate, committed.
 */
const nihon = {
  keys: ["n", "i", "h", "o", "n", "n"],
  candidate: "日本",
  marked: ["n", "に", "にh", "にほ", "にほn", "にほん", "日本"],
};

type Case = {
  name: string;
  start: JSONValue;
  /** Hardware shortcuts pressed at the caret before composing. */
  shortcuts: KeyInput[];
};

const cases: Case[] = [
  {
    name: "after-text",
    start: document(paragraph([plainText("今日は")])),
    shortcuts: [],
  },
  { name: "empty-paragraph", start: document(paragraph([])), shortcuts: [] },
  {
    name: "after-bold-shortcut",
    start: document(paragraph([plainText("今日は")])),
    shortcuts: ["b"],
  },
];

async function cli(...args: string[]): Promise<unknown> {
  const child = Bun.spawn(
    ["bun", `${root}apps/cli/src/main.ts`, "--profile", "dev", ...args],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      // Never let a shell override send this to production.
      env: { ...process.env, LEXIDRAW_URL: appUrl, LEXIDRAW_TOKEN: undefined },
    },
  );
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status) throw new Error(stderr);
  return stdout.trim() ? JSON.parse(stdout) : null;
}

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
const storedDocument = z.object({ content: jsonValue, updatedAt: z.string() });
const createdDocument = z.object({ id: z.string() });

async function stored(id: string) {
  return storedDocument.parse(await cli("doc", "get", id, "--format", "json"));
}

async function signIn(page: Page) {
  await page.goto(`${appUrl}/signin`, { waitUntil: "networkidle2" });
  const signedIn = await page.evaluate(async () => {
    const session: { user?: unknown } | null = await fetch(
      "/api/auth/session",
    ).then((r) => r.json());
    return Boolean(session?.user);
  });
  if (signedIn) return;
  const credentials = Object.fromEntries(
    (await readFile(`${homedir()}/.lexidraw-dev-account`, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line
            .slice(separator + 1)
            .trim()
            .replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
  await page.locator('input[name="email"]').fill(credentials.email ?? "");
  await page.locator('input[name="password"]').fill(credentials.password ?? "");
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => location.pathname === "/dashboard");
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
      await page.keyboard.down("Meta");
      await page.keyboard.press(key);
      await page.keyboard.up("Meta");
      await pause(100);
    }
    const client = await page.createCDPSession();
    for (const text of nihon.marked) {
      await imeKey(client, () =>
        client.send("Input.imeSetComposition", {
          text,
          selectionStart: text.length,
          selectionEnd: text.length,
        }),
      );
    }
    await imeKey(client, () =>
      client.send("Input.insertText", { text: nihon.candidate }),
    );
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

const browser = await puppeteer.launch();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await signIn(page);
  const recorded = [];
  for (const testCase of cases) {
    recorded.push({
      name: testCase.name,
      start: testCase.start,
      shortcuts: testCase.shortcuts,
      saved: await record(page, testCase),
    });
  }
  const fixture = {
    recordedWith: await browser.version(),
    keys: nihon.keys,
    candidate: nihon.candidate,
    marked: nihon.marked,
    cases: recorded,
  };
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
} finally {
  await browser.close();
}
