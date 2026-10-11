import { randomUUID } from "node:crypto";
import { open, link, rename, rm, type FileHandle } from "node:fs/promises";

export const publicationFileSystem = { open, link, rename, rm };
export type GenerationOutput = {
  sqlPath: string;
  snapshotPath: string;
  journalPath: string;
  sql: string;
  snapshot: string;
  journal: string;
};

// The journal is the commit point. This protects controlled failures, not a
// crash-atomic transaction across three paths. Generation requires one writer.
export async function publishGeneration(
  output: GenerationOutput,
  options: {
    signal?: AbortSignal;
    fs?: typeof publicationFileSystem;
  } = {},
) {
  const fs = options.fs ?? publicationFileSystem;
  const owned = new Set<string>();
  const handles = new Set<FileHandle>();
  const published: string[] = [];
  const stages: string[] = [];
  let committed = false;
  let failure: unknown;
  try {
    for (const [path, bytes] of [
      [output.sqlPath, output.sql],
      [output.snapshotPath, output.snapshot],
      [output.journalPath, output.journal],
    ] as const) {
      options.signal?.throwIfAborted();
      const stage = `${path}.${randomUUID()}.stage`;
      const file = await fs.open(stage, "wx");
      owned.add(stage);
      handles.add(file);
      stages.push(stage);
      options.signal?.throwIfAborted();
      await file.writeFile(bytes);
      options.signal?.throwIfAborted();
      await file.sync();
      await file.close();
      handles.delete(file);
    }
    for (const [index, path] of [
      output.sqlPath,
      output.snapshotPath,
    ].entries()) {
      const stage = stages[index];
      if (!stage) throw new Error("Missing staged generation output");
      options.signal?.throwIfAborted();
      await fs.link(stage, path);
      published.push(path);
    }
    const journalStage = stages[2];
    if (!journalStage) throw new Error("Missing staged journal");
    options.signal?.throwIfAborted();
    // Once rename starts, commit wins over cancellation; never roll back files
    // referenced by the newly committed journal.
    await fs.rename(journalStage, output.journalPath);
    owned.delete(journalStage);
    committed = true;
  } catch (error) {
    failure = error;
  }
  const cleanupErrors: unknown[] = [];
  for (const handle of handles) {
    try {
      await handle.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const path of [...owned, ...(committed ? [] : published)]) {
    try {
      await fs.rm(path);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length) {
    throw new AggregateError(
      failure === undefined ? cleanupErrors : [failure, ...cleanupErrors],
      "Generation publication cleanup failed",
    );
  }
  if (failure !== undefined) throw failure;
}
