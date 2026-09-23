/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { StaleDocumentError } from "./conflict";

describe("StaleDocumentError", () => {
  test("names the revision the caller has to retry against", () => {
    const error = new StaleDocumentError(new Date("2026-09-23T10:00:00.000Z"));
    expect(error.currentUpdatedAt.toISOString()).toBe(
      "2026-09-23T10:00:00.000Z",
    );
    expect(error.message).toBe(
      "Document was modified at 2026-09-23T10:00:00.000Z; re-read it and retry with the new updatedAt",
    );
  });
});
