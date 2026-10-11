import type { InValue } from "@libsql/client";
import type { MigrationExecutor } from "./file-migration-owner.js";
import {
  captureLegacyDocuments,
  type OriginalDocumentBatch,
} from "./legacy-document-retention.js";

export interface LegacyDocumentConversionBatch extends OriginalDocumentBatch {
  timestampProvenance: { unit: "unix-milliseconds"; evidence: string };
  destination: "standalone-modern-v1";
  /** Explicit one-to-one existing User -> Users IDs; no identity creation. */
  userIds: readonly string[];
}

const stop = (reason: string): never => {
  throw new Error(`Legacy document conversion STOP: ${reason}`);
};
const encode = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8");
const decode = (v: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(v);
  } catch {
    return stop("invalid UTF8");
  }
};

// JSON.parse alone discards duplicate decoded keys, including unknown metadata keys.
function strictJSON(raw: string): unknown {
  let at = 0;
  let budget = 1_000_000;
  const whitespace = () => {
    while (/[\x20\t\r\n]/.test(raw[at] ?? "x")) at++;
  };
  const string = (): string => {
    const token =
      // biome-ignore lint/suspicious/noControlCharactersInRegex: JSON forbids unescaped control characters.
      /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"/.exec(
        raw.slice(at),
      )?.[0];
    if (!token) return stop("invalid JSON string");
    at += token.length;
    return JSON.parse(token);
  };
  const value = (depth: number): void => {
    if (depth > 256 || --budget < 0) stop("JSON bounds exceeded");
    whitespace();
    const first = raw[at];
    if (first === '"') {
      string();
      return;
    }
    if (first === "{" || first === "[") {
      at++;
      const end = first === "{" ? "}" : "]";
      const keys = new Set<string>();
      whitespace();
      if (raw[at] === end) {
        at++;
        return;
      }
      for (;;) {
        if (first === "{") {
          whitespace();
          const key = string();
          if (keys.has(key)) stop("duplicate decoded JSON key");
          keys.add(key);
          whitespace();
          if (raw[at++] !== ":") stop("invalid JSON member");
        }
        value(depth + 1);
        whitespace();
        const next = raw[at++];
        if (next === end) return;
        if (next !== ",") stop("invalid JSON delimiter");
      }
    }
    const token =
      /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        raw.slice(at),
      )?.[0] ?? stop("invalid JSON value");
    at += token.length;
  };
  value(0);
  whitespace();
  if (at !== raw.length) stop("trailing JSON");
  try {
    return JSON.parse(raw);
  } catch {
    return stop("corrupt JSON");
  }
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    return stop("expected object");
  return v as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, expected: readonly string[]) {
  if (
    Object.keys(v).length !== expected.length ||
    expected.some((k) => !Object.hasOwn(v, k))
  )
    stop("unknown or missing nested fields");
}
function nonempty(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
function payload(raw: string) {
  const envelope = object(strictJSON(raw));
  const node = (input: unknown, type: "root" | "paragraph" | "text") => {
    const n = object(input);
    keys(
      n,
      type === "text"
        ? ["detail", "format", "mode", "style", "text", "type", "version"]
        : ["children", "direction", "format", "indent", "type", "version"],
    );
    if (n.type !== type || n.version !== 1) stop("unsupported node or version");
    if (type === "text") {
      if (
        n.detail !== 0 ||
        n.format !== 0 ||
        n.mode !== "normal" ||
        n.style !== "" ||
        !nonempty(n.text)
      )
        stop("unsupported text fields");
    } else if (
      n.direction !== null ||
      n.format !== "" ||
      n.indent !== 0 ||
      !Array.isArray(n.children) ||
      !n.children.length
    )
      stop("unsupported or empty element");
    return n;
  };
  const root = node(envelope.root, "root");
  for (const p of root.children as unknown[]) {
    const paragraph = node(p, "paragraph");
    for (const text of paragraph.children as unknown[]) node(text, "text");
  }
  if (Object.hasOwn(envelope, "tts")) {
    const audio = object(envelope.tts);
    keys(audio, ["text", "audioUrl"]);
    if (!nonempty(audio.text) || !nonempty(audio.audioUrl))
      stop("unsupported audio metadata");
  }
}

const documentDefaults = {
  entityType: "document",
  appState: null,
  parentId: null,
  screenShotLight: "",
  screenShotDark: "",
  isActive: 1,
  thumbnailStatus: "pending",
  thumbnailUpdatedAt: null,
  thumbnailVersion: null,
} as const;
const entityColumns = [
  "id",
  "title",
  "elements",
  "appState",
  "entityType",
  "parentId",
  "screenShotLight",
  "screenShotDark",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "userId",
  "publicAccess",
  "isActive",
  "thumbnailStatus",
  "thumbnailUpdatedAt",
  "thumbnailVersion",
] as const;
const shareColumns = [
  "id",
  "entityId",
  "userId",
  "accessLevel",
  "createdAt",
  "updatedAt",
] as const;
const receiptDDL =
  "CREATE TABLE LegacyDocumentConversionV1 (sourceSetId TEXT PRIMARY KEY NOT NULL, sourceIdentity TEXT NOT NULL UNIQUE, contractVersion INTEGER NOT NULL CHECK(contractVersion = 1), status TEXT NOT NULL CHECK(status = 'converted'), derivedFields BLOB NOT NULL, destinationValues BLOB NOT NULL)";

type Row = Record<string, InValue>;
// A deliberately narrow standalone destination, independent of configured schema loaders.
const modernDDL: Record<string, string> = {
  Entities: `CREATE TABLE Entities (
 id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, elements TEXT NOT NULL,
 appState TEXT, entityType TEXT DEFAULT 'drawing' NOT NULL, parentId TEXT,
 screenShotLight TEXT DEFAULT '' NOT NULL, screenShotDark TEXT DEFAULT '' NOT NULL,
 createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, deletedAt INTEGER,
 userId TEXT NOT NULL, publicAccess TEXT NOT NULL, isActive INTEGER DEFAULT 1 NOT NULL,
 thumbnailStatus TEXT DEFAULT 'pending', thumbnailUpdatedAt INTEGER, thumbnailVersion TEXT,
 FOREIGN KEY (parentId) REFERENCES Entities(id) ON UPDATE cascade ON DELETE cascade,
 FOREIGN KEY (userId) REFERENCES Users(id) ON UPDATE cascade ON DELETE cascade
)`,
  SharedEntities: `CREATE TABLE SharedEntities (
 id TEXT PRIMARY KEY NOT NULL, entityId TEXT NOT NULL, userId TEXT NOT NULL,
 accessLevel TEXT NOT NULL, createdAt INTEGER DEFAULT 1735950685000 NOT NULL,
 updatedAt INTEGER DEFAULT 1735950685000 NOT NULL,
 FOREIGN KEY (entityId) REFERENCES Entities(id) ON UPDATE cascade ON DELETE cascade,
 FOREIGN KEY (userId) REFERENCES Users(id) ON UPDATE cascade ON DELETE cascade
)`,
};
const sqlTokens = (sql: string) =>
  sql.match(/'(?:[^']|'')*'|[^\s]+/g)?.join(" ");
