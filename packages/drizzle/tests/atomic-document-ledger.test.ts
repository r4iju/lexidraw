import { expect, test } from "bun:test";
import { createClient } from "@libsql/client/sqlite3";
import {
  clone,
  control,
  database,
  decorated,
  expected,
  observe,
  profile,
  quote,
  run,
} from "./atomic-document-continuation.test";

for (const withDefault of [false, true])
  test(`quoted custom ledger reads and writes exactly once; unrelated default ${withDefault}`, async () => {
    await control();
    const table = 'custom " continuation';
    const db = await database(false, table);
    try {
      if (withDefault) {
        const c = createClient({ url: db.url });
        try {
          await c.execute(
            "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
          );
          await c.execute(
            "INSERT INTO __drizzle_migrations (hash,created_at) VALUES ('unrelated-default',9)",
          );
        } finally {
          c.close();
        }
        const defaultState = await observe(db.url);
        const p = db.p as typeof db.p & { unrelatedLedger?: unknown };
        p.unrelatedLedger = {
          master: defaultState.master.filter(
            (r) => r.tbl_name === "__drizzle_migrations",
          ),
          table: defaultState.tables.__drizzle_migrations,
        };
        for (const st of [p.baseline, p.completed]) {
          st.master.push(
            ...clone(
              defaultState.master.filter(
                (r) => r.tbl_name === "__drizzle_migrations",
              ),
            ),
          );
          st.master.sort((a, b) =>
            a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
          );
          st.tables.__drizzle_migrations = clone(
            defaultState.tables.__drizzle_migrations,
          );
        }
      }
      expect(await run(db.owner, db.config, db.p)).toEqual({
        documents: 1,
        shares: 1,
        repeated: false,
      });
      expect(await observe(db.url)).toEqual(db.p.completed);
      let operations = 0;
      await run(
        decorated(db.owner, async (_e, s) => {
          if (/^(INSERT|CREATE|ALTER|DROP|UPDATE|DELETE)/i.test(s.trim()))
            operations++;
        }),
        db.config,
        db.p,
      );
      expect(operations).toBe(0);
      expect(await observe(db.url)).toEqual(db.p.completed);
    } finally {
      await db.close();
    }
  });

for (const mutation of [
  ["unknown hash", "UPDATE __drizzle_migrations SET hash='unknown'"],
  [
    "false highwater",
    "UPDATE __drizzle_migrations SET created_at=9999999999999",
  ],
  [
    "duplicate checkpoint",
    "INSERT INTO __drizzle_migrations SELECT * FROM __drizzle_migrations",
  ],
  ["missing checkpoint", "DELETE FROM __drizzle_migrations"],
  [
    "unsupported ledger columns",
    "ALTER TABLE __drizzle_migrations ADD extra text",
  ],
  [
    "unexpected ledger index",
    "CREATE INDEX unknown_ledger ON __drizzle_migrations(hash)",
  ],
  [
    "nonmonotonic prior subset",
    `INSERT INTO __drizzle_migrations (hash,created_at) VALUES ('${expected.pending[6]!.hash}',1791647826278)`,
  ],
  ["absent late ledger remains unsupported", "DROP TABLE __drizzle_migrations"],
  [
    "archive without batch",
    "CREATE TABLE LegacyDocumentRetentionV1 (anything text)",
  ],
] as const)
  test(`ledger B0 ${mutation[0]}: complete identity STOP with no mutation, valid control first`, async () => {
    await control();
    const db = await database();
    let writes = 0;
    try {
      const c = createClient({ url: db.url });
      try {
        await c.execute(mutation[1]);
      } finally {
        c.close();
      }
      const before = await observe(db.url);
      await expect(
        run(
          decorated(db.owner, async (_e, s) => {
            if (/^(INSERT|CREATE|ALTER|DROP|UPDATE|DELETE)/i.test(s.trim()))
              writes++;
          }),
          db.config,
          db.p,
        ),
      ).rejects.toMatchObject({ committed: false });
      expect(writes).toBe(0);
      expect(await observe(db.url)).toEqual(before);
    } finally {
      await db.close();
    }
  });

