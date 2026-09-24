/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { leaveChoice } from "./leave-choice";

describe("leaving an editor with unsaved edits", () => {
  test("autosave saves them on the way out", () => {
    expect(leaveChoice({ autoSave: true, savesHeld: false })).toBe("save");
  });

  test("without autosave, the user is asked", () => {
    expect(leaveChoice({ autoSave: false, savesHeld: false })).toBe("ask");
  });

  test("while a write elsewhere stands unanswered, the user is asked even with autosave", () => {
    // Saving on the way out would answer the question by overwriting it.
    expect(leaveChoice({ autoSave: true, savesHeld: true })).toBe("ask");
  });
});
