import { createClient } from "@libsql/client/sqlite3";
import type { Transaction } from "@libsql/client";

export type MigrationExecutor = Pick<
  Transaction,
  "execute" | "executeMultiple"
>;

/** Owns each write's private connection through settlement and disposal. */
export interface MigrationOwner {
  write<T>(work: (executor: MigrationExecutor) => Promise<T>): Promise<T>;
}

/** Fault notifications after owner-controlled cleanup attempts; no lifecycle authority. */
export interface MigrationCleanup {
  restoreForeignKeys?(): Promise<void>;
  close?(): void;
}

export class FileMigrationError extends AggregateError {
  constructor(
    failures: unknown[],
    readonly committed: boolean | "unknown",
  ) {
    super(
      failures,
      committed === true
        ? "Migration committed, but settlement cleanup failed"
        : committed === "unknown"
          ? "Migration commit outcome is unknown; settlement failed"
          : "Migration failed before commit",
      { cause: failures[0] },
    );
    this.name = "FileMigrationError";
  }
}

/** Only explicit, non-replicated local file URLs are supported. */
export function createFileMigrationOwner(
  url: string,
  cleanup: MigrationCleanup = {},
): MigrationOwner {
  const file = new URL(url);
  if (
    file.protocol !== "file:" ||
    file.host ||
    file.search ||
    file.hash ||
    !file.pathname.startsWith("/") ||
    file.pathname === "/" ||
    file.pathname.includes(":memory:")
  ) {
    throw new Error(
      "Atomic migrations require an explicit non-replicated file URL",
    );
  }
  return {
    async write(work) {
      const client = createClient({ url, concurrency: 1, timeout: 0 });
      let transaction: Transaction | undefined;
      let committed: boolean | "unknown" = false;
      let value: Awaited<ReturnType<typeof work>> | undefined;
      const failures: unknown[] = [];
      try {
        await client.execute("PRAGMA foreign_keys=off");
        if (
          (await client.execute("PRAGMA foreign_keys")).rows[0]
            ?.foreign_keys !== 0
        ) {
          throw new Error("Could not disable foreign keys before migration");
        }
        transaction = await client.transaction("write");
        value = await work({
          execute: transaction.execute.bind(transaction),
          executeMultiple: transaction.executeMultiple.bind(transaction),
        });
        committed = "unknown";
        await transaction.commit();
        committed = true;
      } catch (error) {
        failures.push(error);
        if (transaction && !transaction.closed) {
          try {
            await transaction.rollback();
          } catch (cleanup) {
            failures.push(cleanup);
          }
        }
      } finally {
        try {
          transaction?.close();
        } catch (cleanup) {
          failures.push(cleanup);
        }
        try {
          await client.execute("PRAGMA foreign_keys=on");
          if (
            (await client.execute("PRAGMA foreign_keys")).rows[0]
              ?.foreign_keys !== 1
          ) {
            failures.push(
              new Error(
                "Could not restore foreign keys after migration settlement",
              ),
            );
          }
        } catch (cleanup) {
          failures.push(cleanup);
        }
        try {
          await cleanup.restoreForeignKeys?.();
        } catch (cleanup) {
          failures.push(cleanup);
        }
        try {
          client.close();
        } catch (cleanup) {
          failures.push(cleanup);
        }
        try {
          cleanup.close?.();
        } catch (cleanup) {
          failures.push(cleanup);
        }
      }
      if (failures.length) throw new FileMigrationError(failures, committed);
      return value as Awaited<ReturnType<typeof work>>;
    },
  };
}
