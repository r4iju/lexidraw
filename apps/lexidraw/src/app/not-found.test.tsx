/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import type { AppBarAccount } from "~/components/app-bar/account-menu";
import { installDom, render } from "~/test/dom";

installDom("https://app.test/no-such-page");

mock.module("next/navigation", () => ({
  usePathname: () => "/no-such-page",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
let account: AppBarAccount | null = null;
mock.module("~/server/app-bar-account", () => ({
  appBarAccount: async () => account,
}));
// The site's own header reads the session on the server; its place is enough.
mock.module("~/sections/header", () => ({
  default: () => <header data-component-name="MarketingHeader" />,
}));
const { default: NotFound } = await import("./not-found");

const bar = () =>
  document.querySelector("header")?.getAttribute("data-component-name");
const crumbs = () =>
  [...document.querySelectorAll("nav[aria-label=Breadcrumb] li")].map(
    (crumb) => ({
      text: crumb.textContent,
      href: crumb.querySelector("a")?.getAttribute("href") ?? null,
      current: crumb.getAttribute("aria-current"),
    }),
  );

describe("a page that is not there", () => {
  test("is under the app bar for someone signed in, a step from Home", async () => {
    account = {
      id: "u1",
      name: "Ada",
      email: "ada@example.test",
      isAdmin: false,
    };
    const view = await render(await NotFound());
    expect(bar()).toBe("AppBar");
    expect(crumbs()).toEqual([
      { text: "Home", href: "/dashboard", current: null },
      { text: "Page not found", href: null, current: "page" },
    ]);
    await view.unmount();
  });

  test("is under the site's header for a visitor", async () => {
    account = null;
    const view = await render(await NotFound());
    expect(bar()).toBe("MarketingHeader");
    await view.unmount();
  });
});
