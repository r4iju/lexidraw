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
              async restoreForeignKeys() {
                throw restoreFailure;
              },
            }
          : {}),
        close() {
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

test.each([false, true])(
  "cleanup notifications have no operation authority and preserve all failures (work rejects: %s)",
  async (workRejects) => {
    const directory = await mkdtemp("/tmp/lexidraw-atomic-migration-");
    const url = pathToFileURL(join(directory, "notifications.sqlite")).href;
    const workFailure = new Error("Synthetic work failure");
    const restoreFailure = new Error("Synthetic after-restoration failure");
    const closeFailure = new Error("Synthetic after-close failure");
    const notifications: { phase: string; args: unknown[] }[] = [];
    try {
      const owner = createFileMigrationOwner(url, {
        async restoreForeignKeys(...args: unknown[]) {
          notifications.push({ phase: "restored", args });
          throw restoreFailure;
        },
        close(...args: unknown[]) {
          notifications.push({ phase: "closed", args });
          throw closeFailure;
        },
      });
      let rejection: unknown;
      try {
        await owner.write(async (executor) => {
          await executor.execute("CREATE TABLE SyntheticRow (value TEXT)");
          if (workRejects) throw workFailure;
        });
      } catch (error) {
        rejection = error;
      }
      expect(notifications).toEqual([
        { phase: "restored", args: [] },
        { phase: "closed", args: [] },
      ]);
      expect(rejection).toBeInstanceOf(AggregateError);
      expect(rejection).toMatchObject({ committed: !workRejects });
      expect((rejection as AggregateError).errors).toEqual(
        workRejects
          ? [workFailure, restoreFailure, closeFailure]
          : [restoreFailure, closeFailure],
      );
      expect((rejection as Error).cause).toBe(
        workRejects ? workFailure : restoreFailure,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  15000,
);
