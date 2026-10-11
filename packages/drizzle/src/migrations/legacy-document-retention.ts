import type { MigrationExecutor } from "./file-migration-owner.js";

export interface OriginalDocumentBatch {
  sourceSetId: string;
  sourceIdentity: string;
  provenance: "original0001:f741ca2490e7555f522fc4ea63fa1bffaf8af113";
}

// Literal original0001 SQL, blob f741ca2490e7555f522fc4ea63fa1bffaf8af113.
const originalDDL: Record<string, string> = {
  Document:
    "CREATE TABLE `Document` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`title` text NOT NULL,\n\t`elements` text NOT NULL,\n\t`createdAt` integer NOT NULL,\n\t`updatedAt` integer NOT NULL,\n\t`deletedAt` integer,\n\t`userId` text NOT NULL,\n\t`publicAccess` text NOT NULL,\n\tFOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade\n)",
  SharedDocument:
    "CREATE TABLE `SharedDocument` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`documentId` text NOT NULL,\n\t`userId` text NOT NULL,\n\t`accessLevel` text NOT NULL,\n\t`createdAt` integer NOT NULL,\n\tFOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON UPDATE cascade ON DELETE cascade,\n\tFOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade\n)",
  Document_userId_idx:
    "CREATE INDEX `Document_userId_idx` ON `Document` (`userId`)",
  SharedDocument_documentId_userId_key:
    "CREATE UNIQUE INDEX `SharedDocument_documentId_userId_key` ON `SharedDocument` (`documentId`,`userId`)",
  SharedDocument_userId_idx:
    "CREATE INDEX `SharedDocument_userId_idx` ON `SharedDocument` (`userId`)",
  SharedDocument_documentId_idx:
    "CREATE INDEX `SharedDocument_documentId_idx` ON `SharedDocument` (`documentId`)",
};
const tables = ["Document", "SharedDocument"] as const;
const retentionDDL =
  "CREATE TABLE LegacyDocumentRetentionV1 (sourceSetId TEXT NOT NULL, sourceTable TEXT NOT NULL, sourceId BLOB NOT NULL, sourceDDL BLOB NOT NULL, sourceColumns BLOB NOT NULL, sourceValues BLOB NOT NULL, mappedEntityId TEXT, contractVersion INTEGER NOT NULL CHECK(contractVersion = 1), status TEXT NOT NULL CHECK(status IN ('retained','converted')), derivedFields BLOB NOT NULL, PRIMARY KEY(sourceSetId,sourceTable,sourceId))";
// The separate identity/count receipt also makes an empty source batch repeatable.
const batchDDL =
  "CREATE TABLE LegacyDocumentRetentionBatchV1 (sourceSetId TEXT PRIMARY KEY NOT NULL, sourceIdentity TEXT NOT NULL UNIQUE, provenance TEXT NOT NULL, documentCount INTEGER NOT NULL, sharedDocumentCount INTEGER NOT NULL)";
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8");
const stop = (reason: string): never => {
  throw new Error(`Legacy document retention STOP: ${reason}`);
};

type Executor = MigrationExecutor;
type ArchiveRow = {
  table: string;
  id: Buffer;
  ddl: Buffer;
  columns: Buffer;
  values: Buffer;
  derived: Buffer;
};

