/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { ViewFilter, FilterHint } from "./view-filter";

const at = (html: string) => new JSDOM(html).window.document;

describe("Home's view control", () => {
  test("offers All, Favorites and Archived, labelled, with the current one marked", () => {
    const doc = at(
      renderToStaticMarkup(
        <ViewFilter
          view="favorites"
          pathname="/dashboard"
          searchParams={new URLSearchParams("sortBy=title")}
        />,
      ),
    );
    const links = [...doc.querySelectorAll("a")];
    expect(links.map((link) => link.textContent)).toEqual([
      "All",
      "Favorites",
      "Archived",
    ]);
    expect(
      links.find((link) => link.getAttribute("aria-current"))?.textContent,
    ).toBe("Favorites");
    expect(links[2]?.getAttribute("href")).toBe(
      "/dashboard?sortBy=title&view=archived",
    );
  });

  test("says what is filtered, with a way to clear it", () => {
    const doc = at(
      renderToStaticMarkup(
        <FilterHint
          view="favorites"
          tags="recipes"
          pathname="/dashboard"
          searchParams={new URLSearchParams("view=favorites&tags=recipes")}
        />,
      ),
    );
    expect(doc.body.textContent).toContain(
      "Filtered: Favorites, tagged recipes",
    );
    const clear = [...doc.querySelectorAll("a")].find(
      (link) => link.textContent === "Clear",
    );
    expect(clear?.getAttribute("href")).toBe("/dashboard?view=all&tags=");
  });

  test("says nothing when nothing is filtered", () => {
    expect(
      renderToStaticMarkup(
        <FilterHint
          view="all"
          pathname="/dashboard"
          searchParams={new URLSearchParams()}
        />,
      ),
    ).toBe("");
  });
});
