import { test, expect } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import {
  initialCheckpoint,
  reopen,
  inspect,
  compareState,
} from "./historical-adapter-checkpoint-test-support";
import source from "./fixtures/historical-adapter-checkpoint-v1/source-completed-checkpoint-oracle.json";
import type { State } from "./historical-adapter-checkpoint-test-support";

test("actual original idx0/1 and initial accepted adapter reconcile the complete independent source", async () => {
  const { url } = await initialCheckpoint();
  const client = await reopen(url);
  try {
    const state = await inspect(client);
    compareState(state, source as unknown as State);
    expect(state.physical.foreignKeyCheck).toEqual([]);
    const settings: Record<string, unknown> = {};
    for (const sql of [
      "SELECT sqlite_version(),sqlite_source_id()",
      "PRAGMA foreign_keys",
      "PRAGMA legacy_alter_table",
      "PRAGMA journal_mode",
      "PRAGMA encoding",
    ])
      settings[sql] = (await client.execute(sql)).rows.map((row) =>
        Array.from(row),
      );
    if (
      existsSync(
        "/Users/emanuel/.ai/working/lexidraw-276-recovery/evidence/historical-adapter-checkpoint-implementation-v1",
      )
    )
      writeFileSync(
        "/Users/emanuel/.ai/working/lexidraw-276-recovery/evidence/historical-adapter-checkpoint-implementation-v1/actual-setup-observation.json",
        `${JSON.stringify(
          {
            url,
            state,
            settings,
            actualOriginalReceipts: state.rows.__drizzle_migrations,
            copiedLedgerSeed: false,
            adapter: "initial a56 path",
            fullSourceComparison: true,
          },
          null,
          2,
        )}\n`,
      );
  } finally {
    client.close();
  }
});
