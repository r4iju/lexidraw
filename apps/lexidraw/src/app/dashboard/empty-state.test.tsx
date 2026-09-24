/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState } from "./empty-state";

type Props = ComponentProps<typeof EmptyState>;

function at(props: Partial<Props>) {
  const html = renderToStaticMarkup(
    <EmptyState
      inFolder={false}
      view="all"
      pathname="/dashboard"
      searchParams={new URLSearchParams("sortBy=title")}
      action={<button type="button">New</button>}
      {...props}
    />,
  );
  const doc = new JSDOM(html).window.document;
  const links = [...doc.querySelectorAll("a")].map((link) => ({
    text: link.textContent,
    href: link.getAttribute("href"),
  }));
  return {
    heading: doc.querySelector("h2")?.textContent,
    text: doc.body.textContent ?? "",
    links,
    hasNew: [...doc.querySelectorAll("button")].some(
      (b) => b.textContent === "New",
    ),
  };
}

describe("Home when there is nothing to show", () => {
  test("a new account is told how to start, with the New menu", () => {
    const empty = at({});
    expect(empty.heading).toBe("Nothing here yet");
    expect(empty.text).toContain("Create a document or a drawing");
    expect(empty.hasNew).toBe(true);
    expect(empty.links).toEqual([]);
  });

  test("an empty folder says so, with the New menu", () => {
    const empty = at({ inFolder: true, pathname: "/dashboard/f1" });
    expect(empty.heading).toBe("This folder is empty");
    expect(empty.text).toContain("Drag files here, or create something new.");
    expect(empty.hasNew).toBe(true);
  });

  test("no favorites says how to add one, and offers all files", () => {
    const empty = at({ view: "favorites" });
    expect(empty.heading).toBe("No favorites yet");
    expect(empty.text).toContain("Add to favorites");
    expect(empty.hasNew).toBe(true);
    expect(empty.links).toEqual([
      { text: "Show all files", href: "/dashboard?sortBy=title&view=all" },
    ]);
  });

  test("nothing archived explains what archiving does", () => {
    const empty = at({ view: "archived" });
    expect(empty.heading).toBe("Nothing archived");
    expect(empty.text).toContain(
      "Archived files are hidden from Home but kept until you delete them.",
    );
    expect(empty.links.map((link) => link.text)).toEqual(["Show all files"]);
  });

  test("a tag filter that matches nothing offers to clear the filters", () => {
    const empty = at({
      view: "favorites",
      tags: "recipes",
      pathname: "/dashboard/f1",
      inFolder: true,
    });
    expect(empty.text).toContain("recipes");
    expect(empty.links).toEqual([
      {
        text: "Clear filters",
        href: "/dashboard/f1?sortBy=title&view=all&tags=",
      },
    ]);
  });
});
