/**
 * Scripts that drive the local dev stack: signing a browser in with the dev
 * account and running the CLI against the dev app.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { Page } from "puppeteer";
import { z } from "zod";

const root = fileURLToPath(new URL("../../../", import.meta.url));

const devAccount = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});
const session = z.object({ user: z.unknown().optional() }).nullable();

/** `~/.lexidraw-dev-account`: `email=` and `password=` lines. */
async function readDevAccount() {
  const lines = (await readFile(`${homedir()}/.lexidraw-dev-account`, "utf8"))
    .trim()
    .split("\n");
  const credentials = devAccount.safeParse(
    Object.fromEntries(
      lines.map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line
            .slice(separator + 1)
            .trim()
            .replace(/^['"]|['"]$/g, ""),
        ];
      }),
    ),
  );
  assert(credentials.success, "Missing dev credentials");
  return credentials.data;
}

/** Signs `page` in to the dev app at `appUrl`, unless it already is. */
export async function signInToDev(page: Page, appUrl: string) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.isInterceptResolutionHandled()) return;
    if (request.url().includes("react-scan")) void request.abort();
    else void request.continue();
  });
  await page.goto(`${appUrl}/signin`, { waitUntil: "networkidle2" });
  const reply: unknown = await page.evaluate(() =>
    fetch("/api/auth/session").then((response) => response.json()),
  );
  if (session.parse(reply)?.user) return;
  const credentials = await readDevAccount();
  await page.locator('input[name="email"]').fill(credentials.email);
  await page.locator('input[name="password"]').fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => location.pathname === "/dashboard");
}

/**
 * The CLI with its dev profile, against the dev app at `appUrl`: it runs
 * with the given arguments and gives back the JSON it prints, or null for
 * nothing.
 */
export function devCli(appUrl: string) {
  return async (...args: string[]): Promise<unknown> => {
    const child = Bun.spawn(
      ["bun", `${root}apps/cli/src/main.ts`, "--profile", "dev", ...args],
      {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
        // Never let a shell override send this to production.
        env: {
          ...process.env,
          LEXIDRAW_URL: appUrl,
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
    return stdout.trim() ? JSON.parse(stdout) : null;
  };
}
