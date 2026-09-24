/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { leaveChoice } from "./leave-choice";

describe("leaving an editor", () => {
  test("with nothing unsaved, it just goes", () => {
    expect(
      leaveChoice({ unsaved: false, autoSave: false, savesHeld: false }),
    ).toBe("leave");
    expect(
      leaveChoice({ unsaved: false, autoSave: true, savesHeld: false }),
    ).toBe("leave");
  });

  test("with unsaved edits, autosave saves them on the way out", () => {
    expect(
      leaveChoice({ unsaved: true, autoSave: true, savesHeld: false }),
    ).toBe("save");
  });

  test("with unsaved edits and no autosave, the user is asked", () => {
    expect(
      leaveChoice({ unsaved: true, autoSave: false, savesHeld: false }),
    ).toBe("ask");
  });

  test("while a write elsewhere stands unanswered, the user is asked even with autosave", () => {
    // Saving on the way out would answer the question by overwriting it.
    expect(
      leaveChoice({ unsaved: true, autoSave: true, savesHeld: true }),
    ).toBe("ask");
    // The question stands over edits even when nothing marked them unsaved.
    expect(
      leaveChoice({ unsaved: false, autoSave: true, savesHeld: true }),
    ).toBe("ask");
  });
});