async function modernDestination(e: MigrationExecutor) {
  const master = (
    await e.execute("SELECT type,name,tbl_name,sql FROM sqlite_master")
  ).rows;
  const specs: {
    table: string;
    columns: readonly string[];
    integer: string[];
    nullable: string[];
    defaults: Record<string, string>;
    foreign: string[][];
    indexes: Record<string, string[]>;
  }[] = [
    {
      table: "Entities",
      columns: entityColumns,
      integer: [
        "createdAt",
        "updatedAt",
        "deletedAt",
        "isActive",
        "thumbnailUpdatedAt",
      ],
      nullable: [
        "appState",
        "parentId",
        "deletedAt",
        "thumbnailStatus",
        "thumbnailUpdatedAt",
        "thumbnailVersion",
      ],
      defaults: {
        entityType: "'drawing'",
        screenShotLight: "''",
        screenShotDark: "''",
        isActive: "1",
        thumbnailStatus: "'pending'",
      },
      foreign: [
        ["parentId", "Entities", "id"],
        ["userId", "Users", "id"],
      ],
      indexes: {
        Entity_userId_idx: ["userId"],
        Entity_parentId_idx: ["parentId"],
        Entity_title_idx: ["title"],
        Entity_createdAt_idx: ["createdAt"],
        Entity_unique_directory_name: ["title", "parentId"],
      },
    },
    {
      table: "SharedEntities",
      columns: shareColumns,
      integer: ["createdAt", "updatedAt"],
      nullable: [],
      defaults: { createdAt: "1735950685000", updatedAt: "1735950685000" },
      foreign: [
        ["entityId", "Entities", "id"],
        ["userId", "Users", "id"],
      ],
      indexes: {
        SharedEntity_entityId_userId_key: ["entityId", "userId"],
        SharedEntity_userId_idx: ["userId"],
        SharedEntity_entityId_idx: ["entityId"],
      },
    },
  ];
  for (const s of specs) {
    const objects = master.filter(
      (r) =>
        String(r.tbl_name).toLowerCase() === s.table.toLowerCase() ||
        (new RegExp(`\\b${s.table}\\b`, "i").test(String(r.sql ?? "")) &&
          !["Entities", "SharedEntities"].includes(String(r.tbl_name))),
    );
    const own = objects.filter((r) => r.tbl_name === s.table);
    if (
      objects.some((r) => r.type !== "table" && r.type !== "index") ||
      own.filter((r) => r.type === "table").length !== 1
    )
      stop("unsupported modern dependent object");
    const tableSQL = master.find(
      (r) => r.name === s.table && r.type === "table",
    )?.sql;
    if (
      typeof tableSQL !== "string" ||
      sqlTokens(tableSQL) !== sqlTokens(modernDDL[s.table] ?? "")
    )
      stop("unsupported modern table DDL");
    const info = (await e.execute(`PRAGMA table_xinfo(${s.table})`)).rows;
    if (info.length !== s.columns.length) stop("unsupported modern columns");
    for (const [i, name] of s.columns.entries()) {
      const c = info[i];
      const defaults = s.defaults;
      if (
        !c ||
        c.name !== name ||
        c.type !== (s.integer.includes(name) ? "INTEGER" : "TEXT") ||
        c.notnull !== (s.nullable.includes(name) ? 0 : 1) ||
        c.pk !== (name === "id" ? 1 : 0) ||
        c.hidden !== 0 ||
        c.dflt_value !== (defaults[name] ?? null)
      )
        stop("unsupported modern column contract");
    }
    const foreign = (await e.execute(`PRAGMA foreign_key_list(${s.table})`))
      .rows;
    if (
      foreign.length !== s.foreign.length ||
      s.foreign.some(
        ([from, table, to]) =>
          !foreign.some(
            (r) =>
              r.from === from &&
              r.table === table &&
              r.to === to &&
              r.on_update === "CASCADE" &&
              r.on_delete === "CASCADE" &&
              r.seq === 0 &&
              r.match === "NONE",
          ),
      )
    )
      stop("unsupported modern references");
    const indexes = (await e.execute(`PRAGMA index_list(${s.table})`)).rows;
    if (indexes.length !== Object.keys(s.indexes).length + 1)
      stop("unsupported modern indexes");
    for (const [name, cols] of Object.entries(s.indexes)) {
      const index = indexes.find((r) => r.name === name);
      const unique =
        name === "Entity_unique_directory_name" ||
        name === "SharedEntity_entityId_userId_key";
      if (
        index?.origin !== "c" ||
        index.unique !== Number(unique) ||
        index.partial !== Number(name === "Entity_unique_directory_name")
      )
        stop("unsupported modern index contract");
      const xinfo = (
        await e.execute(`PRAGMA index_xinfo(${name})`)
      ).rows.filter((r) => r.key === 1);
      if (
        xinfo.length !== cols.length ||
        xinfo.some(
          (r, i) => r.name !== cols[i] || r.coll !== "BINARY" || r.desc !== 0,
        )
      )
        stop("unsupported index columns");
      if (
        name === "Entity_unique_directory_name" &&
        !/WHERE\s+entityType\s*=\s*'directory'\s*$/i.test(
          String(master.find((r) => r.name === name)?.sql),
        )
      )
        stop("unsupported partial index");
    }
    if (
      !indexes.some(
        (r) => r.origin === "pk" && r.unique === 1 && r.partial === 0,
      )
    )
      stop("missing modern primary key");
  }
  return master;
}

