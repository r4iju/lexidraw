import { expect, test } from "bun:test";
import { createClient } from "@libsql/client/sqlite3";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runAtomicMigrations } from "../src/migrations/atomic-migrate";
import { createFileMigrationOwner } from "../src/migrations/file-migration-owner";

const fixture = join(import.meta.dir, "fixtures/e4-atomic");
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("10s migration barrier deadline")),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("empty original 0002 inspection excludes competing file writes, commits original rows and repeats without duplicate receipts", async () => {
  const directory = await mkdtemp("/tmp/lexidraw-atomic-migration-");
  const url = pathToFileURL(join(directory, "fixture.sqlite")).href;
  const competitor = createClient({ url, concurrency: 1, timeout: 0 });
  const inspected = signal();
  const resume = signal();
  let running: Promise<void> | undefined;
  try {
    for (const name of ["schema.sql", "rows.sql"]) {
      const contents = await readFile(join(fixture, name), "utf8");
      for (const statement of contents.split("--> statement-breakpoint"))
        await competitor.execute(statement);
    }
    const owner = createFileMigrationOwner(url);
    const config = { migrationsFolder: fixture };
    running = runAtomicMigrations(owner, config, async (executor, latest) => {
      expect(latest).toBeUndefined();
      expect(
        (await executor.execute("SELECT count(*) AS n FROM Document")).rows[0]
          ?.n,
      ).toBe(0);
      expect(
        (await executor.execute("SELECT count(*) AS n FROM SharedDocument"))
          .rows[0]?.n,
      ).toBe(0);
      inspected.resolve();
      await bounded(resume.promise);
    });
    // Attach immediately so deadline or setup failures cannot leak a rejection.
    const outcome = running.then(
      () => undefined,
      (error) => error,
    );
    await bounded(
      Promise.race([
        inspected.promise,
        outcome.then((error) => {
          throw error ?? new Error("Inspection not reached");
        }),
      ]),
    );
    let competingError: unknown;
    try {
      await competitor.execute(
        "INSERT INTO Document VALUES ('race','race','{}',1,1,NULL,'user-atomic','private')",
      );
    } catch (error) {
      competingError = error;
    }
    console.log(
      "R1 competing result",
      competingError ? String(competingError) : "INSERT SUCCEEDED",
    );
    expect((competingError as { code?: string } | undefined)?.code).toBe(
      "SQLITE_BUSY",
    );
    expect(
      (await competitor.execute("SELECT count(*) AS n FROM Document")).rows[0]
        ?.n,
    ).toBe(0);
    resume.resolve();
    await bounded(running);
    expect(
      (
        await competitor.execute(
          "SELECT name FROM sqlite_master WHERE name IN ('Document','SharedDocument')",
        )
      ).rows,
    ).toEqual([]);
    expect<unknown>(
      (await competitor.execute("SELECT * FROM Entity")).rows,
    ).toEqual([
      {
        id: "drawing-atomic",
        title: "Literal title",
        elements: '{"opaque":"α\\\\tail"}',
        appState: '{"zoom":1}',
        createdAt: 11,
        updatedAt: 22,
        deletedAt: null,
        userId: "user-atomic",
        publicAccess: "private",
        entityType: "drawing",
      },
    ]);
    expect<unknown>(
      (await competitor.execute("SELECT * FROM SharedEntity")).rows,
    ).toEqual([
      {
        id: "share-atomic",
        entityId: "drawing-atomic",
        userId: "user-atomic",
        accessLevel: "read",
        createdAt: 33,
      },
    ]);
    const receipt = JSON.parse(
      await readFile(join(fixture, "receipt.json"), "utf8"),
    );
    const receipts = (
      await competitor.execute(
        "SELECT id,hash,created_at FROM __drizzle_migrations",
      )
    ).rows;
    expect(receipts).toEqual([{ id: null, ...receipt }]);
    await runAtomicMigrations(owner, config, async (_executor, latest) => {
      expect(latest).toEqual(receipts[0]);
    });
    expect(
      (
        await competitor.execute(
          "SELECT id,hash,created_at FROM __drizzle_migrations",
        )
      ).rows,
    ).toEqual(receipts);
    expect<unknown>(
      (await competitor.execute("SELECT id FROM Entity")).rows,
    ).toEqual([{ id: "drawing-atomic" }]);
  } finally {
    resume.resolve();
    if (running) await bounded(running).catch(() => undefined);
    competitor.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
