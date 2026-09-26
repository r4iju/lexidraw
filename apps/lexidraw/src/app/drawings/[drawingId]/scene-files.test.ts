/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import { MAX_DRAWING_FILE_BYTES } from "@packages/types";
import { TRPCClientError } from "@trpc/client";
import { editorFile } from "~/lib/drawing-files";
import {
  drawingFileStore,
  FileRefused,
  SceneFiles,
  type StoredFile,
} from "./scene-files";

const image = (
  name: string,
  more: {
    status?: "pending" | "saved" | "error";
    isDeleted?: boolean;
    fileId?: string;
  } = {},
) =>
  ({
    id: `element-${name}`,
    type: "image",
    fileId: id(name),
    status: "pending",
    isDeleted: false,
    ...more,
  }) as unknown as ExcalidrawElement;

/** A PNG's signature, then `name`: bytes a drawing stores, one set per name. */
const bytesOf = (name: string) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(name),
  ]);
/** The id the file called `name` is stored under: the SHA-1 of its bytes. */
const id = (name: string) =>
  createHash("sha1").update(bytesOf(name)).digest("hex");
/** The file called `name`, under its own id unless another is given. */
const file = (
  name: string,
  {
    dataURL = `data:image/png;base64,${bytesOf(name).toString("base64")}`,
    as = id(name),
  } = {},
) => editorFile({ id: as, mimeType: "image/png", dataURL, created: 1 });

const filesOf = (...files: BinaryFileData[]): BinaryFiles =>
  Object.fromEntries(files.map((f) => [f.id, f]));

const stored = (name: string): StoredFile => ({
  id: id(name),
  mimeType: "image/png",
  url: `https://blob.test/${id(name)}`,
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

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
    rekeyed: [] as [string, string][],
    failed: [] as string[],
  };
  let listing = listed;
  const files = new SceneFiles(
    {
      list: async () => {
        calls.lists++;
        return listing;
      },
      fetch: async (stored) => file("any", { as: stored.id }),
      upload: (sent) => {
        calls.uploads.push(sent.id);
        return upload(sent);
      },
    },
    {
      addFiles: (added) => calls.added.push(...added.map((f) => f.id)),
      settle: (statuses) => calls.settled.push(...statuses),
      rekey: (from, to) => calls.rekeyed.push([from, to]),
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
    expect(calls.added.toSorted()).toEqual([id("a"), id("b")].toSorted());
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
    expect(calls.uploads).toEqual([id("new")]);

    sending.resolve();
    await tick();
    expect(calls.uploads).toEqual([id("new"), id("next")]);
    expect(calls.settled).toEqual([
      [id("new"), "saved"],
      [id("next"), "saved"],
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
    expect(calls.uploads).toEqual([id("new")]);
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
    expect(calls.uploads).toEqual([id("big")]);
    expect(calls.failed).toEqual([id("big")]);
    expect(calls.settled).toEqual([[id("big"), "error"]]);
  });

  test("over the size a drawing stores are refused without being sent", async () => {
    const { files, calls } = harness();
    await files.open();
    const huge = `data:image/png;base64,${"A".repeat(
      (Math.ceil(MAX_DRAWING_FILE_BYTES / 3) + 1) * 4,
    )}`;
    files.changed([image("huge")], filesOf(file("huge", { dataURL: huge })));
    await tick();
    expect(calls.uploads).toEqual([]);
    expect(calls.failed).toEqual([id("huge")]);
    expect(calls.settled).toEqual([[id("huge"), "error"]]);
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
    expect(calls.uploads).toEqual([id("flaky"), id("flaky"), id("flaky")]);
    expect(calls.failed).toEqual([id("flaky")]);
    expect(calls.settled).toEqual([[id("flaky"), "saved"]]);
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
    expect(calls.added).toEqual([id("theirs")]);
    const lists = calls.lists;
    files.changed([image("theirs", { status: "saved" })], {});
    await tick();
    expect(calls.lists).toBe(lists);
  });

  // Pasted from excalidraw.com or a library, or named before Lexidraw hashed it.
  test("whose id is not the hash of their bytes are stored under the hash, and their images pointed at it", async () => {
    const { files, calls } = harness();
    await files.open();
    const pasted = file("pasted", { as: "elsewhere" });
    files.changed([image("pasted", { fileId: "elsewhere" })], filesOf(pasted));
    await tick();
    expect(calls.added).toEqual([id("pasted")]);
    expect(calls.rekeyed).toEqual([["elsewhere", id("pasted")]]);
    expect(calls.uploads).toEqual([id("pasted")]);
    expect(calls.settled).toEqual([[id("pasted"), "saved"]]);
  });
});

describe("a drawing's file store", () => {
  test.each(["BAD_REQUEST", "PAYLOAD_TOO_LARGE"])(
    "takes a %s answer to a file as refusing it for good",
    async (code) => {
      const store = drawingFileStore(
        {
          files: { query: async () => ({ files: [] }) },
          putFile: {
            mutate: async () => {
              throw TRPCClientError.from({
                error: { message: "no", code: -32600, data: { code } },
              });
            },
          },
        },
        "drawing",
      );
      await expect(store.upload(file("refused"))).rejects.toBeInstanceOf(
        FileRefused,
      );
    },
  );
});
