import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import { TRPCClientError } from "@trpc/client";
import {
  dataURLOf,
  drawingFileId,
  editorFile,
  readDrawingFile,
} from "~/lib/drawing-files";
import type { RouterInputs, RouterOutputs } from "~/trpc/shared";

/** A file the drawing stores, as `drawings.files` lists it. */
export type StoredFile = RouterOutputs["drawings"]["files"]["files"][number];

/**
 * The server will not store a file, and sending it again changes nothing
 * while this editor is open.
 */
export class FileRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileRefused";
  }
}

type Store = {
  list: () => Promise<StoredFile[]>;
  fetch: (file: StoredFile) => Promise<BinaryFileData>;
  /** Throws {@link FileRefused} when the server refuses the file itself. */
  upload: (file: BinaryFileData) => Promise<void>;
};

type Editor = {
  addFiles: (files: BinaryFileData[]) => void;
  /** Sets the status of the image elements showing each file. */
  settle: (statuses: [fileId: string, status: "saved" | "error"][]) => void;
  /** Points the image elements showing file `from` at file `to`. */
  rekey: (from: string, to: BinaryFileData["id"]) => void;
  /** Says why a file was not stored; called once per file. */
  failed: (fileId: string, reason: string) => void;
};

type Scene = { elements: readonly ExcalidrawElement[]; files: BinaryFiles };

/** The calls of the drawings API the file store makes. */
type FilesApi = {
  files: { query: (input: { id: string }) => Promise<{ files: StoredFile[] }> };
  putFile: {
    mutate: (
      input: RouterInputs["drawings"]["putFile"],
      options: { context: { skipBatch: true } },
    ) => Promise<unknown>;
  };
};

/** The drawing's file store, as the drawings API keeps it. */
export function drawingFileStore(api: FilesApi, drawingId: string): Store {
  return {
    list: async () => (await api.files.query({ id: drawingId })).files,
    fetch: async (stored) => {
      const response = await fetch(stored.url);
      if (!response.ok) throw new Error(`${response.status}`);
      return editorFile({
        id: stored.id,
        mimeType: stored.mimeType,
        dataURL: dataURLOf(
          stored.mimeType,
          new Uint8Array(await response.arrayBuffer()),
        ),
        created: stored.created,
      });
    },
    upload: async (file) => {
      try {
        await api.putFile.mutate(
          {
            id: drawingId,
            fileId: file.id,
            mimeType: file.mimeType,
            dataURL: file.dataURL,
          },
          { context: { skipBatch: true } },
        );
      } catch (error) {
        if (
          error instanceof TRPCClientError &&
          (error.data?.code === "BAD_REQUEST" ||
            error.data?.code === "PAYLOAD_TOO_LARGE")
        ) {
          throw new FileRefused(error.message);
        }
        throw error;
      }
    },
  };
}

/**
 * The files an open drawing's image elements show, kept in step with the
 * drawing's file store: the stored ones are loaded when it opens, one an
 * image shows that this editor lacks is fetched once it is stored, and one
 * this editor added is sent, once, and its images marked saved so the next
 * save tells everyone else it is there to fetch. One whose id is not the hash
 * of its bytes, as a file pasted from elsewhere brings, is sent under the
 * hash, and its images pointed at that.
 *
 * Nothing is sent until the listing says what is stored already, and files
 * go one at a time; see `MAX_DRAWING_FILE_BYTES`.
 */
export class SceneFiles {
  /** On the server, as listed or since sent. */
  private readonly stored = new Set<string>();
  /** In the editor, or on the way there. */
  private readonly loaded = new Set<string>();
  /** Files looked for in the store, by id and the status that sent us. */
  private readonly sought = new Set<string>();
  /** Refused for good, so never sent again. */
  private readonly refused = new Set<string>();
  /** Failures already said, so a retry that fails too stays quiet. */
  private readonly reported = new Set<string>();
  private readonly queue = new Map<string, BinaryFileData>();
  private sending = false;
  private listing: Promise<void> | null = null;
  private ready = false;
  private closed = false;
  private latest: Scene | null = null;

