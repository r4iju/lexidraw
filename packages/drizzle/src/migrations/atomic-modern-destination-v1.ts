import contract from "./atomic-modern-destination-v1.json" with {
  type: "json",
};
import type { MigrationExecutor } from "./file-migration-owner.js";

export const quoteAtomicIdentifier = (name: string) =>
  `"${name.replaceAll('"', '""')}"`;
export function atomicIdentity(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v !== null && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, canonical(x)]),
      );
    return v;
  };
  return JSON.stringify(canonical(value));
}
export function atomicEqual(
  actual: unknown,
  expected: unknown,
  reason: string,
): void {
  if (atomicIdentity(actual) !== atomicIdentity(expected))
    throw new Error(`Atomic document continuation STOP: ${reason}`);
}
export interface AtomicTableState {
  columns: Record<string, unknown>[];
  foreignKeys: Record<string, unknown>[];
  indexes: (Record<string, unknown> & { keys: Record<string, unknown>[] })[];
  rows: Record<string, unknown>[];
}
export interface AtomicPhysicalState {
  master: {
    type: string;
    name: string;
    tbl_name: string;
    sql: string | null;
  }[];
  tables: Record<string, AtomicTableState>;
}

/** Full typed state read on the caller's held executor, without connection ownership. */
export async function inspectAtomicState(
  held: Pick<MigrationExecutor, "execute">,
  bounds?: { maxRows: number; maxBytes: number },
): Promise<AtomicPhysicalState> {
  if (
    bounds &&
    (!Number.isSafeInteger(bounds.maxRows) ||
      !Number.isSafeInteger(bounds.maxBytes) ||
      bounds.maxRows < 0 ||
      bounds.maxBytes < 0)
  )
    throw new Error(
      "Atomic document continuation STOP: finite inspection bounds required",
    );
  const master = (
    await held.execute(
      "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name",
    )
  ).rows.map((r) => ({
    type: String(r.type),
    name: String(r.name),
    tbl_name: String(r.tbl_name),
    sql: r.sql === null ? null : String(r.sql),
  }));
  const tables: Record<string, AtomicTableState> = {};
  for (const t of master) {
    if (t.type !== "table") continue;
    const q = quoteAtomicIdentifier(t.name);
    const columns = (await held.execute(`PRAGMA table_xinfo(${q})`)).rows.map(
      (r) => ({ ...r }),
    );
    if (bounds) {
      const bytes = columns
        .map(
          (c) =>
            `coalesce(length(CAST(${quoteAtomicIdentifier(String(c.name))} AS BLOB)),0)`,
        )
        .join("+");
      const inventory = (
        await held.execute(
          `SELECT count(*) AS count,coalesce(sum(${bytes}),0) AS size FROM ${q}`,
        )
      ).rows[0];
      if (
        !inventory ||
        Number(inventory.count) > bounds.maxRows ||
        Number(inventory.size) > bounds.maxBytes
      )
        throw new Error(
          "Atomic document continuation STOP: bounded typed inventory exceeded",
        );
    }
    const indexes: AtomicTableState["indexes"] = [];
    for (const index of (await held.execute(`PRAGMA index_list(${q})`)).rows)
      indexes.push({
        ...index,
        keys: (
          await held.execute(
            `PRAGMA index_xinfo(${quoteAtomicIdentifier(String(index.name))})`,
          )
        ).rows.map((r) => ({ ...r })),
      });
    const expressions = columns.flatMap((c, i) => [
      `typeof(${quoteAtomicIdentifier(String(c.name))}) t${i}`,
      `hex(CAST(${quoteAtomicIdentifier(String(c.name))} AS BLOB)) v${i}`,
    ]);
    tables[t.name] = {
      columns,
      indexes,
      foreignKeys: (
        await held.execute(`PRAGMA foreign_key_list(${q})`)
      ).rows.map((r) => ({ ...r })),
      rows: (
        await held.execute(
          `SELECT ${expressions.join(",")} FROM ${q} ORDER BY ${expressions.map((_, i) => i + 1).join(",")}`,
        )
      ).rows.map((r) => ({ ...r })),
    };
  }
  return { master, tables };
}

/** Closed synthetic dependency set, distinct from cached and historical profiles. */
export async function verifyAtomicModernDestinationV1(
  held: MigrationExecutor,
  layout: "legacyNormalized" | "absentCreated",
  sourceUserName: "User" | "ArchivedSyntheticUser" = "User",
) {
  const state = await inspectAtomicState(held);
  const spec = JSON.parse(
    JSON.stringify(contract.profiles[layout]),
  ) as typeof contract.profiles.legacyNormalized;
  if (sourceUserName !== "User") {
    for (const r of spec.master)
      if (r.sql)
        r.sql = r.sql.replaceAll(
          "REFERENCES `User`",
          'REFERENCES "ArchivedSyntheticUser"',
        );
    for (const t of Object.values(spec.tables))
      for (const fk of t.foreignKeys)
        if (fk.table === "User") fk.table = sourceUserName;
  }
  const names = new Set(Object.keys(spec.tables));
  const dependent = new RegExp(`\\b(?:${[...names].join("|")})\\b`, "i");
  const actual = state.master.filter(
    (r) => names.has(r.tbl_name) || dependent.test(r.sql ?? ""),
  );
  atomicEqual(
    actual,
    spec.master,
    "unsupported atomic modern dependency objects",
  );
  for (const [name, expected] of Object.entries(spec.tables)) {
    const actual = state.tables[name];
    if (!actual)
      throw new Error(
        "Atomic document continuation STOP: missing destination table",
      );
    const { rows: _rows, ...physical } = actual;
    atomicEqual(physical, expected, `${name} physical contract`);
  }
  return (
    await held.execute("SELECT type,name,tbl_name,sql FROM sqlite_master")
  ).rows;
}
