import { existsSync, writeFileSync } from "node:fs";
import { expect, test } from "bun:test";
import type { MigrationOwner } from "./file-migration-owner";
import { createFileMigrationOwner } from "./file-migration-owner";
import { reconstructHistoricalAdapterCheckpoint } from "./historical-adapter-checkpoint";
import {
  initialCheckpoint,
  reopen,
  inspect,
  compareState,
  type State,
} from "./historical-adapter-checkpoint-test-support";
import target from "./fixtures/historical-adapter-checkpoint-v1/target-checkpoint-typed-oracle.json";
import { canon } from "./historical-prefix-test-support";
import receipt from "./fixtures/historical-adapter-checkpoint-v1/continuation-receipt-oracle.json";

function record(name: string, value: unknown) {
  if (
    !existsSync(
      "/Users/emanuel/.ai/working/lexidraw-276-recovery/evidence/historical-adapter-checkpoint-implementation-v1",
    )
  )
    return;
  writeFileSync(
    `/Users/emanuel/.ai/working/lexidraw-276-recovery/evidence/historical-adapter-checkpoint-implementation-v1/${name}.json`,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}
const profile = {
  kind: "synthetic-historical-adapter-plural-checkpoint-v1",
} as const;
function observedOwner(url: string) {
  const writes: string[] = [];
  const native = createFileMigrationOwner(url);
  const owner: MigrationOwner = {
    write: (work) =>
      native.write((ex) =>
        work({
          execute: async (sql) => {
            const text = typeof sql === "string" ? sql : sql.sql;
            if (
              /^\s*(CREATE|DROP|ALTER|INSERT|UPDATE|DELETE|REPLACE)\b/i.test(
                text,
              )
            )
              writes.push(text);
            return ex.execute(sql);
          },
          executeMultiple: async (sql) => {
            writes.push(sql);
            await ex.executeMultiple(sql);
          },
        }),
      ),
  };
  return { owner, writes };
}
test("reconstructs the complete literal plural target through the injected held runner", async () => {
  const { url } = await initialCheckpoint();
  const { owner } = observedOwner(url);
  expect(await reconstructHistoricalAdapterCheckpoint(owner, profile)).toEqual({
    repeated: false,
  });
  const fresh = await reopen(url);
  try {
    const state = await inspect(fresh);
    record("fresh-target-observation", { url, state });
    compareState(state, target as unknown as State);
  } finally {
    fresh.close();
  }
});
test("writes the distinct literal receipt after target reconciliation and preserves historical ancestry", async () => {
  const { url } = await initialCheckpoint();
  await reconstructHistoricalAdapterCheckpoint(
    createFileMigrationOwner(url),
    profile,
  );
  const fresh = await reopen(url);
  try {
    const state = await inspect(fresh);
    expect<unknown>(state.rows.HistoricalAdapterContinuationReceiptV1).toEqual([
      receipt.typedTuple,
    ]);
    expect<unknown>(state.rows.HistoricalDataAdapterReceiptV1).toEqual(
      target.rows.HistoricalDataAdapterReceiptV1,
    );
    expect(state.rows.__drizzle_migrations?.map(canon).sort()).toEqual(
      target.rows.__drizzle_migrations.map(canon).sort(),
    );
  } finally {
    fresh.close();
  }
});

const rejectionCases: [string, string][] = [
  [
    "initial later title drift",
    "UPDATE Entity SET title='later edited title' WHERE entityType='document'",
  ],
  ["unknown table", "CREATE TABLE UnknownCheckpointObject(id integer)"],
  ["unknown index", "CREATE INDEX UnknownCheckpointIndex ON Entity(title)"],
  ["unknown column", "ALTER TABLE Entity ADD COLUMN unexpected text"],
  [
    "sequence drift",
    "UPDATE sqlite_sequence SET seq=seq+1 WHERE name='WebRTCAnswer'",
  ],
  [
    "old raw evidence",
    "UPDATE HistoricalStructuralRawV1 SET sourceDDL='changed' WHERE sourceTable='Document'",
  ],
  [
    "old derivation evidence",
    "UPDATE HistoricalDataDerivationV1 SET destinationTable='changed'",
  ],
  [
    "old receipt",
    "UPDATE HistoricalDataAdapterReceiptV1 SET expectedRowsIdentity='changed'",
  ],
  [
    "original ledger",
    "UPDATE __drizzle_migrations SET hash='changed' WHERE created_at=1710770910405",
  ],
  [
    "outside host safe INTEGER",
    "UPDATE Entity SET updatedAt=9007199254740992 WHERE entityType='document'",
  ],
  ["uncertified REAL", "UPDATE CityCoordinates SET latitude=0.0"],
];
for (const [name, sql] of rejectionCases)
  test(`rejects ${name} before writes with complete source unchanged`, async () => {
    const { url } = await initialCheckpoint();
    const client = await reopen(url);
    try {
      const original = await inspect(client);
      await client.execute(sql);
      const before = await inspect(client);
      expect(before).not.toEqual(original);
      const { owner, writes } = observedOwner(url);
      let error: unknown;
      try {
        await reconstructHistoricalAdapterCheckpoint(owner, profile);
      } catch (caught) {
        error = caught;
      }
      compareState(await inspect(client), before);
      expect(writes).toEqual([]);
      expect(error).toBeTruthy();
    } finally {
      client.close();
    }
  });

test("restores the complete source and leaves no new receipt after a witnessed deterministic rebuild fault", async () => {
  const { url, state: original } = await initialCheckpoint();
  let witnessed = false;
  let error: unknown;
  try {
    await reconstructHistoricalAdapterCheckpoint(
      createFileMigrationOwner(url),
      {
        ...profile,
        onRebuilt: async (ex) => {
          const names = (
            await ex.execute(
              "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
            )
          ).rows.map((row) => row.name);
          expect(names).toContain("Users");
          expect(names).not.toContain("User");
          witnessed = true;
          throw new Error("DETERMINISTIC_CHECKPOINT_FAULT_AFTER_CHANGED_TABLE");
        },
      },
    );
  } catch (caught) {
    error = caught;
  }
  expect(witnessed).toBe(true);
  expect(error).toBeTruthy();
  const fresh = await reopen(url);
  try {
    const actual = await inspect(fresh);
    record("deterministic-fault-observation", {
      url,
      witnessed,
      actual,
      original,
    });
    compareState(actual, original);
    expect(actual.rows.HistoricalAdapterContinuationReceiptV1).toBeUndefined();
  } finally {
    fresh.close();
  }
});

test("genuine fresh completed repeat performs zero reconstruction writes", async () => {
  const { url } = await initialCheckpoint();
  await reconstructHistoricalAdapterCheckpoint(
    createFileMigrationOwner(url),
    profile,
  );
  const fresh = await reopen(url);
  try {
    const before = await inspect(fresh);
    compareState(before, target as unknown as State);
    const { owner, writes } = observedOwner(url);
    const result = await reconstructHistoricalAdapterCheckpoint(owner, profile);
    const after = await inspect(fresh);
    record("completed-repeat-observation", {
      url,
      before,
      after,
      writes,
      result,
    });
    compareState(after, before);
    expect(writes).toEqual([]);
    expect(result).toEqual({ repeated: true });
  } finally {
    fresh.close();
  }
});

test("completed repeat preserves only the separately certified later title edit and immutable receipt", async () => {
  const { url } = await initialCheckpoint();
  await reconstructHistoricalAdapterCheckpoint(
    createFileMigrationOwner(url),
    profile,
  );
  const fresh = await reopen(url);
  try {
    compareState(await inspect(fresh), target as unknown as State);
    await fresh.execute(
      "UPDATE Entities SET title='Later certified plural title' WHERE id='doc-1'",
    );
    const before = await inspect(fresh);
    expect(before.rows.Entities).not.toEqual(target.rows.Entities);
    expect<unknown>(before.rows.HistoricalAdapterContinuationReceiptV1).toEqual(
      [receipt.typedTuple],
    );
    const { owner, writes } = observedOwner(url);
    const result = await reconstructHistoricalAdapterCheckpoint(owner, profile);
    const after = await inspect(fresh);
    record("certified-edit-repeat-observation", {
      url,
      before,
      after,
      writes,
      result,
    });
    compareState(after, before);
    expect(writes).toEqual([]);
    expect(result).toEqual({ repeated: true });
  } finally {
    fresh.close();
  }
});

test("rejects shaped new ancestry disagreement from a genuine completed checkpoint without writes", async () => {
  const { url } = await initialCheckpoint();
  await reconstructHistoricalAdapterCheckpoint(
    createFileMigrationOwner(url),
    profile,
  );
  const fresh = await reopen(url);
  try {
    compareState(await inspect(fresh), target as unknown as State);
    await fresh.execute(
      "UPDATE HistoricalAdapterContinuationReceiptV1 SET priorAdapterReceiptIdentity='sha256:0000000000000000000000000000000000000000000000000000000000000000'",
    );
    const before = await inspect(fresh);
    const { owner, writes } = observedOwner(url);
    let error: unknown;
    try {
      await reconstructHistoricalAdapterCheckpoint(owner, profile);
    } catch (caught) {
      error = caught;
    }
    compareState(await inspect(fresh), before);
    expect(writes).toEqual([]);
    expect(error).toBeTruthy();
  } finally {
    fresh.close();
  }
});

for (const [name, sql] of [
  [
    "uncertified later title",
    "UPDATE Entities SET title='arbitrary edit' WHERE id='doc-1'",
  ],
  [
    "changed completed highwater",
    "UPDATE sqlite_sequence SET seq=seq+1 WHERE name='WebRTCAnswers'",
  ],
  [
    "unknown completed object",
    "CREATE TABLE UnknownCompletedObject(id integer)",
  ],
  [
    "changed completed old evidence",
    "UPDATE HistoricalDataAdapterReceiptV1 SET expectedRowsIdentity='changed'",
  ],
] as const)
  test(`rejects ${name} on an accepting completed seam with complete state unchanged`, async () => {
    const { url } = await initialCheckpoint();
    await reconstructHistoricalAdapterCheckpoint(
      createFileMigrationOwner(url),
      profile,
    );
    const fresh = await reopen(url);
    try {
      compareState(await inspect(fresh), target as unknown as State);
      await fresh.execute(sql);
      const before = await inspect(fresh);
      const { owner, writes } = observedOwner(url);
      let error: unknown;
      try {
        await reconstructHistoricalAdapterCheckpoint(owner, profile);
      } catch (caught) {
        error = caught;
      }
      compareState(await inspect(fresh), before);
      expect(writes).toEqual([]);
      expect(error).toBeTruthy();
    } finally {
      fresh.close();
    }
  });
