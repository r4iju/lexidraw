import type { MigrationExecutor } from "./file-migration-owner.js";
import {
  atomicEqual,
  type AtomicPhysicalState,
  inspectAtomicState,
} from "./atomic-modern-destination-v1.js";
import contract from "./atomic-modern-destination-v1.json" with {
  type: "json",
};

const legacyTable = `CREATE TABLE TtsJobs (
 id text PRIMARY KEY NOT NULL, documentId text NOT NULL, userId text NOT NULL,
 status text NOT NULL, manifestUrl text, stitchedUrl text, segmentCount integer,
 error text, ttsConfig text, createdAt integer NOT NULL, updatedAt integer NOT NULL,
 plannedCount integer,
 FOREIGN KEY (documentId) REFERENCES Entities(id) ON UPDATE cascade ON DELETE cascade,
 FOREIGN KEY (userId) REFERENCES Users(id) ON UPDATE cascade ON DELETE cascade
)`;
const columns = [
  ["id", "TEXT", 1, null, 1, 0],
  ["documentId", "TEXT", 1, null, 0, 0],
  ["userId", "TEXT", 1, null, 0, 0],
  ["status", "TEXT", 1, null, 0, 0],
  ["manifestUrl", "TEXT", 0, null, 0, 0],
  ["stitchedUrl", "TEXT", 0, null, 0, 0],
  ["segmentCount", "INTEGER", 0, null, 0, 0],
  ["error", "TEXT", 0, null, 0, 0],
  ["ttsConfig", "TEXT", 0, null, 0, 0],
  ["createdAt", "INTEGER", 1, null, 0, 0],
  ["updatedAt", "INTEGER", 1, null, 0, 0],
  ["plannedCount", "INTEGER", 0, null, 0, 0],
];
// These finite DDLs contain no string literals. Keep the existing recognizer's
// permitted quoting/case/whitespace variations, with no additional clauses.
const normalize = (sql: string) =>
  sql
    .replace(/`([^`]*)`|"([^"]*)"|\s+|;/g, (_m, b, q) => b ?? q ?? "")
    .toLowerCase();
const stop = (): never => {
  throw new Error(
    "Atomic document continuation STOP: unsupported legacy TtsJobs",
  );
};
export type HeldTtsProfile = {
  kind: "absent" | "legacy" | "generic";
  layout: "legacyNormalized" | "absentCreated";
  rows: Record<string, unknown>[];
};

/** Exact completed metadata chooses one of the two closed generic variants. */
export function recognizeGenericTtsLayoutV1(
  state: AtomicPhysicalState,
): HeldTtsProfile["layout"] {
  const table = state.tables.TtsJobs;
  if (!table) return stop();
  const objects = state.master.filter(
    (r) =>
      r.tbl_name.toLowerCase() === "ttsjobs" ||
      /\bTtsJobs\b/i.test(r.sql ?? ""),
  );
  const { rows: _rows, ...physical } = table;
  const candidates = Object.entries(contract.profiles) as [
    HeldTtsProfile["layout"],
    typeof contract.profiles.legacyNormalized,
  ][];
  // Compare canonically, since object property order is not a schema property.
  let matched: HeldTtsProfile["layout"] | undefined;
  for (const [name, c] of candidates) {
    try {
      atomicEqual(physical, c.tables.TtsJobs, "generic TTS physical");
      atomicEqual(
        objects,
        c.master.filter((r) => r.tbl_name === "TtsJobs"),
        "generic TTS objects",
      );
      matched = name;
      break;
    } catch {}
  }
  if (!matched) return stop();
  return matched;
}

/** Recognition and referential inventory only, before any SQL mutation. */
export async function inspectHeldTtsV1(
  held: MigrationExecutor,
  plannedIds: readonly string[],
): Promise<HeldTtsProfile> {
  const state = await inspectAtomicState(held);
  const objects = state.master.filter(
    (r) =>
      r.tbl_name.toLowerCase() === "ttsJobs".toLowerCase() ||
      /\bTtsJobs\b/i.test(r.sql ?? ""),
  );
  const table = state.tables.TtsJobs;
  if (!objects.length)
    return { kind: "absent", layout: "absentCreated", rows: [] };
  if (!table) return stop();
  const legacy = table.columns.some((c) => c.name === "documentId");
  let layout: HeldTtsProfile["layout"] = "legacyNormalized";
  if (legacy) {
    atomicEqual(
      table.columns.map((c) => [
        c.name,
        c.type,
        c.notnull,
        c.dflt_value,
        c.pk,
        c.hidden,
      ]),
      columns,
      "legacy TTS columns",
    );
    const expected = [
      [
        "index",
        "TtsJobs_documentId_idx",
        "CREATE INDEX TtsJobs_documentId_idx ON TtsJobs(documentId)",
      ],
      [
        "index",
        "TtsJobs_status_idx",
        "CREATE INDEX TtsJobs_status_idx ON TtsJobs(status)",
      ],
      ["index", "sqlite_autoindex_TtsJobs_1", null],
      ["table", "TtsJobs", legacyTable],
    ];
    const shape = (rows: readonly (readonly unknown[])[]) =>
      rows
        .map(([type, name, sql]) => [
          type,
          name,
          sql === null ? null : normalize(String(sql)),
        ])
        .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    atomicEqual(
      shape(objects.map((r) => [r.type, r.name, r.sql])),
      shape(expected),
      "legacy TTS objects",
    );
  } else {
    layout = recognizeGenericTtsLayoutV1(state);
  }
  const entity = legacy ? "documentId" : "entityId";
  const current = (
    await held.execute("SELECT id,typeof(id) AS type FROM Entities")
  ).rows;
  const users = (await held.execute("SELECT id,typeof(id) AS type FROM Users"))
    .rows;
  if (
    current.some((r) => r.type !== "text") ||
    users.some((r) => r.type !== "text")
  )
    return stop();
  const ids = new Set([...plannedIds, ...current.map((r) => String(r.id))]);
  const userIds = new Set(users.map((r) => String(r.id)));
  const jobs = (
    await held.execute(
      `SELECT ${entity} AS entity,userId,typeof(${entity}) AS et,typeof(userId) AS ut FROM TtsJobs`,
    )
  ).rows;
  if (
    jobs.some(
      (r) =>
        r.et !== "text" ||
        r.ut !== "text" ||
        !ids.has(String(r.entity)) ||
        !userIds.has(String(r.userId)),
    )
  )
    return stop();
  return { kind: legacy ? "legacy" : "generic", layout, rows: table.rows };
}

/** Called only at the frozen actual0034 boundary on the same held executor. */
export async function normalizeHeldLegacyTtsV1(
  held: MigrationExecutor,
  source: HeldTtsProfile,
) {
  if (source.kind !== "legacy") return;
  await held.execute(
    "ALTER TABLE TtsJobs RENAME COLUMN documentId TO entityId",
  );
  await held.execute("DROP INDEX TtsJobs_documentId_idx");
  await held.execute("CREATE INDEX TtsJobs_entityId_idx ON TtsJobs(entityId)");
  await held.execute("ALTER TABLE TtsJobs ADD runId text");
  const state = await inspectAtomicState(held);
  atomicEqual(
    state.tables.TtsJobs?.rows,
    source.rows.map((r) => ({ ...r, t12: "null", v12: "" })),
    "normalized TTS typed bytes",
  );
}
