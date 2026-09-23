import { one, type ParsedArgs } from "./args";
import { type Entity, entityRows } from "./entities";
import { usageError } from "./errors";

export type Format = "json" | "table" | "md" | "raw";

/** `--format`, restricted to what the command can render. */
export function chooseFormat<T extends Format>(
  args: ParsedArgs,
  allowed: readonly T[],
  fallback: T,
): T {
  const given = one(args, "format");
  if (given === undefined) return fallback;
  const match = allowed.find((name) => name === given);
  if (match === undefined) {
    throw usageError(`unknown --format "${given}"`, { known: allowed });
  }
  return match;
}

/** Refuses an explicit `--format`, for a mode that has its own rendering. */
export function rejectFormat(args: ParsedArgs, why: string): void {
  if (one(args, "format") !== undefined) throw usageError(why);
}

/** Columns padded to their widest cell; the last one is left unpadded. */
export function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd();
  return `${[line(headers), ...rows.map(line)].join("\n")}\n`;
}

/** One JSON object per line, so a reader can stream the rows. */
export function ndjson(rows: readonly unknown[]): string {
  return rows.map((row) => `${JSON.stringify(row)}\n`).join("");
}

/**
 * A listing as a table. `parentId` only earns a column where the rows come
 * from more than one directory.
 */
export function entityTable(
  values: readonly unknown[],
  options: { parent?: boolean } = {},
): string {
  const headers = ["id", "title", "type", "updatedAt"];
  const cells = (row: Entity) => [
    row.id,
    row.title,
    row.entityType,
    row.updatedAt,
  ];
  if (!options.parent) {
    return table(headers, entityRows(values).map(cells));
  }
  return table(
    [...headers, "parentId"],
    entityRows(values).map((row) => [...cells(row), row.parentId ?? ""]),
  );
}
