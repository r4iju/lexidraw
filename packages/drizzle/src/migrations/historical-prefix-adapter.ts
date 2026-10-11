import { createHash } from "node:crypto";
import type { Client, Transaction } from "@libsql/client";
import frozen from "./fixtures/historical-prefix-v1/contract.json";

type Cell = ["null", null] | ["integer" | "real" | "text" | "blob", string];
type Rows = Record<string, Cell[][]>;
type Executor = Pick<Client, "execute">;
type JsonRecord = Record<string, unknown>;
type Metadata = {
  xinfo: unknown[][];
  foreignKeys: unknown[][];
  indexList: unknown[][];
  indexXinfo: Record<string, unknown[][]>;
};
type Physical = {
  master: unknown[][];
  tables: Record<string, Metadata>;
  sequence: [string, number][];
  foreignKeyCheck: unknown[][];
};
type Envelope = (typeof frozen.envelopes)[number];
type Contract = {
  identityBase: {
    sourceColumns: Record<string, string[]>;
    sourceDDL: Record<string, string>;
    sourceExplicitIndexes: Record<string, string>;
    qualification: string;
    version: number;
  };
  receiptBindings: typeof frozen.receiptBindings;
  profile: typeof frozen.profile;
  sourcePhysical: Physical & { scope: string };
  targetPhysical: Physical & { scope: string };
  orderedColumns: Record<string, string[]>;
  envelopes: Envelope[];
  sourceSchemaIdentity: string;
  contract: {
    identityPayload: {
      archiveDDL: Record<string, string>;
      destinationDDL: Record<string, string>;
      destinationIndexes: Record<string, string>;
    };
  };
  order: typeof frozen.order;
  liveQualification: string;
};
type TimestampEntry = {
  sourceTable: string;
  typedRowId: { storageClass: Cell[0]; exact: string };
  sourceColumnOrMissingDestinationColumn: string;
  sourceIdentity: string;
  sourcePresence: string;
  rawSource: unknown;
  conversion: {
    rounding: string;
    offsetDecimal: string;
    numeratorDecimal: string;
    denominatorDecimal: string;
  };
  sourceUnit: string;
  destinationUnit: string;
  origin: { kind: string; certifier: string; evidenceRef: string };
  destinationStorageClass: Cell[0];
  destinationIntegerDecimal: string | null;
};
export type HistoricalPrefixConnection = {
  execute: Client["execute"];
  transaction: (mode: "write") => Promise<
    Pick<Transaction, "execute" | "commit" | "rollback" | "close"> & {
      closed?: boolean;
    }
  >;
};
const contract = frozen as unknown as Contract;
const binding = contract.receiptBindings;
const q = (name: string) => `"${name.replaceAll('"', '""')}"`;
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map(
            (key) =>
              `${JSON.stringify(key)}:${canonical((value as JsonRecord)[key])}`,
          )
          .join(",")}}`
      : JSON.stringify(value);
const identity = (value: unknown) =>
  `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
