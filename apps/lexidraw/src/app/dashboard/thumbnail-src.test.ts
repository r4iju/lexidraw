/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { thumbnailSrc } from "./thumbnail-src";

const BASE = "https://blob.example/thumbnails/e1-light.webp";
const EDITED = new Date("2026-09-24T10:00:00.000Z");

describe("a listing's thumbnail URL", () => {
  // The blob path is fixed per entity and overwritten by every render, so
  // only the URL tells a cache that the picture changed.
  test("changes when a new thumbnail lands, though the content did not move", () => {
    const before = thumbnailSrc(BASE, {
      updatedAt: EDITED,
      thumbnailUpdatedAt: new Date("2026-09-24T10:00:05.000Z"),
    });
    const after = thumbnailSrc(BASE, {
      updatedAt: EDITED,
      thumbnailUpdatedAt: new Date("2026-09-24T10:07:00.000Z"),
    });
    expect(after).not.toBe(before);
  });
});