async function snapshot(executor: Executor, batch: OriginalDocumentBatch) {
  const master = (
    await executor.execute("SELECT type,name,tbl_name,sql FROM sqlite_master")
  ).rows;
  const relevant = master.filter(
    (row) =>
      tables.some(
        (table) => String(row.tbl_name).toLowerCase() === table.toLowerCase(),
      ) || /\b(Document|SharedDocument)\b/i.test(String(row.sql ?? "")),
  );
  const expectedNames = [
    ...Object.keys(originalDDL),
    "sqlite_autoindex_Document_1",
    "sqlite_autoindex_SharedDocument_1",
  ];
  if (relevant.length !== expectedNames.length)
    stop("unsupported original layout or dependent object");
  for (const name of expectedNames) {
    const row = relevant.find((r) => r.name === name);
    if (
      !row ||
      (originalDDL[name] ? row.sql !== originalDDL[name] : row.sql !== null) ||
      row.type !==
        (tables.includes(name as (typeof tables)[number]) ? "table" : "index")
    ) {
      stop("unsupported original DDL");
    }
  }
  const result: ArchiveRow[] = [];
  const counts: number[] = [];
  for (const table of tables) {
    const info = (await executor.execute(`PRAGMA table_xinfo(\`${table}\`)`))
      .rows;
    const columns = bytes([
      1,
      info.map((row) => [
        row.cid,
        row.name,
        row.type,
        row.notnull,
        row.dflt_value,
        row.pk,
        row.hidden,
      ]),
    ]);
    const names = info.map((row) => String(row.name));
    const expressions = names.flatMap((name, i) => [
      `typeof(\`${name}\`) AS t${i}`,
      `CASE WHEN typeof(\`${name}\`)='integer' THEN CAST(\`${name}\` AS TEXT) ELSE lower(hex(CAST(\`${name}\` AS BLOB))) END AS v${i}`,
    ]);
    const rows = (
      await executor.execute(
        `SELECT ${expressions.join(",")} FROM \`${table}\` ORDER BY CAST(id AS BLOB),typeof(id)`,
      )
    ).rows;
    counts.push(rows.length);
    const ids = new Set<string>();
    for (const row of rows) {
      const values = names.map((_, i) => {
        const type = row[`t${i}`];
        if (
          type !== "null" &&
          type !== "integer" &&
          type !== "text" &&
          type !== "blob"
        )
          stop("unsupported SQLite storage class");
        return [type, type === "null" ? null : row[`v${i}`]];
      });
      if (row.t0 !== "text" && row.t0 !== "blob")
        stop("unsupported source ID storage class");
      const id = String(row.v0);
      if (ids.has(id)) stop("source ID byte collision");
      ids.add(id);
      result.push({
        table,
        id: Buffer.from(id, "hex"),
        ddl: Buffer.from(originalDDL[table] ?? "", "utf8"),
        columns,
        values: bytes([1, values]),
        derived: bytes([
          1,
          {
            sourceIdentity: batch.sourceIdentity,
            provenance: batch.provenance,
            mapping: null,
          },
        ]),
      });
    }
  }
  return { rows: result, counts };
}

async function ensureDestination(executor: Executor) {
  const master = (
    await executor.execute("SELECT type,name,tbl_name,sql FROM sqlite_master")
  ).rows;
  for (const [name, ddl] of [
    ["LegacyDocumentRetentionV1", retentionDDL],
    ["LegacyDocumentRetentionBatchV1", batchDDL],
  ] as const) {
    const objects = master.filter(
      (r) =>
        String(r.tbl_name).toLowerCase() === name.toLowerCase() ||
        String(r.name).toLowerCase() === name.toLowerCase() ||
        new RegExp(`\\b${name}\\b`, "i").test(String(r.sql ?? "")),
    );
    if (!objects.length) {
      await executor.execute(ddl);
      continue;
    }
    const table = objects.find((r) => r.name === name);
    const autoindexes = name === "LegacyDocumentRetentionBatchV1" ? 2 : 1;
    if (
      table?.type !== "table" ||
      table.sql !== ddl ||
      objects.length !== autoindexes + 1 ||
      objects.some(
        (r) =>
          r.name !== name &&
          (r.type !== "index" ||
            r.sql !== null ||
            !String(r.name).startsWith(`sqlite_autoindex_${name}_`)),
      )
    )
      stop("unsupported retention destination");
  }
}

