import { expect, test } from "bun:test";
import { createClient } from "@libsql/client/sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createFileMigrationOwner } from "../src/migrations/file-migration-owner";

test.each([false, true])(
  "cleanup rejection reports committed rows and preserves causes (restoration fault: %s)",
  async (restorationFault) => {
    const directory = await mkdtemp("/tmp/lexidraw-atomic-migration-");
    const url = pathToFileURL(join(directory, "cleanup.sqlite")).href;
    const closeFailure = new Error(
      "Synthetic close failure after actual close",
    );
    const restoreFailure = new Error("Synthetic restoration cleanup failure");
    let observer: ReturnType<typeof createClient> | undefined;
    try {
      const owner = createFileMigrationOwner(url, {
        ...(restorationFault
          ? {
              async restoreForeignKeys(restore: () => Promise<void>) {
                await restore();
                throw restoreFailure;
              },
            }
          : {}),
        close(close) {
          close();
          throw closeFailure;
        },
      });
      let rejection: unknown;
      try {
        await owner.write(async (executor) => {
          await executor.executeMultiple(
            "CREATE TABLE CommittedRow (value TEXT NOT NULL); INSERT INTO CommittedRow VALUES ('literal committed row');",
          );
        });
      } catch (error) {
        rejection = error;
      }
      observer = createClient({ url, concurrency: 1, timeout: 0 });
      expect<unknown>(
        (await observer.execute("SELECT value FROM CommittedRow")).rows,
      ).toEqual([{ value: "literal committed row" }]);
      expect(rejection).toMatchObject({ committed: true });
      expect(rejection).toBeInstanceOf(AggregateError);
      expect((rejection as AggregateError).errors).toEqual(
        restorationFault ? [restoreFailure, closeFailure] : [closeFailure],
      );
      expect((rejection as Error).cause).toBe(
        restorationFault ? restoreFailure : closeFailure,
      );
    } finally {
      observer?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  15000,
);
