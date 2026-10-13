import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderKeyInput } from "./provider-key-input";

test("native pre-hydration form submission cannot serialize the provider key", () => {
  const markup = renderToStaticMarkup(
    <form>
      <ProviderKeyInput />
    </form>,
  );
  const dom = new JSDOM(markup, { url: "https://lexidraw.test/settings" });
  const input = dom.window.document.querySelector("input");
  const form = dom.window.document.querySelector("form");
  if (!input || !form) throw new Error("Missing form");
  const secret = "sk-or-distinctive-pre-hydration-key";
  input.value = secret;
  const submitted = new dom.window.FormData(form);
  expect([...submitted.values()]).not.toContain(secret);
  expect(
    new URLSearchParams(
      [...submitted.entries()].map(([key, value]) => [key, String(value)]),
    ).toString(),
  ).toBe("");
  dom.window.close();
});
