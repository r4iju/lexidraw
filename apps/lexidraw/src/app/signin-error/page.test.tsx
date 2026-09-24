import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import SignInErrorPage from "./page";

async function render(error?: string) {
  const page = await SignInErrorPage({
    searchParams: Promise.resolve(error ? { error } : {}),
  });
  return renderToStaticMarkup(page);
}

describe("sign-in error page", () => {
  test("says sign-in failed and explains the code in a sentence", async () => {
    const html = await render("OAuthAccountNotLinked");
    expect(html).toContain("We couldn’t sign you in");
    expect(html).toContain(
      "This email already has an account that signs in with a password.",
    );
  });

  test("offers one Try again and a way back to Home", async () => {
    const html = await render("AccessDenied");
    expect(html.match(/Try again<\/a>/g)).toHaveLength(1);
    expect(html).toContain('href="/signin"');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("Back to Home");
  });

  test("explains an unknown code without echoing it", async () => {
    const html = await render("<script>");
    expect(html).not.toContain("&lt;script&gt;");
    expect(html).toContain("Try again");
  });
});
