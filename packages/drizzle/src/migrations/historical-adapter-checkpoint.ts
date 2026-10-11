import type { MigrationOwner, MigrationExecutor } from "./file-migration-owner";
import sourceLiteral from "./fixtures/historical-adapter-checkpoint-v1/source-completed-checkpoint-oracle.json";
import targetLiteral from "./fixtures/historical-adapter-checkpoint-v1/target-checkpoint-typed-oracle.json";
import targetDDL from "./fixtures/historical-adapter-checkpoint-v1/target-ddl.json";
import transform from "./fixtures/historical-adapter-checkpoint-v1/transform-manifest.json";
import receipt from "./fixtures/historical-adapter-checkpoint-v1/continuation-receipt-oracle.json";
import laterEdit from "./fixtures/historical-adapter-checkpoint-v1/certified-later-edit.json";
import finite from "./fixtures/historical-adapter-checkpoint-v1/finite-profile.json";

type Cell = [string, string | null];
type Rows = Record<string, Cell[][]>;
type Metadata = {
  xinfo: unknown[][];
  foreignKeys: unknown[][];
  indexList: unknown[][];
  indexXinfo: Record<string, unknown[][]>;
};
type State = {
  physical: {
    master: unknown[][];
    tables: Record<string, Metadata>;
    sequence: unknown[][];
    foreignKeyCheck: unknown[][];
  };
  rows: Rows;
};
const source = sourceLiteral as unknown as State;
const target = targetLiteral as unknown as State;
const nameMap: Record<string, string> = transform.tableNameMap;
const receiptTable = "HistoricalAdapterContinuationReceiptV1";
const q = (name: string) => `"${name.replaceAll('"', '""')}"`;
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map(
            (key) =>
              `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
          )
          .join(",")}}`
      : JSON.stringify(value);
function stop(reason: string): never {
  throw new Error(`STOP_HISTORICAL_ADAPTER_CHECKPOINT: ${reason}`);
}
function equal(actual: unknown, expected: unknown, reason: string) {
  if (canonical(actual) !== canonical(expected)) stop(reason);
}
function sorted(rows: Cell[][]) {
  return rows.map(canonical).sort();
}
async function tuples(
  ex: MigrationExecutor,
  sql: string,
): Promise<unknown[][]> {
  return (await ex.execute(sql)).rows.map((row) => Array.from(row));
}
function eligible([kind, exact]: Cell) {
  if (kind === "null") {
    if (exact !== null) stop("invalid NULL");
    return;
  }
  if (typeof exact !== "string") stop("invalid typed cell");
  if (kind === "integer") {
    if (
      !/^(0|-?[1-9][0-9]*)$/.test(exact) ||
      !Number.isSafeInteger(Number(exact))
    )
      stop("unsafe INTEGER");
  } else if (kind === "real") {
    if (!["4041c00000000000", "4061700000000000"].includes(exact))
      stop("uncertified REAL");
  } else if (
    !["text", "blob"].includes(kind) ||
    !/^([0-9a-f]{2})*$/.test(exact) ||
    exact.length / 2 > finite.finiteBounds.maxEncodedBytes
  )
    stop("invalid bytes");
}
async function inspect(ex: MigrationExecutor): Promise<State> {
  const master = await tuples(
    ex,
    "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type COLLATE BINARY,name COLLATE BINARY,tbl_name COLLATE BINARY",
  );
  const tables: Record<string, Metadata> = {},
    rows: Rows = {};
  let total = 0;
  for (const [type, name] of master) {
    if (type !== "table") continue;
    const table = String(name);
    const xinfo = await tuples(ex, `PRAGMA table_xinfo(${q(table)})`);
    const indexList = await tuples(ex, `PRAGMA index_list(${q(table)})`);
    const indexXinfo: Record<string, unknown[][]> = {};
    for (const index of indexList)
      indexXinfo[String(index[1])] = await tuples(
        ex,
        `PRAGMA index_xinfo(${q(String(index[1]))})`,
      );
    tables[table] = {
      xinfo,
      indexList,
      indexXinfo,
      foreignKeys: await tuples(ex, `PRAGMA foreign_key_list(${q(table)})`),
    };
    const columns = xinfo.map((column) => String(column[1]));
    const data = await tuples(
      ex,
      `SELECT ${columns
        .flatMap((column) => {
          const c = q(column);
          return [
            `typeof(${c})`,
            `CASE WHEN typeof(${c})='integer' THEN CAST(${c} AS TEXT) WHEN typeof(${c}) IN ('text','blob') THEN lower(hex(CAST(${c} AS BLOB))) ELSE ${c} END`,
          ];
        })
        .join(
          ",",
        )} FROM ${q(table)} LIMIT ${finite.finiteBounds.maxRowsPerTable + 1}`,
    );
    total += data.length;
    if (
      data.length > finite.finiteBounds.maxRowsPerTable ||
      total > finite.finiteBounds.maxTotalRows
    )
      stop("row bounds");
    rows[table] = data.map((row) =>
      columns.map((_, index): Cell => {
        const kind = String(row[2 * index]),
          value = row[2 * index + 1];
        let exact = value === null ? null : String(value);
        if (kind === "real") {
          const bytes = Buffer.alloc(8);
          bytes.writeDoubleBE(value as number);
          exact = bytes.toString("hex");
        }
        const cell: Cell = [kind, exact];
        eligible(cell);
        return cell;
      }),
    );
  }
  return {
    physical: {
      master,
      tables,
      sequence: await tuples(
        ex,
        "SELECT name,seq FROM sqlite_sequence ORDER BY name COLLATE BINARY",
      ),
      foreignKeyCheck: await tuples(ex, "PRAGMA foreign_key_check"),
    },
    rows,
  };
}
function compareRows(actual: Rows, expected: Rows) {
  equal(
    Object.keys(actual).sort(),
    Object.keys(expected).sort(),
    "closed table set",
  );
  for (const table of Object.keys(expected))
    equal(
      sorted(actual[table] as Cell[][]),
      sorted(expected[table] as Cell[][]),
      `typed rows ${table}`,
    );
}
function compare(actual: State, expected: State) {
  equal(actual.physical, expected.physical, "full physical certificate");
  compareRows(actual.rows, expected.rows);
}
function decode([kind, exact]: Cell) {
  if (kind === "null") return null;
  if (kind === "integer") return Number(exact);
  const bytes = Buffer.from(exact as string, "hex");
  return kind === "real"
    ? bytes.readDoubleBE()
    : kind === "text"
      ? bytes.toString("utf8")
      : bytes;
}
async function insert(ex: MigrationExecutor, table: string, row: Cell[]) {
  const columns = (target.physical.tables[table] as Metadata).xinfo.map(
    (column) => String(column[1]),
  );
  await ex.execute({
    sql: `INSERT INTO ${q(table)} (${columns.map(q).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    args: row.map(decode),
  });
}
export interface HistoricalAdapterCheckpointProfileV1 {
  kind: "synthetic-historical-adapter-plural-checkpoint-v1";
  onRebuilt?: (executor: MigrationExecutor) => Promise<void>;
}
export async function reconstructHistoricalAdapterCheckpoint(
  owner: MigrationOwner,
  profile: HistoricalAdapterCheckpointProfileV1,
): Promise<{ repeated: boolean }> {
  return owner.write(async (ex) => {
    if (profile.kind !== finite.profileId)
      stop("explicit finite profile required");
    equal(await tuples(ex, "PRAGMA legacy_alter_table"), [[0]], "legacy mode");
    const before = await inspect(ex);
    if (before.rows[receiptTable]) {
      equal(before.physical, target.physical, "completed physical certificate");
      // Historical receipts describe their sealed past results, separately from this one certified live edit.
      const expectedRows = structuredClone(target.rows);
      const columns = (
        target.physical.tables[laterEdit.table] as Metadata
      ).xinfo.map((column) => String(column[1]));
      const keyIndex = columns.indexOf(laterEdit.keyColumn),
        editIndex = columns.indexOf(laterEdit.column);
      const actualRow = before.rows[laterEdit.table]?.find(
        (row) => canonical(row[keyIndex]) === canonical(laterEdit.keyCell),
      );
      if (
        actualRow &&
        canonical(actualRow[editIndex]) === canonical(laterEdit.cell)
      ) {
        const expectedRow = expectedRows[laterEdit.table]?.find(
          (row) => canonical(row[keyIndex]) === canonical(laterEdit.keyCell),
        );
        if (!expectedRow) stop("uncertified edit key");
        expectedRow[editIndex] = laterEdit.cell as Cell;
      }
      compareRows(before.rows, expectedRows);
      return { repeated: true };
    }
    compare(before, source);
    const sourceOrder = targetDDL.creationOrder
      .filter((table) => Object.values(nameMap).includes(table))
      .map(
        (table) =>
          Object.keys(nameMap).find(
            (name) => nameMap[name] === table,
          ) as string,
      );
    // Capture all cells and reconcile immutable evidence before removing children.
    const captured = structuredClone(before.rows);
    for (const table of [...sourceOrder].reverse())
      await ex.execute(`DROP TABLE ${q(table)}`);
    const liveTargets = new Set(Object.values(nameMap));
    const statements = new Set(
      target.physical.master
        .filter(
          (row) =>
            (row[0] === "table" &&
              (liveTargets.has(String(row[1])) || row[1] === receiptTable)) ||
            (row[0] === "index" &&
              row[3] !== null &&
              liveTargets.has(String(row[2]))),
        )
        .map((row) => String(row[3])),
    );
    for (const sql of targetDDL.statements)
      if (statements.has(sql)) await ex.execute(sql);
    await profile.onRebuilt?.(ex);
    for (const table of sourceOrder)
      for (const row of captured[table] as Cell[][])
        await insert(ex, nameMap[table] as string, row);
    await ex.execute("DELETE FROM sqlite_sequence");
    for (const row of captured.sqlite_sequence as Cell[][]) {
      const originalName = String(decode(row[0] as Cell));
      await ex.execute({
        sql: "INSERT INTO sqlite_sequence(name,seq) VALUES (?,CAST(? AS INTEGER))",
        args: [nameMap[originalName] ?? originalName, (row[1] as Cell)[1]],
      });
    }
    compare(await inspect(ex), {
      physical: target.physical,
      rows: { ...target.rows, [receiptTable]: [] },
    });
    await insert(ex, receiptTable, receipt.typedTuple as Cell[]);
    compare(await inspect(ex), target);
    return { repeated: false };
  });
}
