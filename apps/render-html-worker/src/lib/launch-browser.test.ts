import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RENDER_FONTS } from "./render-fonts";

let scratch: string;
let lambdaTmp: string;
let events: string[];
let preparationGate: Promise<void> | undefined;
let preparationFailure: Error | undefined;
const hostTmp = tmpdir();
const savedCwd = process.cwd();
const envKeys = ["TMPDIR", "VERCEL", "NODE_ENV"] as const;
// Next types NODE_ENV as read-only.
const env = process.env as Record<string, string | undefined>;
const savedEnv = envKeys.map((key) => [key, env[key]] as const);

function fontsUnder(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { recursive: true })) {
    const file = path.join(dir, String(entry));
    if (file.endsWith(".ttf"))
      found.set(path.basename(file), readFileSync(file, "utf8"));
  }
  return found;
}

mock.module("@sparticuz/chromium", () => ({
  default: {
    args: ["--single-process"],
    async executablePath() {
      events.push("preparation");
      await preparationGate;
      if (preparationFailure) throw preparationFailure;
      const fonts = path.join(lambdaTmp, "fonts");
      // The real one unpacks its fonts.conf only when this folder is absent.
      events.push(`executablePath:fonts-dir-existed=${existsSync(fonts)}`);
      mkdirSync(fonts, { recursive: true });
      writeFileSync(path.join(fonts, "fonts.conf"), "<fontconfig/>");
      return path.join(lambdaTmp, "chromium");
    },
  },
}));

mock.module("puppeteer-core", () => ({
  async launch(options: { args: string[]; executablePath: string }) {
    const fonts = path.join(lambdaTmp, "fonts");
    events.push("launch");
    installedAtLaunch = fontsUnder(fonts);
    confAtLaunch = existsSync(path.join(fonts, "fonts.conf"));
    launchOptions = options;
    return { fake: "browser" };
  },
}));

let installedAtLaunch: Map<string, string>;
let confAtLaunch: boolean;
let launchOptions: { args: string[]; executablePath: string } | undefined;

beforeEach(() => {
  scratch = mkdtempSync(path.join(hostTmp, "launch-browser-"));
  lambdaTmp = path.join(scratch, "tmp");
  const task = path.join(scratch, "task");
  mkdirSync(lambdaTmp);
  mkdirSync(path.join(task, "fonts"), { recursive: true });
  for (const font of RENDER_FONTS)
    writeFileSync(path.join(task, "fonts", font.file), `bytes of ${font.file}`);
  process.chdir(task);
  env.TMPDIR = lambdaTmp;
  env.VERCEL = "1";
  env.NODE_ENV = "production";
  events = [];
  preparationGate = undefined;
  preparationFailure = undefined;
  installedAtLaunch = new Map();
  confAtLaunch = false;
  launchOptions = undefined;
});

afterEach(() => {
  process.chdir(savedCwd);
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  rmSync(scratch, { recursive: true, force: true });
});

test("the serverless Chromium starts with every render font installed for fontconfig", async () => {
  const { launchBrowser } = await import("./launch-browser");

  const browser = await launchBrowser({
    viewport: { width: 1280, height: 900 },
    args: ["--proxy-server=http://proxy:1"],
  });

  expect(browser).toEqual({ fake: "browser" } as never);
  expect(events).toEqual([
    "preparation",
    "executablePath:fonts-dir-existed=false",
    "launch",
  ]);
  expect(confAtLaunch).toBe(true);
  expect(Object.fromEntries(installedAtLaunch)).toEqual(
    Object.fromEntries(
      RENDER_FONTS.map((font) => [font.file, `bytes of ${font.file}`]),
    ),
  );
  expect(launchOptions?.args).toEqual([
    "--single-process",
    "--proxy-server=http://proxy:1",
  ]);
  expect(launchOptions?.executablePath).toBe(path.join(lambdaTmp, "chromium"));
});

test("a warm instance launches again with the fonts it already installed", async () => {
  const { launchBrowser } = await import("./launch-browser");

  await launchBrowser({ viewport: { width: 375, height: 812 } });
  await launchBrowser({ viewport: { width: 375, height: 812 } });

  expect(events.filter((e) => e === "launch")).toHaveLength(2);
  expect([...installedAtLaunch.keys()].sort()).toEqual(
    RENDER_FONTS.map((font) => font.file).sort(),
  );
});

test("a bundle without its fonts fails the launch instead of rendering blanks", async () => {
  rmSync(path.join(process.cwd(), "fonts", "NotoSansJP.ttf"));
  const { launchBrowser } = await import("./launch-browser");

  await expect(
    launchBrowser({ viewport: { width: 1280, height: 900 } }),
  ).rejects.toThrow("NotoSansJP.ttf");
  expect(events).not.toContain("launch");
});

test("concurrent cold requests prepare the shared Chromium files once before either launches", async () => {
  let release!: () => void;
  preparationGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { launchBrowser } = await import("./launch-browser");
  const first = launchBrowser({ viewport: { width: 375, height: 812 } });
  const second = launchBrowser({ viewport: { width: 420, height: 900 } });
  await Bun.sleep(20);
  const preparations = events.filter((event) => event === "preparation").length;
  const launchesBeforeReady = events.filter(
    (event) => event === "launch",
  ).length;
  release();
  await Promise.all([first, second]);
  expect(preparations).toBe(1);
  expect(launchesBeforeReady).toBe(0);
  expect(events.filter((event) => event === "launch")).toHaveLength(2);
  expect(confAtLaunch).toBe(true);
  expect(installedAtLaunch.size).toBe(RENDER_FONTS.length);
});

test("a failed shared preparation is retried by the next request", async () => {
  preparationFailure = new Error("Chromium unpack failed");
  const { launchBrowser } = await import("./launch-browser");
  const results = await Promise.allSettled([
    launchBrowser({ viewport: { width: 375, height: 812 } }),
    launchBrowser({ viewport: { width: 420, height: 900 } }),
  ]);
  expect(results.every((result) => result.status === "rejected")).toBe(true);
  expect(events).not.toContain("launch");
  const preparations = events.filter((event) => event === "preparation").length;
  preparationFailure = undefined;
  await launchBrowser({ viewport: { width: 375, height: 812 } });
  expect(preparations).toBe(1);
  expect(events.filter((event) => event === "preparation")).toHaveLength(2);
  expect(events.filter((event) => event === "launch")).toHaveLength(1);
});
