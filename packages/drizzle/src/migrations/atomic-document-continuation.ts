import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readMigrationFiles, type MigrationConfig } from "drizzle-orm/migrator";
import type { MigrationOwner } from "./file-migration-owner.js";
import {
  adoptStagedLegacyDocuments,
  stageLegacyDocuments,
  type StagedLegacyDocuments,
} from "./legacy-document-retention.js";
import {
  restoreArchivedLegacyDocuments,
  stageLegacyDocumentConversion,
  type ArchivedLegacyConversionBatch,
} from "./legacy-document-conversion.js";
import {
  atomicEqual,
  atomicIdentity,
  inspectAtomicState,
  quoteAtomicIdentifier,
  verifyAtomicModernDestinationV1,
  type AtomicPhysicalState,
} from "./atomic-modern-destination-v1.js";
import {
  inspectHeldTtsV1,
  recognizeGenericTtsLayoutV1,
  normalizeHeldLegacyTtsV1,
} from "./legacy-tts-normalization.js";

export interface FrozenContinuationEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
  hash: string;
  sql: string[];
}
export interface AtomicDocumentContinuationProfileV1 {
  kind:
    | "synthetic-stranded-modern0014-v1"
    | "synthetic-original0002-rollback-v1";
  batch: ArchivedLegacyConversionBatch;
  ledgerTable: string;
  baseline: AtomicPhysicalState;
  completed: AtomicPhysicalState;
  source: StagedLegacyDocuments;
  journal: FrozenContinuationEntry[];
  pending: FrozenContinuationEntry[];
  maxSourceBytes: number;
  maxSourceRows: number;
  onStage?: (stage: "staged", source: StagedLegacyDocuments) => Promise<void>;
}
export interface AtomicDocumentContinuationResultV1 {
  documents: number;
  shares: number;
  repeated: boolean;
}
const stop = (reason: string): never => {
  throw new Error(`Atomic document continuation STOP: ${reason}`);
};
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
}

function validateCertificates(
  p: AtomicDocumentContinuationProfileV1,
  table: string,
) {
  if (
    !table ||
    table.includes("\0") ||
    table.length > 128 ||
    table !== p.ledgerTable
  )
    stop("explicit finite selected ledger identifier required");
  if (
    p.kind !== "synthetic-stranded-modern0014-v1" &&
    p.kind !== "synthetic-original0002-rollback-v1"
  )
    stop("no actual historical source/baseline certificate");
  if (
    p.batch.destination !== "atomic-modern-modeled-v1" ||
    p.batch.timestampProvenance.unit !== "unix-milliseconds" ||
    !p.batch.timestampProvenance.evidence
  )
    stop("explicit synthetic source timestamps and destination required");
  if (p.kind === "synthetic-original0002-rollback-v1") {
    if (
      p.journal.length !== 1 ||
      p.journal[0]?.idx !== 2 ||
      p.pending.length !== 1 ||
      p.pending[0]?.idx !== 2 ||
      p.baseline.tables[table]
    )
      stop("unsupported early rollback baseline");
    atomicEqual(
      p.pending,
      p.journal,
      "exact actual0002 pending metadata and splits",
    );
    return;
  }
  const checkpoint = p.baseline.tables[table];
  const r = checkpoint?.rows[0];
  if (!checkpoint || checkpoint.rows.length !== 1 || !r)
    stop(
      "modeled0014 complete checkpoint required; absent late ledger unsupported",
    );
  atomicEqual(
    r,
    {
      t0: "null",
      v0: "",
      t1: "text",
      v1: Buffer.from(
        "78ab410710c6ad4e7969c31273fccb3e8f226c2fa8ad7ad94b7e20c0b7e6c54c",
      )
        .toString("hex")
        .toUpperCase(),
      t2: "integer",
      v2: Buffer.from("1761866938152").toString("hex").toUpperCase(),
    },
    "modeled checkpoint full typed identity",
  );
  if (p.journal.length !== 28 || p.pending.length !== 15)
    stop("unsupported frozen journal scope");
  atomicEqual(
    p.pending,
    p.journal.slice(13),
    "exact modeled0014 pending order",
  );
  const receipt = p.completed.tables.LegacyDocumentConversionV1?.rows[0];
  if (!receipt || receipt.t4 !== "blob")
    return stop("bound immutable conversion certificate required");
  let derived: Record<string, unknown>;
  try {
    derived = JSON.parse(
      Buffer.from(String(receipt.v4), "hex").toString("utf8"),
    );
  } catch {
    return stop("invalid conversion certificate");
  }
  atomicEqual(
    derived.timestampProvenance,
    p.batch.timestampProvenance,
    "timestamp evidence bound to synthetic source certificate",
  );
  atomicEqual(
    derived.userIds,
    [...p.batch.userIds].sort(),
    "bound source User mapping",
  );
}