async function ids(e: MigrationExecutor, table: string): Promise<string[]> {
  const rows = (
    await e.execute(
      `SELECT typeof(id) AS type,hex(CAST(id AS BLOB)) AS value FROM ${table}`,
    )
  ).rows;
  return rows.map((r) => {
    if (r.type !== "text") return stop("identity must be TEXT");
    return decode(Buffer.from(String(r.value), "hex"));
  });
}
function typedValues(v: unknown): (string | number | null)[] {
  const parsed = strictJSON(decode(Buffer.from(v as ArrayBuffer)));
  if (!Array.isArray(parsed) || parsed[0] !== 1 || !Array.isArray(parsed[1]))
    return stop("unsupported archive tuple");
  return parsed[1].map((entry: unknown) => {
    if (!Array.isArray(entry) || entry.length !== 2)
      return stop("unsupported archive value");
    const [type, value] = entry;
    if (type === "null" && value === null) return null;
    if (type === "text" && typeof value === "string")
      return decode(Buffer.from(value, "hex"));
    if (type === "integer" && typeof value === "string") {
      const number = Number(value);
      if (
        !Number.isSafeInteger(number) ||
        Math.abs(number) > 8_640_000_000_000_000
      )
        stop("unsupported date");
      return number;
    }
    return stop("unsupported source storage type");
  });
}
function text(v: unknown): string {
  if (typeof v !== "string") return stop("required source TEXT");
  return v;
}
function date(v: unknown, nullable = false): number | null {
  if (v === null && nullable) return null;
  if (typeof v !== "number") return stop("required integer date");
  return v;
}

