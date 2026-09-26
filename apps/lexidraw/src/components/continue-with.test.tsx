/// <reference types="bun" />
import { expect, mock, test } from "bun:test";
import { button, click, installDom, render } from "~/test/dom";
import { callbackPath } from "~/app/signin/callback-path";

installDom("https://app.test/signin");
const signIn = mock((_provider: string, _options: object) => {});
const nextAuth = await import("next-auth/react");
mock.module("next-auth/react", () => ({ ...nextAuth, signIn }));
const { ContinueWith } = await import("./continue-with");

test("a provider's sign-in returns to the page that asked for it", async () => {
  const view = await render(
    <ContinueWith
      providers={["github"]}
      callbackPath={callbackPath("/documents/abc")}
    />,
  );

  await click(button("Continue with GitHub"));

  expect(signIn).toHaveBeenCalledWith("github", {
    callbackUrl: "/documents/abc",
  });
  await view.unmount();
});
