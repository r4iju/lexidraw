import { beforeAll, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const started: unknown[][] = [];
let launch: Promise<unknown> | undefined;
mock.module("workflow/api", () => ({
  start: async (_workflow: unknown, args: unknown[]) => {
    started.push(args);
    return launch ?? {};
  },
}));
const { appRouter } = await import("~/server/api/root");
const { markdownToEditorState } = await import("~/server/documents/markdown");
const caller = appRouter.createCaller({
  drizzle: db,
  schema,
  session: { user: { id: "thumbq_owner" } },
  auth: { kind: "session" },
  headers: new Headers(),
} as never);
const empty = JSON.stringify({
  root: {
    type: "root",
    version: 1,
    children: [],
    direction: null,
    format: "",
    indent: 0,
  },
});
beforeAll(async () => {
  await db.insert(schema.users).values({
    id: "thumbq_owner",
    name: "Owner",
    email: "thumbq@example.test",
  });
});

async function queued(id: string, write: () => Promise<unknown>) {
  const before = started.length;
  await write();
  const listed = (await caller.entities.list({})).find((row) => row.id === id);
  expect(listed?.thumbnailStatus).toBe("pending");
  expect(listed?.thumbnailVersion).toBeTruthy();
  expect(started.slice(before)).toContainEqual([
    expect.any(String),
    id,
    listed?.thumbnailVersion,
  ]);
}

test("document create, editor save and each markdown write queue a current thumbnail", async () => {
  const id = "8d2f6a3c-1b4e-4c7d-9e0f-2a3b4c5d6e01";
  await queued(id, () =>
    caller.entities.create({
      id,
      title: "Queue",
      entityType: "document",
      elements: empty,
      parentId: null,
    }),
  );
  await queued(id, () =>
    caller.documents.appendMarkdown({ id, markdown: "# Hello" }),
  );
  let revision = await caller.documents.getMarkdown({ id, format: "raw" });
  await queued(id, () =>
    caller.documents.insertMarkdown({
      id,
      markdown: "Inserted",
      atBlockIndex: 1,
      ifUnmodifiedSince: new Date(revision.updatedAt).toISOString(),
    }),
  );
  revision = await caller.documents.getMarkdown({ id, format: "raw" });
  await queued(id, () =>
    caller.documents.replaceMarkdown({
      id,
      markdown: "# Replaced",
      ifUnmodifiedSince: new Date(revision.updatedAt).toISOString(),
    }),
  );
  await queued(id, () =>
    caller.documents.save({
      id,
      elements: JSON.stringify(markdownToEditorState("Saved in the editor")),
    }),
  );
  await queued(id, () =>
    caller.entities.save({
      id,
      elements: JSON.stringify(markdownToEditorState("Saved again")),
    }),
  );
  const count = started.length;
  await expect(
    caller.documents.replaceMarkdown({
      id,
      markdown: "Stale",
      ifUnmodifiedSince: "2000-01-01T00:00:00.000Z",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(started).toHaveLength(count);
  await queued("8d2f6a3c-1b4e-4c7d-9e0f-2a3b4c5d6e02", () =>
    caller.documents.create({
      id: "8d2f6a3c-1b4e-4c7d-9e0f-2a3b4c5d6e02",
      title: "Direct",
      elements: empty,
    }),
  );
});

test("drawing create and put queue a thumbnail, directories do not", async () => {
  await queued("8d2f6a3c-1b4e-4c7d-9e0f-2a3b4c5d6e03", () =>
    caller.drawings.create({
      id: "8d2f6a3c-1b4e-4c7d-9e0f-2a3b4c5d6e03",
      title: "Drawing",
      elements: [],
    }),
  );
  const drawing = await caller.drawings.get({
    id: "8d2f6a3c-1b4e-4c7d-9e0f-2a3b4c5d6e03",
  });
  await queued(drawing.id, () =>
    caller.drawings.put({
      id: drawing.id,
      elements: [
        { id: "shape", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
      ],
      ifUnmodifiedSince: drawing.updatedAt,
    }),
  );
  const count = started.length;
  await caller.entities.create({
    id: "8d2f6a3c-1b4e-4c7d-9e0f-2a3b4c5d6e04",
    title: "Folder",
    entityType: "directory",
    elements: "{}",
    parentId: null,
  });
  expect(started).toHaveLength(count);
});

test("a slow thumbnail cannot replace the picture of a newer write", async () => {
  const id = "8d2f6a3c-1b4e-4c7d-9e0f-2a3b4c5d6e05";
  await caller.entities.create({
    id,
    title: "Race",
    entityType: "document",
    elements: empty,
    parentId: null,
  });
  const before = (await caller.entities.list({})).find((row) => row.id === id);
  await caller.documents.appendMarkdown({ id, markdown: "A newer revision" });
  const current = (await caller.entities.list({})).find((row) => row.id === id);
  const { updateEntityStep } = await import(
    "~/workflows/thumbnail/update-entity-step"
  );
  await updateEntityStep(
    id,
    "https://example.test/new-light.png",
    "https://example.test/new-dark.png",
    current?.thumbnailVersion ?? "",
  );
  await updateEntityStep(
    id,
    "https://example.test/old-light.png",
    "https://example.test/old-dark.png",
    before?.thumbnailVersion ?? "",
  );
  const listed = (await caller.entities.list({})).find((row) => row.id === id);
  expect(listed?.thumbnailVersion).toBe(current?.thumbnailVersion);
  expect(listed?.screenShotLight).toBe("https://example.test/new-light.png");
  expect(listed?.thumbnailStatus).toBe("ready");
});

test("same-version saves preserve pending and processing jobs", async () => {
  const id = "8d2f6a3c-1b4e-4c7d-9e0f-2a3b4c5d6e06";
  await caller.documents.create({ id, title: "Duplicate", elements: empty });
  const { eq } = await import("drizzle-orm");
  for (const status of ["pending", "processing"] as const) {
    await db
      .update(schema.thumbnailJobs)
      .set({ status, attempts: 2 })
      .where(eq(schema.thumbnailJobs.entityId, id));
    const before = started.length;
    await caller.documents.save({ id, elements: empty });
    expect(started).toHaveLength(before);
    const job = await db.query.thumbnailJobs.findFirst({
      where: eq(schema.thumbnailJobs.entityId, id),
    });
    expect(job?.status).toBe(status);
    expect(job?.attempts).toBe(2);
  }
});

test("writes finish while the workflow launcher is still pending", async () => {
  let release!: () => void;
  launch = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const write = caller.documents.create({
      id: "8d2f6a3c-1b4e-4c7d-9e0f-2a3b4c5d6e07",
      title: "Slow launch",
      elements: empty,
    });
    const result = await Promise.race([
      write.then(() => "saved"),
      Bun.sleep(300).then(() => "blocked"),
    ]);
    expect(result).toBe("saved");
  } finally {
    release();
    launch = undefined;
  }
});
