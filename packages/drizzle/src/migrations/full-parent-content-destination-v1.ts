import type { MigrationExecutor } from "./file-migration-owner.js";
import { Buffer } from "node:buffer";
import literal from "./full-parent-content-destination-v1.json" with { type: "json" };

export type TypedCell = [string, string | null];
export type ContentState = {
  orderedColumns: Record<string, string[]>;
  rows: Record<string, TypedCell[][]>;
  physical: {
    master: unknown[][];
    tables: Record<string, unknown>;
    sequence: unknown[][];
  };
};
export const destination = literal as unknown as {
  profile: string;
  source: ContentState;
  target: ContentState;
  receipt: { orderedColumns: string[]; typedTuple: TypedCell[] };
  supply: {
    entityKeyedAdditions: { id: string; values: Record<string, TypedCell> }[];
  };
  ddl: { statements: string[] };
  bridge: {
    inputRows: { sourceTable: string; typedArchiveTuple: TypedCell[] }[];
    certifiedShareUpdatedAt: TypedCell;
    liveDocumentReconciliation: Record<string, TypedCell>;
    liveShareReconciliation: Record<string, TypedCell>;
  };
};
export const quoteContentName = (name: string) =>
  `"${name.replaceAll('"', '""')}"`;
export function requireContentValue<T>(value: T | undefined, label: string): T {
  if (value === undefined)
    throw new Error(`STOP_FULL_PARENT_CONTENT: missing ${label}`);
  return value;
}
export function contentCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(contentCanonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${contentCanonical(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
export function requireContentEqual(
  actual: unknown,
  expected: unknown,
  label: string,
): void {
  if (contentCanonical(actual) !== contentCanonical(expected))
    throw new Error(`STOP_FULL_PARENT_CONTENT: ${label}`);
}
export function decodeContentCell([kind, value]: TypedCell):
  | null
  | string
  | number
  | bigint
  | Uint8Array {
  if (kind === "null") return null;
  if (value === null)
    throw new Error("STOP_FULL_PARENT_CONTENT: null representation");
  if (kind === "integer") return BigInt(value);
  if (kind === "real") return Buffer.from(value, "hex").readDoubleBE();
  const bytes = Buffer.from(value, "hex");
  if (kind === "blob") return bytes;
  if (kind === "text") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    requireContentEqual(
      Buffer.from(text).toString("hex"),
      value,
      "TEXT round trip",
    );
    return text;
  }
  throw new Error("STOP_FULL_PARENT_CONTENT: storage class");
}
export async function readFullParentContent(
  executor: MigrationExecutor,
): Promise<ContentState> {
  const values = async (sql: string): Promise<unknown[][]> =>
    (await executor.execute(sql)).rows.map((row) => Array.from(row));
  const master = await values(
    "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type COLLATE BINARY,name COLLATE BINARY,tbl_name COLLATE BINARY",
  );
  const tables: Record<string, unknown> = {},
    rows: ContentState["rows"] = {},
    orderedColumns: ContentState["orderedColumns"] = {};
  for (const [kind, name] of master) {
    if (kind !== "table") continue;
    const table = String(name),
      quoted = quoteContentName(table);
    const xinfo = await values(`PRAGMA table_xinfo(${quoted})`);
    const indexList = await values(`PRAGMA index_list(${quoted})`);
    const indexXinfo: Record<string, unknown[][]> = {};
    for (const index of indexList)
      indexXinfo[String(index[1])] = await values(
        `PRAGMA index_xinfo(${quoteContentName(String(index[1]))})`,
      );
    tables[table] = {
      xinfo,
      indexList,
      indexXinfo,
      foreignKeys: await values(`PRAGMA foreign_key_list(${quoted})`),
    };
    const columns = xinfo.map((column) => String(column[1]));
    orderedColumns[table] = columns;
    const pairs = columns.flatMap((name) => {
      const col = quoteContentName(name);
      return [
        `typeof(${col})`,
        `CASE WHEN typeof(${col})='integer' THEN CAST(${col} AS TEXT) WHEN typeof(${col}) IN ('text','blob') THEN lower(hex(CAST(${col} AS BLOB))) ELSE ${col} END`,
      ];
    });
    const tuples = await values(`SELECT ${pairs.join(",")} FROM ${quoted}`);
    rows[table] = tuples.map((row) =>
      columns.map((_, index): TypedCell => {
        const kind = String(row[2 * index]),
          value = row[2 * index + 1];
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
        "SELECT name,seq FROM sqlite_sequence ORDER BY name COLLATE BINARY",
      ),
    },
    orderedColumns,
    rows,
  };
}
export function requireFullParentState(
  actual: ContentState,
  expected: ContentState,
): void {
  for (const field of ["master", "tables", "sequence"] as const) {
    requireContentEqual(
      actual.physical[field],
      expected.physical[field],
      `complete physical certificate ${field}`,
    );
  }
  requireContentEqual(
    actual.orderedColumns,
    expected.orderedColumns,
    "complete ordered columns",
  );
  requireContentEqual(
    Object.keys(actual.rows).sort(),
    Object.keys(expected.rows).sort(),
    "complete table set",
  );
  for (const table of Object.keys(expected.rows)) {
    const multiset = (rows: TypedCell[][]) => rows.map(contentCanonical).sort();
    requireContentEqual(
      multiset(requireContentValue(actual.rows[table], table)),
      multiset(requireContentValue(expected.rows[table], table)),
      `complete typed rows ${table}`,
    );
  }
}
export async function validateFullParentContentSource(
  executor: MigrationExecutor,
): Promise<void> {
  requireFullParentState(
    await readFullParentContent(executor),
    destination.source,
  );
}
export async function validateFullParentContentCompletion(
  executor: MigrationExecutor,
): Promise<void> {
  requireFullParentState(
    await readFullParentContent(executor),
    destination.target,
  );
}
