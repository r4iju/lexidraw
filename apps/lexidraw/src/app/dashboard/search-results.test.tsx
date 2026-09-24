/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { button, click, installDom, render } from "~/test/dom";

installDom();
const { SearchResults } = await import("./search-results");

type Props = ComponentProps<typeof SearchResults>;
type Result = Props["results"][number];

const result = (overrides: Partial<Result>): Result => ({
  id: "r1",
  title: "Checkout PRD",
  entityType: "document",
  updatedAt: new Date(),
  screenShotLight: "",
  screenShotDark: "",
  folderTitle: null,
  snippet: null,
  ...overrides,
});

function props(overrides: Partial<Props> = {}): Props {
  return {
    query: "latency",
    results: [],
    loading: false,
    onClearSearch: () => {},
    ...overrides,
  };
}

const rows = () =>
  [...document.querySelectorAll("[data-search-result]")].map((row) => ({
    title: row.querySelector("[data-search-title]")?.textContent,
    where: row.querySelector("[data-search-folder]")?.textContent,
    snippet: row.querySelector("[data-search-snippet]")?.textContent ?? null,
    href: row.closest("a")?.getAttribute("href"),
  }));

describe("search results", () => {
  test("show each file's title, folder and, for a content hit, the text that matched", async () => {
    const view = await render(
      <SearchResults
        {...props({
          results: [
            result({
              id: "d1",
              folderTitle: "Design review",
              snippet: "…stays inside a latency budget of 200 ms.",
            }),
            result({ id: "w1", title: "Latency map", entityType: "drawing" }),
          ],
        })}
      />,
    );
    expect(document.body.textContent).toContain("2 files");
    expect(rows()).toEqual([
      {
        title: "Checkout PRD",
        where: "Document in Design review",
        snippet: "…stays inside a latency budget of 200 ms.",
        href: "/documents/d1",
      },
      {
        title: "Latency map",
        where: "Drawing in Home",
        snippet: null,
        href: "/drawings/w1",
      },
    ]);
    await view.unmount();
  });

  test("no results say where search looks, and offer to clear it", async () => {
    const onClearSearch = mock(() => {});
    const view = await render(
      <SearchResults {...props({ query: "zzqqxx", onClearSearch })} />,
    );
    expect(document.body.textContent).toContain("No files match “zzqqxx”.");
    expect(document.body.textContent).toContain(
      "Search looks in titles, text and tags.",
    );
    await click(button("Clear search"));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
