import {
  generateSQLiteMigration,
  type DrizzleSQLiteSnapshotJSON,
} from "drizzle-kit/api";
import { isDeepStrictEqual } from "node:util";
import contract from "./retention-archive-contract.json" with { type: "json" };

const names = Object.keys(
  contract.physical,
) as (keyof typeof contract.physical)[];

/**
 * V1 raw archives and conversion receipts are manual-migration-only. Their exact
 * sqlite_master DDL and inline identity constraints are durable contracts. Kit
 * compiles unique() as
 * an explicit index, so only validated, unchanged tables may be carried across
 * ordinary generation. The supported uniqueConstraints field records the table
 * constraint with a logical name, not a droppable physical index. Neither Kit's
 * CREATE TABLE nor its recreation SQL may regenerate these tables.
 *
 * An archive or receipt change needs a separately reviewed manual migration and
 * a new versioned capture/conversion contract. There is deliberately no force/custom bypass.
 */
export async function planRetentionSafeMigration(
  previousInput: DrizzleSQLiteSnapshotJSON,
  currentInput: DrizzleSQLiteSnapshotJSON,
) {
  // Compare the persisted snapshot form, including omission of optional undefined fields.
  const previous = JSON.parse(
    JSON.stringify(previousInput),
  ) as DrizzleSQLiteSnapshotJSON;
  const current = JSON.parse(
    JSON.stringify(currentInput),
  ) as DrizzleSQLiteSnapshotJSON;
  for (const name of names) {
    if (
      !isDeepStrictEqual(previous.tables[name], contract.physical[name]) ||
      !isDeepStrictEqual(current.tables[name], contract.declarations[name])
    ) {
      throw new Error(
        `${name}: manual archive migration required; V1 physical baseline and declaration are immutable`,
      );
    }
  }
  for (const snapshot of [previous, current]) {
    for (const [key, table] of Object.entries(snapshot.tables)) {
      if (
        typeof table !== "object" ||
        table === null ||
        !("name" in table) ||
        typeof table.name !== "string"
      ) {
        throw new Error("Invalid migration table metadata");
      }
      const tableName = table.name;
      if (
        names.some(
          (name) =>
            name.toLowerCase() === key.toLowerCase() ||
            name.toLowerCase() === tableName.toLowerCase(),
        ) &&
        !names.some((name) => key === name && tableName === name)
      ) {
        throw new Error(
          "manual archive migration required; archive name alias",
        );
      }
    }
  }
  const withoutArchives = (snapshot: DrizzleSQLiteSnapshotJSON) => ({
    ...snapshot,
    tables: Object.fromEntries(
      Object.entries(snapshot.tables).filter(
        ([name]) => !names.some((archive) => archive === name),
      ),
    ),
  });
  const sql = await generateSQLiteMigration(
    withoutArchives(previous),
    withoutArchives(current),
  );
  return {
    sql,
    snapshot: {
      ...current,
      tables: { ...current.tables, ...structuredClone(contract.physical) },
    },
  };
}
