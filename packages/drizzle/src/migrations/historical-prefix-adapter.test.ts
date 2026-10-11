import { expect, test } from "bun:test";
import { createClient } from "@libsql/client/sqlite3";
import {
  preserveHistoricalPrefix,
  type HistoricalPrefixConnection,
} from "./historical-prefix-adapter";
import oracle from "./fixtures/historical-prefix-v1/oracle.json";
import contract from "./fixtures/historical-prefix-v1/contract.json";
import { bootstrap, inspect, canon } from "./historical-prefix-test-support";

type FixtureRows = Record<string, unknown[][]>;
const fixtureRow = (rows: FixtureRows, table: string, index = 0) =>
  (rows[table] as unknown[][])[index] as (string | null)[][];
const typed = (v: unknown): [string, string | null] =>
  v === null
    ? ["null", null]
    : typeof v === "number"
      ? ["integer", String(v)]
      : typeof v === "string"
        ? ["text", Buffer.from(v).toString("hex")]
        : [
            (v as { storageClass: string; exact: string }).storageClass,
            (v as { exact: string }).exact,
          ];
const sorted = (rows: unknown[]) => rows.map(canon).sort();
const ledger = oracle.seed.identityPayload.copiedLedgerRows.map((r) => [
  r.slice(0, 2),
  r.slice(2, 4),
  r.slice(4, 6),
]);
function compareRows(actual: FixtureRows, expected: FixtureRows) {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const t of Object.keys(expected))
    expect(sorted(actual[t] as unknown[])).toEqual(
      sorted(expected[t] as unknown[]),
    );
}
function expectedTarget() {
  const rows: FixtureRows = {
    ...oracle.live.rows,
    __drizzle_migrations: ledger,
    sqlite_sequence: contract.targetPhysical.sequence.map((r) => r.map(typed)),
  };
  const adapters: Record<string, Record<string, unknown>[]> = {
    HistoricalStructuralRawV1: oracle.raw.rows,
    HistoricalStructuralRawBatchV1: [oracle.raw.rawBatchCandidate],
    HistoricalDataDerivationV1: oracle.derivations.rows,
    HistoricalDataAdapterReceiptV1: [oracle.receipt.fixedFields],
  };
  for (const [t, rs] of Object.entries(adapters))
    rows[t] = rs.map((r) =>
      (
        (
          contract.targetPhysical.tables as Record<
            string,
            { xinfo: unknown[][] }
          >
        )[t] as { xinfo: unknown[][] }
      ).xinfo.map((c) => typed(r[String(c[1])])),
    );
  return rows;
}
function expectedSource(): FixtureRows {
  return {
    ...oracle.seed.identityPayload.sourceTypedRows,
    __drizzle_migrations: ledger,
    sqlite_sequence: contract.sourcePhysical.sequence.map((r) => r.map(typed)),
  };
}
async function open() {
  const { url } = await bootstrap();
  const client = createClient({ url, concurrency: 1, timeout: 0 });
  await client.execute("PRAGMA foreign_keys=ON");
  await client.execute("PRAGMA legacy_alter_table=OFF");
  expect(
    (await client.execute("PRAGMA foreign_keys")).rows[0]?.foreign_keys,
  ).toBe(1);
  return { client, url };
}
test("commits the complete independently prescribed historical state and bound receipt", async () => {
  const { client, url } = await open();
  try {
    await preserveHistoricalPrefix(client, oracle.timestamps);
  } finally {
    client.close();
  }
  const reopened = createClient({ url, concurrency: 1, timeout: 0 });
  try {
    await reopened.execute("PRAGMA foreign_keys=ON");
    const state = await inspect(reopened);
    const { scope: _, ...physical } = contract.targetPhysical;
    expect(state.physical).toEqual(physical);
    compareRows(state.rows, expectedTarget());
  } finally {
    reopened.close();
  }
});

