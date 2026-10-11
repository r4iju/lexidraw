import contract from "./cached-modern-destination-v1.json" with {
  type: "json",
};
import type { MigrationExecutor } from "./file-migration-owner.js";

const stop = (reason: string): never => {
  throw new Error(
    `Legacy document conversion cached modern destination STOP: ${reason}`,
  );
};
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const fold = (name: string) => name.replace(/[A-Z]/g, (c) => c.toLowerCase());
// Preserve quoting, literal values and all clauses. Only ASCII whitespace varies.
const sqlTokens = (sql: string) =>
  sql.match(/'(?:[^']|'')*'|[^\s]+/g)?.join(" ");
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, sort(x)]),
      );
    return v;
  };
  return JSON.stringify(sort(value));
}
function equal(actual: unknown, expected: unknown, reason: string) {
  if (canonical(actual) !== canonical(expected)) stop(reason);
}

/**
 * cached-modern-0036-v1: exact scoped cached physical DDL, never journal certification.
 * Complete Users data layout and Tags/EntityTags edges are required. The converter
 * separately verifies its finite synthetic source User and same-ID mapping.
 */
export async function verifyCachedModernDestinationV1(held: MigrationExecutor) {
  const master = (
    await held.execute("SELECT type,name,tbl_name,sql FROM sqlite_master")
  ).rows;
  const tables = Object.keys(contract);
  const names = new Set(tables.map(fold));
  const dependent = new RegExp(`\\b(?:${tables.join("|")})\\b`, "i");
  const scoped = master.filter(
    (r) =>
      names.has(fold(String(r.tbl_name))) ||
      dependent.test(String(r.sql ?? "")),
  );
  const expectedObjects = Object.values(contract).flatMap((s) => s.objects);
  const normalizeObjects = (rows: readonly Record<string, unknown>[]) =>
    rows
      .map((r) => ({
        type: r.type,
        name: r.name,
        tbl_name: r.tbl_name,
        sql: typeof r.sql === "string" ? sqlTokens(r.sql) : r.sql,
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  equal(
    normalizeObjects(scoped),
    normalizeObjects(expectedObjects),
    "unsupported DDL, index or dependent object",
  );
  for (const [table, spec] of Object.entries(contract)) {
    equal(
      (await held.execute(`PRAGMA table_xinfo(${quote(table)})`)).rows.map(
        (r) => ({ ...r }),
      ),
      spec.columns,
      `${table} columns/defaults/order`,
    );
    equal(
      (await held.execute(`PRAGMA foreign_key_list(${quote(table)})`)).rows.map(
        (r) => ({ ...r }),
      ),
      spec.foreignKeys,
      `${table} foreign keys`,
    );
    const indexes: Record<string, unknown>[] = [];
    for (const index of (
      await held.execute(`PRAGMA index_list(${quote(table)})`)
    ).rows) {
      const { seq: _seq, ...shape } = index;
      indexes.push({
        ...shape,
        keys: (
          await held.execute(`PRAGMA index_xinfo(${quote(String(index.name))})`)
        ).rows.map((r) => ({ ...r })),
      });
    }
    indexes.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    equal(
      indexes,
      [...spec.indexes].sort((a, b) => a.name.localeCompare(b.name)),
      `${table} indexes/keys/collation`,
    );
  }
  return master;
}
