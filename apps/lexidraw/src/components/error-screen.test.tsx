/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { button, click, installDom, render } from "~/test/dom";

installDom();
const { AppError, NotFoundScreen } = await import("./error-screen");

const links = () =>
  [...document.querySelectorAll("a")].map((link) => ({
    text: link.textContent,
    href: link.getAttribute("href"),
  }));

describe("error screens", () => {
  test("a render error says what happened, retries, and leads back to Home", async () => {
    const reset = mock(() => {});
    const view = await render(
      <AppError title="This document couldn’t be opened" reset={reset} />,
    );
    expect(document.querySelector("h1")?.textContent).toBe(
      "This document couldn’t be opened",
    );
    expect(links()).toEqual([{ text: "Back to Home", href: "/dashboard" }]);
    await click(button("Try again"));
    expect(reset).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  test("a signed-in 404 leads back to Home", async () => {
    const view = await render(<NotFoundScreen signedIn />);
    expect(document.querySelector("h1")?.textContent).toBe("Page not found");
    expect(document.body.textContent).toContain(
      "The link may be broken, or the file was moved or deleted.",
    );
    expect(links()).toEqual([{ text: "Back to Home", href: "/dashboard" }]);
    await view.unmount();
  });

  test("a signed-out 404 leads to the landing page", () => {
    const html = renderToStaticMarkup(<NotFoundScreen signedIn={false} />);
    expect(html).toContain('href="/"');
    expect(html).not.toContain("/dashboard");
  });
});