const certificateCases: [string, (c: typeof oracle.timestamps) => void][] = [
  [
    "missing keyed timestamp",
    (c) => {
      c.entries.shift();
    },
  ],
  [
    "duplicate keyed timestamp",
    (c) => {
      c.entries.push(c.entries[0] as (typeof c.entries)[number]);
    },
  ],
  [
    "contradictory timestamp",
    (c) => {
      (c.entries[0] as (typeof c.entries)[number]).destinationIntegerDecimal =
        "1600000000101";
    },
  ],
  [
    "fractional timestamp conversion",
    (c) => {
      const e = c.entries.find(
        (e) =>
          e.sourcePresence === "present" &&
          e.destinationStorageClass === "integer",
      ) as (typeof c.entries)[number];
      e.sourceUnit = "unix_microseconds";
      e.conversion.denominatorDecimal = "1000";
    },
  ],
];
for (const [name, change] of certificateCases)
  test(`rejects ${name} with complete original state unchanged`, async () => {
    const { client, url } = await open();
    const c = structuredClone(oracle.timestamps);
    change(c);
    try {
      await expect(preserveHistoricalPrefix(client, c)).rejects.toThrow("STOP");
    } finally {
      client.close();
    }
    const reopened = createClient({ url, concurrency: 1, timeout: 0 });
    try {
      const state = await inspect(reopened);
      const { scope: _, ...physical } = contract.sourcePhysical;
      expect(state.physical).toEqual(physical);
      compareRows(state.rows, expectedSource());
    } finally {
      reopened.close();
    }
  });

const sourceCases: [string, string, (rows: FixtureRows) => void][] = [
  [
    "content union ID collision",
    "UPDATE Document SET id='draw-1'; UPDATE SharedDocument SET documentId='draw-1'",
    (r) => {
      fixtureRow(r, "Document")[0] = ["text", "647261772d31"];
      fixtureRow(r, "SharedDocument")[1] = ["text", "647261772d31"];
    },
  ],
  [
    "share union ID collision",
    "UPDATE SharedDocument SET id='sd-1'",
    (r) => {
      fixtureRow(r, "SharedDocument")[0] = [
        "text",
        Buffer.from("sd-1").toString("hex"),
      ];
    },
  ],
  [
    "missing parent",
    "UPDATE WebRTCAnswer SET drawingId='missing-parent'",
    (r) => {
      fixtureRow(r, "WebRTCAnswer")[2] = [
        "text",
        Buffer.from("missing-parent").toString("hex"),
      ];
    },
  ],
  [
    "uncertified REAL",
    "UPDATE CityCoordinates SET latitude=1.5",
    (r) => {
      fixtureRow(r, "CityCoordinates")[2] = ["real", "3ff8000000000000"];
    },
  ],
  [
    "unsafe integer",
    "UPDATE Analytics SET timestamp=9007199254740992 WHERE id=5",
    (r) => {
      (
        (r.Analytics as (string | null)[][][]).find(
          (x) => x[0]?.[1] === "5",
        ) as (string | null)[][]
      )[1] = ["integer", "9007199254740992"];
    },
  ],
];
for (const [name, sql, change] of sourceCases)
  test(`rejects ${name} before archive or rebuild`, async () => {
    const { client, url } = await open();
    await client.execute("PRAGMA foreign_keys=OFF");
    for (const statement of sql.split(";")) await client.execute(statement);
    await client.execute("PRAGMA foreign_keys=ON");
    const expected = structuredClone(expectedSource());
    change(expected);
    try {
      await expect(
        preserveHistoricalPrefix(client, oracle.timestamps),
      ).rejects.toThrow("STOP");
    } finally {
      client.close();
    }
    const reopened = createClient({ url, concurrency: 1, timeout: 0 });
    try {
      const state = await inspect(reopened);
      const { scope: _, ...physical } = structuredClone(
        contract.sourcePhysical,
      ) as Omit<typeof contract.sourcePhysical, "foreignKeyCheck"> & {
        foreignKeyCheck: (string | number)[][];
      };
      physical.foreignKeyCheck =
        name === "missing parent" ? [["WebRTCAnswer", 3, "Drawing", 0]] : [];
      expect(state.physical).toEqual(physical);
      compareRows(state.rows, expected);
    } finally {
      reopened.close();
    }
  });

