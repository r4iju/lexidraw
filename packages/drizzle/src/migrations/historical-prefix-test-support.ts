import { expect } from "bun:test";
import { createClient } from "@libsql/client/sqlite3";
import type { Client } from "@libsql/client";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runAtomicMigrations } from "./atomic-migrate";
import { createFileMigrationOwner } from "./file-migration-owner";
import contract from "./fixtures/historical-prefix-v1/contract.json";
import oracle from "./fixtures/historical-prefix-v1/oracle.json";

type Cell = [string, string | null];
type Epoch = {
  retainedSha256: string;
  entry: { when: number };
  sourceLiteralSplits: { sql: string }[];
};
export const q = (name: string) => `"${name.replaceAll('"', '""')}"`;
export function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canon(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
const values = async (client: Pick<Client, "execute">, sql: string) =>
  (await client.execute(sql)).rows.map((row) => Array.from(row));

export async function inspect(client: Pick<Client, "execute">) {
  const master = await values(
    client,
    "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type COLLATE BINARY,name COLLATE BINARY,tbl_name COLLATE BINARY",
  );
  const tables: Record<
    string,
    {
      xinfo: unknown[][];
      foreignKeys: unknown[][];
      indexList: unknown[][];
      indexXinfo: Record<string, unknown[][]>;
    }
  > = {};
  const rows: Record<string, Cell[][]> = {};
  for (const [type, name] of master) {
    if (type !== "table") continue;
    const table = String(name);
    const xinfo = await values(client, `PRAGMA table_xinfo(${q(table)})`);
    const indexList = await values(client, `PRAGMA index_list(${q(table)})`);
    const indexXinfo: Record<string, unknown[][]> = {};
    for (const index of indexList)
      indexXinfo[String(index[1])] = await values(
        client,
        `PRAGMA index_xinfo(${q(String(index[1]))})`,
      );
    tables[table] = {
      xinfo,
      foreignKeys: await values(client, `PRAGMA foreign_key_list(${q(table)})`),
      indexList,
      indexXinfo,
    };
    const columns = xinfo.map((column) => String(column[1]));
    const data = await values(
      client,
      `SELECT ${columns.flatMap((column) => [`typeof(${q(column)})`, `CASE WHEN typeof(${q(column)})='integer' THEN CAST(${q(column)} AS TEXT) WHEN typeof(${q(column)}) IN ('text','blob') THEN lower(hex(CAST(${q(column)} AS BLOB))) ELSE ${q(column)} END`]).join(",")} FROM ${q(table)}`,
    );
    rows[table] = data.map((row) =>
      columns.map((_, index): Cell => {
        const kind = String(row[index * 2]);
        const value = row[index * 2 + 1];
        if (kind === "real") {
          const bytes = Buffer.alloc(8);
          bytes.writeDoubleBE(Number(value));
          return [kind, bytes.toString("hex")];
        }
        return [kind, value === null ? null : String(value)];
      }),
    );
  }
  return {
    physical: {
      master,
      tables,
      sequence: await values(
        client,
        "SELECT name,seq FROM sqlite_sequence ORDER BY name COLLATE BINARY",
      ),
      foreignKeyCheck: await values(client, "PRAGMA foreign_key_check"),
    },
    rows,
  };
}

function decode([kind, value]: Cell) {
  if (kind === "null") return null;
  if (kind === "integer") return Number(value);
  const bytes = Buffer.from(value as string, "hex");
  return kind === "real"
    ? bytes.readDoubleBE()
    : kind === "text"
      ? bytes.toString("utf8")
      : bytes;
}

export async function bootstrap() {
  const directory = mkdtempSync("/tmp/lexidraw-historical-adapter-bootstrap-");
  const url = `file:${directory}/source.sqlite`;
  const folder = fileURLToPath(
    new URL(
      "./fixtures/historical-prefix-v1/original-bootstrap/",
      import.meta.url,
    ),
  );
  const epochs = (
    JSON.parse(
      Buffer.from(
        oracle.receipt.fixedFields.sourceEpochAndSplitManifest.exact,
        "hex",
      ).toString("utf8"),
    ) as Epoch[]
  ).slice(0, 2);
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  expect(migrations.map((m) => [m.hash, m.folderMillis, m.sql])).toEqual(
    epochs.map((e) => [
      e.retainedSha256,
      e.entry.when,
      e.sourceLiteralSplits.map((s) => s.sql),
    ]),
  );
  const forwarded: string[] = [];
  const owner = createFileMigrationOwner(url);
  await runAtomicMigrations(
    {
      write: (work) =>
        owner.write(async (executor) => {
          expect(
            (await executor.execute("PRAGMA foreign_keys")).rows.map((row) =>
              Array.from(row),
            ),
          ).toEqual([[0]]);
          expect(
            (await executor.execute("PRAGMA legacy_alter_table")).rows.map(
              (row) => Array.from(row),
            ),
          ).toEqual([[0]]);
          return work({
            execute: executor.execute.bind(executor),
            executeMultiple: async (sql) => {
              forwarded.push(sql);
              await executor.executeMultiple(sql);
            },
          });
        }),
    },
    { migrationsFolder: folder },
    async (_, latest) => expect(latest).toBeUndefined(),
  );
  expect(forwarded).toEqual(
    epochs.flatMap((e) => e.sourceLiteralSplits.map((s) => s.sql)),
  );
  const client = createClient({ url, concurrency: 1, timeout: 0 });
  try {
    await client.execute("PRAGMA foreign_keys=ON");
    expect(await values(client, "PRAGMA foreign_keys")).toEqual([[1]]);
    expect(await values(client, "PRAGMA legacy_alter_table")).toEqual([[0]]);
    const seed = oracle.seed.identityPayload;
    const columns = seed.sourceColumns as Record<string, string[]>;
    const seedRows = seed.sourceTypedRows as unknown as Record<
      string,
      Cell[][]
    >;
    for (const table of contract.order.sourceCreationAndInsertion) {
      const names = columns[table] as string[];
      for (const row of seedRows[table] as Cell[][])
        await client.execute({
          sql: `INSERT INTO ${q(table)} (${names.map(q).join(",")}) VALUES (${names.map(() => "?").join(",")})`,
          args: row.map(decode),
        });
    }
    for (const [table, seq] of Object.entries(seed.sourceSequence))
      await client.execute({
        sql: "UPDATE sqlite_sequence SET seq=CAST(? AS INTEGER) WHERE name=?",
        args: [seq, table],
      });
    const state = await inspect(client);
    const { scope: _, ...physical } = contract.sourcePhysical;
    expect(state.physical).toEqual(physical);
    const sorted = (rows: unknown[]) => rows.map(canon).sort();
    for (const [table, rows] of Object.entries(seed.sourceTypedRows))
      expect(sorted(state.rows[table] as Cell[][])).toEqual(sorted(rows));
    expect(
      sorted(
        (state.rows.__drizzle_migrations as Cell[][]).map((row) => row.flat()),
      ),
    ).toEqual(sorted(seed.copiedLedgerRows));
    expect(
      await values(
        client,
        "SELECT name,typeof(seq),CAST(seq AS TEXT) FROM sqlite_sequence ORDER BY name COLLATE BINARY",
      ),
    ).toEqual(
      Object.entries(seed.sourceSequence)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([table, seq]) => [table, "integer", seq]),
    );
    return { url };
  } finally {
    client.close();
  }
}
