import { expect, test } from "bun:test";
import { DeviceCheckpoint } from "./device-contracts";

test("terminal narration checkpoints reject unfinished parts at the runtime boundary", () => {
  for (const status of ["saved", "completed", "syncing", "sync_failed"]) {
    expect(
      DeviceCheckpoint.safeParse({
        version: 1,
        account: "fixture-account",
        documentId: "fixture-document",
        id: "fixture-key",
        created: 1,
        status,
        parts: [{ kind: "unknown", text: "Unconfirmed" }],
      }).success,
    ).toBe(false);
  }
});