for (const damage of ["class", "DDL", "count"] as const)
  test(`rejects archive ${damage} mismatch atomically before destructive DDL`, async () => {
    const { client, url } = await open();
    const injected: HistoricalPrefixConnection = {
      execute: client.execute.bind(client),
      transaction: async (mode) => {
        const tx = await client.transaction(mode);
        return {
          execute: async (s) => {
            const text = typeof s === "string" ? s : s.sql;
            if (
              text.startsWith('INSERT INTO "HistoricalStructuralRawV1"') &&
              damage === "class" &&
              typeof s !== "string" &&
              Array.isArray(s.args)
            ) {
              s = {
                ...s,
                args: s.args.map((v, i) => (i === 5 ? "invalid-class" : v)),
              };
            }
            const result = await tx.execute(s);
            if (
              text.startsWith('INSERT INTO "HistoricalStructuralRawV1"') &&
              damage === "DDL"
            )
              await tx.execute(
                "UPDATE HistoricalStructuralRawV1 SET sourceDDL=x'00'",
              );
            if (
              text.startsWith('INSERT INTO "HistoricalStructuralRawBatchV1"') &&
              damage === "count"
            )
              await tx.execute(
                "UPDATE HistoricalStructuralRawBatchV1 SET totalRowCount=0",
              );
            return result;
          },
          commit: tx.commit.bind(tx),
          rollback: tx.rollback.bind(tx),
          close: tx.close.bind(tx),
        };
      },
    };
    try {
      await expect(
        preserveHistoricalPrefix(injected, oracle.timestamps),
      ).rejects.toThrow("STOP");
    } finally {
      client.close();
    }
    const reopened = createClient({ url, concurrency: 1, timeout: 0 });
    try {
      const state = await inspect(reopened);
      const { scope: _, ...physical } = contract.sourcePhysical;
      expect(state.physical).toEqual(physical);
      compareRows(state.rows, expectedSource());
    } finally {
      reopened.close();
    }
  });

for (const edited of [false, true])
  test(`fresh completed verification preserves ${edited ? "later edits" : "the exact completed state"}`, async () => {
    const { client, url } = await open();
    try {
      await preserveHistoricalPrefix(client, oracle.timestamps);
    } finally {
      client.close();
    }
    const reopened = createClient({ url, concurrency: 1, timeout: 0 });
    try {
      await reopened.execute("PRAGMA foreign_keys=ON");
      if (edited)
        await reopened.execute(
          "UPDATE Entity SET title='later local edit' WHERE id='doc-1'",
        );
      const before = await inspect(reopened);
      expect(
        await preserveHistoricalPrefix(reopened, oracle.timestamps),
      ).toEqual({ status: "verified_prefix0003" });
      expect(await inspect(reopened)).toEqual(before);
    } finally {
      reopened.close();
    }
  });

const completionDamage: [string, string][] = [
  [
    "contradictory receipt",
    "UPDATE HistoricalDataAdapterReceiptV1 SET expectedRowsIdentity='contradiction'",
  ],
  ["missing receipt", "DELETE FROM HistoricalDataAdapterReceiptV1"],
  ["archive values", "UPDATE HistoricalStructuralRawV1 SET sourceValues=x'00'"],
  ["archive DDL", "UPDATE HistoricalStructuralRawV1 SET sourceDDL=x'00'"],
  [
    "archive count",
    "UPDATE HistoricalStructuralRawBatchV1 SET totalRowCount=0",
  ],
  ["derivation", "UPDATE HistoricalDataDerivationV1 SET derivation=x'00'"],
  ["invalid completed parent", "UPDATE WebRTCAnswer SET entityId='absent'"],
];
for (const [name, sql] of completionDamage)
  test(`completed verification rejects ${name} unchanged`, async () => {
    const { client, url } = await open();
    try {
      await preserveHistoricalPrefix(client, oracle.timestamps);
    } finally {
      client.close();
    }
    const reopened = createClient({ url, concurrency: 1, timeout: 0 });
    try {
      await reopened.execute("PRAGMA foreign_keys=OFF");
      await reopened.execute(sql);
      await reopened.execute("PRAGMA foreign_keys=ON");
      const before = await inspect(reopened);
      await expect(
        preserveHistoricalPrefix(reopened, oracle.timestamps),
      ).rejects.toThrow("STOP");
      expect(await inspect(reopened)).toEqual(before);
    } finally {
      reopened.close();
    }
  });