async function mappedRows(
  e: MigrationExecutor,
  batch: LegacyDocumentConversionBatch,
) {
  const raw = (
    await e.execute({
      sql: "SELECT sourceTable,sourceValues FROM LegacyDocumentRetentionV1 WHERE sourceSetId=? ORDER BY sourceTable,sourceId",
      args: [batch.sourceSetId],
    })
  ).rows;
  const documents: Row[] = [];
  const shares: Row[] = [];
  for (const r of raw) {
    const v = typedValues(r.sourceValues);
    if (r.sourceTable === "Document") {
      if (v.length !== 8) stop("unsupported document tuple");
      const elements = text(v[2]);
      payload(elements);
      const access = text(v[7]);
      if (!["private", "view", "edit"].includes(access))
        stop("unknown publicAccess");
      documents.push({
        id: text(v[0]),
        title: text(v[1]),
        elements,
        ...documentDefaults,
        createdAt: date(v[3]),
        updatedAt: date(v[4]),
        deletedAt: date(v[5], true),
        userId: text(v[6]),
        publicAccess: access,
      });
    } else if (r.sourceTable === "SharedDocument") {
      if (v.length !== 5) stop("unsupported share tuple");
      const access = text(v[3]);
      if (!["view", "edit"].includes(access)) stop("unknown accessLevel");
      shares.push({
        id: text(v[0]),
        entityId: text(v[1]),
        userId: text(v[2]),
        accessLevel: access,
        createdAt: date(v[4]),
        updatedAt: date(v[4]),
      });
    } else stop("unknown retained table");
  }
  const sourceIds = await ids(e, "User");
  const modernIds = new Set(await ids(e, "Users"));
  const selected = new Set(batch.userIds);
  if (
    selected.size !== batch.userIds.length ||
    sourceIds.length !== selected.size ||
    sourceIds.some((id) => !selected.has(id) || !modernIds.has(id))
  )
    stop("explicit one-to-one existing identity mapping required");
  if (!documents.length && !shares.length && selected.size)
    stop("empty layout requires zero source identities");
  const parents = new Set(documents.map((r) => r.id));
  if (
    documents.some((r) => !selected.has(text(r.userId))) ||
    shares.some(
      (r) => !selected.has(text(r.userId)) || !parents.has(r.entityId),
    )
  )
    stop("dangling reference");
  return { documents, shares };
}

