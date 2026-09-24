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
});