/** Completed synthetic sources may be removed or explicitly renamed after adoption. */
function completedSourceObjects(
  state: AtomicPhysicalState,
  expected: AtomicPhysicalState,
) {
  const sourceNames = ["Document", "SharedDocument", "User"];
  const renamed = "ArchivedSyntheticUser";
  const residual = state.master.filter(
    (r) => sourceNames.includes(r.tbl_name) || r.tbl_name === renamed,
  );
  for (const name of sourceNames) {
    const present = residual.filter((r) => r.tbl_name === name);
    if (present.length)
      atomicEqual(
        present,
        expected.master.filter((r) => r.tbl_name === name),
        `remaining ${name} source objects`,
      );
  }
  const renamedObjects = residual.filter((r) => r.tbl_name === renamed);
  if (renamedObjects.length) {
    if (residual.some((r) => r.tbl_name === "User"))
      stop("ambiguous renamed synthetic source User");
    const original = expected.master
      .filter((r) => r.tbl_name === "User")
      .map((r) => ({
        ...r,
        name: r.name === "User" ? renamed : r.name.replace("User", renamed),
        tbl_name: renamed,
        sql:
          r.sql === null
            ? null
            : `CREATE TABLE "${renamed}" (\`id\` text PRIMARY KEY NOT NULL)`,
      }));
    atomicEqual(
      renamedObjects,
      original,
      "explicit renamed synthetic source User",
    );
    const a = state.tables[renamed];
    const b = expected.tables.User;
    if (!a || !b) return stop("missing renamed source User");
    const copied = JSON.parse(JSON.stringify(b)) as typeof b;
    for (const i of copied.indexes)
      i.name = String(i.name).replace("User", renamed);
    atomicEqual(a, copied, "renamed synthetic User complete typed data");
  }
  return new Set([...sourceNames, renamed]);
}

/**
 * Explicit composition only. The injected owner alone controls connection,
 * transaction, FK state and settlement; this runner cannot supply a production DB.
 */
