import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
  type DrizzleSQLiteSnapshotJSON,
} from "drizzle-kit/api";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { planRetentionSafeMigration } from "../src/generation/retention-migration";

const root = resolve(import.meta.dir, "..");
const batch = "LegacyDocumentRetentionBatchV1";
const uniqueName = `${batch}_sourceIdentity_unique`;
const baseline = JSON.parse(
  await readFile(join(root, "drizzle/meta/0036_snapshot.json"), "utf8"),
) as DrizzleSQLiteSnapshotJSON;
const ddl = await readFile(
  join(root, "drizzle/0035_legacy_document_retention.sql"),
  "utf8",
);

// Compile the exact owned declarations without importing full schema/config/environment.
async function compile(
  change: (source: string) => string = (source) => source,
) {
  const source = await readFile(join(root, "src/drizzle-schema.ts"), "utf8");
  const declarations = source.slice(
    source.indexOf("export const legacyDocumentRetentionV1"),
    source.indexOf("export type LegacyDocumentRetentionV1"),
  ) + source.slice(
    source.indexOf("export const legacyDocumentConversionV1"),
    source.indexOf("export type LegacyDocumentConversionV1"),
  );
  const directory = await mkdtemp("/tmp/retention-declarations-");
  try {
    const file = join(directory, "schema.ts");
    await writeFile(
      file,
      `import { sql } from ${JSON.stringify(join(root, "node_modules/drizzle-orm/index.js"))};\nimport { blob, check, integer, primaryKey, sqliteTable, text, unique } from ${JSON.stringify(join(root, "node_modules/drizzle-orm/sqlite-core/index.js"))};\n${change(declarations)}`,
    );
    return await generateSQLiteDrizzleJson(
      await import(pathToFileURL(file).href),
      baseline.id,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function withArchives(compiled: DrizzleSQLiteSnapshotJSON) {
  return {
    ...baseline,
    id: compiled.id,
    prevId: baseline.id,
    tables: { ...baseline.tables, ...compiled.tables },
  };
}

test("public differ reproduces absent DROP INDEX on actual 0035 shape; generation rejects a future unique rename", async () => {
  const original = await compile();
  const renamed = await compile((source) =>
    source.replace(uniqueName, `${uniqueName}_renamed`),
  );
  const unsafe = await generateSQLiteMigration(
    withArchives(original),
    withArchives(renamed),
  );
  const db = new Database(":memory:");
  try {
    db.exec(ddl.replaceAll("--> statement-breakpoint", ""));
    expect(db.query(`PRAGMA index_list(${batch})`).all()).toEqual([
      {
        seq: 0,
        name: `sqlite_autoindex_${batch}_2`,
        unique: 1,
        origin: "u",
        partial: 0,
      },
      {
        seq: 1,
        name: `sqlite_autoindex_${batch}_1`,
        unique: 1,
        origin: "pk",
        partial: 0,
      },
    ]);
    expect(unsafe).toContain(`DROP INDEX \`${uniqueName}\`;`);
    expect(() => db.exec(unsafe.join("\n"))).toThrow("no such index");
    console.log(
      "Public cached differ emitted absent DROP INDEX; actual 0035 SQLite rejected it",
      unsafe,
    );
    await expect(
      planRetentionSafeMigration(baseline, withArchives(renamed)),
    ).rejects.toThrow("manual archive migration");
  } finally {
    db.close();
  }
}, 15000);

test("generation entrypoint stops future archive constraint changes before producing a plan", async () => {
  const renamed = await compile((source) =>
    source.replace(uniqueName, `${uniqueName}_renamed`),
  );
  const directory = await mkdtemp("/tmp/retention-generation-");
  try {
    const input = join(directory, "synthetic-input.json");
    await writeFile(
      input,
      JSON.stringify({ previous: baseline, current: withArchives(renamed) }),
    );
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        "--no-env-file",
        "--preload",
        fileURLToPath(
          new URL("./fixtures/generation/offline-preload.ts", import.meta.url),
        ),
        join(root, "src/generation/generate.ts"),
        "--offline-input",
        input,
      ],
      {
        env: {
          HOME: directory,
          PATH: dirname(process.execPath),
          TMPDIR: directory,
          LEXIDRAW_TEST_SYNTHETIC: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const timer = setTimeout(() => child.kill(), 10000);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(stdout).toBe("");
      expect(code).not.toBe(0);
      expect(stderr).toContain("manual archive migration");
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);

test("unchanged archive declarations compiled by the public API produce no archive migration", async () => {
  const original = await compile();
  const plan = await planRetentionSafeMigration(
    baseline,
    withArchives(original),
  );
  expect(plan.sql).toEqual([]);
});

test("configured Kit generation is blocked while non-generation commands retain their existing path", async () => {
  const { enforceArchiveGenerationEntrypoint } = await import(
    "../src/generation/kit-generation-policy"
  );
  expect(() => enforceArchiveGenerationEntrypoint(["generate"])).toThrow(
    "db:generate",
  );
  expect(() => enforceArchiveGenerationEntrypoint(["generate:sqlite"])).toThrow(
    "db:generate",
  );
  expect(() => enforceArchiveGenerationEntrypoint(["migrate"])).not.toThrow();
});
