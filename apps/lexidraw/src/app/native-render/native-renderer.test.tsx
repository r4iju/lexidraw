/// <reference types="bun" />
import { installDom, render } from "~/test/dom";

installDom("https://app.test/native-render");

import { expect, test } from "bun:test";
import { act } from "react";

const { default: NativeRenderer } = await import("./native-renderer");

const text = (value: string) => ({
  type: "text",
  version: 1,
  text: value,
  format: 0,
  detail: 0,
  mode: "normal",
  style: "",
});

test("a code block rendered for iOS numbers its lines when asked to", async () => {
  const view = await render(<NativeRenderer />);
  await act(async () => {
    window.renderNativeEmbed?.({
      node: {
        type: "code",
        version: 1,
        language: "python",
        showLineNumbers: true,
        children: [
          text("def one():"),
          { type: "linebreak", version: 1 },
          text("    return 1"),
        ],
        direction: null,
        format: "",
        indent: 0,
      },
      theme: "light",
      width: 358,
      fontFamily: "system-ui",
      fontSize: 16,
    });
  });
  expect(
    [...document.querySelectorAll("[data-line-number]")].map((line) =>
      line.getAttribute("data-line-number"),
    ),
  ).toEqual(["1", "2"]);
  await view.unmount();
});