const blob = (value: unknown) => ({
  storageClass: "blob",
  exact: Buffer.from(canonical(value)).toString("hex"),
});
const stop: (reason: string) => never = (reason) => {
  throw new Error(`STOP_HISTORICAL_PREFIX: ${reason}`);
};
function equal(actual: unknown, expected: unknown, reason: string) {
  if (canonical(actual) !== canonical(expected)) stop(reason);
}
const field = (row: Cell[], index: number) => row[index] as Cell;
const rowsFor = (rows: Rows, table: string) => rows[table] as Cell[][];
function sorted<T>(values: T[]): T[] {
  return [...values].sort((a, b) =>
    Buffer.compare(Buffer.from(canonical(a)), Buffer.from(canonical(b))),
  );
}
async function values(executor: Executor, sql: string): Promise<unknown[][]> {
  return (await executor.execute(sql)).rows.map((row) => Array.from(row));
}
function eligibleCell(cell: Cell) {
  const [kind, value] = cell;
  if (kind === "null") {
    if (value !== null) stop("invalid NULL");
    return;
  }
  if (typeof value !== "string") stop("invalid typed cell");
  if (kind === "integer") {
    if (
      !/^(0|-?[1-9][0-9]*)$/.test(value) ||
      !Number.isSafeInteger(Number(value))
    )
      stop("unsafe integer");
  } else if (kind === "real") {
    if (!["4041c00000000000", "4061700000000000"].includes(value))
      stop("uncertified REAL");
  } else if (
    !["text", "blob"].includes(kind) ||
    !/^([0-9a-f]{2})*$/.test(value)
  )
    stop("invalid byte encoding");
}
async function typedRows(
  executor: Executor,
  table: string,
  columns: string[],
): Promise<Cell[][]> {
  const result = await values(
    executor,
    `SELECT ${columns
      .flatMap((column) => {
        const c = q(column);
        return [
          `typeof(${c})`,
          `CASE WHEN typeof(${c})='integer' THEN CAST(${c} AS TEXT) WHEN typeof(${c}) IN ('text','blob') THEN lower(hex(CAST(${c} AS BLOB))) ELSE ${c} END`,
        ];
      })
      .join(",")} FROM ${q(table)}`,
  );
  return sorted(
    result.map((row) =>
      columns.map((_, i): Cell => {
        const kind = row[2 * i];
        let exact = row[2 * i + 1];
        if (kind === "real") {
          const bytes = Buffer.alloc(8);
          bytes.writeDoubleBE(exact as number);
          exact = bytes.toString("hex");
        }
        const cell = [kind, exact] as Cell;
        eligibleCell(cell);
        return cell;
      }),
    ),
  );
}
async function physical(executor: Executor) {
  const master = await values(
    executor,
    "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type COLLATE BINARY,name COLLATE BINARY,tbl_name COLLATE BINARY",
  );
  const tables: JsonRecord = {};
  for (const [type, name] of master) {
    if (type !== "table") continue;
    const indexList = await values(
      executor,
      `PRAGMA index_list(${q(String(name))})`,
    );
    const indexXinfo: JsonRecord = {};
    for (const index of indexList)
      indexXinfo[String(index[1])] = await values(
        executor,
        `PRAGMA index_xinfo(${q(String(index[1]))})`,
      );
    tables[String(name)] = {
      xinfo: await values(executor, `PRAGMA table_xinfo(${q(String(name))})`),
      foreignKeys: await values(
        executor,
        `PRAGMA foreign_key_list(${q(String(name))})`,
      ),
      indexList,
      indexXinfo,
    };
  }
  return {
    master,
    tables,
    sequence: await values(
      executor,
      "SELECT name,seq FROM sqlite_sequence ORDER BY name COLLATE BINARY",
    ),
    foreignKeyCheck: await values(executor, "PRAGMA foreign_key_check"),
  };
}
function metadata(certificate: JsonRecord) {
  const { scope: _, ...state } = certificate;
  return state;
}
function decode(cell: Cell): string | number | Buffer | null {
  eligibleCell(cell);
  const [kind, exact] = cell;
  if (kind === "null") return null;
  if (kind === "integer") return Number(exact);
  const bytes = Buffer.from(exact as string, "hex");
  if (kind === "real") return bytes.readDoubleBE();
  if (kind === "blob") return bytes;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!Buffer.from(text).equals(bytes)) stop("unsupported text bytes");
  return text;
}
const textCell = (text: string): Cell => [
  "text",
  Buffer.from(text).toString("hex"),
];
function objectCell(value: unknown): Cell {
  return value === null
    ? ["null", null]
    : typeof value === "number"
      ? ["integer", String(value)]
      : typeof value === "string"
        ? textCell(value)
        : ([
            (value as { storageClass: Cell[0]; exact: string }).storageClass,
            (value as { exact: string }).exact,
          ] as Cell);
}
async function insert(
  executor: Executor,
  table: string,
  columns: string[],
  row: Cell[],
) {
  await executor.execute({
    sql: `INSERT INTO ${q(table)} (${columns.map(q).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    args: row.map(decode),
  });
}
function columnsFor(table: string): string[] {
  return (contract.targetPhysical.tables[table] as Metadata).xinfo.map(
    (column: unknown[]) => String(column[1]),
  );
}
async function insertObjects(
  executor: Executor,
  table: string,
  rows: JsonRecord[],
) {
  const columns = columnsFor(table);
  for (const row of rows)
    await insert(
      executor,
      table,
      columns,
      columns.map((column) => objectCell(row[column])),
    );
}
async function verifyObjects(
  executor: Executor,
  table: string,
  rows: JsonRecord[],
) {
  const columns = columnsFor(table);
  equal(
    await typedRows(executor, table, columns),
    sorted(rows.map((row) => columns.map((column) => objectCell(row[column])))),
    `archive/receipt mismatch ${table}`,
  );
}
function timestamps(certificate: unknown, source: Rows) {
  if (identity(certificate) !== binding.timestampCertificateIdentity)
    stop("timestamp certificate identity");
  const mapped = new Map<string, Cell>();
  for (const entry of (certificate as { entries: TimestampEntry[] }).entries) {
    const key = canonical([
      entry.sourceTable,
      [entry.typedRowId.storageClass, entry.typedRowId.exact],
      entry.sourceColumnOrMissingDestinationColumn,
    ]);
    if (mapped.has(key)) stop("duplicate timestamp");
    equal(
      entry.sourceIdentity,
      binding.sourceIdentity,
      "timestamp source binding",
    );
    const columns = contract.identityBase.sourceColumns[
      entry.sourceTable
    ] as string[];
    const row = source[entry.sourceTable]?.find(
      (r) =>
        canonical(field(r, 0)) ===
        canonical([entry.typedRowId.storageClass, entry.typedRowId.exact]),
    );
    if (!row) stop("timestamp row absent");
    const index = columns.indexOf(entry.sourceColumnOrMissingDestinationColumn);
    const present = index >= 0;
    equal(
      entry.sourcePresence,
      present ? "present" : "missing",
      "timestamp presence",
    );
    equal(
      entry.rawSource,
      present
        ? { storageClass: field(row, index)[0], exact: field(row, index)[1] }
        : null,
      "timestamp raw value",
    );
    const conversion = entry.conversion;
    if (
      conversion.rounding !== "forbidden" ||
      conversion.offsetDecimal !== "0" ||
      conversion.numeratorDecimal !== "1" ||
      conversion.denominatorDecimal !== "1"
    )
      stop("unsupported rational units");
    if (
      entry.destinationUnit !== "unix_milliseconds" ||
      entry.sourceUnit !== (present ? "unix_milliseconds" : "none_missing") ||
      entry.origin.kind !== "syntheticFixture" ||
      !entry.origin.certifier ||
      !entry.origin.evidenceRef
    )
      stop("uncertified origin or units");
    const cell = [
      entry.destinationStorageClass,
      entry.destinationIntegerDecimal,
    ] as Cell;
    eligibleCell(cell);
    if (present)
      equal(cell, field(row, index), "timestamp conversion mismatch");
    mapped.set(key, cell);
  }
  return (table: string, row: Cell[], column: string) =>
    mapped.get(canonical([table, field(row, 0), column])) ??
    stop(`missing timestamp ${table}.${column}`);
}
function derive(source: Rows, timestamp: ReturnType<typeof timestamps>) {
  const live: Rows = Object.fromEntries(
    Object.keys(contract.orderedColumns).map((table) => [table, []]),
  );
  const raw: JsonRecord[] = [];
  const derivations: JsonRecord[] = [];
  for (const table of Object.keys(source).sort()) {
    const columns = contract.identityBase.sourceColumns[table] as string[];
    const destination =
      table === "_prisma_migrations"
        ? null
        : ["Drawing", "Document"].includes(table)
          ? "Entity"
          : ["SharedDrawing", "SharedDocument"].includes(table)
            ? "SharedEntity"
            : table;
    for (const row of sorted(rowsFor(source, table))) {
      const typedRowKey = blob(field(row, 0));
      raw.push({
        sourceIdentity: binding.sourceIdentity,
        sourceTable: table,
        typedRowKey,
        sourceDDL: (
          contract.envelopes.find(
            (envelope: Envelope) => envelope.sourceTable === table,
          ) as Envelope
        ).sourceDDL,
        sourceColumns: blob(columns),
        sourceValues: blob({ version: 1, columns, values: row }),
        contractVersion: 1,
      });
      const additions: Record<string, Cell> = {};
      const mapped: Record<string, Cell> = {};
      const mapping = destination
        ? columns.map((column, i) => {
            const to =
              column === "drawingId" || column === "documentId"
                ? "entityId"
                : column;
            mapped[to] = field(row, i);
            return { from: column, to, rule: "EXACT_TYPED_COPY" };
          })
        : [];
      if (table === "Document") additions.appState = ["null", null];
      if (table === "Document" || table === "Drawing") {
        additions.entityType = textCell(table.toLowerCase());
        additions.screenShotLight = textCell("");
        additions.screenShotDark = textCell("");
      }
      for (const column of table === "User" || table === "CityCoordinates"
        ? ["createdAt", "updatedAt"]
        : table === "SharedDrawing" || table === "SharedDocument"
          ? ["updatedAt"]
          : [])
        additions[column] = timestamp(table, row, column);
      if (table === "User") additions.deletedAt = ["null", null];
      if (destination) {
        const fields = { ...mapped, ...additions };
        const targetRow = (
          contract.orderedColumns[destination] as string[]
        ).map(
          (column: string) =>
            fields[column] ?? stop("unmapped destination column"),
        );
        rowsFor(live, destination).push(targetRow);
      }
      const derivation = {
        version: 1,
        sourceIdentity: binding.sourceIdentity,
        sourceTable: table,
        typedRowKey: field(row, 0),
        destinationTable: destination,
        mapping,
        additions,
        timestampCertificateIdentity: binding.timestampCertificateIdentity,
        noSourceMutations: true,
        rawOnly: !destination,
      };
      derivations.push({
        sourceIdentity: binding.sourceIdentity,
        sourceTable: table,
        typedRowKey,
        contractVersion: 1,
        destinationTable: destination,
        destinationRowKey: destination ? typedRowKey : null,
        derivation: blob(derivation),
      });
    }
  }
  for (const table of Object.keys(live))
    live[table] = sorted(rowsFor(live, table));
  // The certified union retains Drawing rows before Document rows.
  rowsFor(live, "Entity").sort(
    (a, b) =>
      Number(field(a, 9)[1] === textCell("document")[1]) -
      Number(field(b, 9)[1] === textCell("document")[1]),
  );
  for (const table of ["Entity", "SharedEntity"]) {
    const ids = rowsFor(live, table).map((row) => canonical(field(row, 0)));
    if (new Set(ids).size !== ids.length) stop("union ID collision");
  }
  const pairs = rowsFor(live, "SharedEntity").map((row) =>
    canonical(row.slice(1, 3)),
  );
  if (new Set(pairs).size !== pairs.length) stop("share pair collision");
  return { live, raw, derivations };
}

function prepare(
  source: Rows,
  sequence: Record<string, string>,
  ledger: unknown[][],
  certificate: unknown,
) {
  const sourceIdentity = identity({
    ...contract.identityBase,
    sourceTypedRows: source,
    sourceSequence: sequence,
    copiedLedgerRows: ledger,
  });
  equal(
    sourceIdentity,
    binding.sourceIdentity,
    "source logical identity mismatch",
  );
  const timestamp = timestamps(certificate, source);
  for (const row of rowsFor(source, "Document")) {
    const index = (
      contract.identityBase.sourceColumns.Document as string[]
    ).indexOf("elements");
    if (
      field(row, index)[0] !== "text" ||
      createHash("sha256")
        .update(Buffer.from(field(row, index)[1] as string, "hex"))
        .digest("hex") !== contract.profile.documentPayload.sha256
    )
      stop("unsupported Document bytes");
  }
  const { live, raw, derivations } = derive(source, timestamp);
  const epochs = JSON.parse(
    Buffer.from(binding.sourceEpochAndSplitManifest.exact, "hex").toString(
      "utf8",
    ),
  );
  const rawManifest = {
    version: 1,
    sourceIdentity,
    sourceSetId: binding.sourceSetId,
    sourceSchemaIdentity: contract.sourceSchemaIdentity,
    sourceSequence: sequence,
    sourceLedger: ledger,
    epochs,
    bounds: contract.profile.finiteBounds,
    rawRowsIdentity: identity(raw),
    tables: contract.envelopes.map((envelope: Envelope) => ({
      ...envelope,
      rowCount: rowsFor(source, envelope.sourceTable).length,
      rawRowKeys: rowsFor(source, envelope.sourceTable).map((row) =>
        field(row, 0),
      ),
    })),
  };
  equal(
    identity(rawManifest),
    binding.rawArchiveManifestIdentity,
    "raw manifest identity",
  );
  equal(
    identity(derivations),
    binding.derivationManifestIdentity,
    "derivation identity",
  );
  const liveState = {
    version: 1,
    orderedColumns: contract.orderedColumns,
    rows: live,
    sequence,
    originalLedger: ledger,
    qualification: contract.liveQualification,
  };
  equal(
    identity(liveState),
    binding.expectedRowsIdentity,
    "destination row identity",
  );
  const batch = {
    sourceIdentity,
    sourceSetId: binding.sourceSetId,
    contractVersion: 1,
    rawManifest: blob(rawManifest),
    rawManifestIdentity: identity(rawManifest),
    sourceCheckpointIdentity: sourceIdentity,
    totalRowCount: raw.length,
  };
  return {
    live,
    raw,
    derivations,
    batch,
    receipt: { ...binding, validatedDestinationRows: blob(liveState) },
  };
}
async function verifyCompleted(ex: Executor, certificate: unknown) {
  equal(
    await physical(ex),
    metadata(contract.targetPhysical),
    "completed physical certificate mismatch",
  );
  equal(
    await typedRows(ex, "sqlite_sequence", ["name", "seq"]),
    sorted(
      contract.targetPhysical.sequence.map((row: [string, number]) => [
        textCell(row[0]),
        ["integer", String(row[1])],
      ]),
    ),
    "completed typed sequence mismatch",
  );
  const rawRows = await typedRows(
    ex,
    "HistoricalStructuralRawV1",
    columnsFor("HistoricalStructuralRawV1"),
  );
  const source: Rows = Object.fromEntries(
    Object.keys(contract.identityBase.sourceColumns).map((table) => [
      table,
      [],
    ]),
  );
  const sourceValuesIndex = columnsFor("HistoricalStructuralRawV1").indexOf(
    "sourceValues",
  );
  const sourceTableIndex = columnsFor("HistoricalStructuralRawV1").indexOf(
    "sourceTable",
  );
  for (const row of rawRows) {
    const table = decode(field(row, sourceTableIndex)) as string;
    if (!Object.hasOwn(source, table)) stop("unknown archived source table");
    if (field(row, sourceValuesIndex)[0] !== "blob")
      stop("archive sourceValues storage class");
    const encoded = decode(field(row, sourceValuesIndex)) as Buffer;
    if (encoded.length > contract.profile.finiteBounds.maxEncodedBytes)
      stop("archive byte bound");
    const payload = JSON.parse(encoded.toString("utf8"));
    equal(payload.version, 1, "archive codec version");
    equal(
      payload.columns,
      contract.identityBase.sourceColumns[table],
      "archive column manifest",
    );
    if (
      !Array.isArray(payload.values) ||
      payload.values.length !== payload.columns.length
    )
      stop("archive field count");
    for (const cell of payload.values) eligibleCell(cell);
    rowsFor(source, table).push(payload.values);
  }
  for (const table of Object.keys(source))
    source[table] = sorted(rowsFor(source, table));
  const sequence = Object.fromEntries(
    contract.sourcePhysical.sequence.map((row: [string, number]) => [
      row[0],
      String(row[1]),
    ]),
  );
  const ledger = sorted(
    (
      await typedRows(ex, "__drizzle_migrations", ["id", "hash", "created_at"])
    ).map((row) => row.flat()),
  );
  const { raw, derivations, batch, receipt } = prepare(
    source,
    sequence,
    ledger,
    certificate,
  );
  await verifyObjects(ex, "HistoricalStructuralRawV1", raw);
  await verifyObjects(ex, "HistoricalStructuralRawBatchV1", [batch]);
  await verifyObjects(ex, "HistoricalDataDerivationV1", derivations);
  await verifyObjects(ex, "HistoricalDataAdapterReceiptV1", [receipt]);
}

/** Only the independently certified synthetic prefix is supported. No tail adoption. */
export async function preserveHistoricalPrefix(
  connection: HistoricalPrefixConnection,
  timestampCertificate: unknown,
): Promise<{ status: string }> {
  equal(
    await values(connection, "PRAGMA foreign_keys"),
    [[1]],
    "foreign_keys must be enabled",
  );
  equal(
    await values(connection, "PRAGMA legacy_alter_table"),
    [[0]],
    "unsupported legacy mode",
  );
  let transaction:
    | Awaited<ReturnType<HistoricalPrefixConnection["transaction"]>>
    | undefined;
  let committing = false;
  try {
    transaction = await connection.transaction("write");
    const ex = transaction;
    if (
      (
        await values(
          ex,
          "SELECT name FROM sqlite_master WHERE type='table' AND name='HistoricalDataAdapterReceiptV1'",
        )
      ).length
    ) {
      await verifyCompleted(ex, timestampCertificate);
      await transaction.rollback();
      return { status: "verified_prefix0003" };
    }
    equal(
      await physical(ex),
      metadata(contract.sourcePhysical),
      "source physical certificate mismatch",
    );
    // Reject the NULL-only boundary without selecting unsupported values.
    equal(
      await values(
        ex,
        "SELECT count(*) FROM User WHERE email IS NOT NULL OR password IS NOT NULL OR emailVerified IS NOT NULL",
      ),
      [[0]],
      "unsupported User profile",
    );
    for (const table of ["Account", "Session", "VerificationToken"])
      equal(
        await values(ex, `SELECT count(*) FROM ${q(table)}`),
        [[0]],
        "unsupported populated structural table",
      );
    const source: Rows = {};
    for (const [table, columns] of Object.entries(
      contract.identityBase.sourceColumns,
    )) {
      source[table] = await typedRows(ex, table, columns as string[]);
      if (source[table].length > contract.profile.finiteBounds.maxRowsPerTable)
        stop("table row bound");
    }
    if (
      Object.values(source).reduce((sum, rows) => sum + rows.length, 0) >
        contract.profile.finiteBounds.maxTotalRows ||
      Buffer.byteLength(canonical(source)) >
        contract.profile.finiteBounds.maxEncodedBytes
    )
      stop("source size bound");
    equal(
      await typedRows(ex, "sqlite_sequence", ["name", "seq"]),
      sorted(
        contract.sourcePhysical.sequence.map((row: [string, number]) => [
          textCell(row[0]),
          ["integer", String(row[1])],
        ]),
      ),
      "source typed sequence mismatch",
    );
    const sequence = Object.fromEntries(
      await values(
        ex,
        "SELECT name,CAST(seq AS TEXT) FROM sqlite_sequence ORDER BY name COLLATE BINARY",
      ),
    );
    const ledger = sorted(
      (
        await typedRows(ex, "__drizzle_migrations", [
          "id",
          "hash",
          "created_at",
        ])
      ).map((row) => row.flat()),
    );
    const { live, raw, derivations, batch, receipt } = prepare(
      source,
      sequence,
      ledger,
      timestampCertificate,
    );
    for (const ddl of Object.values(
      contract.contract.identityPayload.archiveDDL,
    ))
      await ex.execute(ddl as string);
    await insertObjects(ex, "HistoricalStructuralRawBatchV1", [batch]);
    await insertObjects(ex, "HistoricalStructuralRawV1", raw);
    await insertObjects(ex, "HistoricalDataDerivationV1", derivations);
    await verifyObjects(ex, "HistoricalStructuralRawBatchV1", [batch]);
    await verifyObjects(ex, "HistoricalStructuralRawV1", raw);
    await verifyObjects(ex, "HistoricalDataDerivationV1", derivations);
    for (const table of Object.keys(
      contract.contract.identityPayload.archiveDDL,
    ))
      equal(
        (await physical(ex)).tables[table],
        contract.targetPhysical.tables[table],
        "archive DDL mismatch",
      );
    // Remove every child before its parent, after the durable archive is reconciled.
    for (const table of [
      ...contract.order.sourceCreationAndInsertion,
    ].reverse())
      await ex.execute(`DROP TABLE ${q(table)}`);
    for (const table of contract.order.targetCreationAndInsertion)
      await ex.execute(
        contract.contract.identityPayload.destinationDDL[table] as string,
      );
    for (const name of Object.keys(
      contract.contract.identityPayload.destinationIndexes,
    ).sort())
      await ex.execute(
        contract.contract.identityPayload.destinationIndexes[name] as string,
      );
    for (const table of contract.order.targetCreationAndInsertion)
      for (const row of rowsFor(live, table))
        await insert(
          ex,
          table,
          contract.orderedColumns[table] as string[],
          row,
        );
    for (const [table, seq] of Object.entries(sequence))
      await ex.execute({
        sql: "UPDATE sqlite_sequence SET seq=CAST(? AS INTEGER) WHERE name=?",
        args: [String(seq), table],
      });
    equal(
      await physical(ex),
      metadata(contract.targetPhysical),
      "destination physical certificate mismatch",
    );
    equal(
      await typedRows(ex, "sqlite_sequence", ["name", "seq"]),
      sorted(
        contract.targetPhysical.sequence.map((row: [string, number]) => [
          textCell(row[0]),
          ["integer", String(row[1])],
        ]),
      ),
      "destination typed sequence mismatch",
    );
    for (const table of Object.keys(live))
      equal(
        await typedRows(ex, table, contract.orderedColumns[table] as string[]),
        sorted(rowsFor(live, table)),
        `destination cells ${table}`,
      );
    equal(
      sorted(
        (
          await typedRows(ex, "__drizzle_migrations", [
            "id",
            "hash",
            "created_at",
          ])
        ).map((row) => row.flat()),
      ),
      ledger,
      "original ledger changed",
    );
    await verifyObjects(ex, "HistoricalStructuralRawBatchV1", [batch]);
    await verifyObjects(ex, "HistoricalStructuralRawV1", raw);
    await verifyObjects(ex, "HistoricalDataDerivationV1", derivations);
    await insertObjects(ex, "HistoricalDataAdapterReceiptV1", [receipt]);
    await verifyObjects(ex, "HistoricalDataAdapterReceiptV1", [receipt]);
    equal(
      await values(ex, "PRAGMA foreign_key_check"),
      [],
      "destination foreign key violation",
    );
    committing = true;
    await transaction.commit();
    return { status: "preserved_prefix0003" };
  } catch (error) {
    if (!committing && transaction && !transaction.closed)
      await transaction.rollback();
    if (committing)
      throw new Error("STOP_UNCERTAIN_HISTORICAL_PREFIX", { cause: error });
    throw new Error("STOP_HISTORICAL_PREFIX", { cause: error });
  } finally {
    transaction?.close();
  }
}