  constructor(
    private readonly store: Store,
    private readonly editor: Editor,
    private readonly options: { canUpload: boolean },
  ) {}

  /** Loads what the drawing stores; changes before it lands wait for it. */
  async open(): Promise<void> {
    await this.relist();
    this.ready = true;
    if (this.latest) this.changed(this.latest.elements, this.latest.files);
  }

  /** Stops acting on answers that arrive after the editor is gone. */
  close(): void {
    this.closed = true;
  }

  /** Excalidraw reported the scene. */
  changed(elements: readonly ExcalidrawElement[], files: BinaryFiles): void {
    if (this.closed) return;
    if (!this.ready) {
      this.latest = { elements, files };
      return;
    }
    let lacking = false;
    for (const element of elements) {
      if (element.type !== "image" || element.isDeleted || !element.fileId) {
        continue;
      }
      const id = element.fileId;
      const held = files[id];
      if (held) {
        this.loaded.add(id);
        if (this.options.canUpload) this.enqueue(held);
        continue;
      }
      const seeking = `${id}:${element.status}`;
      if (this.loaded.has(id) || this.sought.has(seeking)) continue;
      this.sought.add(seeking);
      lacking = true;
    }
    if (lacking) void this.relist();
    void this.send();
  }

  private enqueue(file: BinaryFileData): void {
    if (
      this.stored.has(file.id) ||
      this.refused.has(file.id) ||
      this.queue.has(file.id)
    ) {
      return;
    }
    this.queue.set(file.id, file);
  }

  private async send(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      for (const [queued, file] of this.queue) {
        if (this.closed) return;
        let id = queued;
        try {
          const checked = readDrawingFile(file.mimeType, file.dataURL);
          if (!checked.ok) throw new FileRefused(checked.reason);
          id = await drawingFileId(checked.bytes);
          if (this.closed) return;
          const sent =
            id === queued
              ? file
              : editorFile({
                  id,
                  mimeType: checked.mimeType,
                  dataURL: file.dataURL,
                  created: file.created,
                });
          if (id !== queued) {
            this.loaded.add(id);
            this.editor.addFiles([sent]);
            this.editor.rekey(queued, sent.id);
          }
          if (!this.stored.has(id)) await this.store.upload(sent);
          this.stored.add(id);
          this.editor.settle([[id, "saved"]]);
        } catch (error) {
          if (error instanceof FileRefused) {
            this.refused.add(queued);
            this.refused.add(id);
            this.editor.settle([[id, "error"]]);
          }
          this.report(id, error);
        } finally {
          this.queue.delete(queued);
        }
      }
    } finally {
      this.sending = false;
    }
  }

  private report(id: string, error: unknown): void {
    if (this.closed || this.reported.has(id)) return;
    this.reported.add(id);
    this.editor.failed(
      id,
      error instanceof Error ? error.message : "The image was not stored",
    );
  }

  /** Lists the store and loads what this editor lacks; one listing at a time. */
  private relist(): Promise<void> {
    this.listing ??= this.load().finally(() => {
      this.listing = null;
    });
    return this.listing;
  }

  private async load(): Promise<void> {
    let listed: StoredFile[];
    try {
      listed = await this.store.list();
    } catch (error) {
      console.error("drawing files not listed", error);
      return;
    }
    const missing = listed.filter((file) => {
      this.stored.add(file.id);
      return !this.loaded.has(file.id);
    });
    for (const file of missing) this.loaded.add(file.id);
    const fetched = await Promise.all(
      missing.map((file) =>
        this.store.fetch(file).catch((error: unknown) => {
          this.loaded.delete(file.id);
          console.error("drawing file not fetched", file.id, error);
          return null;
        }),
      ),
    );
    const files = fetched.filter((file) => file !== null);
    if (!this.closed && files.length > 0) this.editor.addFiles(files);
  }
}