/** Capture only. Caller must supply the executor of an already held migration write. */
export async function captureLegacyDocuments(
  heldMigrationExecutor: MigrationExecutor,
  batch: OriginalDocumentBatch,
): Promise<{ retainedRows: number; repeated: boolean }> {
  if (
    !batch.sourceSetId ||
    !batch.sourceIdentity ||
    batch.provenance !== "original0001:f741ca2490e7555f522fc4ea63fa1bffaf8af113"
  )
    stop("explicit batch identity and original provenance required");
  const source = await snapshot(heldMigrationExecutor, batch);
  await ensureDestination(heldMigrationExecutor);
  const receipts = (
    await heldMigrationExecutor.execute({
      sql: "SELECT * FROM LegacyDocumentRetentionBatchV1 WHERE sourceSetId=? OR sourceIdentity=?",
      args: [batch.sourceSetId, batch.sourceIdentity],
    })
  ).rows;
  const archived = (
    await heldMigrationExecutor.execute({
      sql: "SELECT sourceSetId,sourceTable,lower(hex(sourceId)) AS id,lower(hex(sourceDDL)) AS ddl,lower(hex(sourceColumns)) AS columns,lower(hex(sourceValues)) AS valuesBytes,mappedEntityId,contractVersion,status,lower(hex(derivedFields)) AS derived,typeof(sourceId) AS idType,typeof(sourceDDL) AS ddlType,typeof(sourceColumns) AS columnsType,typeof(sourceValues) AS valuesType,typeof(derivedFields) AS derivedType FROM LegacyDocumentRetentionV1 WHERE sourceSetId=? ORDER BY sourceTable,sourceId",
      args: [batch.sourceSetId],
    })
  ).rows;
  if (receipts.length) {
    const receipt = receipts[0];
    if (
      receipts.length !== 1 ||
      receipt?.sourceSetId !== batch.sourceSetId ||
      receipt.sourceIdentity !== batch.sourceIdentity ||
      receipt.provenance !== batch.provenance ||
      receipt.documentCount !== source.counts[0] ||
      receipt.sharedDocumentCount !== source.counts[1]
    )
      stop("changed source or reused batch identity");
    if (archived.length !== source.rows.length) stop("archive count mismatch");
    for (const [i, row] of source.rows.entries()) {
      const stored = archived[i];
      if (
        !stored ||
        stored.sourceSetId !== batch.sourceSetId ||
        stored.sourceTable !== row.table ||
        stored.id !== row.id.toString("hex") ||
        stored.ddl !== row.ddl.toString("hex") ||
        stored.columns !== row.columns.toString("hex") ||
        stored.valuesBytes !== row.values.toString("hex") ||
        stored.derived !== row.derived.toString("hex") ||
        stored.mappedEntityId !== null ||
        stored.contractVersion !== 1 ||
        stored.status !== "retained" ||
        [
          stored.idType,
          stored.ddlType,
          stored.columnsType,
          stored.valuesType,
          stored.derivedType,
        ].some((type) => type !== "blob")
      )
        stop("archive or original source mismatch");
    }
    return { retainedRows: source.rows.length, repeated: true };
  }
  if (archived.length) stop("archive exists without batch receipt");
  await heldMigrationExecutor.execute({
    sql: "INSERT INTO LegacyDocumentRetentionBatchV1 VALUES (?,?,?,?,?)",
    args: [
      batch.sourceSetId,
      batch.sourceIdentity,
      batch.provenance,
      source.counts[0] ?? 0,
      source.counts[1] ?? 0,
    ],
  });
  for (const row of source.rows) {
    await heldMigrationExecutor.execute({
      sql: "INSERT INTO LegacyDocumentRetentionV1 VALUES (?,?,?,?,?,?,NULL,1,'retained',?)",
      args: [
        batch.sourceSetId,
        row.table,
        row.id,
        row.ddl,
        row.columns,
        row.values,
        row.derived,
      ],
    });
  }
  return { retainedRows: source.rows.length, repeated: false };
}