export async function runAtomicDocumentContinuationV1(
  owner: MigrationOwner,
  config: MigrationConfig,
  supplied: AtomicDocumentContinuationProfileV1,
): Promise<AtomicDocumentContinuationResultV1> {
  const options = { ...config };
  const table = options.migrationsTable ?? "__drizzle_migrations";
  const onStage = supplied.onStage;
  const p = freeze(
    JSON.parse(JSON.stringify(supplied)) as AtomicDocumentContinuationProfileV1,
  );
  const migrations = readMigrationFiles(options);
  const journal = JSON.parse(
    readFileSync(join(options.migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as { entries: Omit<FrozenContinuationEntry, "hash" | "sql">[] };
  const actual = freeze(
    journal.entries.map((j, i) => ({
      ...j,
      hash: migrations[i]?.hash,
      sql: migrations[i]?.sql,
    })),
  );
  atomicEqual(
    actual,
    p.journal,
    "actual reader tags/when/hash/breakpoints/splits",
  );
  const pending = p.pending;
  const ledger = quoteAtomicIdentifier(table);
  // Nothing interprets a thrown settlement as rollback or success here.
  return owner.write(async (held) => {
    validateCertificates(p, table);
    const before = await inspectAtomicState(held, {
      maxRows: p.maxSourceRows,
      maxBytes: p.maxSourceBytes,
    });
    const completed =
      p.kind === "synthetic-stranded-modern0014-v1" &&
      before.tables[table] &&
      atomicIdentity(before.tables[table]) ===
        atomicIdentity(p.completed.tables[table]);
    if (completed) {
      const sources = completedSourceObjects(before, p.completed);
      const sourceUserName = before.tables.ArchivedSyntheticUser
        ? "ArchivedSyntheticUser"
        : "User";
      const expectedCompleted = JSON.parse(
        JSON.stringify(p.completed),
      ) as AtomicPhysicalState;
      if (sourceUserName !== "User") {
        for (const r of expectedCompleted.master)
          if (r.sql)
            r.sql = r.sql.replaceAll(
              "REFERENCES `User`",
              'REFERENCES "ArchivedSyntheticUser"',
            );
        for (const t of Object.values(expectedCompleted.tables))
          for (const fk of t.foreignKeys)
            if (fk.table === "User") fk.table = sourceUserName;
      }
      atomicEqual(
        before.master.filter((r) => !sources.has(r.tbl_name)),
        expectedCompleted.master.filter((r) => !sources.has(r.tbl_name)),
        "completed complete physical schema",
      );
      for (const [name, expected] of Object.entries(expectedCompleted.tables)) {
        if (
          sources.has(name) ||
          name === "Entities" ||
          name === "SharedEntities"
        )
          continue;
        atomicEqual(
          before.tables[name],
          expected,
          `completed ${name} full bytes`,
        );
      }
      const layout = recognizeGenericTtsLayoutV1(before);
      const result = await restoreArchivedLegacyDocuments(
        held,
        p.batch,
        p.source,
        (e) => verifyAtomicModernDestinationV1(e, layout, sourceUserName),
      );
      if (!result.repeated) stop("completed ledger requires immutable receipt");
      return result;
    }
    atomicEqual(
      before,
      p.baseline,
      "full baseline schema/typed rows/ledger identity",
    );
    const bounds = { maxRows: p.maxSourceRows, maxBytes: p.maxSourceBytes };
    const staged = await stageLegacyDocuments(held, p.batch, bounds);
    atomicEqual(
      staged,
      p.source,
      "original source staged counts and typed bytes",
    );
    const candidate = await stageLegacyDocumentConversion(
      held,
      p.batch,
      staged,
      bounds,
      p.kind !== "synthetic-original0002-rollback-v1",
    );
    const tts =
      p.kind === "synthetic-stranded-modern0014-v1"
        ? await inspectHeldTtsV1(
            held,
            candidate.documents.map((r) => String(r.id)),
          )
        : undefined;
    await onStage?.("staged", freeze(staged));
    for (const entry of pending) {
      if (entry.idx === 34) {
        if (
          entry.tag !== "0034_tts_jobs_baseline" ||
          entry.when !== 1791698049490 ||
          !tts
        )
          return stop("unsupported TTS normalization boundary");
        await normalizeHeldLegacyTtsV1(held, tts);
      }
      for (const statement of entry.sql) await held.executeMultiple(statement);
    }
    if (p.kind === "synthetic-original0002-rollback-v1")
      stop(
        "early profile is rollback-only; full historical destination certificate absent",
      );
    if (!tts) return stop("missing TTS inventory");
    await verifyAtomicModernDestinationV1(held, tts.layout);
    await adoptStagedLegacyDocuments(held, p.batch, staged, {
      requireExisting: true,
    });
    await adoptStagedLegacyDocuments(held, p.batch, staged, {
      requireExisting: true,
      verifyOnly: true,
    });
    const result = await restoreArchivedLegacyDocuments(
      held,
      p.batch,
      staged,
      (e) => verifyAtomicModernDestinationV1(e, tts.layout),
    );
    if ((await held.execute("PRAGMA foreign_key_check")).rows.length)
      stop("final actual ID referential check failed");
    if (!before.tables[table]) stop("late absent ledger baseline unsupported");
    for (const entry of pending)
      await held.execute({
        sql: `INSERT INTO ${ledger} ("hash", "created_at") VALUES (?,?)`,
        args: [entry.hash, entry.when],
      });
    atomicEqual(
      await inspectAtomicState(held),
      p.completed,
      "full completed schema/typed bytes/receipt/ledger",
    );
    return result;
  });
}
