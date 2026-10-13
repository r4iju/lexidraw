import { expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  publicationFileSystem,
  publishGeneration,
} from "../src/generation/publish-generation";

const prior = ' { "entries": [{"idx":35,"tag":"prior"}] }\n\n';
async function fixture(
  run: (
    output: Parameters<typeof publishGeneration>[0],
    directory: string,
  ) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "generation-publication-"));
  await mkdir(join(directory, "meta"));
  const output = {
    sqlPath: join(directory, "0036_next.sql"),
    snapshotPath: join(directory, "meta/0036_snapshot.json"),
    journalPath: join(directory, "meta/_journal.json"),
    sql: "CREATE TABLE next (id TEXT);\n",
    snapshot: '{"version":"6","id":"next"}\n',
    journal:
      '{"entries":[{"idx":35,"tag":"prior"},{"idx":36,"tag":"0036_next"}]}\n',
  };
  await writeFile(output.journalPath, prior);
  try {
    await run(output, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function unchanged(
  output: Parameters<typeof publishGeneration>[0],
  directory: string,
) {
  expect(await readFile(output.journalPath, "utf8")).toBe(prior);
  expect(await readdir(directory)).toEqual(["meta"]);
  expect(await readdir(join(directory, "meta"))).toEqual(["_journal.json"]);
}
function faultWrite(target: string, cancellation?: AbortController) {
  return {
    ...publicationFileSystem,
    open: async (...args: Parameters<typeof publicationFileSystem.open>) => {
      const file = await publicationFileSystem.open(...args);
      if (!String(args[0]).includes(target)) return file;
      return new Proxy(file, {
        get(handle, key) {
          if (key === "writeFile")
            return async () => {
              await handle.writeFile("partial");
              if (cancellation) {
                cancellation.abort(new Error("cancelled"));
                return;
              }
              throw new Error("injected partial write");
            };
          const value = Reflect.get(handle, key, handle);
          return typeof value === "function" ? value.bind(handle) : value;
        },
      });
    },
  };
}

test("partial SQL write removes owned bytes and preserves literal prior journal", async () => {
  await fixture(async (output, directory) => {
    await expect(
      publishGeneration(output, { fs: faultWrite(".sql") }),
    ).rejects.toThrow("injected partial write");
    await unchanged(output, directory);
  });
});

test("partial snapshot write removes owned bytes and preserves literal prior journal", async () => {
  await fixture(async (output, directory) => {
    await expect(
      publishGeneration(output, { fs: faultWrite("_snapshot.json") }),
    ).rejects.toThrow("injected partial write");
    await unchanged(output, directory);
  });
});

test("partial journal replacement write preserves literal prior journal and removes owned outputs", async () => {
  await fixture(async (output, directory) => {
    await expect(
      publishGeneration(output, { fs: faultWrite("_journal.json") }),
    ).rejects.toThrow("injected partial write");
    await unchanged(output, directory);
  });
});

test("cancellation while an owned partial exists awaits cleanup and preserves prior bytes", async () => {
  await fixture(async (output, directory) => {
    const controller = new AbortController();
    await expect(
      publishGeneration(output, {
        signal: controller.signal,
        fs: faultWrite(".sql", controller),
      }),
    ).rejects.toThrow("cancelled");
    await unchanged(output, directory);
  });
});

for (const existing of ["sqlPath", "snapshotPath"] as const) {
  test(`preexisting ${existing} remains literal and publication rolls back owned outputs`, async () => {
    await fixture(async (output, directory) => {
      await writeFile(output[existing], "preexisting literal bytes\n");
      await expect(publishGeneration(output)).rejects.toThrow("EEXIST");
      expect(await readFile(output[existing], "utf8")).toBe(
        "preexisting literal bytes\n",
      );
      expect(await readFile(output.journalPath, "utf8")).toBe(prior);
      expect(await readdir(directory)).toEqual(
        existing === "sqlPath" ? ["0036_next.sql", "meta"] : ["meta"],
      );
      expect(await readdir(join(directory, "meta"))).toEqual(
        existing === "snapshotPath"
          ? ["0036_snapshot.json", "_journal.json"]
          : ["_journal.json"],
      );
    });
  });
}

test("journal rename failure rolls back complete new files and retains prior journal bytes", async () => {
  await fixture(async (output, directory) => {
    await expect(
      publishGeneration(output, {
        fs: {
          ...publicationFileSystem,
          rename: async () => {
            throw new Error("injected rename failure");
          },
        },
      }),
    ).rejects.toThrow("injected rename failure");
    await unchanged(output, directory);
  });
});

test("successful append publishes complete closed flushed outputs before journal replacement", async () => {
  await fixture(async (output, directory) => {
    const active = new Set<string>();
    const flushed = new Set<string>();
    await publishGeneration(output, {
      fs: {
        ...publicationFileSystem,
        open: async (...args) => {
          const file = await publicationFileSystem.open(...args);
          const path = String(args[0]);
          active.add(path);
          return new Proxy(file, {
            get(handle, key) {
              if (key === "sync")
                return async () => {
                  await handle.sync();
                  flushed.add(path);
                };
              if (key === "close")
                return async () => {
                  await handle.close();
                  active.delete(path);
                };
              const value = Reflect.get(handle, key, handle);
              return typeof value === "function" ? value.bind(handle) : value;
            },
          });
        },
        link: async (...args) => {
          expect(active.size).toBe(0);
          expect(flushed.size).toBe(3);
          expect(await readFile(output.journalPath, "utf8")).toBe(prior);
          await publicationFileSystem.link(...args);
        },
        rename: async (...args) => {
          expect(await readFile(output.sqlPath, "utf8")).toBe(
            "CREATE TABLE next (id TEXT);\n",
          );
          expect(await readFile(output.snapshotPath, "utf8")).toBe(
            '{"version":"6","id":"next"}\n',
          );
          expect(await readFile(output.journalPath, "utf8")).toBe(prior);
          await publicationFileSystem.rename(...args);
        },
      },
    });
    expect(await readFile(output.journalPath, "utf8")).toBe(
      '{"entries":[{"idx":35,"tag":"prior"},{"idx":36,"tag":"0036_next"}]}\n',
    );
    expect(await readdir(directory)).toEqual(["0036_next.sql", "meta"]);
    expect(await readdir(join(directory, "meta"))).toEqual([
      "0036_snapshot.json",
      "_journal.json",
    ]);
  });
});

for (const operation of ["sync", "close"] as const) {
  test(`${operation} failure cleans owned staged files without publishing`, async () => {
    await fixture(async (output, directory) => {
      let injected = false;
      await expect(
        publishGeneration(output, {
          fs: {
            ...publicationFileSystem,
            open: async (...args) => {
              const file = await publicationFileSystem.open(...args);
              return new Proxy(file, {
                get(handle, key) {
                  if (key === operation)
                    return async () => {
                      if (!injected) {
                        injected = true;
                        throw new Error(`injected ${operation} failure`);
                      }
                      await handle[operation]();
                    };
                  const value = Reflect.get(handle, key, handle);
                  return typeof value === "function"
                    ? value.bind(handle)
                    : value;
                },
              });
            },
          },
        }),
      ).rejects.toThrow(`injected ${operation} failure`);
      await unchanged(output, directory);
    });
  });
}

test("cancellation after SQL publication rolls back owned files before journal commit", async () => {
  await fixture(async (output, directory) => {
    const controller = new AbortController();
    await expect(
      publishGeneration(output, {
        signal: controller.signal,
        fs: {
          ...publicationFileSystem,
          link: async (...args) => {
            await publicationFileSystem.link(...args);
            controller.abort(new Error("cancelled after link"));
          },
        },
      }),
    ).rejects.toThrow("cancelled after link");
    await unchanged(output, directory);
  });
});

test("cancellation once journal rename starts completes commit and retains referenced files", async () => {
  await fixture(async (output, directory) => {
    const controller = new AbortController();
    await publishGeneration(output, {
      signal: controller.signal,
      fs: {
        ...publicationFileSystem,
        rename: async (...args) => {
          controller.abort(new Error("cancelled during commit"));
          await publicationFileSystem.rename(...args);
        },
      },
    });
    expect(await readFile(output.sqlPath, "utf8")).toBe(output.sql);
    expect(await readFile(output.snapshotPath, "utf8")).toBe(output.snapshot);
    expect(await readFile(output.journalPath, "utf8")).toBe(output.journal);
    expect(await readdir(directory)).toEqual(["0036_next.sql", "meta"]);
    expect(await readdir(join(directory, "meta"))).toEqual([
      "0036_snapshot.json",
      "_journal.json",
    ]);
  });
});
