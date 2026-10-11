import {
  generateSQLiteDrizzleJson,
  type DrizzleSQLiteSnapshotJSON,
} from "drizzle-kit/api";
import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { planRetentionSafeMigration } from "./retention-migration.js";

type Input = {
  previous: DrizzleSQLiteSnapshotJSON;
  current: DrizzleSQLiteSnapshotJSON;
};
type Journal = {
  version: string;
  dialect: string;
  entries: {
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }[];
};

// No configured Kit CLI, dotenv, credentials or database loader is used here.
// The same mandatory planner is used for offline input and ordinary generation.
async function main() {
  const args = process.argv.slice(2);
  const argument = args[1];
  if (args.length === 2 && args[0] === "--offline-input" && argument) {
    const input = JSON.parse(await readFile(argument, "utf8")) as Input;
    console.log(
      JSON.stringify(
        await planRetentionSafeMigration(input.previous, input.current),
      ),
    );
    return;
  }
  if (
    args.length &&
    !(
      args.length === 2 &&
      args[0] === "--name" &&
      typeof argument === "string" &&
      /^[a-z0-9_]+$/.test(argument)
    )
  ) {
    throw new Error(
      "Usage: db:generate [--name lowercase_name]; archive changes require a reviewed manual archive migration",
    );
  }
  const folder = resolve(import.meta.dirname, "../../drizzle");
  const journalPath = join(folder, "meta/_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  const last = journal.entries.at(-1);
  if (!last) throw new Error("Missing archive migration baseline");
  const previous = JSON.parse(
    await readFile(
      join(folder, `meta/${String(last.idx).padStart(4, "0")}_snapshot.json`),
      "utf8",
    ),
  ) as DrizzleSQLiteSnapshotJSON;
  const current = await generateSQLiteDrizzleJson(
    await import(
      pathToFileURL(resolve(import.meta.dirname, "../drizzle-schema.ts")).href
    ),
    previous.id,
  );
  const plan = await planRetentionSafeMigration(previous, current);
  if (!plan.sql.length) {
    console.log("No schema changes");
    return;
  }
  const idx = last.idx + 1;
  const prefix = String(idx).padStart(4, "0");
  const tag = `${prefix}_${args[1] ?? "generated"}`;
  const sqlPath = join(folder, `${tag}.sql`);
  const snapshotPath = join(folder, `meta/${prefix}_snapshot.json`);
  const created: string[] = [];
  try {
    await writeFile(
      sqlPath,
      `${plan.sql.join("\n--> statement-breakpoint\n")}\n`,
      { flag: "wx" },
    );
    created.push(sqlPath);
    await writeFile(
      snapshotPath,
      `${JSON.stringify(plan.snapshot, null, 2)}\n`,
      { flag: "wx" },
    );
    created.push(snapshotPath);
    journal.entries.push({
      idx,
      version: plan.snapshot.version,
      when: Math.max(Date.now(), last.when + 1),
      tag,
      breakpoints: true,
    });
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  } catch (error) {
    for (const file of created) await rm(file);
    throw error;
  }
  console.log(
    `Generated ${tag}; immutable V1 archive metadata carried forward`,
  );
}

const timer = setTimeout(() => {
  console.error(
    "Migration generation exceeded 60 seconds; no unscoped generation fallback",
  );
  process.exit(1);
}, 60000);
try {
  await main();
} finally {
  clearTimeout(timer);
}
