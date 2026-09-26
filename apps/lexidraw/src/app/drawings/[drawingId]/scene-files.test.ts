/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import { MAX_DRAWING_FILE_BYTES } from "~/lib/drawing-files";
import { FileRefused, SceneFiles, type StoredFile } from "./scene-files";

const image = (
  fileId: string,
  more: { status?: "pending" | "saved" | "error"; isDeleted?: boolean } = {},
) =>
  ({
    id: `element-${fileId}`,
    type: "image",
    fileId,
    status: "pending",
    isDeleted: false,
    ...more,
  }) as unknown as ExcalidrawElement;

const file = (id: string, dataURL = "data:image/png;base64,AAAA") =>
  ({ id, mimeType: "image/png", dataURL, created: 1 }) as BinaryFileData;

const filesOf = (...files: BinaryFileData[]): BinaryFiles =>
  Object.fromEntries(files.map((f) => [f.id, f]));

const stored = (id: string): StoredFile => ({
  id,
  mimeType: "image/png",
  url: `https://blob.test/${id}`,
  created: 1,
});

/** A promise and the hands that settle it. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A drawing's file store and editor, recording what each was asked. */
function harness({
  listed = [] as StoredFile[],
  canUpload = true,
  upload = async (_: BinaryFileData) => {},
} = {}) {
  const calls = {
    lists: 0,
    uploads: [] as string[],
    added: [] as string[],
    settled: [] as [string, string][],
    failed: [] as string[],
  };
  let listing = listed;
  const files = new SceneFiles(
    {
      list: async () => {
        calls.lists++;
        return listing;
      },
      fetch: async (stored) => file(stored.id),
      upload: (sent) => {
        calls.uploads.push(sent.id);
        return upload(sent);
      },
    },
    {
      addFiles: (added) => calls.added.push(...added.map((f) => f.id)),
      settle: (statuses) => calls.settled.push(...statuses),
      failed: (fileId) => calls.failed.push(fileId),
    },
    { canUpload },
  );
  return {
    files,
    calls,
    store: (next: StoredFile[]) => {
      listing = next;
    },
  };
}

describe("a drawing's files in the editor", () => {
  test("are the stored ones once the drawing opens", async () => {
    const { files, calls } = harness({ listed: [stored("a"), stored("b")] });
    await files.open();
    expect(calls.added.toSorted()).toEqual(["a", "b"]);
  });

  test("are sent once each, one at a time, and their images marked saved", async () => {
    const sending = deferred();
    const { files, calls } = harness({ upload: () => sending.promise });
    await files.open();
    const scene = [image("new"), image("next")];
    const held = filesOf(file("new"), file("next"));
    files.changed(scene, held);
    files.changed(scene, held);
    await tick();
    expect(calls.uploads).toEqual(["new"]);

    sending.resolve();
    await tick();
    expect(calls.uploads).toEqual(["new", "next"]);
    expect(calls.settled).toEqual([
      ["new", "saved"],
      ["next", "saved"],
    ]);
  });

  test("are not sent when the drawing already stores them, even if a change comes first", async () => {
    const { files, calls } = harness({ listed: [stored("kept")] });
    files.changed(
      [image("kept"), image("new")],
      filesOf(file("kept"), file("new")),
    );
    await files.open();
    await tick();
    expect(calls.uploads).toEqual(["new"]);
  });

  test("are not sent for an image that is gone, or for no image at all", async () => {
    const { files, calls } = harness();
    await files.open();
    files.changed(
      [image("gone", { isDeleted: true })],
      filesOf(file("gone"), file("loose")),
    );
    await tick();
    expect(calls.uploads).toEqual([]);
  });

  test("are not sent from a drawing open to read", async () => {
    const { files, calls } = harness({ canUpload: false });
    await files.open();
    files.changed([image("new")], filesOf(file("new")));
    await tick();
    expect(calls.uploads).toEqual([]);
  });

  test("that the server refuses are said once, marked errored, and not sent again", async () => {
    const { files, calls } = harness({
      upload: async () => {
        throw new FileRefused("too big");
      },
    });
    await files.open();
    files.changed([image("big")], filesOf(file("big")));
    await tick();
    files.changed([image("big")], filesOf(file("big")));
    await tick();
    expect(calls.uploads).toEqual(["big"]);
    expect(calls.failed).toEqual(["big"]);
    expect(calls.settled).toEqual([["big", "error"]]);
  });

  test("over the size a drawing stores are refused without being sent", async () => {
    const { files, calls } = harness();
    await files.open();
    const huge = `data:image/png;base64,${"A".repeat(
      (Math.ceil(MAX_DRAWING_FILE_BYTES / 3) + 1) * 4,
    )}`;
    files.changed([image("huge")], filesOf(file("huge", huge)));
    await tick();
    expect(calls.uploads).toEqual([]);
    expect(calls.failed).toEqual(["huge"]);
    expect(calls.settled).toEqual([["huge", "error"]]);
  });

  test("that fail to send are said once and sent again on the next change", async () => {
    let attempts = 0;
    const { files, calls } = harness({
      upload: async () => {
        attempts++;
        if (attempts < 3) throw new Error("offline");
      },
    });
    await files.open();
    for (let change = 0; change < 3; change++) {
      files.changed([image("flaky")], filesOf(file("flaky")));
      await tick();
    }
    expect(calls.uploads).toEqual(["flaky", "flaky", "flaky"]);
    expect(calls.failed).toEqual(["flaky"]);
    expect(calls.settled).toEqual([["flaky", "saved"]]);
  });

  // A peer's image arrives before its file, which the peer stores after.
  test("are fetched when an image shows one this editor lacks, once it is stored", async () => {
    const { files, calls, store } = harness();
    await files.open();
    files.changed([image("theirs")], {});
    await tick();
    expect(calls.added).toEqual([]);

    store([stored("theirs")]);
    files.changed([image("theirs")], {});
    await tick();
    expect(calls.added).toEqual([]);

    files.changed([image("theirs", { status: "saved" })], {});
    await tick();
    expect(calls.added).toEqual(["theirs"]);
    const lists = calls.lists;
    files.changed([image("theirs", { status: "saved" })], {});
    await tick();
    expect(calls.lists).toBe(lists);
  });
});
