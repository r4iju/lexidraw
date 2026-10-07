/// <reference types="bun" />
import { expect, test } from "bun:test";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { act } from "react";
import { installDom, render } from "~/test/dom";
import FigmaComponent from "./FigmaComponent";

installDom("https://app.test/documents/1");

async function design(documentID: string) {
  return render(
    <LexicalComposer
      initialConfig={{
        namespace: "figma-test",
        onError: (error) => {
          throw error;
        },
      }}
    >
      <FigmaComponent
        className={{ base: "", focus: "" }}
        format={null}
        nodeKey="design"
        documentID={documentID}
      />
    </LexicalComposer>,
  );
}

test("a Figma file is busy until its frame loads, and can be opened in Figma", async () => {
  const view = await design("LKQ4FJ4bTnCSjedbRpk931");
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();

  const frame = document.querySelector("iframe");
  await act(async () => {
    frame?.dispatchEvent(new window.Event("load"));
  });
  expect(document.querySelector('[aria-busy="true"]')).toBeNull();

  const open = [...document.querySelectorAll("a")].find(
    (link) => link.textContent === "Open in Figma",
  );
  expect(open?.href).toBe("https://www.figma.com/file/LKQ4FJ4bTnCSjedbRpk931");
  await view.unmount();
});

test("a Figma file is framed through Figma's embed page for its file link", async () => {
  const view = await design("LKQ4FJ4bTnCSjedbRpk931");
  expect(document.querySelector("iframe")?.getAttribute("src")).toBe(
    "https://www.figma.com/embed?embed_host=lexidraw&url=https%3A%2F%2Fwww.figma.com%2Ffile%2FLKQ4FJ4bTnCSjedbRpk931",
  );
  // The frame draws its own scheme, so the page's dark one must not reach it.
  expect(document.querySelector("iframe")?.style.colorScheme).toBe("normal");
  await view.unmount();
});

test("a Figma block whose id names no file says none is linked, without asking Figma", async () => {
  for (const id of ["", "fixture-unavailable"]) {
    const view = await design(id);
    expect(document.body.textContent).toContain("No Figma file linked");
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("a")).toBeNull();
    await view.unmount();
  }
});