for (const mismatch of [
  "different configured name",
  "empty name",
  "changed journal hash",
  "changed split",
  "changed breakpoint",
  "changed timestamp",
  "changed baseline certificate",
] as const)
  test(`explicit profile rejects ${mismatch} before mutations`, async () => {
    await control();
    const db = await database();
    let writes = 0;
    try {
      const config = { ...db.config };
      const p = clone(db.p);
      if (mismatch === "different configured name")
        config.migrationsTable = "elsewhere";
      if (mismatch === "empty name") config.migrationsTable = "";
      if (mismatch === "changed journal hash") p.journal[0]!.hash = "unknown";
      if (mismatch === "changed split") p.journal[13]!.sql[0] += "\n-- changed";
      if (mismatch === "changed breakpoint") p.journal[0]!.breakpoints = false;
      if (mismatch === "changed timestamp") p.journal[0]!.when++;
      if (mismatch === "changed baseline certificate")
        p.baseline.tables.__drizzle_migrations.rows[0]!.v2 = "30";
      await expect(
        run(
          decorated(db.owner, async (_e, s) => {
            if (/^(INSERT|CREATE|ALTER|DROP|UPDATE|DELETE)/i.test(s.trim()))
              writes++;
          }),
          config,
          p,
        ),
      ).rejects.toThrow();
      expect(writes).toBe(0);
      expect(await observe(db.url)).toEqual(expected.baseline);
    } finally {
      await db.close();
    }
  });

test("custom first and last ledger receipt faults restore full custom identity with default absent", async () => {
  await control();
  for (const target of [1, 15]) {
    const table = 'custom " continuation';
    const db = await database(false, table);
    let seen = 0;
    let count = 0;
    try {
      const owner = decorated(db.owner, async (_e, s) => {
        if (s.startsWith(`INSERT INTO ${quote(table)}`) && ++count === target) {
          seen++;
          throw new Error("custom ledger fault");
        }
      });
      await expect(run(owner, db.config, db.p)).rejects.toMatchObject({
        committed: false,
      });
      expect(seen).toBe(1);
      expect(await observe(db.url)).toEqual(db.p.baseline);
      await run(db.owner, db.config, db.p);
      expect(await observe(db.url)).toEqual(db.p.completed);
      await run(db.owner, db.config, db.p);
      expect(await observe(db.url)).toEqual(db.p.completed);
    } finally {
      await db.close();
    }
  }
});

for (const corrupt of [
  "receipt values",
  "raw bytes",
  "batch count",
  "missing receipt",
  "missing nonmonotonic ledger row",
] as const)
  test(`completed ${corrupt} STOP never overwrites`, async () => {
    await control();
    const db = await database();
    try {
      await run(db.owner, db.config, db.p);
      const c = createClient({ url: db.url });
      try {
        if (corrupt === "receipt values")
          await c.execute(
            "UPDATE LegacyDocumentConversionV1 SET destinationValues=x'00'",
          );
        if (corrupt === "raw bytes")
          await c.execute(
            "UPDATE LegacyDocumentRetentionV1 SET sourceValues=x'00' WHERE sourceTable='Document'",
          );
        if (corrupt === "batch count")
          await c.execute(
            "UPDATE LegacyDocumentRetentionBatchV1 SET documentCount=9",
          );
        if (corrupt === "missing receipt")
          await c.execute("DELETE FROM LegacyDocumentConversionV1");
        if (corrupt === "missing nonmonotonic ledger row")
          await c.execute(
            "DELETE FROM __drizzle_migrations WHERE created_at=1791647826278",
          );
      } finally {
        c.close();
      }
      const before = await observe(db.url);
      let writes = 0;
      await expect(
        run(
          decorated(db.owner, async (_e, s) => {
            if (/^(INSERT|CREATE|ALTER|DROP|UPDATE|DELETE)/i.test(s.trim()))
              writes++;
          }),
          db.config,
          db.p,
        ),
      ).rejects.toMatchObject({ committed: false });
      expect(writes).toBe(0);
      expect(await observe(db.url)).toEqual(before);
    } finally {
      await db.close();
    }
  });
