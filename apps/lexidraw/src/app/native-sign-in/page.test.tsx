/// <reference types="bun" />
import { afterEach, describe, expect, mock, test } from "bun:test";
import { prerender } from "react-dom/static";

import { installServerRuntime } from "~/test/server-runtime";

await installServerRuntime();

let session: { user: { id: string; email?: string } } | null = null;
const realAuth = await import("~/server/auth");
mock.module("~/server/auth", () => ({ ...realAuth, auth: () => session }));

const { default: NativeSignInPage } = await import("./page");

const request = {
  redirectUri: "lexidraw://auth/callback",
  codeChallenge: "hUpXCXT64j8084MaqUgQg0WokXO-TzAmwaSz4tE35b4",
  codeChallengeMethod: "S256",
  deviceName: "Emanuel’s iPhone",
};

afterEach(() => {
  session = null;
});

async function render(params: Record<string, string>) {
  const { prelude } = await prerender(
    <NativeSignInPage searchParams={Promise.resolve(params)} />,
  );
  return new Response(prelude).text();
}

const heading = (html: string) =>
  /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "";

describe("the native sign-in page", () => {
  test("offers no approval for a callback outside the allow-list", async () => {
    session = { user: { id: "page_user", email: "page@example.test" } };
    const html = await render({
      ...request,
      redirectUri: "https://evil.example/callback",
    });
    expect(heading(html)).toBe("This sign-in link doesn’t work");
    expect(html).not.toContain("/native-sign-in/approve");
    expect(html).not.toContain("evil.example");
  });

  test("asks in its own words, whatever the app calls itself", async () => {
    session = { user: { id: "page_user", email: "page@example.test" } };
    const html = await render({
      ...request,
      deviceName: "Lexidraw Security Check",
    });
    expect(heading(html)).toBe(
      "Allow the Lexidraw app to access your account?",
    );
    expect(html).toContain('action="/native-sign-in/approve"');
    expect(html).toContain("Lexidraw Security Check");
  });
});
