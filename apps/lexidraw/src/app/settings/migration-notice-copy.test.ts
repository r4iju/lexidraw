import { describe, expect, test } from "bun:test";
import { selectMigrationNotice } from "./migration-notice-copy";

describe("migration notice presentation", () => {
  test("absent, missing, invalid and unsupported changed phases emit no notice", () => {
    expect(selectMigrationNotice()).toBeNull();
    for (const phase of [
      "absent",
      undefined,
      null,
      "",
      "unknown",
      "changed_unavailable",
      "changed",
      false,
      1,
      {},
      { phase: "advance" },
    ]) {
      expect(selectMigrationNotice(phase)).toBeNull();
    }
  });

  test("explicit advance emits only the exact planned change and qualified alternatives", () => {
    expect(selectMigrationNotice("advance")).toEqual({
      title: "Planned changes to cloud AI",
      paragraphs: [
        "The planned change would move new cloud AI generation supplied by Lexidraw to Pro. This advance notice does not announce that the change has taken effect.",
        "Pro is Coming soon and is not available for public purchase.",
        "Core writing and drawing remain free. This informational notice does not change your documents, drawings, or saved recordings. The planned cloud AI transition is intended to preserve them.",
        "BYOK and local AI are possible alternatives. Their availability for each feature on this device has not been confirmed in this notice.",
      ],
    });
  });
});