async function collisions(
  e: MigrationExecutor,
  master: Awaited<ReturnType<typeof modernDestination>>,
  documents: Row[],
  shares: Row[],
  repeated: boolean,
) {
  for (const table of ["Drawing", "Entity", "Entities"]) {
    if (!master.some((r) => r.name === table && r.type === "table")) continue;
    if (table === "Entities" && repeated) continue;
    const existing = new Set(await ids(e, table));
    if (documents.some((r) => existing.has(text(r.id))))
      stop("document ID collision");
  }
  for (const table of ["SharedDrawing", "SharedEntity", "SharedEntities"]) {
    if (!master.some((r) => r.name === table && r.type === "table")) continue;
    if (table === "SharedEntities" && repeated) continue;
    const existing = new Set(await ids(e, table));
    if (shares.some((r) => existing.has(text(r.id))))
      stop("share ID collision");
    const column = table === "SharedDrawing" ? "drawingId" : "entityId";
    const pairs = (
      await e.execute(
        `SELECT hex(CAST(${column} AS BLOB)) AS entity,hex(CAST(userId AS BLOB)) AS user FROM ${table}`,
      )
    ).rows;
    if (
      shares.some((s) =>
        pairs.some(
          (p) =>
            p.entity ===
              Buffer.from(text(s.entityId)).toString("hex").toUpperCase() &&
            p.user ===
              Buffer.from(text(s.userId)).toString("hex").toUpperCase(),
        ),
      )
    )
      stop("share pair collision");
  }
}
async function receiptTable(e: MigrationExecutor) {
  const objects = (
    await e.execute("SELECT type,name,tbl_name,sql FROM sqlite_master")
  ).rows.filter(
    (r) =>
      String(r.tbl_name).toLowerCase() === "legacydocumentconversionv1" ||
      /\bLegacyDocumentConversionV1\b/i.test(String(r.sql ?? "")),
  );
  if (!objects.length) {
    await e.execute(receiptDDL);
    return;
  }
  if (
    objects.length !== 3 ||
    !objects.some(
      (r) =>
        r.name === "LegacyDocumentConversionV1" &&
        r.type === "table" &&
        r.sql === receiptDDL,
    ) ||
    objects.some(
      (r) =>
        r.name !== "LegacyDocumentConversionV1" &&
        (r.type !== "index" ||
          r.sql !== null ||
          !String(r.name).startsWith(
            "sqlite_autoindex_LegacyDocumentConversionV1_",
          )),
    )
  )
    stop("unsupported conversion receipt schema");
}
async function insert(
  e: MigrationExecutor,
  table: string,
  columns: readonly string[],
  row: Row,
) {
  await e.execute({
    sql: `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    args: columns.map((c) => row[c] ?? null),
  });
}
async function verify(
  e: MigrationExecutor,
  table: string,
  columns: readonly string[],
  expected: Row[],
) {
  for (const row of expected) {
    const expr = columns.flatMap((c, i) => [
      `typeof(${c}) AS t${i}`,
      `hex(CAST(${c} AS BLOB)) AS v${i}`,
    ]);
    const rows = (
      await e.execute({
        sql: `SELECT ${expr.join(",")} FROM ${table} WHERE id=?`,
        args: [row.id ?? null],
      })
    ).rows;
    if (rows.length !== 1) stop("mapped row missing");
    for (const [i, c] of columns.entries()) {
      const value = row[c];
      const type =
        value === null
          ? "null"
          : typeof value === "number"
            ? "integer"
            : "text";
      const hex =
        value === null
          ? ""
          : Buffer.from(String(value)).toString("hex").toUpperCase();
      if (rows[0]?.[`t${i}`] !== type || rows[0]?.[`v${i}`] !== hex)
        stop("mapped row verification mismatch");
    }
  }
}

/** Standalone modern projection only. Caller owns the already-held atomic write and settlement. */
export async function convertLegacyDocuments(
  held: MigrationExecutor,
  batch: LegacyDocumentConversionBatch,
): Promise<{ documents: number; shares: number; repeated: boolean }> {
  if (
    batch.destination !== "standalone-modern-v1" ||
    batch.timestampProvenance?.unit !== "unix-milliseconds" ||
    !nonempty(batch.timestampProvenance.evidence) ||
    !Array.isArray(batch.userIds) ||
    batch.userIds.some((id) => typeof id !== "string")
  )
    stop("explicit destination, identities and timestamp provenance required");
  const master = await modernDestination(held);
  await captureLegacyDocuments(held, batch);
  // Reconcile every newly captured raw receipt before trusting its tuples for mapping.
  await captureLegacyDocuments(held, batch);
  const { documents, shares } = await mappedRows(held, batch);
  const derived = encode({
    version: 1,
    timestampProvenance: batch.timestampProvenance,
    userIds: [...batch.userIds].sort(),
    documentDefaults,
    shareUpdatedAt: "createdAt",
    destination: batch.destination,
  });
  const values = encode({ documents, shares });
  const existingTable = master.some(
    (r) => r.name === "LegacyDocumentConversionV1",
  );
  if (existingTable) await receiptTable(held);
  const receipts = existingTable
    ? (
        await held.execute({
          sql: "SELECT sourceSetId,sourceIdentity,contractVersion,status,typeof(derivedFields) AS dt,hex(derivedFields) AS derived,typeof(destinationValues) AS vt,hex(destinationValues) AS valuesBytes FROM LegacyDocumentConversionV1 WHERE sourceSetId=? OR sourceIdentity=?",
          args: [batch.sourceSetId, batch.sourceIdentity],
        })
      ).rows
    : [];
  const receipt = receipts[0];
  const repeated = receipts.length > 0;
  if (
    repeated &&
    (receipts.length !== 1 ||
      receipt?.sourceSetId !== batch.sourceSetId ||
      receipt.sourceIdentity !== batch.sourceIdentity ||
      receipt.contractVersion !== 1 ||
      receipt.status !== "converted" ||
      receipt.dt !== "blob" ||
      receipt.vt !== "blob" ||
      receipt.derived !== derived.toString("hex").toUpperCase() ||
      receipt.valuesBytes !== values.toString("hex").toUpperCase())
  )
    stop("conversion receipt mismatch");
  await collisions(held, master, documents, shares, repeated);
  if (!repeated) {
    await receiptTable(held);
    for (const row of documents)
      await insert(held, "Entities", entityColumns, row);
    for (const row of shares)
      await insert(held, "SharedEntities", shareColumns, row);
    await verify(held, "Entities", entityColumns, documents);
    await verify(held, "SharedEntities", shareColumns, shares);
    await held.execute({
      sql: "INSERT INTO LegacyDocumentConversionV1 VALUES (?,?,1,'converted',?,?)",
      args: [batch.sourceSetId, batch.sourceIdentity, derived, values],
    });
  }
  return { documents: documents.length, shares: shares.length, repeated };
}
