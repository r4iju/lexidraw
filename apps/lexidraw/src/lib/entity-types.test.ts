import { describe, expect, test } from "bun:test";
import { entityHref, entityTypeLabel } from "./entity-types";

describe("entity types", () => {
  test("each type has the one name people see", () => {
    expect(entityTypeLabel("document")).toBe("Document");
    expect(entityTypeLabel("drawing")).toBe("Drawing");
    expect(entityTypeLabel("directory")).toBe("Folder");
    expect(entityTypeLabel("url")).toBe("Link");
  });

  test("a link to a folder opens that folder", () => {
    expect(entityHref("directory", "f1")).toBe("/dashboard/f1");
  });

  test("a link to a file opens that file", () => {
    expect(entityHref("document", "d1")).toBe("/documents/d1");
    expect(entityHref("drawing", "w1")).toBe("/drawings/w1");
    expect(entityHref("url", "u1")).toBe("/urls/u1");
  });

  test("a planted id links to one segment under its own type's page, never another route", () => {
    const pages = {
      document: "/documents/",
      drawing: "/drawings/",
      directory: "/dashboard/",
      url: "/urls/",
    };
    const planted = [
      "../settings",
      "a/b",
      "x?tab=1",
      "#top",
      "..",
      ".",
      "%2e%2e",
      "..%2Fsettings",
      " ",
    ];
    for (const [type, page] of Object.entries(pages))
      for (const id of planted) {
        // How a browser resolves the link, dot segments and all.
        const opened = new URL(
          entityHref(type, id),
          "https://lexidraw.test/dashboard/folder",
        );
        const segment = opened.pathname.slice(page.length);
        expect({
          id,
          page: opened.pathname.startsWith(page),
          oneSegment: segment !== "" && !segment.includes("/"),
          query: opened.search + opened.hash,
        }).toEqual({ id, page: true, oneSegment: true, query: "" });
        // A dot segment cannot be spelled in a path at all; any other id is
        // what the page is handed back.
        if (id !== "." && id !== "..")
          expect(decodeURIComponent(segment)).toBe(id);
      }
  });

  test("an id that needs no escaping links as it is", () => {
    const id = "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a01";
    expect(entityHref("document", id)).toBe(`/documents/${id}`);
  });
});
